/**
 * content/extract.js
 *
 * DOM helpers injected into the page alongside lib/readability.js.
 * Loaded by content/index.js. Must NOT call chrome.* APIs directly.
 */

// ── Selection ─────────────────────────────────────────────────────────────────

/**
 * Returns the current text selection, trimmed.
 * Returns "" when nothing is selected.
 * @returns {string}
 */
function getSelectionText() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return "";
  return sel.toString().trim();
}

// ── Page gate ─────────────────────────────────────────────────────────────────

/**
 * Returns true for pages we must never send to an AI (chrome://, extension
 * pages, Web Store). Readability extraction is also refused on these.
 * @returns {boolean}
 */
function isRestrictedPage() {
  const url = window.location.href;
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("about:") ||
    url.startsWith("edge://") ||
    url.includes("chrome.google.com/webstore")
  );
}

// ── Article extraction (Readability) ─────────────────────────────────────────

const ARTICLE_MAX_CHARS = 12000; // ~3k tokens — enough for a solid summary, fits Groq's free tier comfortably

/**
 * Attempt Readability on a clone of the document.
 * Returns null when Readability finds nothing useful.
 *
 * @returns {{ title, byline, text, excerpt } | null}
 */
function tryReadability() {
  // Readability mutates the node it receives, so always clone.
  const docClone = document.cloneNode(true);

  // Readability is a global injected by lib/readability.js (loaded first).
  // The constructor accepts a document node.
  let reader;
  try {
    reader = new Readability(docClone); // eslint-disable-line no-undef
  } catch (_e) {
    return null;
  }

  let article;
  try {
    article = reader.parse();
  } catch (_e) {
    return null;
  }

  if (!article || !article.textContent || article.textContent.trim().length < 100) {
    return null;
  }

  return {
    title: (article.title || document.title || "").trim(),
    byline: (article.byline || "").trim(),
    text: article.textContent.trim().slice(0, ARTICLE_MAX_CHARS),
    excerpt: (article.excerpt || "").trim().slice(0, 300),
  };
}

/**
 * Fallback: grab visible text from document.body when Readability returns
 * nothing (SPAs, thin pages). Returns the first ARTICLE_MAX_CHARS characters.
 *
 * @returns {{ title, byline, text, excerpt, isFallback: true }}
 */
function bodyFallback() {
  const raw = (document.body && document.body.innerText) || "";
  return {
    title: (document.title || "").trim(),
    byline: "",
    text: raw.trim().slice(0, ARTICLE_MAX_CHARS),
    excerpt: raw.trim().slice(0, 300),
    isFallback: true,
  };
}

/**
 * Main entry point called by index.js for EXTRACT_ARTICLE.
 * Never throws — errors are converted to `{ error }`.
 *
 * @returns {{ title, byline, text, excerpt, isFallback?, error? }}
 */
function extractArticle() {
  if (isRestrictedPage()) {
    return { error: "RESTRICTED_PAGE" };
  }

  const article = tryReadability();
  if (article) return article;

  const fallback = bodyFallback();
  if (!fallback.text) {
    return { error: "EMPTY_PAGE" };
  }
  return fallback;
}
