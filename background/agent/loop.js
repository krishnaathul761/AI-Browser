/**
 * background/agent/loop.js
 *
 * Approval-based agent loop (Slice 3.3, Architecture §7.7).
 *
 * Enforces human-in-the-loop safety:
 * - Scans page -> model proposes ONE action -> pauses in 'awaiting_approval'
 * - NEVER executes any DOM mutation without explicit user Approve
 * - Stop / Skip / Step limits supported
 * - Persists session state to chrome.storage.local
 */

let activeAgentSession = null;

/**
 * Persist the current session state to local storage.
 */
async function persistAgentSession() {
  await saveAgentSession(activeAgentSession);
}

/**
 * Restore agent session from storage (e.g. after service worker restart).
 */
async function restoreAgentSession() {
  activeAgentSession = await loadAgentSession();
  return activeAgentSession;
}

/**
 * Get current agent session state (restores from storage if needed).
 */
async function getAgentState() {
  if (!activeAgentSession) {
    await restoreAgentSession();
  }
  return activeAgentSession;
}

/**
 * Ensure content scripts are active in the target tab.
 */
async function ensureContentScriptInjected(tabId) {
  try {
    if (!chrome.scripting || !chrome.scripting.executeScript) return false;
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        "lib/readability.js",
        "lib/readability-readerable.js",
        "content/extract.js",
        "content/scanner.js",
        "content/overlay.js",
        "content/execute.js",
        "content/index.js",
      ],
    });
    await new Promise((r) => setTimeout(r, 150));
    return true;
  } catch (err) {
    console.warn("[Sahayak] Auto-injecting content scripts into tab " + tabId + " failed:", err.message);
    return false;
  }
}

/**
 * Send message to tab with auto-injection retry and timeout.
 */
async function sendMessageWithTimeout(tabId, message, timeoutMs = 8000) {
  try {
    return await Promise.race([
      chrome.tabs.sendMessage(tabId, message),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Page communication timed out after ${timeoutMs / 1000}s. Please refresh the page tab.`)),
          timeoutMs
        )
      ),
    ]);
  } catch (err) {
    // If receiving end is missing (e.g. tab was open before extension reloaded), auto-inject and retry once
    if (err && err.message && err.message.includes("Receiving end does not exist")) {
      console.log(`[Sahayak Agent] Content script not detected in tab ${tabId}. Auto-injecting scripts...`);
      const injected = await ensureContentScriptInjected(tabId);
      if (injected) {
        return await Promise.race([
          chrome.tabs.sendMessage(tabId, message),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error(`Page communication timed out after retry.`)),
              timeoutMs
            )
          ),
        ]);
      }
    }
    throw err;
  }
}

/**
 * Step loop: scan page -> ask model for ONE action -> wait for user approval.
 *
 * @param {Object} session
 * @returns {Promise<Object>} updated session
 */
async function advanceAgentStep(session) {
  if (!session || session.status === "stopped" || session.status === "complete") {
    return session;
  }

  // 1. Check max steps limit
  if (session.step >= session.maxSteps) {
    session.status = "complete";
    session.currentProposal = {
      action: "done",
      reason: `Maximum step limit (${session.maxSteps}) reached.`,
    };
    await persistAgentSession();
    return session;
  }

  session.status = "running";
  session.currentProposal = null;
  session.lastError = null;
  await persistAgentSession();

  // 2. Safety check: target tab and URL
  let tabUrl = "";
  try {
    const tab = await chrome.tabs.get(session.tabId);
    tabUrl = (tab && tab.url) || "";
  } catch (_e) {
    session.status = "error";
    session.lastError = "Target tab is no longer available.";
    await persistAgentSession();
    return session;
  }

  if (isRestrictedUrl(tabUrl)) {
    session.status = "error";
    session.lastError = "RESTRICTED_PAGE: Agent automation is blocked on restricted browser or payment pages.";
    await persistAgentSession();
    return session;
  }

  // 3. Scan interactive elements with badges visible
  let scanReply;
  try {
    scanReply = await sendMessageWithTimeout(session.tabId, {
      type: "SCAN_INTERACTIVE",
      requestId: uuid(),
      payload: { showBadges: true },
    }, 8000);
  } catch (err) {
    console.error("[Sahayak Agent] SCAN_INTERACTIVE failed:", err);
    session.status = "error";
    session.lastError = err.message || "Could not scan the page. Please ensure the tab is refreshed and active.";
    await persistAgentSession();
    return session;
  }

  if (!scanReply || !scanReply.ok || !scanReply.data || !Array.isArray(scanReply.data.elements)) {
    session.status = "error";
    session.lastError = (scanReply && scanReply.error) || "Could not detect interactive elements on the page.";
    await persistAgentSession();
    return session;
  }

  const elements = scanReply.data.elements;
  if (elements.length === 0) {
    session.status = "error";
    session.lastError = "No interactive elements found on the page.";
    await persistAgentSession();
    return session;
  }

  if (session.status === "stopped") {
    return session;
  }

  // 4. Construct prompt and query AI model
  const settings = await readSettings();
  const prompt = buildAgentStepPrompt(session.goal, session.history, elements, settings.language);

  console.log(`[Sahayak Agent] Querying AI model for Step ${session.step + 1} (${elements.length} elements)...`);
  let rawResponse;
  try {
    rawResponse = await callAI({
      model: GEMINI_FLASH_LITE,
      prompt,
      settings,
      maxTokens: 500,
    });
    console.log("[Sahayak Agent] AI raw response:", rawResponse);
  } catch (err) {
    console.error("[Sahayak Agent] AI call failed:", err);
    session.status = "error";
    session.lastError = typeof geminiErrorMessage === "function" ? geminiErrorMessage(err) : (err.message || "AI call failed.");
    await persistAgentSession();
    return session;
  }

  if (session.status === "stopped") {
    return session;
  }

  // 5. Validate JSON proposal
  let validation = validateAgentAction(rawResponse, elements);

  // If first attempt was malformed, retry once with Flash
  if (!validation.ok) {
    try {
      console.warn("[Sahayak Agent] First attempt invalid, retrying with Flash...", validation.error);
      const retryPrompt =
        prompt + "\n\nCRITICAL: Return ONLY valid JSON with keys: action, n, value, reason. No other text.";
      const retryRaw = await callAI({
        model: GEMINI_FLASH,
        prompt: retryPrompt,
        settings,
        maxTokens: 500,
      });
      validation = validateAgentAction(retryRaw, elements);
    } catch (_retryErr) {}
  }

  if (session.status === "stopped") {
    return session;
  }

  if (!validation.ok) {
    session.status = "error";
    session.lastError = `Model returned invalid action: ${validation.error}`;
    await persistAgentSession();
    return session;
  }

  const proposal = validation.data;
  console.log("[Sahayak Agent] Step proposal ready:", proposal);

  // 6. Action: "done" -> complete
  if (proposal.action === "done") {
    session.status = "complete";
    session.currentProposal = proposal;
    session.pendingProposal = proposal;
    session.stopReason = proposal.reason || "All planned steps finished successfully.";
    await persistAgentSession();
    return session;
  }

  // 7. Action requiring approval -> pause in "awaiting_approval"
  session.status = "awaiting_approval";
  session.currentProposal = proposal;
  session.pendingProposal = proposal;
  session.currentStep = session.step + 1;

  // Highlight the target element on the page so the user can inspect it
  if (proposal.n) {
    try {
      await sendMessageWithTimeout(session.tabId, {
        type: "HIGHLIGHT_ELEMENT",
        requestId: uuid(),
        payload: { n: proposal.n },
      }, 5000);
    } catch (_err) {}
  }

  await persistAgentSession();
  return session;
}

/**
 * Start a new agent task.
 *
 * @param {string} goal - user goal instruction
 * @param {number} [tabId] - target tab ID
 * @param {number} [maxSteps=20] - max steps limit
 * @returns {Promise<Object>} session state
 */
async function agentStart(goal, tabId, maxSteps = 20, dryRun = undefined) {
  if (!goal || !goal.trim()) {
    throw new Error("Please describe the goal for the agent.");
  }

  const resolvedTabId = await resolveTabId(tabId);
  if (resolvedTabId === null) {
    throw new Error("No active tab found.");
  }

  const settings = await readSettings();
  const limit = Number.isInteger(maxSteps) && maxSteps > 0 ? maxSteps : settings.maxAgentSteps || 20;
  const isDryRun = typeof dryRun === "boolean" ? dryRun : Boolean(settings.dryRunDefault);

  activeAgentSession = {
    id: uuid(),
    status: "running",
    goal: goal.trim(),
    tabId: resolvedTabId,
    step: 0,
    currentStep: 1,
    maxSteps: limit,
    dryRun: isDryRun,
    currentProposal: null,
    pendingProposal: null,
    history: [],
    lastError: null,
    startedAt: Date.now(),
  };

  await persistAgentSession();
  return advanceAgentStep(activeAgentSession);
}

/**
 * Approve the current proposed action and execute it in the page (or simulate in dry-run).
 *
 * @returns {Promise<Object>} updated session state
 */
async function agentApprove() {
  if (!activeAgentSession) {
    await restoreAgentSession();
  }
  if (!activeAgentSession) {
    throw new Error("No active agent task.");
  }
  const proposal = activeAgentSession.currentProposal || activeAgentSession.pendingProposal;
  if (activeAgentSession.status !== "awaiting_approval" || !proposal) {
    throw new Error("No action is currently awaiting approval.");
  }

  let execResult;
  let decision = "approved";
  let status = "executed";

  // 1. Dry-run mode vs Live execution
  if (activeAgentSession.dryRun) {
    decision = "dry-run";
    status = "dry-run";
    // In dry-run, highlight and scroll to the target element, but DO NOT mutate DOM
    if (proposal.n) {
      try {
        await sendMessageWithTimeout(activeAgentSession.tabId, {
          type: "HIGHLIGHT_ELEMENT",
          requestId: uuid(),
          payload: { n: proposal.n },
        }, 5000);
      } catch (_e) {}
    }
    execResult = { ok: true, dryRun: true, message: "Dry-run: Highlighted only. DOM unchanged." };
  } else {
    try {
      execResult = await sendMessageWithTimeout(activeAgentSession.tabId, {
        type: "EXECUTE_ACTION",
        requestId: uuid(),
        payload: { proposal },
      }, 10000);
      status = (execResult && execResult.ok) ? "executed" : "error";
    } catch (err) {
      execResult = { ok: false, error: err.message || "Could not execute action on the page." };
      status = "error";
    }
  }

  // 2. Record action in session history and persistent action log
  const historyItem = {
    step: activeAgentSession.step + 1,
    proposal,
    decision,
    status,
    result: execResult,
    at: Date.now(),
  };
  activeAgentSession.history.push(historyItem);

  await appendActionLog({
    step: activeAgentSession.step + 1,
    proposal,
    reason: proposal.reason || "",
    decision,
    taskGoal: activeAgentSession.goal,
    at: Date.now(),
  });

  // If execution failed (e.g. stale element or sensitive field refusal)
  if (!execResult || !execResult.ok) {
    activeAgentSession.lastError = (execResult && execResult.error) || "Execution failed on the page.";
  }

  activeAgentSession.step++;
  activeAgentSession.currentStep = activeAgentSession.step + 1;

  // 3. Advance to the next step
  return advanceAgentStep(activeAgentSession);
}

/**
 * Skip the current proposed action and continue the loop.
 *
 * @returns {Promise<Object>} updated session state
 */
async function agentSkip() {
  if (!activeAgentSession) {
    await restoreAgentSession();
  }
  if (!activeAgentSession) {
    throw new Error("No active agent task.");
  }
  const proposal = activeAgentSession.currentProposal || activeAgentSession.pendingProposal;
  if (activeAgentSession.status !== "awaiting_approval" || !proposal) {
    throw new Error("No action is currently awaiting approval.");
  }

  activeAgentSession.history.push({
    step: activeAgentSession.step + 1,
    proposal,
    decision: "skipped",
    status: "skipped",
    at: Date.now(),
  });

  await appendActionLog({
    step: activeAgentSession.step + 1,
    proposal,
    reason: proposal.reason || "",
    decision: "skipped",
    taskGoal: activeAgentSession.goal,
    at: Date.now(),
  });

  activeAgentSession.step++;
  activeAgentSession.currentStep = activeAgentSession.step + 1;
  return advanceAgentStep(activeAgentSession);
}

/**
 * Stop the agent task immediately.
 *
 * @param {string} [reason] - stop reason
 * @returns {Promise<Object>} updated session state
 */
async function agentStop(reason = "Stopped by user") {
  if (!activeAgentSession) {
    await restoreAgentSession();
  }
  if (!activeAgentSession) {
    return { status: "idle" };
  }

  const proposal = activeAgentSession.currentProposal || activeAgentSession.pendingProposal;
  if (proposal) {
    await appendActionLog({
      step: activeAgentSession.step + 1,
      proposal,
      reason: reason || "Stopped by user",
      decision: "stopped",
      taskGoal: activeAgentSession.goal,
      at: Date.now(),
    });
  }

  activeAgentSession.status = "stopped";
  activeAgentSession.stopReason = reason;

  // Clear badges and overlays from the page
  try {
    await chrome.tabs.sendMessage(activeAgentSession.tabId, {
      type: "CLEAR_OVERLAYS",
      requestId: uuid(),
    });
  } catch (_e) {}

  await persistAgentSession();
  return activeAgentSession;
}

/**
 * Clear step history of the active errand session.
 *
 * @returns {Promise<Object|null>}
 */
async function agentHistoryClear() {
  if (!activeAgentSession) {
    await restoreAgentSession();
  }
  if (activeAgentSession) {
    activeAgentSession.history = [];
    await persistAgentSession();
  }
  return activeAgentSession;
}

/**
 * Reset active agent session back to idle.
 *
 * @returns {Promise<Object>}
 */
async function agentReset() {
  activeAgentSession = null;
  await clearAgentSession();
  return { status: "idle" };
}

