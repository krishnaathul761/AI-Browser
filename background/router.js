const SETTINGS_STORAGE_KEY = "settings";

const DEFAULT_SETTINGS = {
  geminiApiKey: "",
  groqApiKey: "",
  language: "en",
  translateTarget: "hi",
  dryRunDefault: false,
  maxAgentSteps: 20,
  preferredProvider: "auto", // "auto" | "gemini" | "groq"
};

const SETTINGS_FIELDS = [
  "geminiApiKey",
  "groqApiKey",
  "language",
  "translateTarget",
  "dryRunDefault",
  "maxAgentSteps",
  "preferredProvider",
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeSettings(raw) {
  if (!isPlainObject(raw)) {
    return Object.assign({}, DEFAULT_SETTINGS);
  }

  const next = Object.assign({}, DEFAULT_SETTINGS);

  if (typeof raw.geminiApiKey === "string") {
    next.geminiApiKey = raw.geminiApiKey.trim();
  }
  if (typeof raw.groqApiKey === "string") {
    next.groqApiKey = raw.groqApiKey.trim();
  }
  if (raw.language === "en" || raw.language === "hinglish") {
    next.language = raw.language;
  }
  if (typeof raw.translateTarget === "string" && raw.translateTarget.trim()) {
    next.translateTarget = raw.translateTarget.trim();
  }
  if (typeof raw.dryRunDefault === "boolean") {
    next.dryRunDefault = raw.dryRunDefault;
  }
  if (Number.isInteger(raw.maxAgentSteps) && raw.maxAgentSteps > 0) {
    next.maxAgentSteps = Math.min(raw.maxAgentSteps, 100);
  }
  if (raw.preferredProvider === "gemini" || raw.preferredProvider === "groq" || raw.preferredProvider === "auto") {
    next.preferredProvider = raw.preferredProvider;
  }

  return next;
}

async function readSettings() {
  const bag = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  const stored = bag[SETTINGS_STORAGE_KEY];

  if (stored === undefined) {
    return Object.assign({}, DEFAULT_SETTINGS);
  }

  if (!isPlainObject(stored)) {
    const defaults = Object.assign({}, DEFAULT_SETTINGS);
    await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: defaults });
    return defaults;
  }

  return normalizeSettings(stored);
}

function pickKnownSettings(payload) {
  const patch = {};
  if (!isPlainObject(payload)) {
    return patch;
  }
  for (let i = 0; i < SETTINGS_FIELDS.length; i += 1) {
    const key = SETTINGS_FIELDS[i];
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      patch[key] = payload[key];
    }
  }
  return patch;
}

async function writeSettings(payload) {
  const current = await readSettings();
  const patch = pickKnownSettings(payload);
  const next = normalizeSettings(Object.assign({}, current, patch));
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: next });
  return next;
}

function fail(requestId, error) {
  return { ok: false, requestId: requestId, error: error };
}

function ok(requestId, data) {
  return { ok: true, requestId: requestId, data: data };
}

async function routeMessage(message, _sender) {
  const requestId = message && message.requestId ? message.requestId : uuid();
  const type = message && message.type;

  if (!type) {
    return fail(requestId, "Missing message type");
  }

  switch (type) {
    case "SETTINGS_GET":
      return ok(requestId, await readSettings());

    case "SETTINGS_SET":
      return ok(requestId, await writeSettings(message.payload));

    case "SELECTION_ACTION":
      return handleSelectionAction(requestId, message);

    case "SUMMARY_ARTICLE":
      return handleSummaryArticle(requestId, message);

    case "SUMMARY_YOUTUBE":
      return handleSummaryYouTube(requestId, message);

    case "TRANSLATE_RESULT":
      return handleTranslateResult(requestId, message);

    case "CHAT_SEND":
      return handleChatSend(requestId, message);

    case "CHAT_RESET":
      return handleChatReset(requestId, message);

    default:
      return fail(requestId, "Unknown message type");
  }
}

// ── SELECTION_ACTION ──────────────────────────────────────────────────────────

/**
 * Ask the active tab's content script for the current selection, then run
 * the requested mode (currently only "explain") through Gemini.
 *
 * Payload shape: { mode: "explain", tabId?: number }
 *
 * Success data: { mode, result: string }
 */
async function handleSelectionAction(requestId, message) {
  const payload = message && message.payload;
  const mode = payload && payload.mode;

  if (mode !== "explain") {
    return fail(requestId, 'Unsupported mode "' + mode + '"');
  }

  // Resolve the target tab.
  const tabId = await resolveTabId(payload && payload.tabId);
  if (tabId === null) {
    return fail(requestId, "No active tab found.");
  }

  // 1. Fetch the current selection from the content script.
  let selectionText;
  try {
    const selReply = await chrome.tabs.sendMessage(tabId, {
      type: "GET_SELECTION",
      requestId: uuid(),
    });
    selectionText = selReply && selReply.data && selReply.data.text;
  } catch (_err) {
    return fail(
      requestId,
      "Could not reach the page. Try reloading the tab, then try again."
    );
  }

  if (!selectionText || !selectionText.trim()) {
    return fail(requestId, "NO_SELECTION");
  }

  // 2. Gate: need at least one AI key.
  const settings = await readSettings();
  if (!settings.geminiApiKey && !settings.groqApiKey) {
    return fail(requestId, "MISSING_KEY");
  }

  // 3. Build prompt and call AI (Gemini with Groq fallback).
  const prompt = buildExplainPrompt(selectionText.trim(), settings.language);
  try {
    const result = await callAI({ model: GEMINI_FLASH_LITE, prompt, settings });
    return ok(requestId, { mode, result });
  } catch (err) {
    return fail(requestId, geminiErrorMessage(err));
  }
}

/**
 * Resolve a tabId: use provided value, or query the active tab.
 * Returns null if no usable tab is found.
 *
 * @param {number|undefined} explicitTabId
 * @returns {Promise<number|null>}
 */
async function resolveTabId(explicitTabId) {
  if (typeof explicitTabId === "number") {
    return explicitTabId;
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return (tab && tab.id) || null;
  } catch (_err) {
    return null;
  }
}

// ── SUMMARY_ARTICLE ───────────────────────────────────────────────────────────

/**
 * Extract article text from the active tab via the content script, then
 * ask Gemini Flash-Lite for a structured summary (TL;DR, 5 key points,
 * What to do next).
 *
 * Success data: { tldr, keyPoints: string[], nextSteps, isFallback?, title }
 */
async function handleSummaryArticle(requestId, message) {
  const payload = message && message.payload;

  // Resolve tab.
  const tabId = await resolveTabId(payload && payload.tabId);
  if (tabId === null) {
    return fail(requestId, "No active tab found.");
  }

  // Gate: get tab URL to check for restricted pages before sending to content.
  let tabUrl = "";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabUrl = (tab && tab.url) || "";
  } catch (_e) {}

  if (isRestrictedUrl(tabUrl)) {
    return fail(requestId, "RESTRICTED_PAGE");
  }

  // ── Auto-detect YouTube and route to the YouTube handler ──────────────────
  if (isYouTubeVideoUrl(tabUrl)) {
    return handleSummaryYouTube(requestId, { payload: { url: tabUrl } });
  }

  // ── Cache check ───────────────────────────────────────────────────────────
  const forceRefresh = payload && payload.forceRefresh === true;
  if (!forceRefresh) {
    const cached = await getCachedSummary(tabUrl);
    if (cached) {
      return ok(requestId, Object.assign({}, cached, { fromCache: true }));
    }
  }

  // 1. Extract article text from the content script.
  let articleData;
  try {
    const reply = await chrome.tabs.sendMessage(tabId, {
      type: "EXTRACT_ARTICLE",
      requestId: uuid(),
    });
    if (!reply || !reply.ok) {
      const errCode = (reply && reply.error) || "EXTRACT_FAILED";
      return fail(requestId, errCode);
    }
    articleData = reply.data;
  } catch (_err) {
    return fail(
      requestId,
      "Could not reach the page. Try reloading the tab, then try again."
    );
  }

  if (!articleData || !articleData.text || !articleData.text.trim()) {
    return fail(requestId, "EMPTY_PAGE");
  }

  // 2. Gate: need at least one AI key.
  const settings = await readSettings();
  if (!settings.geminiApiKey && !settings.groqApiKey) {
    return fail(requestId, "MISSING_KEY");
  }

  // 3. Build prompt → AI with Groq fallback.
  const prompt = buildSummaryPrompt(articleData, settings.language);

  let rawText;
  try {
    rawText = await callAI({ model: GEMINI_FLASH_LITE, prompt, settings });
  } catch (err) {
    return fail(requestId, geminiErrorMessage(err));
  }

  // 4. Parse structured JSON from the model.
  const parsed = parseSummaryJson(rawText);
  if (!parsed) {
    // Return the raw text as a plain result so the user still gets something.
    return ok(requestId, { raw: rawText, parseError: true, title: articleData.title });
  }

  const result = {
    tldr: parsed.tldr,
    keyPoints: parsed.keyPoints,
    nextSteps: parsed.nextSteps,
    isFallback: articleData.isFallback || false,
    title: articleData.title || "",
  };

  // Cache by tab URL so repeat views are free.
  setCachedSummary(tabUrl, result).catch(() => {});

  return ok(requestId, result);
}

/**
 * Strip markdown fences and parse the summary JSON the model returned.
 * Returns null if parsing or validation fails.
 *
 * @param {string} raw
 * @returns {{ tldr, keyPoints, nextSteps } | null}
 */
function parseSummaryJson(raw) {
  if (typeof raw !== "string") return null;

  // Strip ```json ... ``` or ``` ... ``` fences if present.
  let text = raw.trim();
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  let obj;
  try {
    obj = JSON.parse(text);
  } catch (_e) {
    return null;
  }

  if (typeof obj !== "object" || obj === null) return null;
  if (typeof obj.tldr !== "string" || !obj.tldr.trim()) return null;
  if (!Array.isArray(obj.keyPoints) || obj.keyPoints.length === 0) return null;
  if (typeof obj.nextSteps !== "string" || !obj.nextSteps.trim()) return null;

  return {
    tldr: obj.tldr.trim(),
    keyPoints: obj.keyPoints
      .filter((p) => typeof p === "string" && p.trim())
      .slice(0, 5)
      .map((p) => p.trim()),
    nextSteps: obj.nextSteps.trim(),
  };
}

/**
 * True for URLs that must not be summarised or sent to Gemini.
 * @param {string} url
 * @returns {boolean}
 */
function isRestrictedUrl(url) {
  if (!url) return false;
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("about:") ||
    url.startsWith("edge://") ||
    url.includes("chrome.google.com/webstore")
  );
}

/**
 * Convert a typed AI error into a user-facing string.
 * Handles errors from both gemini.js and ai.js (which may combine messages).
 * @param {Error} err
 * @returns {string}
 */
function geminiErrorMessage(err) {
  if (err.code === "MISSING_KEY") return "MISSING_KEY";
  if (err.code === "API_ERROR" && err.status === 429)
    return "Rate limit reached on all AI providers. Wait a moment and try again.";
  if (err.code === "API_ERROR" && err.status === 400)
    return "Invalid API key. Check your keys in Settings.";
  if (err.code === "API_ERROR" && err.status === 403)
    return "API key does not have access. Check your keys in Settings.";
  if (err.code === "NETWORK_ERROR")
    return "Network error. Check your connection and try again.";
  // ai.js may return a combined message string directly
  return err.message || "AI request failed.";
}

// ── SUMMARY_YOUTUBE ───────────────────────────────────────────────────────────

/**
 * Summarise a public YouTube video by sending its URL directly to Gemini.
 * Gemini's multimodal API can process public YouTube URLs natively.
 *
 * Payload shape: { url?: string }  — falls back to active tab URL.
 *
 * Success data:
 *   { tldr, keyPoints: string[], timestamps: {label,seconds}[], nextSteps, videoId, videoUrl }
 */
async function handleSummaryYouTube(requestId, message) {
  const payload = message && message.payload;

  // Resolve the video URL — use explicit payload or active tab.
  let videoUrl = payload && payload.url;
  if (!videoUrl) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      videoUrl = (tab && tab.url) || "";
    } catch (_e) {}
  }

  const videoId = extractYouTubeVideoId(videoUrl);
  if (!videoId) {
    return fail(requestId, "NOT_YOUTUBE");
  }

  // Normalise to a canonical watch URL so Gemini can always resolve it.
  const canonicalUrl = "https://www.youtube.com/watch?v=" + videoId;

  // ── Cache check — videos never change, cache is always valid ─────────────
  const forceRefreshYt = payload && payload.forceRefresh === true;
  if (!forceRefreshYt) {
    const cached = await getCachedSummary(canonicalUrl);
    if (cached) {
      return ok(requestId, Object.assign({}, cached, { fromCache: true }));
    }
  }

  // Gate on API key — YouTube requires Gemini specifically.
  const settings = await readSettings();
  if (!settings.geminiApiKey) {
    return fail(requestId, "MISSING_KEY");
  }

  // Build prompt and call Gemini Flash (Gemini-only — YouTube URL not supported by Groq).
  // The video URL is sent as a fileData part, not in the text prompt.
  // Retries up to 3 times with exponential backoff on 503 / network errors.
  const prompt = buildYouTubePrompt(settings.language);

  let rawText;
  let lastErr;
  const delays = [1500, 3000, 6000]; // ms between retries

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      rawText = await generateContentWithVideo(
        GEMINI_FLASH,
        canonicalUrl,
        prompt,
        settings.geminiApiKey
      );
      lastErr = null;
      break; // success — exit retry loop
    } catch (err) {
      lastErr = err;
      // Only retry on overload / server errors. Auth errors fail immediately.
      const retryable =
        err.code === "NETWORK_ERROR" ||
        (err.code === "API_ERROR" && (err.status === 503 || err.status === 500 || err.status === 529));

      if (!retryable || attempt === delays.length) {
        break; // not retryable or out of attempts
      }

      // Wait before next attempt.
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }

  if (lastErr) {
    return fail(requestId, geminiErrorMessage(lastErr));
  }

  // Parse the structured JSON response.
  const parsed = parseYouTubeJson(rawText);

  if (!parsed) {
    // Return raw text as graceful fallback so the user still gets something.
    return ok(requestId, {
      raw: rawText,
      parseError: true,
      videoId,
      videoUrl: canonicalUrl,
    });
  }

  const ytResult = {
    tldr: parsed.tldr,
    keyPoints: parsed.keyPoints,
    timestamps: parsed.timestamps,
    nextSteps: parsed.nextSteps,
    videoId,
    videoUrl: canonicalUrl,
  };

  // Cache — YouTube videos don't change, so this is always safe.
  setCachedSummary(canonicalUrl, ytResult).catch(() => {});

  return ok(requestId, ytResult);
}

/**
 * Strip markdown fences and parse the YouTube summary JSON.
 * Returns null on failure, or { error: "UNAVAILABLE" } for unavailable videos.
 *
 * @param {string} raw
 * @returns {{ tldr, keyPoints, timestamps, nextSteps } | { error: string } | null}
 */
function parseYouTubeJson(raw) {
  if (typeof raw !== "string") return null;

  let text = raw.trim();
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/i);
  if (fenceMatch) text = fenceMatch[1].trim();

  let obj;
  try {
    obj = JSON.parse(text);
  } catch (_e) {
    return null;
  }

  if (typeof obj !== "object" || obj === null) return null;

  if (typeof obj.tldr !== "string" || !obj.tldr.trim()) return null;
  if (!Array.isArray(obj.keyPoints) || obj.keyPoints.length === 0) return null;
  if (typeof obj.nextSteps !== "string" || !obj.nextSteps.trim()) return null;

  // Timestamps are optional — normalise to a clean array.
  const timestamps = Array.isArray(obj.timestamps)
    ? obj.timestamps
        .filter((t) => t && typeof t.label === "string" && Number.isInteger(t.seconds))
        .map((t) => ({ label: t.label.trim(), seconds: Math.max(0, t.seconds) }))
    : [];

  return {
    tldr: obj.tldr.trim(),
    keyPoints: obj.keyPoints
      .filter((p) => typeof p === "string" && p.trim())
      .map((p) => p.trim()),
    timestamps,
    nextSteps: obj.nextSteps.trim(),
  };
}

/**
 * Extract the YouTube video ID from a URL.
 * Handles: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID,
 *          youtube.com/embed/ID, and query-string variants.
 *
 * Returns null when the URL is not a recognisable YouTube video URL.
 *
 * @param {string} url
 * @returns {string|null}
 */
function extractYouTubeVideoId(url) {
  if (!url || typeof url !== "string") return null;

  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");

    // youtu.be/VIDEO_ID
    if (host === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0];
      return isValidVideoId(id) ? id : null;
    }

    // youtube.com/watch?v=VIDEO_ID
    if (host === "youtube.com" || host === "m.youtube.com") {
      const v = u.searchParams.get("v");
      if (v && isValidVideoId(v)) return v;

      // youtube.com/shorts/ID or /embed/ID
      const parts = u.pathname.split("/").filter(Boolean);
      if ((parts[0] === "shorts" || parts[0] === "embed") && parts[1]) {
        return isValidVideoId(parts[1]) ? parts[1] : null;
      }
    }
  } catch (_e) {
    // URL constructor threw — not a valid URL.
  }

  return null;
}

/**
 * YouTube video IDs are 11 characters of [A-Za-z0-9_-].
 * @param {string} id
 * @returns {boolean}
 */
function isValidVideoId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{11}$/.test(id);
}

/**
 * Return true when the URL is a YouTube video that Sahayak can summarise.
 * Used by the panel to decide which summary path to take.
 *
 * @param {string} url
 * @returns {boolean}
 */
function isYouTubeVideoUrl(url) {
  return extractYouTubeVideoId(url) !== null;
}

// ── TRANSLATE_RESULT ──────────────────────────────────────────────────────────

/**
 * Translate the text fields of a stored summary into the current language.
 * Uses Groq (or Gemini Flash-Lite) — never burns the Gemini Flash quota.
 *
 * Payload shape:
 *   {
 *     fields: { tldr, keyPoints, nextSteps, timestamps? },
 *     language: "en" | "hinglish"
 *   }
 *
 * Success data: same shape as fields, with translated text.
 */
async function handleTranslateResult(requestId, message) {
  const payload  = message && message.payload;
  const fields   = payload && payload.fields;
  const language = payload && payload.language;

  if (!fields || !language) {
    return fail(requestId, "Missing fields or language for translation.");
  }

  // English → just return the original fields unchanged (no API call needed).
  if (language === "en") {
    return ok(requestId, fields);
  }

  const settings = await readSettings();
  if (!settings.geminiApiKey && !settings.groqApiKey) {
    return fail(requestId, "MISSING_KEY");
  }

  // Build fields object — translate only text, keep timestamps seconds intact.
  const fieldsToTranslate = {
    tldr:      fields.tldr      || "",
    keyPoints: fields.keyPoints || [],
    nextSteps: fields.nextSteps || "",
  };

  // Translate timestamp labels separately if present.
  if (fields.timestamps && fields.timestamps.length > 0) {
    fieldsToTranslate.timestampLabels = fields.timestamps.map((t) => t.label);
  }

  const prompt = buildTranslatePrompt(fieldsToTranslate, language);

  let rawText;
  try {
    // Prefer Groq for translation — cheap, fast, and saves Flash quota.
    // Falls back to Flash-Lite if no Groq key or Groq fails.
    rawText = await callAI({ model: GEMINI_FLASH_LITE, prompt, settings });
  } catch (err) {
    return fail(requestId, geminiErrorMessage(err));
  }

  // Parse the translated JSON.
  let translated;
  try {
    let text = rawText.trim();
    const fence = text.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/i);
    if (fence) text = fence[1].trim();
    translated = JSON.parse(text);
  } catch (_e) {
    // If translation JSON is malformed, return original untranslated fields.
    return ok(requestId, fields);
  }

  // Merge translated text back with original structure.
  const result = {
    tldr:      typeof translated.tldr === "string" ? translated.tldr : fields.tldr,
    keyPoints: Array.isArray(translated.keyPoints)  ? translated.keyPoints : fields.keyPoints,
    nextSteps: typeof translated.nextSteps === "string" ? translated.nextSteps : fields.nextSteps,
  };

  // Re-attach timestamp labels if they were translated.
  if (fields.timestamps && fields.timestamps.length > 0) {
    const labels = Array.isArray(translated.timestampLabels) ? translated.timestampLabels : [];
    result.timestamps = fields.timestamps.map((t, i) => ({
      seconds: t.seconds,
      label: labels[i] || t.label,
    }));
  }

  return ok(requestId, result);
}

// ── Chat state ────────────────────────────────────────────────────────────────
//
// Keyed by tabId. Resets automatically when the page URL changes.
// Shape: { [tabId]: { messages: [{role, text}], pageUrl: string } }
//
// Stored in memory only (SW can sleep — if the SW wakes with no state,
// the panel detects the reset and shows a "context lost" message).
// Full persistence is a Phase 3 enhancement.

const chatByTab = {};
const CHAT_MAX_HISTORY = 20; // keep last 20 turns (10 pairs)

// ── CHAT_SEND ─────────────────────────────────────────────────────────────────

/**
 * Handle a user chat message.
 *
 * Payload shape: { message: string, tabId?: number }
 *
 * Success data: { reply: string, resetContext: boolean }
 *   resetContext: true when we detected a URL change and cleared history.
 */
async function handleChatSend(requestId, message) {
  const payload     = message && message.payload;
  const userMessage = payload && payload.message;

  if (!userMessage || !userMessage.trim()) {
    return fail(requestId, "Empty message.");
  }

  // Resolve tab.
  const tabId = await resolveTabId(payload && payload.tabId);
  if (tabId === null) {
    return fail(requestId, "No active tab found.");
  }

  // Get current tab URL to detect navigation.
  let currentUrl = "";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentUrl = (tab && tab.url) || "";
  } catch (_e) {}

  if (isRestrictedUrl(currentUrl)) {
    return fail(requestId, "RESTRICTED_PAGE");
  }

  // Initialise or reset chat state for this tab.
  let resetContext = false;
  if (!chatByTab[tabId] || chatByTab[tabId].pageUrl !== currentUrl) {
    chatByTab[tabId] = { messages: [], pageUrl: currentUrl };
    resetContext = chatByTab[tabId] && chatByTab[tabId].messages.length > 0;
  }

  const chat = chatByTab[tabId];

  // Extract page context via content script.
  let pageContext = null;
  try {
    const reply = await chrome.tabs.sendMessage(tabId, {
      type: "EXTRACT_ARTICLE",
      requestId: uuid(),
    });
    if (reply && reply.ok && reply.data) {
      pageContext = {
        title: reply.data.title || "",
        url:   currentUrl,
        text:  reply.data.text  || "",
      };
    }
  } catch (_e) {}

  if (!pageContext || !pageContext.text.trim()) {
    pageContext = {
      title: currentUrl,
      url:   currentUrl,
      text:  "",
    };
  }

  // Gate on API key.
  const settings = await readSettings();
  if (!settings.geminiApiKey && !settings.groqApiKey) {
    return fail(requestId, "MISSING_KEY");
  }

  // Build prompt with history.
  const prompt = buildChatPrompt(
    pageContext,
    chat.messages.slice(-CHAT_MAX_HISTORY),
    userMessage.trim(),
    settings.language
  );

  let reply;
  try {
    reply = await callAI({ model: GEMINI_FLASH_LITE, prompt, settings });
  } catch (err) {
    return fail(requestId, geminiErrorMessage(err));
  }

  // Append to history.
  chat.messages.push({ role: "user",      text: userMessage.trim() });
  chat.messages.push({ role: "assistant", text: reply.trim() });

  // Cap history length.
  if (chat.messages.length > CHAT_MAX_HISTORY * 2) {
    chat.messages = chat.messages.slice(-CHAT_MAX_HISTORY * 2);
  }

  return ok(requestId, {
    reply:        reply.trim(),
    resetContext,
    pageTitle:    pageContext.title,
    hasPageText:  Boolean(pageContext.text.trim()),
  });
}

// ── CHAT_RESET ────────────────────────────────────────────────────────────────

/**
 * Explicitly clear chat history for a tab (e.g. user presses "New chat").
 * Payload shape: { tabId?: number }
 */
async function handleChatReset(requestId, message) {
  const payload = message && message.payload;
  const tabId   = await resolveTabId(payload && payload.tabId);
  if (tabId !== null && chatByTab[tabId]) {
    delete chatByTab[tabId];
  }
  return ok(requestId, { reset: true });
}
