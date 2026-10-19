/**
 * background/ai/ai.js
 *
 * Unified AI dispatcher with three provider modes:
 *
 *   "auto"   — Groq first for text; Gemini as fallback on retryable errors.
 *              YouTube / vision always go to Gemini regardless of this setting.
 *   "groq"   — Groq only (text tasks). No Gemini fallback.
 *   "gemini" — Gemini only. No Groq fallback.
 *
 * The mode comes from settings.preferredProvider (default: "auto").
 *
 * Exported symbols (available globally after importScripts):
 *   callAI(opts)            → Promise<string>   text tasks, Groq-first
 *   callAIGeminiOnly(opts)  → Promise<string>   YouTube / vision, Gemini only
 *
 * opts shape:
 *   {
 *     model:       string,   // GEMINI_FLASH_LITE (used only when Gemini runs)
 *     prompt:      string,
 *     settings:    { geminiApiKey, groqApiKey, preferredProvider },
 *     maxTokens?:  number,   // task-specific cap; overrides default in clients
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

// ── Main dispatcher (text tasks — Groq-first) ─────────────────────────────────

/**
 * Call the AI provider for text tasks.
 *
 * Default mode ("auto"): try Groq first; fall back to Gemini on retryable
 * errors. If only one key is set, use that provider directly.
 *
 * "groq"   → Groq only.
 * "gemini" → Gemini only.
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

  // ── "auto" mode: Groq-first ───────────────────────────────────────────────

  // Only one key → use that provider directly.
  if (groqKey && !geminiKey) return tryGroq(prompt, groqKey, maxTokens);
  if (geminiKey && !groqKey) return tryGemini(model, prompt, geminiKey, maxTokens);

  // Both keys → try Groq first, fall back to Gemini.
  let firstErr = null;
  try {
    return await tryGroq(prompt, groqKey, maxTokens);
  } catch (err) {
    firstErr = err;
    if (!isRetryable(err)) {
      // Auth error on Groq — not worth trying Gemini for the same prompt.
      throw err;
    }
  }

  // Groq failed with a retryable error → try Gemini.
  try {
    return await tryGemini(model, prompt, geminiKey, maxTokens);
  } catch (geminiErr) {
    const msg = groqErrToString(firstErr) + " Gemini fallback also failed: " + geminiErrToString(geminiErr);
    throw makeError(firstErr.code, msg, firstErr.status);
  }
}

/**
 * Gemini-only call — no Groq fallback, ignores preferredProvider.
 * Required for YouTube URL summarisation and vision tasks (Groq cannot
 * process video or image data).
 *
 * @param {{ model: string, prompt: string, settings: object, maxTokens?: number }} opts
 * @returns {Promise<string>}
 */
async function callAIGeminiOnly(opts) {
  const { model, prompt, settings, maxTokens } = opts;
  const geminiKey = settings && settings.geminiApiKey;
  if (!geminiKey) throw makeError("MISSING_KEY", "MISSING_KEY");
  return generateContent(model, prompt, geminiKey, maxTokens);
}
