/**
 * background/ai/groq.js
 *
 * Text-only Groq API client with retry/backoff.
 * Runs exclusively in the service worker — never from a page.
 *
 * IMPORTANT: Groq is text-only. Never pass image data or YouTube URLs here.
 *
 * Retry policy: 429 / 500 / 503 → backoff 1s, 2s, 4s + jitter, max 3 retries.
 * Honours Retry-After header. Auth errors (401/403) are never retried.
 */

// Groq model: GPT-OSS 20B on Groq hardware.
// Fastest available on this account (1000 tok/s), OpenAI-compatible format.
// Free tier: 30 RPM, 1K RPD, 8K TPM, 200K TPD.
// Text only — never pass video or image data.
const GROQ_MODEL = "openai/gpt-oss-20b";
const GROQ_API_BASE = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Make a typed error consistent with gemini.js.
 * @param {string} code
 * @param {string} message
 * @param {number} [status]
 * @returns {Error}
 */
function groqError(code, message, status) {
  const err = new Error(message);
  err.code = code;
  if (status !== undefined) err.status = status;
  return err;
}

/**
 * Call the Groq chat completions API with retry/backoff.
 *
 * @param {string} prompt
 * @param {string} apiKey
 * @param {number} [maxTokens=1024]
 * @returns {Promise<string>}
 */
async function generateContentGroq(prompt, apiKey, maxTokens) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    throw groqError("MISSING_KEY", "Groq API key is not set.");
  }

  const body = JSON.stringify({
    model: GROQ_MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.4,
    max_tokens: (typeof maxTokens === "number" && maxTokens > 0) ? maxTokens : 1024,
  });

  const headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + apiKey.trim(),
  };

  const DELAYS  = [1000, 2000, 4000];
  const JITTER  = 200;
  const REQUEST_TIMEOUT_MS = 25000;
  let lastErr   = null;

  for (let attempt = 0; attempt <= DELAYS.length; attempt++) {
    let response;
    try {
      response = await fetch(GROQ_API_BASE, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (networkErr) {
      const isTimeout = networkErr.name === "TimeoutError" || networkErr.name === "AbortError";
      const msg = isTimeout
        ? "Request to Groq timed out after " + (REQUEST_TIMEOUT_MS / 1000) + "s."
        : "Network request to Groq failed: " + (networkErr.message || "unknown");
      lastErr = groqError("NETWORK_ERROR", msg);
      if (attempt < DELAYS.length) {
        await new Promise((r) => setTimeout(r, DELAYS[attempt] + (Math.random() * 2 - 1) * JITTER));
        continue;
      }
      throw lastErr;
    }

    let json;
    try {
      json = await response.json();
    } catch (_e) {
      throw groqError("BAD_RESPONSE", "Groq returned a non-JSON response (HTTP " + response.status + ").", response.status);
    }

    if (!response.ok) {
      const detail = (json.error && json.error.message) || "HTTP " + response.status;
      const err    = groqError("API_ERROR", "Groq error: " + detail, response.status);

      // Auth errors — never retry.
      if (response.status === 401 || response.status === 403 || response.status === 400) throw err;

      lastErr = err;
      if (attempt < DELAYS.length) {
        // Honour Retry-After header if present.
        let delay = DELAYS[attempt] + (Math.random() * 2 - 1) * JITTER;
        const ra  = response.headers && response.headers.get("Retry-After");
        if (ra) { const s = parseFloat(ra); if (!isNaN(s) && s > 0) delay = s * 1000; }
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }

    // Success.
    try {
      const content = json.choices[0].message.content;
      if (typeof content !== "string") throw new Error("not a string");
      return content;
    } catch (_e) {
      throw groqError("BAD_RESPONSE", "Groq response had an unexpected shape.");
    }
  }

  throw lastErr || groqError("API_ERROR", "Groq request failed after retries.");
}
