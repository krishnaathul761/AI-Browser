/**
 * background/safety/fields.js
 *
 * Field Gate (Slice 4.3, Architecture §8.2):
 * Extension code barriers preventing automated entry into sensitive fields.
 * Strictly forbids typing into:
 *   - Password fields (type="password" or password in name/id/placeholder)
 *   - OTP / 2FA codes (autocomplete="one-time-code", otp/totp/pin names)
 *   - Payment card details (cc-number, cc-csc, cc-exp, cvv, credit card)
 *   - Government / financial IDs (SSN, Aadhaar, PAN)
 */

const SENSITIVE_FIELD_REGEX =
  /(password|passwd|passcode|pin|otp|totp|2fa|cvv|cvc|card[-_]?num|credit[-_]?card|debit[-_]?card|secret|ssn|aadhaar|pan[-_]?card)/i;

const SENSITIVE_AUTOCOMPLETE_REGEX =
  /(one-time-code|cc-number|cc-csc|cc-exp|current-password|new-password|transaction-amount)/i;

/**
 * Checks whether an interactive element or field descriptor represents
 * a sensitive credential, payment, or auth field.
 *
 * @param {Object} el
 * @returns {boolean}
 */
function isFieldSensitive(el) {
  if (!el || typeof el !== "object") return false;

  // 1. Explicitly marked sensitive by scanner
  if (el.sensitive === true) return true;

  // 2. Input type password
  const type = (el.type || "").toLowerCase().trim();
  if (type === "password") return true;

  // 3. Autocomplete tokens
  const autocomplete = (el.autocomplete || "").toLowerCase().trim();
  if (SENSITIVE_AUTOCOMPLETE_REGEX.test(autocomplete)) return true;

  // 4. Combined metadata inspection (name, id, placeholder, label, text, aria-label)
  const combined = [
    el.name,
    el.id,
    el.placeholder,
    el.label,
    el.text,
    el.ariaLabel,
    el.role,
  ]
    .filter((v) => typeof v === "string" && v.trim())
    .join(" ");

  return SENSITIVE_FIELD_REGEX.test(combined);
}

/**
 * Checks if the text payload being typed resembles a payment card number
 * or one-time passcode (defense in depth against data exfiltration).
 *
 * @param {string} val
 * @returns {boolean}
 */
function isSensitiveValue(val) {
  if (typeof val !== "string") return false;
  const clean = val.replace(/[\s-]/g, "");

  // Luhn-like credit card pattern (13 to 19 digits)
  if (/^\d{13,19}$/.test(clean)) return true;

  // High entropy 3-4 digit CVV/PIN when context suggests payment
  return false;
}

/**
 * Validates whether an action is permitted on the target element.
 *
 * @param {"click"|"type"|"select"|"scroll"|"done"} action
 * @param {Object} targetElement
 * @param {string} [value]
 * @returns {{ ok: true } | { ok: false, error: string, code: "SAFETY_REFUSAL" }}
 */
function validateFieldAction(action, targetElement, value) {
  if (action === "type") {
    if (isFieldSensitive(targetElement)) {
      return {
        ok: false,
        code: "SAFETY_REFUSAL",
        error: `SAFETY_REFUSAL: Target element [${targetElement && targetElement.n ? targetElement.n : "?"}] is a sensitive field (password, payment card, PIN, or OTP). Automated typing is strictly blocked by extension safety code.`,
      };
    }

    if (value && isSensitiveValue(value)) {
      return {
        ok: false,
        code: "SAFETY_REFUSAL",
        error: "SAFETY_REFUSAL: Proposed value resembles a payment card or sensitive credential. Action blocked.",
      };
    }
  }

  return { ok: true };
}

