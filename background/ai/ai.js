/**
 * background/ai/ai.js
 *
 * Unified AI dispatcher with three provider modes:
 *
 *   "auto"   — Gemini first for all tasks; Groq as automatic text fallback on
 *              retryable errors. YouTube / vision always go to Gemini first;
 *              if Gemini fails a text-only Groq fallback is attempted for YouTube.
 *   "gemini" — Gemini only. No Groq fallback.
 *   "groq"   — Groq only (text tasks). No Gemini fallback.
 *
 * The mode comes from settings.preferredProvider (default: "auto").
 *
 * Exported symbols (available globally after importScripts):
 *   callAI(opts)                    → Promise<string>   text tasks, Gemini-first
 *   callAIGeminiOnly(opts)          → Promise<string>   vision tasks, Gemini only (no fallback)
 *   callAIGeminiWithGroqFallback(opts) → Promise<string>   YouTube: Gemini video first, Groq text fallback
 *
 * opts shape:
 *   {
 *     model:        string,   // GEMINI_FLASH_LITE or GEMINI_FLASH
 *     prompt:       string,   // text prompt (for Gemini text / Groq)
 *     videoUrl?:    string,   // canonical YouTube URL (for Gemini video path only)
 *     settings:     { geminiApiKey, groqApiKey, preferredProvider },
 *     maxTokens?:   number,   // task-specific cap; overrides default in clients
 *   }
 */

// ── Error helpers ─────────────────────────────────────────────────────────────

/**
 * True when an error is worth retrying on the other provider.
 * Auth errors (400/401/403) are never retried — a bad key is a bad key.
 * @param {Error} err
 * @returns {boolean}
 */
function isRetryable(err) {
  if (err.code === "NETWORK_ERROR") return true;
  if (err.code === "API_ERROR") {
    const s = err.status;
    return s === 429 || s === 500 || s === 503 || s === 529;
  }
  return false;
}

function groqErrToString(err) {
  if (!err) return "";
  if (err.code === "MISSING_KEY") return "MISSING_KEY";
  if (err.code === "API_ERROR" && err.status === 429) return "Groq rate limit reached.";
  if (err.code === "API_ERROR" && err.status === 401) return "Invalid Groq API key. Check your key in Settings.";
  if (err.code === "NETWORK_ERROR") return "Network error reaching Groq.";
  return err.message || "Groq request failed.";
}

function geminiErrToString(err) {
  if (!err) return "";
  if (err.code === "MISSING_KEY") return "MISSING_KEY";
  if (err.code === "API_ERROR" && err.status === 429) return "Gemini rate limit reached.";
  if (err.code === "API_ERROR" && err.status === 400) return "Invalid Gemini API key. Check your key in Settings.";
  if (err.code === "API_ERROR" && err.status === 403) return "Gemini API key does not have access. Check your key in Settings.";
  if (err.code === "NETWORK_ERROR") return "Network error reaching Gemini.";
  return err.message || "Gemini request failed.";
}

function makeError(code, message, status) {
  const err = new Error(message);
  err.code = code;
  if (status !== undefined) err.status = status;
  return err;
}

// ── Provider calls ────────────────────────────────────────────────────────────

async function tryGemini(model, prompt, geminiKey, maxTokens) {
  return generateContent(model, prompt, geminiKey, maxTokens);
}

async function tryGroq(prompt, groqKey, maxTokens) {
  return generateContentGroq(prompt, groqKey, maxTokens);
}

async function tryGeminiVideo(model, videoUrl, prompt, geminiKey, maxTokens) {
  return generateContentWithVideo(model, videoUrl, prompt, geminiKey, maxTokens);
}

// ── Main dispatcher (text tasks — Gemini-first) ───────────────────────────────

/**
 * Call the AI provider for text tasks.
 *
 * Default mode ("auto"): try Gemini first; fall back to Groq on retryable
 * errors. If only one key is set, use that provider directly.
 *
 * "gemini" → Gemini only.
 * "groq"   → Groq only (text tasks).
 *
 * @param {{ model: string, prompt: string, settings: object, maxTokens?: number }} opts
 * @returns {Promise<string>}
 */
async function callAI(opts) {
  const { model, prompt, settings, maxTokens } = opts;
  const geminiKey = settings && settings.geminiApiKey;
  const groqKey   = settings && settings.groqApiKey;
  const provider  = (settings && settings.preferredProvider) || "auto";

  if (!geminiKey && !groqKey) {
    throw makeError("MISSING_KEY", "MISSING_KEY");
  }

  // ── Explicit "gemini" mode ────────────────────────────────────────────────
  if (provider === "gemini") {
    if (!geminiKey) throw makeError("MISSING_KEY", "MISSING_KEY");
    return tryGemini(model, prompt, geminiKey, maxTokens);
  }

  // ── Explicit "groq" mode ──────────────────────────────────────────────────
  if (provider === "groq") {
    if (!groqKey) throw makeError("MISSING_KEY", "MISSING_KEY");
    return tryGroq(prompt, groqKey, maxTokens);
  }

  // ── "auto" mode: Gemini-first ─────────────────────────────────────────────

  // Only one key → use that provider directly.
  if (geminiKey && !groqKey) return tryGemini(model, prompt, geminiKey, maxTokens);
  if (groqKey && !geminiKey) return tryGroq(prompt, groqKey, maxTokens);

  // Both keys → try Gemini first, fall back to Groq on retryable errors.
  let firstErr = null;
  try {
    return await tryGemini(model, prompt, geminiKey, maxTokens);
  } catch (err) {
    firstErr = err;
    if (!isRetryable(err)) {
      // Auth / bad-request error on Gemini — not worth trying Groq.
      throw err;
    }
  }

  // Gemini failed with a retryable error → fall back to Groq.
  try {
    return await tryGroq(prompt, groqKey, maxTokens);
  } catch (groqErr) {
    // Both providers failed — return a single clear message.
    if (groqErr.code === "MISSING_KEY") {
      throw firstErr; // Groq key not set, surface the Gemini error.
    }
    throw makeError(
      firstErr.code,
      "Rate limit reached on all AI providers. Wait a moment and try again.",
      firstErr.status
    );
  }
}

/**
 * Vision-only call — Gemini only, no Groq fallback (Groq cannot process images).
 * Ignores preferredProvider.
 *
 * @param {{ model: string, prompt: string, settings: object, maxTokens?: number }} opts
 * @returns {Promise<string>}
 */
async function callAIGeminiOnly(opts) {
  const { model, prompt, settings, maxTokens } = opts;
  const geminiKey = settings && settings.geminiApiKey;
  if (!geminiKey) throw makeError("MISSING_KEY", "MISSING_KEY");
  return tryGemini(model, prompt, geminiKey, maxTokens);
}

/**
 * YouTube summarisation — Gemini video API first (sends the URL as fileData),
 * automatic Groq text fallback if Gemini fails with a retryable error.
 *
 * The Groq fallback cannot watch the video; it generates a text-only
 * summary from the prompt alone (no video data). This is still useful
 * for rate-limit situations where the user just needs some output.
 *
 * Always ignores preferredProvider — YouTube is always Gemini-first.
 *
 * @param {{
 *   model:      string,   // GEMINI_FLASH
 *   videoUrl:   string,   // canonical youtube.com/watch?v=ID URL
 *   prompt:     string,   // instruction prompt (no URL inside)
 *   settings:   object,
 *   maxTokens?: number,
 * }} opts
 * @returns {Promise<string>}
 */
async function callAIGeminiWithGroqFallback(opts) {
  const { model, videoUrl, prompt, settings, maxTokens } = opts;
  const geminiKey = settings && settings.geminiApiKey;
  const groqKey   = settings && settings.groqApiKey;

  if (!geminiKey && !groqKey) {
    throw makeError("MISSING_KEY", "MISSING_KEY");
  }

  // Gemini-only mode: no fallback.
  if ((settings && settings.preferredProvider) === "groq") {
    // "groq only" selected — Groq cannot process video, so this is a
    // text-only summary attempt with just the prompt (no video data).
    if (!groqKey) throw makeError("MISSING_KEY", "MISSING_KEY");
    return tryGroq(prompt, groqKey, maxTokens);
  }

  // Try Gemini video path first.
  if (geminiKey) {
    let geminiErr = null;
    try {
      return await tryGeminiVideo(model, videoUrl, prompt, geminiKey, maxTokens);
    } catch (err) {
      geminiErr = err;
      if (!isRetryable(err)) {
        // Auth/bad-request — don't bother falling back.
        throw err;
      }
    }

    // Gemini failed with a retryable error — try Groq text fallback.
    if (groqKey) {
      try {
        return await tryGroq(prompt, groqKey, maxTokens);
      } catch (groqErr) {
        const msg = geminiErrToString(geminiErr) + " Groq fallback also failed: " + groqErrToString(groqErr);
        throw makeError(geminiErr.code, msg, geminiErr.status);
      }
    }

    // No Groq key — re-throw the Gemini error.
    throw geminiErr;
  }

  // No Gemini key at all — go straight to Groq (text-only).
  if (!groqKey) throw makeError("MISSING_KEY", "MISSING_KEY");
  return tryGroq(prompt, groqKey, maxTokens);
}

/**
 * Vision call — inline base64 image sent to Gemini Flash.
 * Never falls back to Groq (text-only, cannot process images).
 * Ignores preferredProvider.
 *
 * @param {{
 *   model:      string,
 *   prompt:     string,
 *   base64:     string,   // raw base64, no data URL prefix
 *   mimeType:   string,   // "image/png" | "image/jpeg"
 *   settings:   object,
 *   maxTokens?: number,
 * }} opts
 * @returns {Promise<string>}
 */
async function callAIVision(opts) {
  const { model, prompt, base64, mimeType, settings, maxTokens } = opts;
  const geminiKey = settings && settings.geminiApiKey;
  if (!geminiKey) throw makeError("MISSING_KEY", "MISSING_KEY");
  return generateContentWithImage(model, prompt, base64, mimeType, geminiKey, maxTokens);
}
