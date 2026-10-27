/**
 * content/scanner.js
 *
 * Interactive element scanner (Slice 3.1, Architecture §7.5).
 * Queries buttons, links, inputs, selects, textareas, and other action roles.
 * Assigns stable 1-based sequential numbers `n` for this scan.
 * Identifies `sensitive` (password, otp, card) and `consequential` (submit, pay, send).
 */

(function () {
  // Shared storage for the most recent scan
  window.__sahayakScannedElements = window.__sahayakScannedElements || [];
  window.__sahayakElementsMap = window.__sahayakElementsMap || new Map();

  const SENSITIVE_REGEX = /(password|passwd|otp|pin|cvv|cvc|card[-_]?num|credit[-_]?card|secret|ssn)/i;
  const AUTOCOMPLETE_SENSITIVE = /(one-time-code|cc-number|cc-csc|cc-exp|current-password|new-password)/i;
  const CONSEQUENTIAL_REGEX = /\b(submit|pay|payment|purchase|buy|send|confirm|delete|remove|checkout|order|place\s*order)\b/i;

  /**
   * Check if an element is currently visible to the user.
   */
  function isElementVisible(el) {
    if (!el || !(el instanceof Element)) return false;

    // Ignore elements inside the Sahayak overlay itself
    if (el.closest("#sahayak-overlay-host")) return false;

    // Check modern visibility API if available
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
        return false;
      }
    }

    const rects = el.getClientRects();
    if (!rects || rects.length === 0) return false;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    const style = window.getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      parseFloat(style.opacity) === 0
    ) {
      return false;
    }

    // Check if hidden or aria-hidden
    if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") {
      return false;
    }

    // Check closest hidden ancestors
    if (el.closest("[hidden], [aria-hidden='true']")) {
      return false;
    }

    return true;
  }

  /**
   * Extract a clear, readable text label for an element (truncated to maxLen).
   */
  function extractElementLabel(el, maxLen = 80) {
    let label = "";

    // 1. Explicit aria-label
    if (el.getAttribute("aria-label")) {
      label = el.getAttribute("aria-label");
    }

    // 2. aria-labelledby
    if (!label && el.getAttribute("aria-labelledby")) {
      const ids = el.getAttribute("aria-labelledby").split(/\s+/);
      const textParts = [];
      for (const id of ids) {
        const ref = document.getElementById(id);
        if (ref && ref.textContent) {
          textParts.push(ref.textContent.trim());
        }
      }
      if (textParts.length > 0) {
        label = textParts.join(" ");
      }
    }

    const tag = el.tagName.toLowerCase();

    // 3. For form controls: check associated <label>
    if (!label && (tag === "input" || tag === "select" || tag === "textarea")) {
      if (el.id) {
        const labelEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (labelEl && labelEl.textContent) {
          label = labelEl.textContent;
        }
      }
      if (!label) {
        const parentLabel = el.closest("label");
        if (parentLabel && parentLabel.textContent) {
          // Clone and remove inputs to get pure text if nested
          label = parentLabel.textContent;
        }
      }
      // Placeholder / title fallback for inputs
      if (!label && el.getAttribute("placeholder")) {
        label = el.getAttribute("placeholder");
      }
      if (!label && el.getAttribute("title")) {
        label = el.getAttribute("title");
      }
      if (!label && (el.type === "submit" || el.type === "button" || el.type === "reset") && el.value) {
        label = el.value;
      }
    }

    // 4. Inner text / textContent for buttons, links, summaries
    if (!label) {
      if (el.innerText && el.innerText.trim()) {
        label = el.innerText;
      } else if (el.textContent && el.textContent.trim()) {
        label = el.textContent;
      }
    }

    // 5. Image/icon fallbacks (e.g. <img alt="..."> or title)
    if (!label) {
      const img = el.querySelector("img[alt]");
      if (img && img.getAttribute("alt")) {
        label = img.getAttribute("alt");
      } else if (el.getAttribute("title")) {
        label = el.getAttribute("title");
      } else if (el.getAttribute("name")) {
        label = el.getAttribute("name");
      }
    }

    // Clean whitespace
    label = (label || "").replace(/\s+/g, " ").trim();

    // Truncate
    if (label.length > maxLen) {
      label = label.slice(0, maxLen - 1).trim() + "…";
    }

    return label;
  }

  /**
   * Determine if an element is sensitive (passwords, OTPs, card details).
   */
  function isElementSensitive(el) {
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "password") return true;

    const autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (AUTOCOMPLETE_SENSITIVE.test(autocomplete)) return true;

    const name = el.getAttribute("name") || "";
    const id = el.id || "";
    const placeholder = el.getAttribute("placeholder") || "";
    const ariaLabel = el.getAttribute("aria-label") || "";

    const combined = `${name} ${id} ${placeholder} ${ariaLabel}`;
    return SENSITIVE_REGEX.test(combined);
  }

  /**
   * Determine if an element is consequential (submit, pay, purchase, delete).
   */
  function isElementConsequential(el, text) {
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "submit") return true;

    const name = el.getAttribute("name") || "";
    const id = el.id || "";
    const value = el.value || "";
    const ariaLabel = el.getAttribute("aria-label") || "";

    const combined = `${text} ${value} ${name} ${id} ${ariaLabel}`;
    return CONSEQUENTIAL_REGEX.test(combined);
  }

  /**
   * Scan interactive elements in document order.
   * Capped to maxElements (~100).
   *
   * @param {Object} [options]
   * @param {number} [options.maxElements=100]
   * @returns {ActionElement[]}
   */
  function scanInteractiveElements(options = {}) {
    const maxElements = options.maxElements || 100;

    const selector = [
      "a[href]",
      "button",
      "[role='button']",
      "input:not([type='hidden'])",
      "textarea",
      "select",
      "[role='checkbox']",
      "[role='radio']",
      "[role='combobox']",
      "[role='menuitem']",
      "[role='tab']",
      "summary",
      "[tabindex='0']:not([role='none'])",
    ].join(", ");

    const candidates = Array.from(document.querySelectorAll(selector));
    const scanned = [];
    const elementsMap = new Map();

    let n = 1;

    for (const el of candidates) {
      if (scanned.length >= maxElements) break;

      // Skip disabled or aria-disabled elements
      if (el.disabled || el.getAttribute("aria-disabled") === "true") {
        continue;
      }

      // Check visibility
      if (!isElementVisible(el)) {
        continue;
      }

      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute("type") || (tag === "select" ? "select" : tag === "textarea" ? "textarea" : undefined);
      const role = el.getAttribute("role") || undefined;
      const text = extractElementLabel(el);
      const sensitive = isElementSensitive(el);
      const consequential = isElementConsequential(el, text);

      const actionElement = {
        n,
        tag,
        text,
        sensitive,
        consequential,
      };

      if (role) actionElement.role = role;
      if (type) actionElement.type = type;
      if (el.id) actionElement.id = el.id;
      if (el.name) actionElement.name = el.name;
      if (el.getAttribute("placeholder")) actionElement.placeholder = el.getAttribute("placeholder");
      if (tag === "a" && el.href) actionElement.href = el.href;
      if (tag === "input" && (type === "checkbox" || type === "radio")) {
        actionElement.checked = el.checked;
      }

      scanned.push(actionElement);
      elementsMap.set(n, { n, element: el, actionElement });

      n++;
    }

    window.__sahayakScannedElements = scanned;
    window.__sahayakElementsMap = elementsMap;

    return scanned;
  }

  // Export functions to window
  window.scanInteractiveElements = scanInteractiveElements;
  window.isElementVisible = isElementVisible;
})();
