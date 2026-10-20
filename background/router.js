const SETTINGS_STORAGE_KEY = "settings";

const DEFAULT_SETTINGS = {
  geminiApiKey: "",
  groqApiKey: "",
  language: "en",
  translateTarget: "hi",
  dryRunDefault: false,
  maxAgentSteps: 20,
  preferredProvider: "auto", // "auto" (Gemini-first) | "gemini" | "groq"
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

    case "CONTEXT_MENU_GET":
      return handleContextMenuGet(requestId);

    case "SCREENSHOT_CAPTURE":
      return handleScreenshotCapture(requestId, message);

    case "SCREENSHOT_ASK":
      return handleScreenshotAsk(requestId, message);

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
  const mode    = payload && payload.mode;

  const VALID_MODES = ["explain", "translate", "draft"];
  if (!VALID_MODES.includes(mode)) {
    return fail(requestId, 'Unsupported mode "' + mode + '"');
  }

  // If selection text is provided directly (from context menu stash), use it.
  // Otherwise fall back to asking the content script.
  let selectionText = payload && payload.selection;

  if (!selectionText || !selectionText.trim()) {
    // Resolve the target tab.
    const tabId = await resolveTabId(payload && payload.tabId);
    if (tabId === null) {
      return fail(requestId, "No active tab found.");
    }

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
  }

  if (!selectionText || !selectionText.trim()) {
    return fail(requestId, "NO_SELECTION");
  }

  // Gate on API key.
  const settings = await readSettings();
  if (!settings.geminiApiKey && !settings.groqApiKey) {
    return fail(requestId, "MISSING_KEY");
  }

  // Build prompt based on mode.
  let prompt;
  let maxTokens;
  if (mode === "explain") {
    prompt = buildExplainPrompt(selectionText.trim(), settings.language);
    maxTokens = 300; // 3-5 sentences
  } else if (mode === "translate") {
    const langNames = {
      hi: "Hindi", fr: "French", es: "Spanish", de: "German",
      ja: "Japanese", zh: "Chinese", ar: "Arabic", pt: "Portuguese",
      ru: "Russian", ko: "Korean", it: "Italian", ta: "Tamil",
      te: "Telugu", bn: "Bengali", mr: "Marathi", gu: "Gujarati",
    };
    const targetCode = settings.translateTarget || "hi";
    const targetName = langNames[targetCode] || targetCode;
    prompt = buildTranslateSelectionPrompt(selectionText.trim(), targetName, settings.language);
    maxTokens = 400; // roughly same length as input
  } else if (mode === "draft") {
    prompt = buildDraftPrompt(selectionText.trim(), settings.language);
    maxTokens = 200; // 2-4 sentences
  }

  try {
    const result = await callAI({ model: GEMINI_FLASH_LITE, prompt, settings, maxTokens });
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
  // Groq has an 8K TPM cap — trim article text to stay well within budget.
  // Gemini has a 1M context window so no trimming needed there, but we
  const trimmedArticle = Object.assign({}, articleData, {
    text: articleData.text.slice(0, 6000),
  });
  // Always generate in English — the panel translates on demand.
  // This ensures the cache is always English and EN↔Hinglish toggles
  // always have a clean source to translate from.
  const prompt = buildSummaryPrompt(trimmedArticle, "en");

  let rawText;
  try {
    rawText = await callAI({ model: GEMINI_FLASH_LITE, prompt, settings, maxTokens: 600 });
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

  // Cache by tab URL — always in English so the toggle always has a clean source.
  setCachedSummary(tabUrl, result).catch(() => {});

  return ok(requestId, result);
}

/**
 * Strip markdown fences and parse the summary JSON the model returned.
 * Tries multiple extraction strategies to handle models that wrap JSON
 * in explanation text (e.g. "Here is the summary: { ... }").
 *
 * @param {string} raw
 * @returns {{ tldr, keyPoints, nextSteps } | null}
 */
function parseSummaryJson(raw) {
  if (typeof raw !== "string") return null;

  let text = raw.trim();

  // Strategy 1: strip ```json ... ``` or ``` ... ``` fences.
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // Strategy 2: find the first { ... } block in the response (handles
  // models that add preamble like "Here is the JSON summary:").
  if (!text.startsWith("{")) {
    const braceStart = text.indexOf("{");
    const braceEnd   = text.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd > braceStart) {
      text = text.slice(braceStart, braceEnd + 1);
    }
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
  if (err.code === "API_ERROR" && err.status === 429) {
    // Extract "retry in Xh Ym Zs" from the Gemini error body when present.
    const retryMatch = err.message && err.message.match(/retry in\s+([\dhms.]+)/i);
    if (retryMatch) {
      const raw = retryMatch[1];
      const hMatch = raw.match(/(\d+)h/);
      const mMatch = raw.match(/(\d+)m/);
      let human = "";
      if (hMatch) human += hMatch[1] + "h ";
      if (mMatch) human += mMatch[1] + "m";
      human = human.trim();
      const who = (err.message && err.message.includes("gemini-3.8-flash"))
        ? "Gemini Flash (vision)" : "Gemini";
      return human
        ? who + " quota exhausted. Try again in " + human + "."
        : "Rate limit reached. Wait a moment and try again.";
    }
    return "Rate limit reached. Wait a moment and try again.";
  }
  if (err.code === "API_ERROR" && err.status === 400) {
    const msg = err.message || "";
    if (msg.toLowerCase().includes("api key")) return "Invalid API key. Check your keys in Settings.";
    if (msg.toLowerCase().includes("safety") || msg.toLowerCase().includes("blocked"))
      return "The request was blocked by Gemini's safety filters. Try rephrasing.";
    return "Invalid API key. Check your keys in Settings.";
  }
  if (err.code === "API_ERROR" && err.status === 401)
    return "Invalid API key. Check your keys in Settings.";
  if (err.code === "API_ERROR" && err.status === 403)
    return "API key does not have access. Check your keys in Settings.";
  if (err.code === "NETWORK_ERROR")
    return "Network error. Check your connection and try again.";
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

  // Gate on API key — YouTube always tries Gemini first; Groq key allows text fallback.
  const settings = await readSettings();
  if (!settings.geminiApiKey && !settings.groqApiKey) {
    return fail(requestId, "MISSING_KEY");
  }

  // Build prompt and call Gemini Flash first (video fileData path).
  // If Gemini fails with a retryable error, callAIGeminiWithGroqFallback
  // automatically retries via Groq's text-only path as a fallback.
  // The video URL is sent as a fileData part inside callAIGeminiWithGroqFallback.
  // Always generate in English — panel translates on demand.
  const prompt = buildYouTubePrompt(canonicalUrl, "en");

  let rawText;
  try {
    rawText = await callAIGeminiWithGroqFallback({
      model:      GEMINI_FLASH,
      videoUrl:   canonicalUrl,
      prompt,
      settings,
      maxTokens:  800, // YouTube summary needs more tokens for timestamps + chapters
    });
  } catch (err) {
    return fail(requestId, geminiErrorMessage(err));
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

  // Extract JSON object if model added preamble text.
  if (!text.startsWith("{")) {
    const braceStart = text.indexOf("{");
    const braceEnd   = text.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd > braceStart) {
      text = text.slice(braceStart, braceEnd + 1);
    }
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
    // Translation of existing fields — 600 tokens covers the JSON structure.
    rawText = await callAI({ model: GEMINI_FLASH_LITE, prompt, settings, maxTokens: 600 });
  } catch (err) {
    return fail(requestId, geminiErrorMessage(err));
  }

  // Parse the translated JSON.
  let translated;
  try {
    let text = rawText.trim();
    const fence = text.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/i);
    if (fence) text = fence[1].trim();
    // Extract JSON object if model added preamble text.
    if (!text.startsWith("{")) {
      const bs = text.indexOf("{");
      const be = text.lastIndexOf("}");
      if (bs !== -1 && be > bs) text = text.slice(bs, be + 1);
    }
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
// In-memory store keyed by tabId.
// Shape: { [tabId]: { messages: [{role, text}], pageUrl: string } }
//
// pageUrl is also persisted to chrome.storage.local (key: chatPageUrl_<tabId>)
// so the SW can detect a URL change even after it has slept and lost memory.

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

  // ── Detect URL change ────────────────────────────────────────────────────
  // Track purely in memory — storage-based tracking caused false negatives
  // because currentUrl was already written before comparison on SW wakes.

  const inMemory   = chatByTab[tabId];

  // URL-change detection:
  // - If we have in-memory state for this tab, compare URLs directly.
  //   This is reliable and doesn't depend on storage timing.
  // - If no in-memory state (SW woke fresh), we can't reliably detect a
  //   URL change — don't false-positive. The user just gets a clean context.
  const urlChanged = Boolean(
    inMemory && inMemory.pageUrl && inMemory.pageUrl !== currentUrl
  );

  let resetContext = false;

  if (!inMemory || urlChanged) {
    resetContext = urlChanged; // only notify when we actually saw the old URL
    chatByTab[tabId] = { messages: [], pageUrl: currentUrl };
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
  // Trim page text to 5k chars (~1.25k tokens) to stay within Groq's 8K TPM.
  const trimmedContext = Object.assign({}, pageContext, {
    text: (pageContext.text || "").slice(0, 5000),
  });
  const prompt = buildChatPrompt(
    trimmedContext,
    chat.messages.slice(-CHAT_MAX_HISTORY),
    userMessage.trim(),
    settings.language
  );

  let reply;
  try {
    reply = await callAI({ model: GEMINI_FLASH_LITE, prompt, settings, maxTokens: 500 });
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
  if (tabId !== null) {
    delete chatByTab[tabId];
  }
  return ok(requestId, { reset: true });
}

// ── SCREENSHOT_CAPTURE ────────────────────────────────────────────────────────

/**
 * Capture the visible tab as a PNG data URL.
 * The panel stores this temporarily in memory — never persisted to storage.
 *
 * Success data: { dataUrl: string, tabId: number, tabUrl: string }
 */
async function handleScreenshotCapture(requestId, message) {
  const payload = message && message.payload;

  // Find the active http/https tab across all normal windows.
  let targetTab = null;
  try {
    const allWindows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
    for (const win of allWindows) {
      const activeTab = (win.tabs || []).find((t) => t.active);
      if (activeTab && activeTab.url &&
          (activeTab.url.startsWith("http://") || activeTab.url.startsWith("https://"))) {
        targetTab = activeTab;
        break;
      }
    }
  } catch (_e) {}

  if (!targetTab) {
    return fail(requestId, "No browser tab found to capture.");
  }

  const tabUrl = targetTab.url || "";

  if (isRestrictedUrl(tabUrl)) {
    return fail(requestId, "RESTRICTED_PAGE");
  }

  // captureVisibleTab called without windowId uses the last focused window.
  // Calling it with null explicitly avoids the cross-window permission error.
  let dataUrl;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "png" });
  } catch (err) {
    return fail(requestId, "Could not capture the tab: " + (err.message || "unknown error"));
  }

  if (!dataUrl || !dataUrl.startsWith("data:image/")) {
    return fail(requestId, "Capture returned an unexpected format.");
  }

  return ok(requestId, { dataUrl, tabUrl });
}

// ── SCREENSHOT_ASK ────────────────────────────────────────────────────────────

/**
 * Send a (possibly cropped) screenshot to Gemini Flash vision and return
 * the model's answer to the user's question.
 *
 * Payload shape:
 *   { dataUrl: string, question: string }
 *   dataUrl  — base64 PNG data URL (full or cropped by the panel)
 *   question — the user's question about the image
 *
 * Gemini only — never sends image data to Groq (text-only).
 *
 * Success data: { answer: string }
 */
async function handleScreenshotAsk(requestId, message) {
  const payload  = message && message.payload;
  const dataUrl  = payload && payload.dataUrl;
  const question = payload && payload.question;

  if (!dataUrl || !dataUrl.startsWith("data:image/")) {
    return fail(requestId, "No screenshot to analyse. Capture the screen first.");
  }
  if (!question || !question.trim()) {
    return fail(requestId, "Please type a question about the screenshot.");
  }

  const settings = await readSettings();
  if (!settings.geminiApiKey) {
    return fail(requestId, "MISSING_KEY");
  }

  // Strip the data URL prefix to get the raw base64.
  // Format: "data:image/png;base64,<base64data>"
  const base64 = dataUrl.split(",")[1];
  if (!base64) {
    return fail(requestId, "Screenshot data is malformed.");
  }

  const prompt = buildVisionPrompt(question.trim(), settings.language);

  try {
    const answer = await callAIVision({
      model:    GEMINI_FLASH,
      prompt,
      base64,
      mimeType: "image/png",
      settings,
      maxTokens: 600,
    });
    return ok(requestId, { answer: answer.trim() });
  } catch (err) {
    return fail(requestId, geminiErrorMessage(err));
  }
}

// ── CONTEXT_MENU_GET ──────────────────────────────────────────────────────────

/**
 * Return and clear any pending context menu action stashed by the SW.
 * The panel calls this on startup to check if it was opened via right-click.
 *
 * Success data: { pending: { mode, selection, url, tabId } | null }
 */
async function handleContextMenuGet(requestId) {
  try {
    const bag = await chrome.storage.local.get("pendingContextAction");
    const pending = bag.pendingContextAction || null;
    // Clear immediately so it doesn't fire again on next panel open.
    if (pending) {
      await chrome.storage.local.remove("pendingContextAction");
    }
    return ok(requestId, { pending });
  } catch (_e) {
    return ok(requestId, { pending: null });
  }
}
