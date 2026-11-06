/**
 * background/safety/pages.js
 *
 * Page Gate (Slice 4.3, Architecture §8.1):
 * Deterministic URL and host-level safety rules in extension code.
 * Blocks agent automation, summaries, grounded chat, and screenshots on:
 *   1. Banking, payment gateways, UPI, netbanking, and card processors.
 *   2. Privileged browser URLs: chrome://, about:, edge://, chrome-extension://.
 *   3. Chrome Web Store & extension stores.
 *
 * Practice pages (/pages/practice/) are explicitly allowlisted for safe learning.
 */

// Known payment gateways, UPI handlers, and banking domains (subdomains included)
const RESTRICTED_HOST_PATTERNS = [
  // Payment gateways & wallets
  /razorpay\.com$/i,
  /stripe\.com$/i,
  /paypal\.com$/i,
  /paytm\.com$/i,
  /phonepe\.com$/i,
  /bhimupi\.org\.in$/i,
  /npci\.org\.in$/i,
  /billdesk\.com$/i,
  /cashfree\.com$/i,
  /ccavenue\.com$/i,
  /payu\.in$/i,
  /cred\.club$/i,
  /instamojo\.com$/i,
  /square\.com$/i,
  /squareup\.com$/i,
  /venmo\.com$/i,

  // Indian banking hosts
  /hdfcbank\.com$/i,
  /icicibank\.com$/i,
  /sbi\.co\.in$/i,
  /onlinesbi\.sbi$/i,
  /axisbank\.com$/i,
  /kotak\.com$/i,
  /pnbindia\.in$/i,
  /bankofbaroda\.in$/i,
  /canarabank\.com$/i,
  /indusind\.com$/i,
  /yesbank\.in$/i,

  // Global banking hosts
  /chase\.com$/i,
  /bankofamerica\.com$/i,
  /wellsfargo\.com$/i,
  /citi\.com$/i,
  /citibank\.com$/i,
  /capitalone\.com$/i,
  /barclays\.co\.uk$/i,
  /hsbc\.com$/i,
];

// Path and query heuristics indicating checkout, payment, or sensitive auth
const RESTRICTED_PATH_PATTERNS = [
  /\/upi(\/|\?|$)/i,
  /\/netbanking(\/|\?|$)/i,
  /\/payment[-_]?gateway(\/|\?|$)/i,
  /\/fund[-_]?transfer(\/|\?|$)/i,
  /\/checkout\/pay/i,
  /\/pay\/now/i,
];

/**
 * Checks whether a given URL is safe for browser automation, AI reading,
 * or screenshot capture.
 *
 * @param {string} url
 * @returns {{ blocked: boolean, reason?: string, category?: "PAYMENT_BANKING" | "INTERNAL_PROTOCOL" | "STORE" }}
 */
function checkPageSafety(url) {
  if (!url || typeof url !== "string") {
    return { blocked: true, reason: "Invalid or empty URL.", category: "INTERNAL_PROTOCOL" };
  }

  const cleanUrl = url.trim();

  // Allowlist: Sahayak bundled practice environment is always permitted
  if (cleanUrl.includes("/pages/practice/") || cleanUrl.includes("pages/practice/")) {
    return { blocked: false };
  }

  // 1. Privileged browser and internal URLs
  if (
    cleanUrl.startsWith("chrome://") ||
    cleanUrl.startsWith("chrome-extension://") ||
    cleanUrl.startsWith("about:") ||
    cleanUrl.startsWith("edge://") ||
    cleanUrl.startsWith("view-source:")
  ) {
    return {
      blocked: true,
      reason: "Access to internal browser or extension pages is strictly restricted for security.",
      category: "INTERNAL_PROTOCOL",
    };
  }

  // 2. Extension web stores
  if (
    cleanUrl.includes("chrome.google.com/webstore") ||
    cleanUrl.includes("chromewebstore.google.com") ||
    cleanUrl.includes("microsoftedge.microsoft.com/addons")
  ) {
    return {
      blocked: true,
      reason: "Extension store pages cannot be automated or accessed by browser extensions.",
      category: "STORE",
    };
  }

  // 3. Domain & Host pattern analysis
  let hostname = "";
  let pathname = "";
  try {
    const parsed = new URL(cleanUrl);
    hostname = parsed.hostname.toLowerCase();
    pathname = (parsed.pathname + parsed.search).toLowerCase();
  } catch (_e) {
    // Malformed URL
    return { blocked: true, reason: "Malformed URL format.", category: "INTERNAL_PROTOCOL" };
  }

  for (let i = 0; i < RESTRICTED_HOST_PATTERNS.length; i += 1) {
    if (RESTRICTED_HOST_PATTERNS[i].test(hostname)) {
      return {
        blocked: true,
        reason: `Banking, payment gateway, or UPI domain (${hostname}) is blocked by safety rails. No page data or actions are permitted.`,
        category: "PAYMENT_BANKING",
      };
    }
  }

  // 4. Sensitive payment / banking path heuristics
  for (let i = 0; i < RESTRICTED_PATH_PATTERNS.length; i += 1) {
    if (RESTRICTED_PATH_PATTERNS[i].test(pathname)) {
      return {
        blocked: true,
        reason: `Payment or transaction path (${pathname.slice(0, 40)}) is blocked by safety rails to protect sensitive financial data.`,
        category: "PAYMENT_BANKING",
      };
    }
  }

  return { blocked: false };
}

/**
 * Convenience helper returning boolean true if URL is blocked.
 * @param {string} url
 * @returns {boolean}
 */
function isPageRestricted(url) {
  return checkPageSafety(url).blocked;
}

/**
 * Get human-readable block reason or empty string.
 * @param {string} url
 * @returns {string}
 */
function getRestrictedPageReason(url) {
  const result = checkPageSafety(url);
  return result.blocked ? (result.reason || "This page is blocked by safety rails.") : "";
}

