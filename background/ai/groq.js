/**
 * background/ai/groq.js
 *
 * Text-only Groq API client.
 * Runs exclusively in the service worker — never from a page.
 *
 * IMPORTANT: Groq is text-only. Never pass image data or YouTube URLs here.
 *
 * Exported symbol (available globally after importScripts):
 *   generateContentGroq(prompt, apiKey) → Promise<string>
 *
 * Uses the Groq chat completions endpoint with the fastest free model.
 * Throws typed errors with the same `.code` shape as gemini.js so callers
 * can handle both providers uniformly.
 *
 * Error codes:
 *   MISSING_KEY   — no Groq key provided
 *   API_ERROR     — HTTP 4xx/5xx from Groq (includes .status)
 *   BAD_RESPONSE  — unexpected response shape
 *   NETWORK_ERROR — fetch threw
 */

// Groq free-tier model: Llama 4 Scout — fast (460 tok/s on Groq hardware),
// Mixture of Experts architecture, strong at summarisation and reasoning.
// Free tier: 30 RPM, ~1,000 RPD. Text only — never pass video or image data.
const GROQ_MODEL = "llama-4-scout-17b-16e-instruct";
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
 * Call the Groq chat completions API with a single user message.
 *
 * @param {string} prompt  - full assembled prompt string
 * @param {string} apiKey  - Groq API key from chrome.storage.local
 * @returns {Promise<string>} - the model's text reply
 */
async function generateContentGroq(prompt, apiKey) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    throw groqError("MISSING_KEY", "Groq API key is not set.");
  }

  const body = {
    model: GROQ_MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.4,
    max_tokens: 2048,
  };

  let response;
  try {
    response = await fetch(GROQ_API_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey.trim(),
      },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    throw groqError(
      "NETWORK_ERROR",
      "Network request to Groq failed: " + (networkErr.message || "unknown error")
    );
  }

  let json;
  try {
    json = await response.json();
  } catch (_parseErr) {
    throw groqError(
      "BAD_RESPONSE",
      "Groq returned a non-JSON response (HTTP " + response.status + ").",
      response.status
    );
  }

  if (!response.ok) {
    // Groq error shape: { error: { message, type, code } }
    const detail =
      (json.error && json.error.message) ||
      "HTTP " + response.status;
    throw groqError("API_ERROR", "Groq error: " + detail, response.status);
  }

  // OpenAI-compatible response shape:
  // { choices: [{ message: { content: string } }] }
  try {
    const content = json.choices[0].message.content;
    if (typeof content !== "string") throw new Error("content is not a string");
    return content;
  } catch (_shapeErr) {
    throw groqError("BAD_RESPONSE", "Groq response had an unexpected shape.");
  }
}
