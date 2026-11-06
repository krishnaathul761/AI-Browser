/**
 * background/safety/actions.js
 *
 * Action Gate & Consequential Action Controls (Slice 4.3, Architecture §8.3):
 * Extension safety code classifying high-impact or irreversible actions.
 * Consequential actions require explicit human confirmation and highlight
 * a warning card in the side panel before DOM execution:
 *   - Submit / Send / Publish
 *   - Pay / Purchase / Buy / Checkout / Place order
 *   - Delete / Remove / Destroy / Cancel subscription
 */

const CONSEQUENTIAL_KEYWORDS = [
  "submit",
  "pay",
  "payment",
  "purchase",
  "buy",
  "send",
  "confirm",
  "delete",
  "remove",
  "destroy",
  "checkout",
  "order",
  "place order",
  "transfer",
  "cancel subscription",
  "finalize",
];

const CONSEQUENTIAL_REGEX = new RegExp(
  `\\b(${CONSEQUENTIAL_KEYWORDS.join("|")})\\b`,
  "i"
);

/**
 * Checks whether an element or proposal constitutes a consequential action
 * (e.g. form submission, payment, deletion, ordering).
 *
 * @param {Object} proposal
 * @param {Object} [element]
 * @returns {{ consequential: boolean, reason?: string, requiresSecondConfirm: boolean }}
 */
function isConsequentialAction(proposal, element) {
  if (!proposal || typeof proposal !== "object") {
    return { consequential: false, requiresSecondConfirm: false };
  }

  // 1. Element marked consequential by scanner or tag is submit
  if (element && element.consequential) {
    return {
      consequential: true,
      requiresSecondConfirm: true,
      reason: "Target element is classified as a consequential form submission or action control.",
    };
  }

  if (element && ((element.type || "").toLowerCase() === "submit" || (element.tag || "").toLowerCase() === "button[type=submit]")) {
    return {
      consequential: true,
      requiresSecondConfirm: true,
      reason: "Form submit button.",
    };
  }

  // 2. Metadata text matching consequential keywords
  const textPool = [
    proposal.action,
    proposal.reason,
    proposal.label,
    proposal.value,
    element && element.text,
    element && element.label,
    element && element.name,
    element && element.id,
    element && element.role,
  ]
    .filter((s) => typeof s === "string" && s.trim())
    .join(" ");

  const match = textPool.match(CONSEQUENTIAL_REGEX);
  if (match) {
    return {
      consequential: true,
      requiresSecondConfirm: true,
      reason: `Action involves potentially consequential operation: "${match[0]}".`,
    };
  }

  return { consequential: false, requiresSecondConfirm: false };
}

/**
 * Determines whether a URL is a practice environment.
 * @param {string} url
 * @returns {boolean}
 */
function isPracticeEnvironment(url) {
  if (!url || typeof url !== "string") return false;
  const u = url.toLowerCase();
  return (
    u.includes("/pages/practice/") ||
    u.includes("pages/practice/") ||
    u.startsWith("file:///") ||
    u.includes("localhost") ||
    u.includes("127.0.0.1")
  );
}

