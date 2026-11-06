/**
 * content/execute.js
 *
 * DOM action execution for the approval-based agent loop (Slice 3.3, Architecture §7.7).
 *
 * Supported actions: click, type, select, scroll, done.
 * Safety rule: NEVER execute 'type' on sensitive fields (password, otp, cvv, etc.).
 */

(function () {
  const SENSITIVE_REGEX =
    /(password|passwd|passcode|pin|otp|totp|2fa|cvv|cvc|card[-_]?num|credit[-_]?card|debit[-_]?card|secret|ssn|aadhaar|pan[-_]?card)/i;

  /**
   * Check if an element is prohibited from automated typing.
   */
  function isFieldSensitive(el) {
    if (!el) return true;
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "password") return true;

    const autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (/(one-time-code|cc-number|cc-csc|cc-exp|current-password|new-password|transaction-amount)/i.test(autocomplete)) {
      return true;
    }

    const name = el.getAttribute("name") || "";
    const id = el.id || "";
    const placeholder = el.getAttribute("placeholder") || "";
    const ariaLabel = el.getAttribute("aria-label") || "";

    return SENSITIVE_REGEX.test(`${name} ${id} ${placeholder} ${ariaLabel}`);
  }

  /**
   * Execute an approved action in the current webpage.
   *
   * @param {Object} proposal
   * @param {"click"|"type"|"select"|"scroll"|"done"} proposal.action
   * @param {number} [proposal.n]
   * @param {string} [proposal.value]
   * @param {"up"|"down"} [proposal.direction]
   * @returns {Promise<{ ok: boolean, error?: string, data?: Object }>}
   */
  async function executeAction(proposal) {
    if (!proposal || !proposal.action) {
      return { ok: false, error: "Invalid action proposal" };
    }

    const { action, n, value, direction } = proposal;

    if (action === "done") {
      return { ok: true, data: { action: "done" } };
    }

    if (action === "scroll") {
      const delta = direction === "up" ? -450 : 450;
      window.scrollBy({ top: delta, behavior: "smooth" });
      await new Promise((r) => setTimeout(r, 400));
      return { ok: true, data: { action: "scroll", direction } };
    }

    // For click, type, select: resolve element from active elements map
    const entry = window.__sahayakElementsMap ? window.__sahayakElementsMap.get(Number(n)) : null;
    const el = entry && entry.element;

    if (!el || !document.contains(el)) {
      return {
        ok: false,
        error: `STALE_ELEMENT: Element [${n}] is no longer in the document. A fresh page scan is required.`,
      };
    }

    // Scroll element into view smoothly before acting
    try {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      await new Promise((r) => setTimeout(r, 200));
    } catch (_e) {}

    // Pulse badge to give visual feedback during execution
    if (typeof window.pulseBadge === "function" && n) {
      window.pulseBadge(n);
    }

    if (action === "click") {
      // Focus element
      try { el.focus(); } catch (_e) {}

      // If it's a checkbox or radio, toggling
      if (el.tagName.toLowerCase() === "input" && (el.type === "checkbox" || el.type === "radio")) {
        el.click();
      } else {
        // Dispatch sequence for framework event handlers
        el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
        el.click();
      }

      await new Promise((r) => setTimeout(r, 300));
      return { ok: true, data: { action: "click", n } };
    }

    /**
     * Helper to find the best matching <option> in a <select> element.
     */
    function findBestSelectOption(selectEl, searchVal) {
      if (!selectEl || !selectEl.options || selectEl.options.length === 0) return null;

      const raw = String(searchVal != null ? searchVal : "").trim();
      if (!raw) return null;

      const lower = raw.toLowerCase();
      const alphaNum = lower.replace(/[^a-z0-9]/g, "");
      const options = Array.from(selectEl.options);

      // 1. Exact match on value or text (case-insensitive)
      for (const opt of options) {
        const val = (opt.value || "").trim().toLowerCase();
        const txt = (opt.text || "").trim().toLowerCase();
        if (val === lower || txt === lower) {
          return opt;
        }
      }

      // 2. Alphanumeric normalized match (e.g. "btech" vs "B.Tech / B.E." or "b.tech")
      if (alphaNum.length > 0) {
        for (const opt of options) {
          const optValNorm = (opt.value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
          const optTxtNorm = (opt.text || "").toLowerCase().replace(/[^a-z0-9]/g, "");
          if (optValNorm && (optValNorm === alphaNum || optValNorm.includes(alphaNum) || alphaNum.includes(optValNorm))) {
            return opt;
          }
          if (optTxtNorm && (optTxtNorm === alphaNum || optTxtNorm.includes(alphaNum) || alphaNum.includes(optTxtNorm))) {
            return opt;
          }
        }
      }

      // 3. Substring match on text or value
      for (const opt of options) {
        const val = (opt.value || "").toLowerCase();
        const txt = (opt.text || "").toLowerCase();
        if (opt.value && (txt.includes(lower) || val.includes(lower) || lower.includes(val))) {
          return opt;
        }
      }

      // 4. Number / ordinal match (for year e.g. "3rd year" -> "3", "2nd" -> "2")
      const digitMatch = raw.match(/\b([1-9])(?:st|nd|rd|th)?\b/i) || raw.match(/(\d+)/);
      if (digitMatch) {
        const num = digitMatch[1];
        for (const opt of options) {
          if (opt.value === num) return opt;
          if (opt.text && (opt.text.startsWith(num) || opt.text.includes(num))) return opt;
        }
      }

      // 5. Semantic / keyword heuristics for common academic forms
      const wordMap = [
        { keys: ["btech", "b.tech", "b.e", "be", "bachelor", "engineering", "b tech", "b e"], match: ["btech", "be"] },
        { keys: ["mtech", "m.tech", "m.e", "me", "master of tech", "m tech"], match: ["mtech"] },
        { keys: ["bsc", "b.sc", "b sc", "bachelor of science"], match: ["bsc"] },
        { keys: ["msc", "m.sc", "m sc", "master of science"], match: ["msc"] },
        { keys: ["bca"], match: ["bca"] },
        { keys: ["mca"], match: ["mca"] },
        { keys: ["mba"], match: ["mba"] },
        { keys: ["phd", "doctorate"], match: ["phd"] },
        { keys: ["grad", "graduate", "passed out", "alumni", "recent graduate"], match: ["grad"] },
        { keys: ["software", "swe", "developer", "engineering", "coding", "web", "frontend", "backend", "fullstack"], match: ["swe"] },
        { keys: ["machine learning", "ml", "ai", "artificial intelligence", "deep learning"], match: ["ml-ai", "ml"] },
        { keys: ["data", "analytics", "analyst", "science", "bi"], match: ["data"] },
        { keys: ["product", "pm"], match: ["product"] },
        { keys: ["design", "ui", "ux", "ui/ux"], match: ["design"] },
        { keys: ["marketing", "digital marketing", "seo"], match: ["marketing"] },
        { keys: ["finance", "fintech"], match: ["finance"] }
      ];

      for (const entry of wordMap) {
        if (entry.keys.some(k => lower.includes(k))) {
          for (const m of entry.match) {
            for (const opt of options) {
              if (opt.value.toLowerCase() === m || opt.text.toLowerCase().includes(m)) {
                return opt;
              }
            }
          }
        }
      }

      // 6. Token overlap fallback
      const tokens = lower.split(/\s+/).filter(t => t.length > 2);
      let bestOpt = null;
      let maxScore = 0;
      for (const opt of options) {
        if (!opt.value) continue;
        let score = 0;
        const combined = (opt.value + " " + opt.text).toLowerCase();
        for (const t of tokens) {
          if (combined.includes(t)) score++;
        }
        if (score > maxScore) {
          maxScore = score;
          bestOpt = opt;
        }
      }
      if (bestOpt && maxScore > 0) return bestOpt;

      // 7. Fallback to first selectable option if non-empty
      const nonEmpties = options.filter(o => o.value);
      if (nonEmpties.length > 0) {
        return nonEmpties[0];
      }

      return null;
    }

    /**
     * Helper to perform select operation on a dropdown or combobox.
     */
    function applySelect(targetEl, n, val) {
      if (targetEl.tagName.toLowerCase() === "select") {
        const matched = findBestSelectOption(targetEl, val);
        if (matched) {
          targetEl.value = matched.value;
          targetEl.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
          targetEl.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
          return { ok: true, data: { action: "select", n, value: matched.value, text: matched.text } };
        } else {
          return { ok: false, error: `Could not find a matching option for "${val}" in select element [${n}]` };
        }
      } else {
        // For custom combobox or button-based dropdowns, try click
        targetEl.click();
        return { ok: true, data: { action: "select", n, value: val } };
      }
    }

    if (action === "type") {
      // If the target element is actually a <select>, gracefully route to select
      if (el.tagName.toLowerCase() === "select") {
        const res = applySelect(el, n, value);
        await new Promise((r) => setTimeout(r, 200));
        return res;
      }

      // Safety check: Never type into sensitive fields
      if (isFieldSensitive(el) || (entry && entry.actionElement && entry.actionElement.sensitive)) {
        return {
          ok: false,
          error: "SENSITIVE_FIELD: Automated typing into password, card, or OTP fields is strictly blocked for security.",
        };
      }

      let textValue = String(value != null ? value : "");

      // Normalize CGPA / Percentage input if user/model provides "8.5 / 10" or "9.0/10" or "85%"
      const fieldDesc = `${el.name || ""} ${el.id || ""} ${(entry && entry.actionElement && entry.actionElement.text) || ""}`;
      if (/cgpa|gpa|percentage|marks/i.test(fieldDesc)) {
        const slashMatch = textValue.match(/^\s*(\d+(?:\.\d+)?)\s*\/\s*10(?:\.0)?\s*$/i);
        if (slashMatch) {
          textValue = slashMatch[1];
        } else {
          const pctMatch = textValue.match(/^\s*(\d+(?:\.\d+)?)\s*%\s*$/);
          if (pctMatch) {
            textValue = pctMatch[1];
          }
        }
      }

      try {
        el.focus();
        el.value = textValue;
        el.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
        el.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
      } catch (err) {
        return { ok: false, error: `Failed to set input value: ${err.message}` };
      }

      await new Promise((r) => setTimeout(r, 200));
      return { ok: true, data: { action: "type", n, value: textValue } };
    }

    if (action === "select") {
      const res = applySelect(el, n, value);
      await new Promise((r) => setTimeout(r, 200));
      return res;
    }

    return { ok: false, error: `Unsupported action "${action}"` };
  }

  window.executeAction = executeAction;
})();
