const bannerEl = document.getElementById("banner");
const settingsBtn = document.getElementById("open-settings");
const langButtons = document.querySelectorAll(".lang-btn");
const tabButtons = document.querySelectorAll(".tab");
const summariseBtn = document.getElementById("summarise-btn");
const summaryArea = document.getElementById("summary-area");
const explainBtn = document.getElementById("explain-btn");
const resultArea = document.getElementById("result-area");

// ── Last-action state (used to re-run on language toggle) ─────────────────────
//
// Stores the last result data so language toggle can translate it cheaply
// via Groq instead of re-calling the full API.
//
// Shape:
//   { type: "summary"|"youtube", data: SummaryData }
//   { type: "explain", data: { result: string } }
//   null
//
let lastAction = null;

// ── Banner ────────────────────────────────────────────────────────────────────

function showBanner(message, kind) {
  if (!message) {
    bannerEl.hidden = true;
    bannerEl.textContent = "";
    bannerEl.classList.remove("is-ok");
    return;
  }
  bannerEl.hidden = false;
  bannerEl.classList.toggle("is-ok", kind === "ok");
  bannerEl.textContent = "";
  bannerEl.append(message);
  if (kind === "settings") {
    const cta = document.createElement("button");
    cta.type = "button";
    cta.className = "banner-cta";
    cta.textContent = "Open Settings";
    cta.addEventListener("click", openSettings);
    bannerEl.append(" ");
    bannerEl.append(cta);
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────

function openSettings() {
  if (globalThis.chrome && chrome.runtime && chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
    return;
  }
  showBanner("Open Sahayak as a Chrome extension to use Settings.");
}

// ── Messaging ─────────────────────────────────────────────────────────────────

async function send(type, payload) {
  if (!globalThis.chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
    throw new Error("Load unpacked in Chrome to talk to the extension.");
  }
  const message = envelope(type, payload);
  const response = await chrome.runtime.sendMessage(message);
  if (!response) {
    throw new Error("No response from background");
  }
  if (!response.ok) {
    throw new Error(response.error || "Request failed");
  }
  return response.data;
}

// ── Language toggle ───────────────────────────────────────────────────────────

function applyLanguage(language) {
  langButtons.forEach((btn) => {
    btn.classList.toggle("is-active", btn.getAttribute("data-lang") === language);
  });
}

async function setLanguage(language) {
  applyLanguage(language);
  // Save language setting — fire and don't await so a slow SW wake doesn't
  // block the rerun. Errors are swallowed here; the toggle UI already updated.
  send("SETTINGS_SET", { language: language }).catch(() => {});
  // Re-run the last action in the new language immediately.
  if (lastAction) {
    await rerunLastAction();
  }
}

langButtons.forEach((btn) => {
  btn.addEventListener("click", (evt) => {
    const language = btn.getAttribute("data-lang");
    setLanguage(language).catch((err) => {
      showBanner(err.message || "Could not switch language.");
    });
  });
});

// ── Translate last result in new language ─────────────────────────────────────

/**
 * Translates the stored last result into the new language via TRANSLATE_RESULT.
 * Uses Groq for text — never re-calls Gemini Flash.
 * Falls back to a full re-run if translation fails.
 */
async function rerunLastAction() {
  if (!lastAction) return;

  const { type, data } = lastAction;

  try {
    if (type === "summary" || type === "youtube") {
      summaryArea.hidden = false;
      summaryArea.innerHTML = "";
      const loadingDiv = document.createElement("div");
      loadingDiv.className = "loading-state";
      loadingDiv.textContent = "Translating…";
      summaryArea.appendChild(loadingDiv);
      summariseBtn.disabled = true;

      // Get current language from settings.
      const settings = await send("SETTINGS_GET");
      const language = settings.language || "en";

      // Send just the text fields to translate — no video/article re-fetch.
      const fields = {
        tldr:       data.tldr,
        keyPoints:  data.keyPoints,
        nextSteps:  data.nextSteps,
        timestamps: data.timestamps,
      };

      const translated = await send("TRANSLATE_RESULT", { fields, language });

      // Merge translated fields back into the original data shape.
      const newData = Object.assign({}, data, {
        tldr:       translated.tldr,
        keyPoints:  translated.keyPoints,
        nextSteps:  translated.nextSteps,
        timestamps: translated.timestamps || data.timestamps,
        fromCache:  true,
      });

      // Update lastAction so next toggle also translates from latest.
      lastAction = { type, data: newData };
      showSummary(newData);

    } else if (type === "explain") {
      showLoading("Translating…");
      explainBtn.disabled = true;

      // For explanations, just re-run SELECTION_ACTION — it's Flash-Lite
      // which is cheap and has 1,000 RPD. No separate translate needed.
      const newData = await send("SELECTION_ACTION", { mode: "explain" });
      lastAction = { type: "explain", data: newData };
      showResult({ label: "Explanation", body: newData.result, kind: "explain" });
    }

  } catch (err) {
    if (type === "summary" || type === "youtube") {
      summaryArea.innerHTML = "";
      summaryArea.hidden = true;
    } else {
      resultArea.innerHTML = "";
      resultArea.hidden = true;
    }
    showBanner(err.message || "Could not translate. Try again.");
  } finally {
    summariseBtn.disabled = false;
    explainBtn.disabled = false;
  }
}

// ── Tab switching ─────────────────────────────────────────────────────────────

tabButtons.forEach((btn) => {
  if (btn.disabled) return;
  btn.addEventListener("click", () => {
    const target = btn.getAttribute("data-tab");
    tabButtons.forEach((b) => b.classList.toggle("is-active", b.getAttribute("data-tab") === target));
    document.querySelectorAll(".view").forEach((view) => {
      view.hidden = view.getAttribute("data-view") !== target;
    });
    // Clear last action when switching tabs — result belongs to the previous tab.
    lastAction = null;
  });
});

// ── Result area ───────────────────────────────────────────────────────────────

/** Show a loading spinner in the result area. */
function showLoading(label) {
  resultArea.hidden = false;
  resultArea.innerHTML = "";
  const div = document.createElement("div");
  div.className = "loading-state";
  div.textContent = label || "Thinking…";
  resultArea.appendChild(div);
}

/**
 * Render a result card in the result area.
 *
 * @param {{ label: string, body: string, kind?: "explain"|"summary" }} opts
 */
function showResult(opts) {
  resultArea.hidden = false;
  resultArea.innerHTML = "";

  const card = document.createElement("div");
  card.className = "result-card";

  const header = document.createElement("div");
  header.className = "result-header";

  const labelEl = document.createElement("span");
  labelEl.className = "result-label";
  labelEl.textContent = opts.label || "Result";
  header.appendChild(labelEl);

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "copy-btn";
  copyBtn.title = "Copy to clipboard";
  copyBtn.textContent = "Copy";
  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(opts.body).then(() => {
      copyBtn.textContent = "Copied!";
      setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
    }).catch(() => {});
  });
  header.appendChild(copyBtn);

  card.appendChild(header);

  const body = document.createElement("p");
  body.className = "result-body";
  // Preserve line-breaks from the model response.
  body.textContent = opts.body;
  card.appendChild(body);

  resultArea.appendChild(card);
}

/** Show an inline error inside the result area (not the global banner). */
function showResultError(message) {
  resultArea.hidden = false;
  resultArea.innerHTML = "";
  const div = document.createElement("div");
  div.className = "result-error";
  div.textContent = message;
  resultArea.appendChild(div);
}

// ── Summarise page ────────────────────────────────────────────────────────────

function showSummary(data) {
  summaryArea.hidden = false;
  summaryArea.innerHTML = "";

  // Build a force-refresh handler for cached results.
  const onRefresh = data.fromCache ? () => runSummarise(true) : null;

  // Route to the right renderer.
  if (data.videoId) {
    showYouTubeSummary(data, onRefresh);
  } else {
    showArticleSummary(data, onRefresh);
  }
}

// ── Article summary renderer ──────────────────────────────────────────────────

function showArticleSummary(data, onRefresh) {
  const card = document.createElement("div");
  card.className = "summary-card";

  const header = buildSummaryHeader("Summary", data.isFallback, buildCopyText(data), onRefresh);
  card.appendChild(header);

  // Raw fallback
  if (data.parseError) {
    const rawP = document.createElement("p");
    rawP.className = "result-body";
    rawP.textContent = data.raw || "No summary returned.";
    card.appendChild(rawP);
    summaryArea.appendChild(card);
    return;
  }

  card.appendChild(buildTldrSection(data.tldr));
  card.appendChild(buildKeyPointsSection(data.keyPoints));
  card.appendChild(buildNextStepsSection(data.nextSteps));
  summaryArea.appendChild(card);
}

// ── YouTube summary renderer ──────────────────────────────────────────────────

function showYouTubeSummary(data, onRefresh) {
  const card = document.createElement("div");
  card.className = "summary-card";

  const header = buildSummaryHeader("YouTube Summary", false, buildYouTubeCopyText(data), onRefresh);

  const badge = document.createElement("span");
  badge.className = "yt-badge";
  badge.textContent = "▶ YouTube";
  // Insert badge between label and copy button
  header.insertBefore(badge, header.querySelector(".copy-btn"));
  card.appendChild(header);

  // Raw fallback
  if (data.parseError) {
    const rawP = document.createElement("p");
    rawP.className = "result-body";
    rawP.textContent = data.raw || "No summary returned.";
    card.appendChild(rawP);
    summaryArea.appendChild(card);
    return;
  }

  card.appendChild(buildTldrSection(data.tldr));
  card.appendChild(buildKeyPointsSection(data.keyPoints));

  // Timestamps section — only when the model returned any
  if (data.timestamps && data.timestamps.length > 0) {
    card.appendChild(buildTimestampsSection(data.timestamps, data.videoId));
  }

  card.appendChild(buildNextStepsSection(data.nextSteps));
  summaryArea.appendChild(card);
}

// ── Shared section builders ───────────────────────────────────────────────────

function buildSummaryHeader(label, isFallback, copyText, onRefresh) {
  const header = document.createElement("div");
  header.className = "result-header";

  const labelEl = document.createElement("span");
  labelEl.className = "result-label";
  labelEl.textContent = label;
  header.appendChild(labelEl);

  if (isFallback) {
    const warn = document.createElement("span");
    warn.className = "fallback-badge";
    warn.title = "Full article text could not be cleanly extracted — summary may include navigation or footer text.";
    warn.textContent = "approx.";
    header.appendChild(warn);
  }

  // Show cached indicator + refresh button when result came from cache.
  if (onRefresh) {
    const cachedBadge = document.createElement("span");
    cachedBadge.className = "cached-badge";
    cachedBadge.title = "Loaded from cache. Click ↺ to fetch a fresh summary.";
    cachedBadge.textContent = "cached";
    header.appendChild(cachedBadge);

    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "refresh-btn";
    refreshBtn.title = "Refresh — fetch a new summary";
    refreshBtn.textContent = "↺";
    refreshBtn.addEventListener("click", onRefresh);
    header.appendChild(refreshBtn);
  }

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "copy-btn";
  copyBtn.textContent = "Copy";
  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(copyText).then(() => {
      copyBtn.textContent = "Copied!";
      setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
    }).catch(() => {});
  });
  header.appendChild(copyBtn);
  return header;
}

function buildTldrSection(tldr) {
  const section = document.createElement("div");
  section.className = "summary-section";
  const lbl = document.createElement("p");
  lbl.className = "summary-section-label";
  lbl.textContent = "TL;DR";
  section.appendChild(lbl);
  const p = document.createElement("p");
  p.className = "summary-tldr";
  p.textContent = tldr;
  section.appendChild(p);
  return section;
}

function buildKeyPointsSection(keyPoints) {
  const section = document.createElement("div");
  section.className = "summary-section";
  const lbl = document.createElement("p");
  lbl.className = "summary-section-label";
  lbl.textContent = "Key points";
  section.appendChild(lbl);
  const ul = document.createElement("ul");
  ul.className = "summary-points";
  (keyPoints || []).forEach((point) => {
    const li = document.createElement("li");
    li.textContent = point;
    ul.appendChild(li);
  });
  section.appendChild(ul);
  return section;
}

/**
 * Renders clickable timestamp links.
 * Each link opens the video at the right time: youtube.com/watch?v=ID&t=SECONDS
 */
function buildTimestampsSection(timestamps, videoId) {
  const section = document.createElement("div");
  section.className = "summary-section";
  const lbl = document.createElement("p");
  lbl.className = "summary-section-label";
  lbl.textContent = "Chapters";
  section.appendChild(lbl);

  const list = document.createElement("div");
  list.className = "timestamp-list";

  timestamps.forEach(({ label, seconds }) => {
    const row = document.createElement("div");
    row.className = "timestamp-row";

    const link = document.createElement("a");
    link.className = "timestamp-link";
    link.href = "https://www.youtube.com/watch?v=" + videoId + "&t=" + seconds;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = formatSeconds(seconds);

    const text = document.createElement("span");
    text.className = "timestamp-label";
    text.textContent = label;

    row.appendChild(link);
    row.appendChild(text);
    list.appendChild(row);
  });

  section.appendChild(list);
  return section;
}

function buildNextStepsSection(nextSteps) {
  const section = document.createElement("div");
  section.className = "summary-section summary-section--last";
  const lbl = document.createElement("p");
  lbl.className = "summary-section-label";
  lbl.textContent = "What to do next";
  section.appendChild(lbl);
  const p = document.createElement("p");
  p.className = "summary-next";
  p.textContent = nextSteps;
  section.appendChild(p);
  return section;
}

/** Format whole seconds to M:SS or H:MM:SS */
function formatSeconds(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hours > 0) {
    return hours + ":" + String(mins).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
  }
  return mins + ":" + String(secs).padStart(2, "0");
}

function buildCopyText(data) {
  if (data.parseError) return data.raw || "";
  const points = (data.keyPoints || []).map((p, i) => (i + 1) + ". " + p).join("\n");
  return (
    "TL;DR\n" + data.tldr + "\n\n" +
    "Key Points\n" + points + "\n\n" +
    "What to do next\n" + data.nextSteps
  );
}

function buildYouTubeCopyText(data) {
  if (data.parseError) return data.raw || "";
  const points = (data.keyPoints || []).map((p, i) => (i + 1) + ". " + p).join("\n");
  const ts = (data.timestamps || [])
    .map((t) => formatSeconds(t.seconds) + "  " + t.label)
    .join("\n");
  return (
    "TL;DR\n" + data.tldr + "\n\n" +
    "Key Points\n" + points + "\n\n" +
    (ts ? "Chapters\n" + ts + "\n\n" : "") +
    "What to do next\n" + data.nextSteps
  );
}

// ── Summarise button ──────────────────────────────────────────────────────────

/**
 * Run SUMMARY_ARTICLE. Pass forceRefresh=true to bypass the cache.
 */
async function runSummarise(forceRefresh) {
  showBanner("");
  summaryArea.hidden = true;
  summaryArea.innerHTML = "";

  summaryArea.hidden = false;
  const loadingDiv = document.createElement("div");
  loadingDiv.className = "loading-state";
  loadingDiv.textContent = forceRefresh ? "Refreshing…" : "Summarising…";
  summaryArea.appendChild(loadingDiv);
  summariseBtn.disabled = true;

  try {
    const data = await send("SUMMARY_ARTICLE", { forceRefresh: forceRefresh === true });
    lastAction = { type: data.videoId ? "youtube" : "summary", data };
    showSummary(data);
  } catch (err) {
    const msg = err.message || "Something went wrong.";
    summaryArea.hidden = true;

    if (msg === "RESTRICTED_PAGE") {
      showBanner("Sahayak can't summarise this page (browser or extension page).");
      return;
    }
    if (msg === "EMPTY_PAGE") {
      showBanner("This page doesn't seem to have readable article text.");
      return;
    }
    if (msg === "YOUTUBE_UNAVAILABLE") {
      showBanner("This video is private or unavailable — Sahayak can only summarise public YouTube videos.");
      return;
    }
    if (msg === "MISSING_KEY") {
      showBanner("Add a Gemini or Groq API key in Settings to use AI features.", "settings");
      return;
    }
    showBanner(msg);
  } finally {
    summariseBtn.disabled = false;
  }
}

summariseBtn.addEventListener("click", () => runSummarise(false));

// ── Selection action (explain / translate / draft) ────────────────────────────

/**
 * Run a selection action by mode.
 * Used by both the Explain button and the context menu pending action.
 *
 * @param {"explain"|"translate"|"draft"} mode
 * @param {string} [selection] - pre-supplied text (from context menu stash)
 */
async function runSelectionAction(mode, selection) {
  showBanner("");
  showLoading(
    mode === "explain"   ? "Explaining…"  :
    mode === "translate" ? "Translating…" :
    "Drafting reply…"
  );
  explainBtn.disabled = true;

  const payload = { mode };
  if (selection) payload.selection = selection;

  try {
    const data = await send("SELECTION_ACTION", payload);

    const labelMap = {
      explain:   "Explanation",
      translate: "Translation",
      draft:     "Draft reply",
    };
    lastAction = { type: "explain", data };
    showResult({ label: labelMap[mode] || "Result", body: data.result });

  } catch (err) {
    const msg = err.message || "Something went wrong.";
    if (msg === "NO_SELECTION") {
      showResultError("Select some text on the page first.");
      return;
    }
    if (msg === "MISSING_KEY") {
      resultArea.hidden = true;
      showBanner("Add a Gemini or Groq API key in Settings to use AI features.", "settings");
      return;
    }
    showResultError(msg);
  } finally {
    explainBtn.disabled = false;
  }
}

explainBtn.addEventListener("click", () => runSelectionAction("explain"));

// ── Chat ──────────────────────────────────────────────────────────────────────

const chatMessages  = document.getElementById("chat-messages");
const chatEmpty     = document.getElementById("chat-empty");
const chatInput     = document.getElementById("chat-input");
const chatSendBtn   = document.getElementById("chat-send-btn");
const chatResetBtn  = document.getElementById("chat-reset-btn");

/** Append a bubble to the chat message list and scroll into view. */
function appendBubble(text, role) {
  chatEmpty.hidden = true;

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble chat-bubble--" + role;
  bubble.textContent = text;
  chatMessages.appendChild(bubble);
  bubble.scrollIntoView({ block: "end", behavior: "smooth" });
  return bubble;
}

/** Show the three-dot thinking animation while waiting for a reply. */
function appendThinking() {
  chatEmpty.hidden = true;
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble chat-bubble--thinking";
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement("span");
    bubble.appendChild(dot);
  }
  chatMessages.appendChild(bubble);
  bubble.scrollIntoView({ block: "end", behavior: "smooth" });
  return bubble;
}

/** Show a small centred notice (e.g. "Context reset — new page"). */
function appendNotice(text) {
  const notice = document.createElement("div");
  notice.className = "chat-notice";
  notice.textContent = text;
  chatMessages.appendChild(notice);
  notice.scrollIntoView({ block: "end", behavior: "smooth" });
}

/** Clear all chat bubbles and show the empty state. */
function clearChatUI() {
  // Remove everything except the chat-empty div.
  Array.from(chatMessages.children).forEach((child) => {
    if (child !== chatEmpty) child.remove();
  });
  chatEmpty.hidden = false;
}

/** Send the current input as a chat message. */
async function sendChatMessage() {
  const text = chatInput.value.trim();
  if (!text) return;

  chatInput.value = "";
  chatInput.style.height = "auto";
  chatSendBtn.disabled = true;

  appendBubble(text, "user");
  const thinkingBubble = appendThinking();

  try {
    const data = await send("CHAT_SEND", { message: text });

    thinkingBubble.remove();

    // If the backend detected a URL change and reset context, show a notice.
    if (data.resetContext) {
      appendNotice("New page detected — chat context was reset.");
    }

    // Warn if the page had no extractable text.
    if (!data.hasPageText) {
      appendNotice("This page has no readable text — answers may be limited.");
    }

    appendBubble(data.reply, "assistant");

  } catch (err) {
    thinkingBubble.remove();
    const msg = err.message || "Something went wrong.";

    if (msg === "MISSING_KEY") {
      appendBubble("Add a Gemini or Groq API key in Settings to use chat.", "error");
    } else if (msg === "RESTRICTED_PAGE") {
      appendBubble("Chat is not available on this page.", "error");
    } else {
      appendBubble(msg, "error");
    }
  } finally {
    chatSendBtn.disabled = false;
    chatInput.focus();
  }
}

// Send on button click.
chatSendBtn.addEventListener("click", sendChatMessage);

// Send on Enter (Shift+Enter inserts a newline).
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});

// Auto-resize the textarea as the user types.
chatInput.addEventListener("input", () => {
  chatInput.style.height = "auto";
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
});

// New chat button — clears UI and tells the background to reset history.
chatResetBtn.addEventListener("click", async () => {
  clearChatUI();
  try {
    await send("CHAT_RESET", {});
  } catch (_e) {}
});

// ── Load settings on startup ──────────────────────────────────────────────────

async function loadSettings() {
  const settings = await send("SETTINGS_GET");
  applyLanguage(settings.language === "hinglish" ? "hinglish" : "en");
  if (!settings.geminiApiKey && !settings.groqApiKey) {
    showBanner("Add a Gemini or Groq API key in Settings to use AI features.", "settings");
  } else {
    showBanner("");
  }

  // Check if the panel was opened via right-click context menu.
  checkAndRunPendingAction();
}

settingsBtn.addEventListener("click", openSettings);

// ── Pending context action ────────────────────────────────────────────────────

// Listen for direct SW push when the panel is already open.
if (globalThis.chrome && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === "CONTEXT_ACTION_READY" && message.payload) {
      const { mode, selection } = message.payload;
      const summariseTab = document.getElementById("tab-summarise");
      if (summariseTab && !summariseTab.classList.contains("is-active")) {
        summariseTab.click();
      }
      setTimeout(() => runSelectionAction(mode, selection), 60);
    }
    return false;
  });
}

/**
 * Read and immediately clear any pending context menu action from storage.
 * Runs on panel startup AND whenever storage changes (covers "already open" case).
 */
async function checkAndRunPendingAction() {
  try {
    const data = await send("CONTEXT_MENU_GET", {});
    if (data && data.pending) {
      const { mode, selection } = data.pending;
      // Switch to Summarise tab so result area is visible.
      const summariseTab = document.getElementById("tab-summarise");
      if (summariseTab && !summariseTab.classList.contains("is-active")) {
        summariseTab.click();
      }
      // Small tick so any tab-switch animation settles first.
      setTimeout(() => runSelectionAction(mode, selection), 60);
    }
  } catch (_e) {
    // Best-effort — never block the panel from loading.
  }
}

if (globalThis.chrome && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    // Settings changed — reload language / banner state.
    if (changes.settings) {
      loadSettings().catch(() => {});
    }

    // A new context menu action was stashed while the panel was already open.
    if (changes.pendingContextAction && changes.pendingContextAction.newValue) {
      checkAndRunPendingAction();
    }
  });
}

loadSettings().catch((err) => {
  showBanner(err.message || "Could not load settings.");
});
