/**
 * background/agent/schema.js
 *
 * Schema validation and JSON parsing for Agent & Find-it operations (Slice 3.2).
 * Strips markdown code fences, validates strict JSON shapes, and handles fallback.
 */

/**
 * Strip markdown code blocks / fences (```json ... ``` or ``` ... ```)
 * and return the cleaned string.
 *
 * @param {string} text
 * @returns {string}
 */
function stripMarkdownFences(text) {
  if (typeof text !== "string") return "";
  let cleaned = text.trim();

  // 1. Check if enclosed in ```json ... ``` or ``` ... ```
  const fenceRegex = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;
  const match = cleaned.match(fenceRegex);
  if (match) {
    return match[1].trim();
  }

  // 2. Look for code fences anywhere in the string
  const firstFence = cleaned.indexOf("```");
  if (firstFence !== -1) {
    const afterFirst = cleaned.slice(firstFence + 3);
    const newline = afterFirst.indexOf("\n");
    const jsonStart = newline !== -1 ? afterFirst.slice(newline + 1) : afterFirst;
    const endFence = jsonStart.lastIndexOf("```");
    if (endFence !== -1) {
      return jsonStart.slice(0, endFence).trim();
    }
  }

  // 3. Fallback: extract substring between first { and last }
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1).trim();
  }

  return cleaned;
}

/**
 * Parse and validate FindElementResult.
 *
 * Expected schema:
 *   {
 *     n: number | null,
 *     reason: string,
 *     confidence: "high" | "medium" | "low"
 *   }
 *
 * @param {string} rawResponse - raw text returned by the LLM
 * @param {number[]} [validElementNumbers] - optional list of known valid n numbers
 * @returns {{ ok: true, data: { n: number|null, reason: string, confidence: "high"|"medium"|"low" } } | { ok: false, error: string }}
 */
function validateFindElementResult(rawResponse, validElementNumbers) {
  if (!rawResponse || typeof rawResponse !== "string") {
    return { ok: false, error: "Empty or invalid response from AI model." };
  }

  const cleaned = stripMarkdownFences(rawResponse);
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    return { ok: false, error: `Invalid JSON returned by model: ${err.message}` };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "Model response is not a valid JSON object." };
  }

  // Parse n
  let n = parsed.n;
  if (n !== null && n !== undefined) {
    n = Number(n);
    if (isNaN(n) || n <= 0) {
      n = null;
    }
  } else {
    n = null;
  }

  // If known valid numbers provided, ensure n is in that set
  if (n !== null && Array.isArray(validElementNumbers) && validElementNumbers.length > 0) {
    if (!validElementNumbers.includes(n)) {
      return {
        ok: false,
        error: `Model selected element [${n}], which is not in the current page scan.`,
      };
    }
  }

  // Validate reason
  const reason = typeof parsed.reason === "string" && parsed.reason.trim()
    ? parsed.reason.trim()
    : (n !== null ? `Element [${n}] selected.` : "No matching element found.");

  // Validate confidence: "high" | "medium" | "low"
  let confidence = "medium";
  if (typeof parsed.confidence === "string") {
    const norm = parsed.confidence.toLowerCase().trim();
    if (norm === "high" || norm === "medium" || norm === "low") {
      confidence = norm;
    }
  }

  return {
    ok: true,
    data: {
      n,
      reason,
      confidence,
    },
  };
}

/**
 * Parse and validate an AgentAction proposal (Slice 3.3, Architecture §5.3).
 *
 * Supported actions: "click", "type", "select", "scroll", "done"
 *
 * @param {string} rawResponse
 * @param {Array<Object>} [actionMap] - list of ActionElement from current scan
 * @returns {{ ok: true, data: Object } | { ok: false, error: string }}
 */
function validateAgentAction(rawResponse, actionMap = []) {
  if (!rawResponse || typeof rawResponse !== "string") {
    return { ok: false, error: "Empty response from agent model." };
  }

  const cleaned = stripMarkdownFences(rawResponse);
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    return { ok: false, error: `Invalid JSON returned by agent model: ${err.message}` };
  }

  let target = parsed;
  if (Array.isArray(target) && target.length > 0) {
    target = target[0];
  }
  if (target && typeof target.proposal === "object" && target.proposal) {
    target = target.proposal;
  } else if (target && Array.isArray(target.actions) && target.actions.length > 0) {
    target = target.actions[0];
  }

  if (!target || typeof target !== "object") {
    return { ok: false, error: "Agent response is not a valid JSON object." };
  }

  let rawAction = typeof target.action === "string" ? target.action.toLowerCase().trim() : "";
  const ACTION_ALIASES = {
    fill: "type",
    input: "type",
    enter: "type",
    write: "type",
    press: "click",
    tap: "click",
    submit: "click",
    choose: "select",
    pick: "select",
    finish: "done",
    complete: "done",
    end: "done",
  };
  const action = ACTION_ALIASES[rawAction] || rawAction;

  const ALLOWED_ACTIONS = ["click", "type", "select", "scroll", "done"];
  if (!ALLOWED_ACTIONS.includes(action)) {
    return {
      ok: false,
      error: `Unsupported action "${rawAction}". Allowed actions: click, type, select, scroll, done.`,
    };
  }

  // Validate reason
  const reason = typeof target.reason === "string" && target.reason.trim()
    ? target.reason.trim().slice(0, 200)
    : "Proceeding with next step.";

  // Action: "done"
  if (action === "done") {
    return {
      ok: true,
      data: {
        action: "done",
        reason,
      },
    };
  }

  // Action: "scroll"
  if (action === "scroll") {
    const dir = typeof target.direction === "string" ? target.direction.toLowerCase().trim() : "down";
    const direction = dir === "up" ? "up" : "down";
    return {
      ok: true,
      data: {
        action: "scroll",
        direction,
        reason,
      },
    };
  }

  // Actions requiring target element n: "click", "type", "select"
  const rawN = target.n ?? target.element ?? target.target ?? target.element_id ?? target.elementNumber ?? target.id;
  let n = Number(rawN);
  if (isNaN(n) || n <= 0) {
    return { ok: false, error: `Action "${action}" requires a valid positive element number n.` };
  }

  const targetElement = actionMap.find((e) => e.n === n);
  if (!targetElement) {
    return {
      ok: false,
      error: `Element [${n}] is not present in the current scan map.`,
    };
  }

  const label = targetElement.text || targetElement.label || targetElement.name || targetElement.placeholder || targetElement.tag || "";
  const consequential = Boolean(targetElement.consequential);

  if (action === "click") {
    return {
      ok: true,
      data: {
        action: "click",
        n,
        reason,
        label,
        consequential,
        targetElement,
      },
    };
  }

  const rawVal = target.value ?? target.text ?? target.val ?? target.input ?? "";
  const val = typeof rawVal === "string" ? rawVal.slice(0, 500) : String(rawVal ?? "");

  if (action === "type") {
    if (targetElement.sensitive) {
      return {
        ok: false,
        error: `SAFETY_REFUSAL: Target element [${n}] is marked sensitive (password/card/OTP). Typing is blocked.`,
      };
    }
    return {
      ok: true,
      data: {
        action: "type",
        n,
        value: val,
        reason,
        label,
        consequential,
        targetElement,
      },
    };
  }

  if (action === "select") {
    return {
      ok: true,
      data: {
        action: "select",
        n,
        value: val,
        reason,
        label,
        consequential,
        targetElement,
      },
    };
  }

  return { ok: false, error: "Unrecognized action state." };
}

