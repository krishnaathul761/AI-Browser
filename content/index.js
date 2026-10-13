/**
 * content/index.js
 *
 * Content script — runs inside every http/https page.
 * Listens for messages from the background service worker and replies.
 *
 * Supported message types:
 *   GET_SELECTION    → { ok, requestId, data: { text } }
 *   EXTRACT_ARTICLE  → { ok, requestId, data: { title, byline, text, excerpt, isFallback? } }
 *                      or { ok: false, requestId, error: string }
 *
 * All other types return false so Chrome doesn't keep the channel open.
 */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) {
    return false;
  }

  if (message.type === "GET_SELECTION") {
    const text = getSelectionText(); // defined in extract.js
    sendResponse({ ok: true, requestId: message.requestId, data: { text } });
    return false;
  }

  if (message.type === "EXTRACT_ARTICLE") {
    // extractArticle() is defined in extract.js (loaded first).
    // It never throws — errors come back as { error } inside data.
    const result = extractArticle();
    if (result.error) {
      sendResponse({ ok: false, requestId: message.requestId, error: result.error });
    } else {
      sendResponse({ ok: true, requestId: message.requestId, data: result });
    }
    return false;
  }

  return false;
});
