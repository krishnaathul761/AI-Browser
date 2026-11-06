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
function buildSummaryPrompt(article, language, customInstruction) {
  const customNote = customInstruction && customInstruction.trim()
    ? "Special Skill Guideline: " + customInstruction.trim() + "\nAdopt this focus while adhering to the required JSON schema below.\n\n"
    : "";
  const fallbackNote = article.isFallback
    ? "Note: full article text could not be cleanly extracted; this may include navigation or footer text.\n\n"
    : "";

  return (
    "You are a helpful reading assistant. Read the article text below and return a JSON object.\n" +
    customNote +
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
 * @param {Array<{ memory: string }|string>} [memories] - optional Mem0 cross-session memories
 * @returns {string} assembled prompt
 */
function buildChatPrompt(pageContext, history, userMessage, language, memories) {
  const historyText = history.length > 0
    ? history.map((m) => (m.role === "user" ? "User: " : "Assistant: ") + m.text).join("\n") + "\n"
    : "";

  let memoryContext = "";
  if (Array.isArray(memories) && memories.length > 0) {
    const memList = memories
      .map((m) => "- " + (typeof m === "string" ? m : (m.memory || m.text || "")))
      .filter((s) => s.trim() !== "-")
      .join("\n");
    if (memList) {
      memoryContext = "User persona & remembered context from past sessions (Mem0):\n" + memList + "\n\n";
    }
  }

  return (
    "You are a helpful reading assistant and personal browser companion.\n\n" +
    (memoryContext ? memoryContext : "") +
    "Instructions:\n" +
    "- If the user asks about past topics, previous chat sessions, their preferences, or remembered context, answer directly from the remembered context above.\n" +
    "- For questions about the current page, answer using the page content provided below.\n" +
    "- Always apply the user's remembered preferences (e.g. tone, concise format, domain interests) to optimize your answers.\n" +
    "- If a question is about the page but the answer is not found in the page content, say clearly: \"I could not find that information on this page.\"\n" +
    "- Be concise, direct, and helpful. Do not repeat the question.\n\n" +
    "Page title: " + (pageContext.title || "Unknown") + "\n" +
    "Page URL: " + (pageContext.url || "") + "\n\n" +
    "Page content:\n" +
    '"""\n' +
    (pageContext.text || "").trim().slice(0, 10000) +
    '\n"""\n\n' +
    (historyText ? "Conversation so far in this tab:\n" + historyText + "\n" : "") +
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
function buildDraftPrompt(selectedText, language, profile) {
  let toneDesc = "polite and professional";
  if (profile && typeof profile.preferredTone === "string" && profile.preferredTone.trim()) {
    const tone = profile.preferredTone.trim().toLowerCase();
    if (tone === "casual") toneDesc = "casual and friendly";
    else if (tone === "formal") toneDesc = "formal and polite";
    else if (tone === "concise") toneDesc = "direct and concise";
    else if (tone === "enthusiastic") toneDesc = "warm and enthusiastic";
    else toneDesc = profile.preferredTone.trim();
  }

  let profileContext = "";
  if (profile) {
    const details = [];
    if (profile.name && profile.name.trim()) {
      details.push("Author name: " + profile.name.trim());
    }
    if (profile.college && profile.college.trim()) {
      details.push("College / Affiliation: " + profile.college.trim());
    }
    if (profile.skills && profile.skills.trim()) {
      details.push("Skills / Expertise: " + profile.skills.trim());
    }
    if (profile.links && profile.links.trim()) {
      details.push("Links / Portfolio: " + profile.links.trim());
    }
    if (details.length > 0) {
      profileContext =
        "Author Profile (use only if relevant to tone, personal context, or sign-off):\n" +
        details.join("\n");
      if (profile.name && profile.name.trim()) {
        profileContext += '\nIf signing off, sign off with "' + profile.name.trim() + '".';
      }
    }
  }
  return (
    "You are a helpful writing assistant. Draft a " + toneDesc + " reply " +
    "to the following text. The reply should be concise (2–4 sentences), " +
    "suitable for email, LinkedIn, or a forum post. " +
    "Do not include a subject line. Do not address it to a specific person. " +
    "Return only the draft reply text.\n\n" +
    (profileContext ? profileContext + "\n\n" : "") +
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
function buildAgentStepPrompt(goal, history, elements, language, profile) {
  // Cap to 50 elements to keep prompt concise, responsive, and avoid TPM rate-limit delays
  const subset = Array.isArray(elements) && elements.length > 50 ? elements.slice(0, 50) : (elements || []);

  const compactElements = subset
    .map((el) => {
      let desc = `[${el.n}] <${el.tag}${el.type ? `:${el.type}` : ""}> "${el.text || ""}"`;
      if (el.placeholder) desc += ` (placeholder: "${el.placeholder}")`;
      if (el.name) desc += ` (name: "${el.name}")`;
      if (el.id) desc += ` (id: "${el.id}")`;
      if (el.checked !== undefined) desc += ` (checked: ${el.checked})`;
      if (el.selected) desc += ` [ALREADY SELECTED]`;
      if (el.currentValue && el.tag !== "button" && el.tag !== "a") desc += ` (current value: "${el.currentValue}")`;
      if (Array.isArray(el.options) && el.options.length > 0) {
        const validOpts = el.options.filter((o) => o.value);
        const optSummary = validOpts.map((o) => `"${o.value}" ("${o.text}")`).join(", ");
        desc += ` [SELECT OPTIONS: ${optSummary}]`;
        if (el.value) {
          desc += ` (currently selected: "${el.value}" - "${el.selectedText || el.value}")`;
        }
      }
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

  // Inject profile memory only for form-filling or when goal mentions profile (Slice 4.1)
  let profileSection = "";
  const isFormFill =
    /profile/i.test(goal || "") ||
    /form|fill|apply|application|signup|sign-up|register|registration|internship/i.test(goal || "") ||
    (Array.isArray(elements) && elements.some((el) =>
      (el.tag === "input" && el.type !== "submit" && el.type !== "button") ||
      el.tag === "textarea" ||
      el.tag === "select"
    ) && /type|enter|input|complete/i.test(goal || ""));

  if (profile && isFormFill) {
    const pItems = [];
    if (profile.name) pItems.push("- Full Name: " + profile.name);
    if (profile.college) pItems.push("- College / University: " + profile.college);
    if (profile.skills) pItems.push("- Skills: " + profile.skills);
    if (profile.links) pItems.push("- Links / Portfolio: " + profile.links);
    if (profile.preferredTone) pItems.push("- Preferred Tone: " + profile.preferredTone);

    // Include all custom user profile memory details added by user
    if (Array.isArray(profile.customFields)) {
      for (const cf of profile.customFields) {
        if (cf && cf.label && cf.value) {
          pItems.push(`- ${cf.label}: ${cf.value}`);
        }
      }
    }

    if (pItems.length > 0) {
      profileSection =
        "\n\nUser Profile Memory (The ONLY personal details you are authorized to fill):\n" +
        pItems.join("\n") +
        "\n\nSTRICT Profile Memory Form-Filling Constraints:\n" +
        "- ONLY fill fields that match an item explicitly listed in User Profile Memory above.\n" +
        "- NEVER invent, hallucinate, guess, or make up values (such as dummy phone numbers, emails, degrees, years, CGPA, or project descriptions) for any field not present in the profile above.\n" +
        "- If a form input, select, or textarea has NO matching value in User Profile Memory:\n" +
        "  * DO NOT type fictional or placeholder data into it.\n" +
        "  * Skip it to fill any other fields that ARE present in User Profile Memory.\n" +
        "  * Once all profile-matched fields are filled, return action \"done\" with a clear reason asking the user to manually fill the remaining missing fields (e.g. 'Filled Name and College from Profile Memory. Please manually fill Phone Number and Degree as they are not in your memory.').\n" +
        "- Field Matching:\n" +
        "  * If form has First Name and Last Name and profile has Full Name (e.g. 'Priya Sharma'), enter 'Priya' in First Name and 'Sharma' in Last Name.\n" +
        "  * If profile memory contains custom fields (e.g. Phone, Degree, Current Year, CGPA, Branch), use them to fill the respective inputs/selects.\n" +
        "  * For skill chips, only click chips matching skills listed in User Profile Memory. Do NOT click chips marked [ALREADY SELECTED].\n" +
        "  * For CGPA / Percentage: enter plain numeric value (e.g. '8.5' or '85'), never append '/10' or '%'.";
    }
  }

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
    profileSection +
    "\n\n" +
    "Instructions:\n" +
    "1. Analyze the user's goal, the previous actions taken, and the current page elements.\n" +
    "2. Determine the SINGLE best next action to make progress toward the goal.\n" +
    "3. Supported actions:\n" +
    '   - click:  { "action": "click", "n": <element number>, "reason": "<1-sentence reason>" }\n' +
    '   - type:   { "action": "type", "n": <element number>, "value": "<text to type>", "reason": "<reason>" }\n' +
    '   - select: { "action": "select", "n": <element number>, "value": "<option value or label>", "reason": "<reason>" }\n' +
    '   - scroll: { "action": "scroll", "direction": "up" | "down", "reason": "<reason>" }\n' +
    '   - done:   { "action": "done", "reason": "<explanation of how goal is completed or what user needs to fill>" }\n' +
    "4. STRICT Memory-Based Form Filling:\n" +
    "   - When filling forms from Profile Memory, fill ONLY details that are explicitly present in User Profile Memory.\n" +
    "   - NEVER invent or guess fake details for fields missing from memory (e.g. Phone number, Degree, CGPA, or Experience).\n" +
    "   - When all memory-matched fields on the page are filled, return action \"done\" and tell the user to manually complete any remaining fields not in their memory.\n" +
    "5. Dropdowns & Selects:\n" +
    "   - For <select> elements, ALWAYS use action: \"select\".\n" +
    "   - You MUST pick an option value or text from the element's [SELECT OPTIONS] list. Never invent values outside the provided options.\n" +
    "   - If a select dropdown already has the desired option selected (see 'currently selected'), do NOT select it again; move to the next field.\n" +
    "6. Multi-Select Chips & Toggle Buttons (e.g. Technical Skills):\n" +
    "   - Elements marked [ALREADY SELECTED] are ALREADY chosen! NEVER click an element marked [ALREADY SELECTED] — clicking it will toggle and deselect it!\n" +
    "   - Pick 1 to 3 relevant chips by clicking unselected chips matching profile skills.\n" +
    "   - Once at least 1-2 chips are [ALREADY SELECTED], stop clicking chips and immediately proceed to the next input or click Next / Submit.\n" +
    "7. Progress Forward (Avoid Loops):\n" +
    "   - If an input or dropdown already has the desired value, do not repeat the action; proceed to the next uncompleted field or next step button.\n" +
    "8. Numeric & CGPA Fields:\n" +
    "   - For CGPA, GPA, or percentage fields, enter ONLY the plain number (e.g. \"8.8\" or \"90\"). NEVER include \"/ 10\", \"/10\", or \"%\" in the value.\n" +
    "9. Safety Rules:\n" +
    "   - NEVER propose typing into [SENSITIVE] elements (passwords, PINs, card numbers).\n" +
    '   - If all steps are complete or the goal is achieved, return action "done".\n' +
    "10. Return ONLY a single raw JSON object starting with { and ending with }. No markdown fences. No other text.\n\n" +
    languageSuffix(language)
  );
}


