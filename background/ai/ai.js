/**
 * background/ai/ai.js
 *
 * Unified AI dispatcher supporting three provider modes:
 *
 *   "gemini" — use Gemini only, no fallback
 *   "groq"   — use Groq only, no fallback (text tasks only)
 *   "auto"   — try the preferred provider first; fall back to the other on
 *              retryable failures (429, 5xx, network). Default when unset.
 *
 * The mode comes from settings.preferredProvider, which the user controls
 * in the Options page. It defaults to "auto".
 *
 * Tasks that MUST use Gemini (YouTube URL, vision) always call
 * callAIGeminiOnly() directly and bypass this setting.
 *
 * Exported symbols (available globally after importScripts):
 *   callAI(opts)            → Promise<string>
 *   callAIGeminiOnly(opts)  → Promise<string>
 *
 * opts shape:
 *   {
 *     model:    string,   // GEMINI_FLASH_LITE | GEMINI_FLASH
 *     prompt:   string,
 *     settings: { geminiApiKey, groqApiKey, preferredProvider },
 *   }
 */

// ── Error helpers ─────────────────────────────────────────────────────────────

/**
 * True when a Gemini error is worth retrying on the other provider.
 * Auth errors (400/403) are never retried — a bad key is a bad key.
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

function geminiErrToString(err) {
  if (!err) return "";
  if (err.code === "MISSING_KEY") return "MISSING_KEY";
  if (err.code === "API_ERROR" && err.status === 429) return "Gemini rate limit reached.";
  if (err.code === "API_ERROR" && err.status === 400) return "Invalid Gemini API key. Check your key in Settings.";
  if (err.code === "API_ERROR" && err.status === 403) return "Gemini API key does not have access. Check your key in Settings.";
  if (err.code === "NETWORK_ERROR") return "Network error reaching Gemini.";
  return err.message || "Gemini request failed.";
}

function groqErrToString(err) {
  if (!err) return "";
  if (err.code === "MISSING_KEY") return "Groq key not set.";
  if (err.code === "API_ERROR" && err.status === 429) return "Groq rate limit reached. Try again in a moment.";
  if (err.code === "API_ERROR" && err.status === 401) return "Invalid Groq API key. Check your key in Settings.";
  if (err.code === "NETWORK_ERROR") return "Network error reaching Groq.";
  return err.message || "Groq request failed.";
}

function makeError(code, message, status) {
  const err = new Error(message);
  err.code = code;
  if (status !== undefined) err.status = status;
  return err;
}

// ── Provider calls ────────────────────────────────────────────────────────────

async function tryGemini(model, prompt, geminiKey) {
  return generateContent(model, prompt, geminiKey);
}

async function tryGroq(prompt, groqKey) {
  return generateContentGroq(prompt, groqKey);
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

/**
 * Call the AI provider chosen by settings.preferredProvider.
 *
 * "gemini" → Gemini only, throws on failure.
 * "groq"   → Groq only, throws on failure.
 * "auto"   → Try Gemini first (if key available); on retryable error fall
 *            back to Groq. If only one key is present, use that provider
 *            directly. Falls back in the other direction too:
 *            Groq-first if preferredProvider is "auto" and only groqKey set.
 *
 * @param {{ model: string, prompt: string, settings: object }} opts
 * @returns {Promise<string>}
 */
async function callAI(opts) {
  const { model, prompt, settings } = opts;
  const geminiKey = settings && settings.geminiApiKey;
  const groqKey   = settings && settings.groqApiKey;
  const provider  = (settings && settings.preferredProvider) || "auto";

  // No keys at all.
  if (!geminiKey && !groqKey) {
    throw makeError("MISSING_KEY", "MISSING_KEY");
  }

  // ── "gemini" mode: Gemini only ──────────────────────────────────────────────
  if (provider === "gemini") {
    if (!geminiKey) throw makeError("MISSING_KEY", "MISSING_KEY");
    return tryGemini(model, prompt, geminiKey);
  }

  // ── "groq" mode: Groq only ──────────────────────────────────────────────────
  if (provider === "groq") {
    if (!groqKey) throw makeError("MISSING_KEY", "MISSING_KEY");
    return tryGroq(prompt, groqKey);
  }

  // ── "auto" mode: smart fallback ─────────────────────────────────────────────
  // Only one key available → use that provider directly.
  if (geminiKey && !groqKey) return tryGemini(model, prompt, geminiKey);
  if (groqKey && !geminiKey) return tryGroq(prompt, groqKey);

  // Both keys available → try Gemini first, fall back to Groq.
  let firstErr = null;
  try {
    return await tryGemini(model, prompt, geminiKey);
  } catch (err) {
    firstErr = err;
    if (!isRetryable(err)) {
      // Auth errors etc. — not worth trying Groq.
      throw err;
    }
  }

  // Gemini failed with a retryable error → try Groq.
  try {
    return await tryGroq(prompt, groqKey);
  } catch (groqErr) {
    // Both failed — combine messages.
    const msg = geminiErrToString(firstErr) + " Groq fallback also failed: " + groqErrToString(groqErr);
    const combined = makeError(firstErr.code, msg, firstErr.status);
    throw combined;
  }
}

/**
 * Call Gemini only — no Groq fallback, ignores preferredProvider.
 * Used for tasks that Groq cannot handle: YouTube URL, vision.
 *
 * @param {{ model: string, prompt: string, settings: object }} opts
 * @returns {Promise<string>}
 */
async function callAIGeminiOnly(opts) {
  const { model, prompt, settings } = opts;
  const geminiKey = settings && settings.geminiApiKey;
  if (!geminiKey) throw makeError("MISSING_KEY", "MISSING_KEY");
  return generateContent(model, prompt, geminiKey);
}
