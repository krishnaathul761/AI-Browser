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
//   { type: "summary"|"youtube", data: SummaryData, originalData: SummaryData }
//   { type: "explain", data: { result: string } }
//   null
//
// originalData is always the English source — we always translate FROM that,
// never from a previously-translated version, so EN→Hinglish→EN round-trips
// correctly.
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
  // Pass the language directly so we don't race with the storage write above.
  if (lastAction) {
    await rerunLastAction(language);
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
 *
 * @param {string} [explicitLanguage] - pass directly from the toggle to avoid
 *   a storage-read race with the just-fired SETTINGS_SET.
 */
async function rerunLastAction(explicitLanguage) {
  if (!lastAction) return;

  const { type, data, originalData } = lastAction;

  try {
    // Use the explicitly passed language when available (avoids a race with
    // the fire-and-forget SETTINGS_SET in setLanguage).
    const language = explicitLanguage || (await send("SETTINGS_GET")).language || "en";

    if (type === "summary" || type === "youtube") {
      summaryArea.hidden = false;
      summaryArea.innerHTML = "";
      const loadingDiv = document.createElement("div");
      loadingDiv.className = "loading-state";
      loadingDiv.textContent = "Translating…";
      summaryArea.appendChild(loadingDiv);
      summariseBtn.disabled = true;

      // Switching back to English — restore original data, no API call needed.
      if (language === "en") {
        const source = originalData || data;
        // Never overwrite originalData — keep it as the immutable English source.
        lastAction = { type, data: source, originalData: originalData || source };
        showSummary(source);
        return;
      }

      // Always translate FROM the original English source.
      const source = originalData || data;
      const fields = {
        tldr:       source.tldr,
        keyPoints:  source.keyPoints,
        nextSteps:  source.nextSteps,
        timestamps: source.timestamps,
      };

      const translated = await send("TRANSLATE_RESULT", { fields, language });

      const newData = Object.assign({}, source, {
        tldr:       translated.tldr,
        keyPoints:  translated.keyPoints,
        nextSteps:  translated.nextSteps,
        timestamps: translated.timestamps || source.timestamps,
        fromCache:  true,
      });

      // Preserve originalData — always the untranslated English source.
      lastAction = { type, data: newData, originalData: source };
      showSummary(newData);

    } else if (type === "explain") {
      showLoading("Translating…");
      explainBtn.disabled = true;

      // Switching back to English — restore original text, no API call.
      if (language === "en") {
        const source = originalData || data;
        lastAction = { type: "explain", data: source, originalData: originalData || source };
        showResult({ label: "Explanation", body: source.result, kind: "explain" });
        return;
      }

      const source = originalData || data;
      const fields = { tldr: source.result, keyPoints: [], nextSteps: "" };
      const translated = await send("TRANSLATE_RESULT", { fields, language });
      const translatedText = translated.tldr || source.result;

      const newData = { result: translatedText };
      // Preserve originalData — never overwrite with translated version.
      lastAction = { type: "explain", data: newData, originalData: source };
      showResult({ label: "Explanation", body: translatedText, kind: "explain" });
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
/**
 * Renders clickable timestamp links.
 * Clicking seeks the already-open YouTube tab instead of opening a new one.
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
    link.href = "#";  // prevent default navigation
    link.textContent = formatSeconds(seconds);
    link.setAttribute("data-seconds", seconds);
    link.setAttribute("data-videoid", videoId);
    link.addEventListener("click", (e) => {
      e.preventDefault();
      seekYouTubeTab(videoId, seconds);
    });

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

/**
 * Seek an already-open YouTube tab to a specific timestamp.
 * If no matching tab is found, open a new one.
 *
 * @param {string} videoId
 * @param {number} seconds
 */
async function seekYouTubeTab(videoId, seconds) {
  const targetUrl = "https://www.youtube.com/watch?v=" + videoId + "&t=" + seconds;

  try {
    // Find an existing tab playing this video.
    const allTabs = await chrome.tabs.query({});
    const ytTab = allTabs.find((t) => {
      if (!t.url) return false;
      try {
        const u = new URL(t.url);
        const host = u.hostname.replace(/^www\./, "");
        if (host !== "youtube.com" && host !== "m.youtube.com") return false;
        return u.searchParams.get("v") === videoId;
      } catch (_e) { return false; }
    });

    if (ytTab) {
      // Update the existing tab's URL to the timestamp version and focus it.
      await chrome.tabs.update(ytTab.id, { url: targetUrl, active: true });
      await chrome.windows.update(ytTab.windowId, { focused: true });
    } else {
      // No existing tab — open a new one.
      await chrome.tabs.create({ url: targetUrl });
    }
  } catch (_e) {
    // Fallback: open a new tab.
    chrome.tabs.create({ url: targetUrl });
  }
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
    // Summary always comes back in English. Store it as originalData.
    // If the user has Hinglish selected, translate immediately.
    const settings = await send("SETTINGS_GET");
    const currentLang = settings.language || "en";
    lastAction = { type: data.videoId ? "youtube" : "summary", data, originalData: data };
    if (currentLang !== "en") {
      // Translate in place — rerunLastAction uses originalData as source.
      await rerunLastAction(currentLang);
    } else {
      showSummary(data);
    }
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
    // Resolve the active tab id in the panel's context and pass it explicitly
    // so the SW doesn't have to guess — side panel may be in a different window
    // than what chrome.tabs.query({ currentWindow: true }) returns.
    let tabId;
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      tabId = tab && tab.id;
    } catch (_e) {}

    const data = await send("CHAT_SEND", { message: text, tabId });

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

// ── Screenshot & Ask ──────────────────────────────────────────────────────────

const captureBtn         = document.getElementById("capture-btn");
const screenshotArea     = document.getElementById("screenshot-area");
const screenshotCanvas   = document.getElementById("screenshot-canvas");
const cropCanvas         = document.getElementById("crop-canvas");
const screenshotHint     = document.getElementById("screenshot-hint");
const clearCropBtn       = document.getElementById("clear-crop-btn");
const clearCaptureBtn    = document.getElementById("clear-capture-btn");
const screenshotQuestion = document.getElementById("screenshot-question");
const screenshotAskBtn   = document.getElementById("screenshot-ask-btn");
const screenshotResult   = document.getElementById("screenshot-result");
const cropPreviewWrap    = document.getElementById("crop-preview-wrap");
const cropPreviewCanvas  = document.getElementById("crop-preview-canvas");

// State
let screenshotDataUrl = null;   // full capture
let croppedDataUrl    = null;   // user-drawn crop (null = use full)
let cropState         = null;   // { startX, startY, endX, endY } in canvas coords
let isDragging        = false;

// ── Capture ───────────────────────────────────────────────────────────────────

let isCapturing = false; // debounce guard

captureBtn.addEventListener("click", async () => {
  if (isCapturing) return;
  isCapturing = true;
  showBanner("");
  captureBtn.disabled = true;
  captureBtn.textContent = "Capturing…";

  try {
    const data = await send("SCREENSHOT_CAPTURE", {});
    screenshotDataUrl = data.dataUrl;
    croppedDataUrl    = null;
    cropState         = null;
    screenshotCanvas._cleanSnapshot = null;

    // Draw full image onto canvas.
    await drawImageOnCanvas(screenshotCanvas, screenshotDataUrl);

    // Show the screenshot area.
    screenshotArea.hidden = false;
    clearCropBtn.hidden   = true;
    screenshotHint.textContent = "Drag to crop a region, or ask about the full screenshot.";
    screenshotResult.hidden    = true;
    screenshotResult.innerHTML = "";
    screenshotQuestion.value   = "";
    screenshotQuestion.focus();

  } catch (err) {
    const msg = err.message || "Could not capture screen.";
    if (msg === "RESTRICTED_PAGE") {
      showBanner("Sahayak can't capture this page (browser or extension page).");
    } else {
      showBanner(msg);
    }
  } finally {
    captureBtn.disabled = false;
    captureBtn.textContent = "Capture screen";
    // Allow next capture after 1.5s to stay within quota.
    setTimeout(() => { isCapturing = false; }, 1500);
  }
});

// ── Draw image on canvas ──────────────────────────────────────────────────────

function drawImageOnCanvas(canvas, dataUrl) {
  return new Promise((resolve, reject) => {
    // Convert data URL → Blob → ImageBitmap without using fetch(),
    // which is blocked for data URLs inside extension pages.
    try {
      const [header, base64] = dataUrl.split(",");
      const mimeMatch = header.match(/:(.*?);/);
      const mime = mimeMatch ? mimeMatch[1] : "image/png";
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: mime });

      createImageBitmap(blob).then((bitmap) => {
        const maxW  = 320;
        const scale = bitmap.width > maxW ? maxW / bitmap.width : 1;
        canvas.width  = Math.round(bitmap.width  * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas.dataset.scale = String(scale);
        canvas.dataset.origW = String(bitmap.width);
        canvas.dataset.origH = String(bitmap.height);
        canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        resolve();
      }).catch(reject);
    } catch (e) {
      reject(e);
    }
  });
}

// ── Crop interaction ──────────────────────────────────────────────────────────

screenshotCanvas.addEventListener("mousedown", (e) => {
  if (!screenshotDataUrl) return;
  const rect = screenshotCanvas.getBoundingClientRect();
  cropState = {
    startX: e.clientX - rect.left,
    startY: e.clientY - rect.top,
    endX:   e.clientX - rect.left,
    endY:   e.clientY - rect.top,
  };
  isDragging = true;
});

screenshotCanvas.addEventListener("mousemove", (e) => {
  if (!isDragging || !cropState) return;
  const rect = screenshotCanvas.getBoundingClientRect();
  cropState.endX = e.clientX - rect.left;
  cropState.endY = e.clientY - rect.top;
  drawCropOverlay();
});

screenshotCanvas.addEventListener("mouseup", async () => {
  if (!isDragging || !cropState) return;
  isDragging = false;

  const w = Math.abs(cropState.endX - cropState.startX);
  const h = Math.abs(cropState.endY - cropState.startY);

  if (w < 5 || h < 5) {
    cropState = null;
    clearCropBtn.hidden = true;
    croppedDataUrl = null;
    cropPreviewWrap.hidden = true;
    return;
  }

  croppedDataUrl = await extractCrop();
  clearCropBtn.hidden = false;
  screenshotHint.textContent = "Crop selected. Ask about the highlighted region.";
  showCropPreview(croppedDataUrl);
});

screenshotCanvas.addEventListener("mouseleave", async () => {
  if (isDragging) {
    isDragging = false;
    if (cropState) {
      const w = Math.abs(cropState.endX - cropState.startX);
      const h = Math.abs(cropState.endY - cropState.startY);
      if (w >= 5 && h >= 5) {
        croppedDataUrl = await extractCrop();
        clearCropBtn.hidden = false;
        showCropPreview(croppedDataUrl);
      }
    }
  }
});

function drawCropOverlay() {
  if (!cropState) return;
  const ctx = screenshotCanvas.getContext("2d");

  // Save the clean image pixels so we can restore them under the selection.
  // We keep a clean offscreen copy the first time we draw a crop.
  if (!screenshotCanvas._cleanSnapshot) {
    const snap = document.createElement("canvas");
    snap.width  = screenshotCanvas.width;
    snap.height = screenshotCanvas.height;
    snap.getContext("2d").drawImage(screenshotCanvas, 0, 0);
    screenshotCanvas._cleanSnapshot = snap;
  }

  const snap = screenshotCanvas._cleanSnapshot;

  // Restore the clean image.
  ctx.drawImage(snap, 0, 0);

  // Dim the whole canvas.
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(0, 0, screenshotCanvas.width, screenshotCanvas.height);

  // Cut out the selected region from the clean snapshot.
  const x = Math.min(cropState.startX, cropState.endX);
  const y = Math.min(cropState.startY, cropState.endY);
  const w = Math.abs(cropState.endX - cropState.startX);
  const h = Math.abs(cropState.endY - cropState.startY);

  if (w > 0 && h > 0) {
    ctx.drawImage(snap, x, y, w, h, x, y, w, h);
    ctx.strokeStyle = "#0d6b63";
    ctx.lineWidth   = 2;
    ctx.strokeRect(x, y, w, h);
  }
}

function extractCrop() {
  if (!cropState || !screenshotDataUrl) return null;

  // Work from the original full-resolution image, not the scaled canvas.
  // This gives the crop full pixel data so the enlarged preview is sharp.
  const scale = Number(screenshotCanvas.dataset.scale) || 1;

  // canvas coords → original image coords
  const srcX = Math.round(Math.min(cropState.startX, cropState.endX)   / scale);
  const srcY = Math.round(Math.min(cropState.startY, cropState.endY)   / scale);
  const srcW = Math.round(Math.abs(cropState.endX - cropState.startX)  / scale);
  const srcH = Math.round(Math.abs(cropState.endY - cropState.startY)  / scale);

  if (srcW < 1 || srcH < 1) return null;

  // Decode the original full-res data URL into a bitmap synchronously
  // using an offscreen canvas at full resolution.
  const [header, base64] = screenshotDataUrl.split(",");
  const mimeMatch = header.match(/:(.*?);/);
  const mime   = mimeMatch ? mimeMatch[1] : "image/png";
  const binary = atob(base64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });

  // Return a promise — callers that need the dataUrl must await.
  return createImageBitmap(blob).then((bitmap) => {
    const off = document.createElement("canvas");
    off.width  = srcW;
    off.height = srcH;
    off.getContext("2d").drawImage(bitmap, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
    bitmap.close();
    return off.toDataURL("image/png");
  });
}

/**
 * Render the cropped data URL enlarged into the crop preview canvas.
 * The preview fills the full panel width (max 320px) so small crops
 * are shown at a much larger size for easy inspection.
 *
 * @param {string} dataUrl - cropped PNG data URL
 */
function showCropPreview(dataUrl) {
  if (!dataUrl) {
    cropPreviewWrap.hidden = true;
    return;
  }

  const [header, base64] = dataUrl.split(",");
  const mimeMatch = header.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : "image/png";
  const binary = atob(base64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });

  createImageBitmap(blob).then((bitmap) => {
    // Scale up to fill panel width. Since the crop is full-res we can go
    // higher — cap at 4× to avoid unnecessarily huge previews.
    const maxW    = 320;
    const maxScale = 4;
    const scale  = Math.min(maxW / bitmap.width, maxScale);
    cropPreviewCanvas.width  = Math.round(bitmap.width  * scale);
    cropPreviewCanvas.height = Math.round(bitmap.height * scale);
    cropPreviewCanvas.getContext("2d").drawImage(
      bitmap, 0, 0, cropPreviewCanvas.width, cropPreviewCanvas.height
    );
    bitmap.close();
    cropPreviewWrap.hidden = false;
  }).catch(() => {
    cropPreviewWrap.hidden = true;
  });
}

clearCropBtn.addEventListener("click", () => {
  cropState      = null;
  croppedDataUrl = null;
  clearCropBtn.hidden      = true;
  cropPreviewWrap.hidden   = true;
  cropPreviewCanvas.width  = 0;
  cropPreviewCanvas.height = 0;
  screenshotHint.textContent = "Drag to crop a region, or ask about the full screenshot.";
  // Redraw the clean image.
  drawImageOnCanvas(screenshotCanvas, screenshotDataUrl);
});

clearCaptureBtn.addEventListener("click", () => {
  // Reset all screenshot state and hide the area.
  screenshotDataUrl = null;
  croppedDataUrl    = null;
  cropState         = null;
  isDragging        = false;
  screenshotCanvas._cleanSnapshot = null;
  screenshotCanvas.width  = 0;
  screenshotCanvas.height = 0;
  cropPreviewWrap.hidden   = true;
  cropPreviewCanvas.width  = 0;
  cropPreviewCanvas.height = 0;
  clearCropBtn.hidden      = true;
  screenshotResult.hidden  = true;
  screenshotResult.innerHTML = "";
  screenshotQuestion.value   = "";
  screenshotArea.hidden      = true;
  showBanner("");
});

// ── Ask ───────────────────────────────────────────────────────────────────────

async function runScreenshotAsk() {
  const question = screenshotQuestion.value.trim();
  if (!question) {
    screenshotQuestion.focus();
    return;
  }
  if (!screenshotDataUrl) {
    showBanner("Capture the screen first.");
    return;
  }

  screenshotAskBtn.disabled = true;
  screenshotResult.hidden   = false;
  screenshotResult.innerHTML = "";

  const loadingDiv = document.createElement("div");
  loadingDiv.className = "loading-state";
  loadingDiv.textContent = "Analysing screenshot…";
  screenshotResult.appendChild(loadingDiv);

  try {
    // Use the cropped image if the user drew a crop, otherwise the full capture.
    const imageToSend = croppedDataUrl || screenshotDataUrl;
    const data = await send("SCREENSHOT_ASK", {
      dataUrl:  imageToSend,
      question,
    });

    screenshotResult.innerHTML = "";
    const card = document.createElement("div");
    card.className = "result-card";

    const header = document.createElement("div");
    header.className = "result-header";
    const lbl = document.createElement("span");
    lbl.className = "result-label";
    lbl.textContent = "Screenshot answer";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "copy-btn";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(data.answer).then(() => {
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
      }).catch(() => {});
    });
    header.appendChild(lbl);
    header.appendChild(copyBtn);
    card.appendChild(header);

    const body = document.createElement("p");
    body.className = "result-body";
    body.textContent = data.answer;
    card.appendChild(body);

    screenshotResult.appendChild(card);

  } catch (err) {
    screenshotResult.innerHTML = "";
    const errDiv = document.createElement("div");
    errDiv.className = "result-error";
    const msg = err.message || "Could not analyse screenshot.";
    if (msg === "MISSING_KEY") {
      errDiv.textContent = "Add a Gemini API key in Settings to use vision.";
    } else {
      errDiv.textContent = msg;
    }
    screenshotResult.appendChild(errDiv);
    screenshotResult.hidden = false;
  } finally {
    screenshotAskBtn.disabled = false;
  }
}

screenshotAskBtn.addEventListener("click", runScreenshotAsk);

screenshotQuestion.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    runScreenshotAsk();
  }
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

// ── Theme (dark / light mode) ─────────────────────────────────────────────────

const themeToggleBtn = document.getElementById("theme-toggle");
const themeSunIcon   = document.getElementById("theme-icon-sun");
const themeMoonIcon  = document.getElementById("theme-icon-moon");
const root           = document.documentElement;

/**
 * Apply a theme to the panel.
 * @param {"dark"|"light"|"system"} theme
 */
function applyTheme(theme) {
  if (theme === "dark") {
    root.setAttribute("data-theme", "dark");
    themeSunIcon.hidden  = false; // show sun (click to go light)
    themeMoonIcon.hidden = true;
    themeToggleBtn.title = "Switch to light mode";
  } else if (theme === "light") {
    root.setAttribute("data-theme", "light");
    themeSunIcon.hidden  = true;
    themeMoonIcon.hidden = false; // show moon (click to go dark)
    themeToggleBtn.title = "Switch to dark mode";
  } else {
    // system — remove override, let CSS media query decide
    root.removeAttribute("data-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    themeSunIcon.hidden  = prefersDark;  // dark system → show sun
    themeMoonIcon.hidden = !prefersDark; // light system → show moon
    themeToggleBtn.title = prefersDark ? "Switch to light mode" : "Switch to dark mode";
  }
}

// Load saved theme preference.
(function initTheme() {
  const saved = localStorage.getItem("sahayak-theme") || "system";
  applyTheme(saved);
})();

themeToggleBtn.addEventListener("click", () => {
  const current = root.getAttribute("data-theme") || "system";
  // Cycle: system → dark → light → dark (once user has toggled, stay manual)
  let next;
  if (current === "dark")  next = "light";
  else                     next = "dark";
  localStorage.setItem("sahayak-theme", next);
  applyTheme(next);
});

// Keep icon in sync if user changes system theme while panel is open.
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  const saved = localStorage.getItem("sahayak-theme") || "system";
  if (saved === "system") applyTheme("system");
});

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
