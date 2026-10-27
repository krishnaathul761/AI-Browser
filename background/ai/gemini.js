/**
 * background/ai/gemini.js
 *
 * Non-streaming Gemini generateContent wrapper with retry/backoff.
 * Runs exclusively in the service worker — never imported from a page.
 *
 * Exported symbols (used by ai.js via importScripts order):
 *   generateContent(model, prompt, apiKey, maxTokens)
 *   generateContentWithVideo(model, videoUrl, prompt, apiKey, maxTokens)
 *   generateContentWithImage(model, prompt, base64, mimeType, apiKey, maxTokens)
 *
 * Retry policy (per call):
 *   - 429 / 500 / 503 / 529 / NETWORK_ERROR → retryable
 *   - Backoff: 1s, 2s, 4s + jitter (±200ms), max 3 retries
 *   - Honours Retry-After header when present
 *   - 400 / 401 / 403 → not retried (auth / bad request)
 *
 * Throws a typed Error on failure:
 *   code "MISSING_KEY" | "API_ERROR" (.status) | "BAD_RESPONSE" | "NETWORK_ERROR"
 */

const GEMINI_API_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models/";

/**
 * Make a typed error so callers can branch on `err.code`.
 *
 * @param {string} code
 * @param {string} message
 * @param {number} [status]
 * @returns {Error}
 */
function apiError(code, message, status) {
  const err = new Error(message);
  err.code = code;
  if (status !== undefined) {
    err.status = status;
  }
  return err;
}

// ── Retry helper ──────────────────────────────────────────────────────────────

const RETRY_DELAYS_MS = [1000, 2000, 4000]; // base delays before each retry
const JITTER_MS       = 200;                // ± random jitter added to each delay
const REQUEST_TIMEOUT_MS = 25000;          // 25s timeout per request attempt

/**
 * True when an HTTP status code is worth retrying.
 * Auth errors (400/401/403) are never retried.
 * @param {number} status
 * @returns {boolean}
 */
function isRetryableStatus(status) {
  return status === 429 || status === 500 || status === 503 || status === 529;
}

/**
 * Return how long to wait (ms) before retry attempt `i` (0-indexed).
 * Honours a Retry-After header value when present.
 *
 * @param {number} i           - retry index (0 = first retry)
 * @param {Response} [response] - the failed response (may have Retry-After)
 * @returns {number} milliseconds to wait
 */
function retryDelay(i, response) {
  // Honour Retry-After if the server sent it (value is seconds).
  if (response) {
    const ra = response.headers && response.headers.get("Retry-After");
    if (ra) {
      const seconds = parseFloat(ra);
      if (!isNaN(seconds) && seconds > 0) return seconds * 1000;
    }
  }
  const base  = RETRY_DELAYS_MS[Math.min(i, RETRY_DELAYS_MS.length - 1)];
  const jitter = (Math.random() * 2 - 1) * JITTER_MS; // ±200ms
  return Math.round(base + jitter);
}

/**
 * Execute a fetch-based API call with up to 3 retries on retryable errors.
 *
 * @param {() => Promise<Response>} fetchFn  - function that performs the fetch
 * @param {(json: object) => string} parseFn - extracts the text from a 200 response
 * @returns {Promise<string>}
 */
async function withRetry(fetchFn, parseFn) {
  let lastErr = null;
  let lastResponse = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const response = await fetchFn();
      lastResponse = response;

      let json;
      try {
        json = await response.json();
      } catch (_e) {
        throw apiError("BAD_RESPONSE", "Gemini returned a non-JSON response (HTTP " + response.status + ").", response.status);
      }

      if (!response.ok) {
        const detail = (json.error && json.error.message) || "HTTP " + response.status;
        const err    = apiError("API_ERROR", "Gemini error: " + detail, response.status);

        // Non-retryable (auth / bad request) — throw immediately.
        if (!isRetryableStatus(response.status)) throw err;

        lastErr = err;
        if (attempt < RETRY_DELAYS_MS.length) {
          await new Promise((r) => setTimeout(r, retryDelay(attempt, response)));
          continue;
        }
        throw err;
      }

      // Success — parse and return.
      try {
        return parseFn(json);
      } catch (_e) {
        throw apiError("BAD_RESPONSE", "Gemini response had an unexpected shape.");
      }

    } catch (err) {
      // Network error / timeout — retryable.
      if (err.code !== "API_ERROR" && err.code !== "BAD_RESPONSE" && err.code !== "MISSING_KEY") {
        const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
        const msg = isTimeout
          ? "Request to Gemini timed out after " + (REQUEST_TIMEOUT_MS / 1000) + "s."
          : "Network request to Gemini failed: " + (err.message || "unknown");
        lastErr = apiError("NETWORK_ERROR", msg);
        if (attempt < RETRY_DELAYS_MS.length) {
          await new Promise((r) => setTimeout(r, retryDelay(attempt, null)));
          continue;
        }
        throw lastErr;
      }
      throw err;
    }
  }

  throw lastErr || apiError("API_ERROR", "Gemini request failed after retries.");
}

// ── Standard text generateContent ─────────────────────────────────────────────

/**
 * Call Gemini generateContent (non-streaming) with retry/backoff.
 *
 * @param {string} model
 * @param {string} prompt
 * @param {string} apiKey
 * @param {number} [maxTokens=1024]
 * @returns {Promise<string>}
 */
async function generateContent(model, prompt, apiKey, maxTokens) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    throw apiError("MISSING_KEY", "Gemini API key is not set.");
  }

  const url =
    GEMINI_API_BASE +
    encodeURIComponent(model) +
    ":generateContent?key=" +
    encodeURIComponent(apiKey.trim());

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: (typeof maxTokens === "number" && maxTokens > 0) ? maxTokens : 1024,
    },
  };

  const bodyStr = JSON.stringify(body);

  return withRetry(
    () => fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyStr,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }),
    (json) => {
      const text = json.candidates[0].content.parts[0].text;
      if (typeof text !== "string" || !text) throw new Error("no text");
      return text;
    }
  );
}

/**
 * Call Gemini generateContent for a YouTube video.
 *
 * Per Google AI docs, YouTube URLs are passed via the standard generateContent
 * endpoint using fileData (camelCase) with mimeType "video/*" and fileUri.
 * Using snake_case file_data or omitting mimeType causes the API to silently
 * ignore the video part and respond as if no URL was provided.
 *
 * REST shape:
 *   POST /v1beta/models/{model}:generateContent
 *   contents: [{ role: "user", parts: [
 *     { fileData: { mimeType: "video/*", fileUri: URL } },
 *     { text: prompt }
 *   ]}]
 *
 * @param {string} model      - e.g. GEMINI_FLASH from prompts.js
 * @param {string} videoUrl   - canonical youtube.com/watch?v=ID URL
 * @param {string} prompt     - text instruction
 * @param {string} apiKey     - from chrome.storage.local (via router)
 * @param {number} [maxTokens=1024] - output token cap
 * @returns {Promise<string>} - the model's text reply
 */
async function generateContentWithVideo(model, videoUrl, prompt, apiKey, maxTokens) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    throw apiError("MISSING_KEY", "Gemini API key is not set.");
  }

  const url =
    GEMINI_API_BASE +
    encodeURIComponent(model) +
    ":generateContent?key=" +
    encodeURIComponent(apiKey.trim());

  const body = {
    contents: [{
      role: "user",
      parts: [
        { fileData: { mimeType: "video/*", fileUri: videoUrl } },
        { text: prompt },
      ],
    }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: (typeof maxTokens === "number" && maxTokens > 0) ? maxTokens : 1024,
    },
  };

  const bodyStr = JSON.stringify(body);

  return withRetry(
    () => fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyStr,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }),
    (json) => {
      const text = json.candidates[0].content.parts[0].text;
      if (typeof text !== "string" || !text) throw new Error("no text");
      return text;
    }
  );
}

/**
 * Call Gemini generateContent with an inline base64 image (vision).
 *
 * Uses the standard generateContent endpoint with inlineData.
 * Never sends image data to Groq — Gemini only.
 *
 * @param {string} model      - GEMINI_FLASH
 * @param {string} prompt     - text instruction
 * @param {string} base64     - raw base64 image data (no data URL prefix)
 * @param {string} mimeType   - e.g. "image/png"
 * @param {string} apiKey     - from chrome.storage.local
 * @param {number} [maxTokens=1024]
 * @returns {Promise<string>}
 */
async function generateContentWithImage(model, prompt, base64, mimeType, apiKey, maxTokens) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    throw apiError("MISSING_KEY", "Gemini API key is not set.");
  }

  const url =
    GEMINI_API_BASE +
    encodeURIComponent(model) +
    ":generateContent?key=" +
    encodeURIComponent(apiKey.trim());

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: base64 } },
      ],
    }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: (typeof maxTokens === "number" && maxTokens > 0) ? maxTokens : 1024,
    },
  };

  const bodyStr = JSON.stringify(body);

  return withRetry(
    () => fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyStr,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }),
    (json) => {
      const text = json.candidates[0].content.parts[0].text;
      if (typeof text !== "string" || !text) throw new Error("no text");
      return text;
    }
  );
}
