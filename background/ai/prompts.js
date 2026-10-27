/**
 * Prompt templates and Gemini model IDs for Sahayak.
 *
 * Model IDs as of 12 Oct 2026 (Google AI Gemini API):
 *   Everyday text (default Flash-Lite):  gemini-3.5-flash-lite
 *   Vision / hard JSON (Flash):          gemini-3.8-flash
 *
 * Architecture still says “Flash-Lite / Flash”. Those roles map here:
 *   Flash-Lite  → cheap summaries, explain, chat, find-it JSON
 *   Flash       → screenshot Q&A, failed structured agent JSON, public YouTube if needed
 *
 * Google currently recommends 3.5 Flash-Lite / 3.8 Flash for NEW projects.
 * Legacy IDs (may be restricted for unused accounts): gemini-3.5-flash-lite, gemini-3.8-flash
 *
 * Endpoint (service worker only, never from the page):
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent
 *
 * API keys: chrome.storage.local via Options. Never commit keys. Never put keys in prompts.
 *
 * Templates are filled in Week 1+ slices. Do not send page text when safety.blocked.
 */

const GEMINI_FLASH_LITE = "gemini-3.5-flash-lite";
const GEMINI_FLASH      = "gemini-3.8-flash";

/** Appended to text prompts from settings.language (`en` | `hinglish`). */
function languageSuffix(language) {
  if (language === "hinglish") {
    return "Respond in Hinglish (Hindi in Latin script mixed with simple English).";
  }
  return "Respond in clear, simple English.";
}

/**
 * Explain a piece of selected text in plain language.
 *
 * @param {string} selectedText - the text the user highlighted
 * @param {string} language     - "en" | "hinglish"
 * @returns {string} assembled prompt
 */
function buildExplainPrompt(selectedText, language) {
  return (
    "You are a helpful reading assistant. " +
    "Explain the following passage in plain, easy-to-understand language. " +
    "Be concise — 3 to 5 sentences. Do not add opinions or extra context beyond what is in the text.\n\n" +
    '"""\n' +
    selectedText.trim() +
    '\n"""\n\n' +
    languageSuffix(language)
  );
}

/**
 * Structured article summary.
 *
 * The model MUST return exactly this JSON shape — no markdown fences,
 * no extra keys. The router validates it before rendering.
 *
 * @param {{ title: string, text: string, isFallback?: boolean }} article
 * @param {string} language - "en" | "hinglish"
 * @returns {string} assembled prompt
 */
function buildSummaryPrompt(article, language) {
  const fallbackNote = article.isFallback
    ? "Note: full article text could not be cleanly extracted; this may include navigation or footer text.\n\n"
    : "";

  return (
    "You are a helpful reading assistant. Read the article text below and return a JSON object.\n" +
    "Return ONLY valid JSON — no markdown fences, no extra keys, no explanation, no preamble.\n" +
    "Your entire response must be a single JSON object starting with { and ending with }.\n\n" +
    "Required JSON shape:\n" +
    '{ "tldr": "<one sentence>", "keyPoints": ["<point 1>", ..., "<point 5>"], "nextSteps": "<1-2 sentences on what to do next>" }\n\n' +
    "Rules:\n" +
    "- tldr: exactly one sentence, max 25 words.\n" +
    "- keyPoints: exactly 5 items, each max 20 words.\n" +
    "- nextSteps: 1-2 sentences on what the reader could do, read, or explore next.\n" +
    "- Answer only from the provided text. Do not invent facts.\n\n" +
    fallbackNote +
    "Article title: " + (article.title || "Unknown") + "\n\n" +
    "Article text:\n" +
    '"""\n' +
    article.text.trim() +
    '\n"""\n\n' +
    languageSuffix(language)
  );
}

/**
 * YouTube video summary using Gemini's native YouTube URL understanding.
 *
 * The YouTube URL is prepended to this prompt as plain text inside
 * gemini.js — NOT sent as a fileData part. Gemini understands public
 * YouTube URLs natively when they appear in the prompt text.
 * Do not include the URL here.
 *
 * The model MUST return JSON — no fences, no extra keys.
 * Timestamps are optional: include them when the video has clear chapters.
 *
 * Required JSON shape:
 * {
 *   "tldr": "<one sentence>",
 *   "keyPoints": ["<point 1>", ...],
 *   "timestamps": [{ "label": "<chapter title>", "seconds": <integer> }, ...],
 *   "nextSteps": "<1-2 sentences>"
 * }
 *
 * `timestamps` may be an empty array when the video has no clear chapters.
 *
 * @param {string} language - "en" | "hinglish"
 * @returns {string} instruction prompt (URL is added by gemini.js, not here)
 */
/**
 * Build a YouTube prompt that includes the video URL directly in the text.
 * The URL is also sent as a file_data part in gemini.js, but including it
 * in the text prompt ensures the model always has an explicit reference.
 *
 * @param {string} videoUrl - canonical youtube.com/watch?v=ID URL
 * @param {string} language - "en" | "hinglish"
 * @returns {string} assembled prompt
 */
function buildYouTubePrompt(videoUrl, language) {
  return (
    "Watch this YouTube video: " + videoUrl + "\n\n" +
    "Return a JSON object summarising the video content.\n" +
    "Return ONLY valid JSON — no markdown fences, no extra keys, no explanation.\n\n" +
    "Required JSON shape:\n" +
    '{ "tldr": "<one sentence>", "keyPoints": ["<point 1>", ...], ' +
    '"timestamps": [{ "label": "<chapter title>", "seconds": <integer> }, ...], ' +
    '"nextSteps": "<1-2 sentences>" }\n\n' +
    "Rules:\n" +
    "- tldr: exactly one sentence, max 30 words.\n" +
    "- keyPoints: 3 to 7 items covering the main topics, each max 25 words.\n" +
    "- timestamps: chapter-style entries with the time in whole seconds. " +
    "Include them only when the video has clear sections or chapters. " +
    "Use an empty array [] if the video has no chapters.\n" +
    "- nextSteps: 1-2 sentences on what the viewer could explore next.\n\n" +
    languageSuffix(language)
  );
}

/**
 * Translate a summary result's text fields into the target language.
 *
 * Used by the language toggle so we never re-call Gemini Flash just to
 * change the language — we send the already-fetched text to Groq/Flash-Lite
 * for a cheap translation instead.
 *
 * The model MUST return the same JSON shape it receives.
 * For articles: { tldr, keyPoints, nextSteps }
 * For YouTube:  { tldr, keyPoints, nextSteps, timestamps? (labels only) }
 *
 * @param {object} fields  - the text fields to translate
 * @param {string} language - "en" | "hinglish"
 * @returns {string} assembled prompt
 */
function buildTranslatePrompt(fields, language) {
  return (
    "You are a translation assistant. Translate the JSON content below into the target language.\n" +
    "Return ONLY valid JSON with exactly the same keys and structure — no extra keys, no markdown fences.\n" +
    "Translate only the text values. Do not translate JSON keys.\n" +
    "For arrays, translate each item in place.\n\n" +
    "Target language: " + languageSuffix(language) + "\n\n" +
    "JSON to translate:\n" +
    JSON.stringify(fields) + "\n"
  );
}

/**
 * Grounded page chat — answers questions using only the page context.
 *
 * @param {{ title: string, url: string, text: string }} pageContext
 * @param {{ role: "user"|"assistant", text: string }[]} history - prior turns
 * @param {string} userMessage - the new user question
 * @param {string} language    - "en" | "hinglish"
 * @returns {string} assembled prompt
 */
function buildChatPrompt(pageContext, history, userMessage, language) {
  const historyText = history.length > 0
    ? history.map((m) => (m.role === "user" ? "User: " : "Assistant: ") + m.text).join("\n") + "\n"
    : "";

  return (
    "You are a helpful reading assistant. Answer the user's question using ONLY " +
    "the page content provided below. Do not use outside knowledge.\n" +
    "If the answer is not in the page content, say clearly: " +
    '"I could not find that information on this page."\n' +
    "Be concise and direct. Do not repeat the question.\n\n" +
    "Page title: " + (pageContext.title || "Unknown") + "\n" +
    "Page URL: " + (pageContext.url || "") + "\n\n" +
    "Page content:\n" +
    '"""\n' +
    (pageContext.text || "").trim().slice(0, 10000) +
    '\n"""\n\n' +
    (historyText ? "Conversation so far:\n" + historyText + "\n" : "") +
    "User: " + userMessage.trim() + "\n\n" +
    languageSuffix(language)
  );
}

/**
 * Translate selected text to a target language.
 *
 * @param {string} selectedText  - the text to translate
 * @param {string} targetLang    - target language name e.g. "Hindi", "French"
 * @param {string} language      - UI language "en" | "hinglish"
 * @returns {string} assembled prompt
 */
function buildTranslateSelectionPrompt(selectedText, targetLang, language) {
  return (
    "Translate the following text into " + targetLang + ".\n" +
    "Return only the translated text — no explanation, no notes, no original text.\n\n" +
    '"""\n' +
    selectedText.trim() +
    '\n"""\n\n' +
    languageSuffix(language)
  );
}

/**
 * Draft a reply to selected text.
 * Produces a polite, professional reply appropriate for email, LinkedIn,
 * or a forum — the user can copy and adapt it.
 *
 * @param {string} selectedText - the text being replied to
 * @param {string} language     - "en" | "hinglish"
 * @returns {string} assembled prompt
 */
function buildDraftPrompt(selectedText, language) {
  return (
    "You are a helpful writing assistant. Draft a polite and professional reply " +
    "to the following text. The reply should be concise (2–4 sentences), " +
    "suitable for email, LinkedIn, or a forum post. " +
    "Do not include a subject line. Do not address it to a specific person. " +
    "Return only the draft reply text.\n\n" +
    "Text to reply to:\n" +
    '"""\n' +
    selectedText.trim() +
    '\n"""\n\n' +
    languageSuffix(language)
  );
}

/**
 * Vision prompt — answer a question about a screenshot.
 *
 * @param {string} question  - the user's question about the visible content
 * @param {string} language  - "en" | "hinglish"
 * @returns {string} assembled prompt
 */
function buildVisionPrompt(question, language) {
  return (
    "You are a helpful visual assistant. Look at the screenshot carefully and " +
    "answer the following question based only on what is visible in the image.\n" +
    "Be concise and direct. If the answer is not visible in the screenshot, say so.\n\n" +
    "Question: " + question + "\n\n" +
    languageSuffix(language)
  );
}

/**
 * Prompt to find a specific interactive element on the page based on user intent (Slice 3.2).
 *
 * @param {string} query - natural language question or target, e.g. "where is the email field?"
 * @param {Array<Object>} elements - compact list of ActionElement
 * @param {string} language - "en" | "hinglish"
 * @returns {string} assembled prompt
 */
function buildFindElementPrompt(query, elements, language) {
  const compactList = elements
    .map((el) => {
      let desc = `[${el.n}] <${el.tag}${el.type ? `:${el.type}` : ""}> "${el.text || ""}"`;
      if (el.placeholder) desc += ` (placeholder: "${el.placeholder}")`;
      if (el.name) desc += ` (name: "${el.name}")`;
      if (el.id) desc += ` (id: "${el.id}")`;
      return desc;
    })
    .join("\n");

  return (
    "You are an AI browser assistant. A user is looking for an interactive element on the current webpage.\n" +
    "Below is the list of interactive elements found on the page in [number] format, followed by their tag, text label, and attributes.\n\n" +
    "Interactive elements:\n" +
    compactList +
    "\n\n" +
    'User query: "' +
    query.trim() +
    '"\n\n' +
    "Analyze which numbered element best matches what the user is looking for.\n" +
    "Return ONLY a valid JSON object matching this schema — no markdown fences, no explanation outside JSON:\n" +
    "{\n" +
    '  "n": <number of the best matching element, or null if no element matches>,\n' +
    '  "reason": "<short 1-sentence explanation of why this element was selected>",\n' +
    '  "confidence": "<\\"high\\" | \\"medium\\" | \\"low\\">"\n' +
    "}\n\n" +
    "Rules:\n" +
    "- If multiple elements match, pick the most relevant one and explain in reason.\n" +
    "- If unsure or the match is weak, set confidence to 'low'.\n" +
    "- If no element matches the query at all, set n to null and confidence to 'low'.\n" +
    "- DO NOT return any text other than the JSON object.\n\n" +
    languageSuffix(language)
  );
}

/**
 * Agent step prompt — propose a single next action towards achieving the user's goal (Slice 3.3).
 *
 * @param {string} goal - overall user instruction e.g. "Fill internship form with Priya Sharma"
 * @param {Array<Object>} history - list of previous actions taken
 * @param {Array<Object>} elements - list of ActionElement from current page scan
 * @param {string} language - "en" | "hinglish"
 * @returns {string} assembled prompt
 */
function buildAgentStepPrompt(goal, history, elements, language) {
  // Cap to 50 elements to keep prompt concise, responsive, and avoid TPM rate-limit delays
  const subset = Array.isArray(elements) && elements.length > 50 ? elements.slice(0, 50) : (elements || []);

  const compactElements = subset
    .map((el) => {
      let desc = `[${el.n}] <${el.tag}${el.type ? `:${el.type}` : ""}> "${el.text || ""}"`;
      if (el.placeholder) desc += ` (placeholder: "${el.placeholder}")`;
      if (el.name) desc += ` (name: "${el.name}")`;
      if (el.id) desc += ` (id: "${el.id}")`;
      if (el.checked !== undefined) desc += ` (checked: ${el.checked})`;
      if (el.consequential) desc += " [CONSEQUENTIAL]";
      if (el.sensitive) desc += " [SENSITIVE]";
      return desc;
    })
    .join("\n");

  const historyLines =
    Array.isArray(history) && history.length > 0
      ? history
          .map((h, idx) => {
            const act = h.proposal || h;
            let line = `Step ${idx + 1}: ${act.action}`;
            if (act.n) line += ` on [${act.n}]`;
            if (act.value) line += ` value="${act.value}"`;
            if (act.direction) line += ` direction="${act.direction}"`;
            if (h.decision) line += ` (${h.decision})`;
            return line;
          })
          .join("\n")
      : "No previous actions yet (Step 1).";

  return (
    "You are Sahayak, an autonomous browser agent. You help users achieve goals by proposing ONE action at a time.\n" +
    "Every step you propose requires human approval before execution.\n\n" +
    'User Goal: "' +
    goal.trim() +
    '"\n\n' +
    "Previous actions taken:\n" +
    historyLines +
    "\n\n" +
    "Current page interactive elements:\n" +
    compactElements +
    "\n\n" +
    "Instructions:\n" +
    "1. Analyze the user's goal, the previous actions taken, and the current page elements.\n" +
    "2. Determine the SINGLE best next action to make progress toward the goal.\n" +
    "3. Supported actions:\n" +
    '   - click:  { "action": "click", "n": <element number>, "reason": "<1-sentence reason>" }\n' +
    '   - type:   { "action": "type", "n": <element number>, "value": "<text to type>", "reason": "<reason>" }\n' +
    '   - select: { "action": "select", "n": <element number>, "value": "<option value or label>", "reason": "<reason>" }\n' +
    '   - scroll: { "action": "scroll", "direction": "up" | "down", "reason": "<reason>" }\n' +
    '   - done:   { "action": "done", "reason": "<explanation of how goal is completed>" }\n' +
    "4. Safety Rules:\n" +
    "   - NEVER propose typing into [SENSITIVE] elements (passwords, PINs, card numbers).\n" +
    '   - If all steps are complete or the goal is achieved, return action "done".\n' +
    "5. Return ONLY a single raw JSON object starting with { and ending with }. No markdown fences. No other text.\n\n" +
    languageSuffix(language)
  );
}


