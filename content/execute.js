/**
 * content/execute.js
 *
 * DOM action execution for the approval-based agent loop (Slice 3.3, Architecture §7.7).
 *
 * Supported actions: click, type, select, scroll, done.
 * Safety rule: NEVER execute 'type' on sensitive fields (password, otp, cvv, etc.).
 */

(function () {
  const SENSITIVE_REGEX = /(password|passwd|otp|pin|cvv|cvc|card[-_]?num|credit[-_]?card|secret|ssn)/i;

  /**
   * Check if an element is prohibited from automated typing.
   */
  function isFieldSensitive(el) {
    if (!el) return true;
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "password") return true;

    const autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (/(one-time-code|cc-number|cc-csc|cc-exp|current-password|new-password)/i.test(autocomplete)) {
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

    if (action === "type") {
      // Safety check: Never type into sensitive fields
      if (isFieldSensitive(el) || (entry && entry.actionElement && entry.actionElement.sensitive)) {
        return {
          ok: false,
          error: "SENSITIVE_FIELD: Automated typing into password, card, or OTP fields is strictly blocked for security.",
        };
      }

      const textValue = String(value != null ? value : "");

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
      const selectVal = String(value != null ? value : "").trim().toLowerCase();
      let matched = false;

      if (el.tagName.toLowerCase() === "select") {
        for (const opt of el.options) {
          if (
            opt.value.trim().toLowerCase() === selectVal ||
            opt.text.trim().toLowerCase() === selectVal
          ) {
            el.value = opt.value;
            matched = true;
            break;
          }
        }

        // Substring fallback
        if (!matched) {
          for (const opt of el.options) {
            if (opt.text.toLowerCase().includes(selectVal) || opt.value.toLowerCase().includes(selectVal)) {
              el.value = opt.value;
              matched = true;
              break;
            }
          }
        }

        el.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
        el.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
      } else {
        // For custom combobox or button-based dropdowns, try click
        el.click();
      }

      await new Promise((r) => setTimeout(r, 200));
      return { ok: true, data: { action: "select", n, value } };
    }

    return { ok: false, error: `Unsupported action "${action}"` };
  }

  window.executeAction = executeAction;
})();
