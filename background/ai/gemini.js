/**
 * background/ai/gemini.js
 *
 * Non-streaming Gemini generateContent wrapper.
 * Runs exclusively in the service worker — never imported from a page.
 *
 * Exported symbol (used by router.js via importScripts order):
 *   generateContent(model, prompt, apiKey) → Promise<string>
 *
 * Throws a typed Error on:
 *   - Missing API key          → code "MISSING_KEY"
 *   - HTTP 4xx/5xx             → code "API_ERROR", includes HTTP status
 *   - Malformed response JSON  → code "BAD_RESPONSE"
 *   - Network failure          → code "NETWORK_ERROR"
 *
 * Callers should map these codes to user-visible messages.
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

/**
 * Call Gemini generateContent (non-streaming).
 *
 * @param {string} model      - e.g. GEMINI_FLASH_LITE from prompts.js
 * @param {string} prompt     - full assembled prompt string
 * @param {string} apiKey     - from chrome.storage.local (via router)
 * @param {number} [maxTokens=1024] - output token cap for this call
 * @returns {Promise<string>} - the model's text reply
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

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    throw apiError(
      "NETWORK_ERROR",
      "Network request to Gemini failed: " + (networkErr.message || "unknown error")
    );
  }

  // Parse body regardless of status — error details live inside it.
  let json;
  try {
    json = await response.json();
  } catch (_parseErr) {
    throw apiError(
      "BAD_RESPONSE",
      "Gemini returned a non-JSON response (HTTP " + response.status + ").",
      response.status
    );
  }

  if (!response.ok) {
    // Gemini error shape: { error: { code, message, status } }
    const detail =
      (json.error && json.error.message) ||
      "HTTP " + response.status;
    throw apiError(
      "API_ERROR",
      "Gemini error: " + detail,
      response.status
    );
  }

  // Success shape: { candidates: [{ content: { parts: [{ text }] } }] }
  try {
    const text =
      json.candidates[0].content.parts[0].text;
    if (typeof text !== "string") {
      throw new Error("text field is not a string");
    }
    return text;
  } catch (_shapeErr) {
    throw apiError(
      "BAD_RESPONSE",
      "Gemini response had an unexpected shape."
    );
  }
}

/**
 * Call Gemini generateContent with a YouTube video URL as a fileData part.
 *
 * @param {string} model      - e.g. GEMINI_FLASH from prompts.js
 * @param {string} videoUrl   - canonical youtube.com/watch?v=ID URL
 * @param {string} prompt     - text instruction (what to do with the video)
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
    contents: [
      {
        parts: [
          { fileData: { fileUri: videoUrl, mimeType: "video/mp4" } },
          { text: prompt },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: (typeof maxTokens === "number" && maxTokens > 0) ? maxTokens : 1024,
    },
  };

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    throw apiError(
      "NETWORK_ERROR",
      "Network request to Gemini failed: " + (networkErr.message || "unknown error")
    );
  }

  let json;
  try {
    json = await response.json();
  } catch (_parseErr) {
    throw apiError(
      "BAD_RESPONSE",
      "Gemini returned a non-JSON response (HTTP " + response.status + ").",
      response.status
    );
  }

  if (!response.ok) {
    const detail =
      (json.error && json.error.message) ||
      "HTTP " + response.status;
    throw apiError("API_ERROR", "Gemini error: " + detail, response.status);
  }

  try {
    const text = json.candidates[0].content.parts[0].text;
    if (typeof text !== "string") throw new Error("text field is not a string");
    return text;
  } catch (_shapeErr) {
    throw apiError("BAD_RESPONSE", "Gemini response had an unexpected shape.");
  }
}
