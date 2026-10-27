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

if (!window.__sahayakMessageListenerRegistered) {
  window.__sahayakMessageListenerRegistered = true;

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

  if (message.type === "SCAN_INTERACTIVE") {
    try {
      const showBadges = !message.payload || message.payload.showBadges !== false;
      const elements = typeof scanInteractiveElements === "function" ? scanInteractiveElements() : [];
      if (showBadges && typeof renderOverlayBadges === "function") {
        renderOverlayBadges(elements);
      }
      sendResponse({
        ok: true,
        requestId: message.requestId,
        data: {
          elements,
          count: elements.length,
          url: window.location.href,
          title: document.title,
        },
      });
    } catch (err) {
      console.error("[Sahayak Content] SCAN_INTERACTIVE error:", err);
      sendResponse({
        ok: false,
        requestId: message.requestId,
        error: err.message || "Failed to scan interactive elements.",
      });
    }
    return false;
  }

  if (message.type === "BADGES_TOGGLE") {
    const forceState = message.payload && typeof message.payload.visible === "boolean" ? message.payload.visible : undefined;
    const visible = toggleOverlayBadges(forceState);
    sendResponse({
      ok: true,
      requestId: message.requestId,
      data: { visible },
    });
    return false;
  }

  if (message.type === "CLEAR_OVERLAYS") {
    clearOverlayBadges();
    sendResponse({
      ok: true,
      requestId: message.requestId,
      data: { cleared: true },
    });
    return false;
  }

  if (message.type === "HIGHLIGHT_ELEMENT") {
    const n = message.payload && Number(message.payload.n);
    const entry = window.__sahayakElementsMap && window.__sahayakElementsMap.get(n);
    if (entry && entry.element) {
      entry.element.scrollIntoView({ behavior: "smooth", block: "center" });

      // Pulse element border/glow
      const prevOutline = entry.element.style.outline;
      const prevBoxShadow = entry.element.style.boxShadow;
      entry.element.style.outline = "3px solid #0d6b63";
      entry.element.style.boxShadow = "0 0 16px rgba(13, 107, 99, 0.7)";
      setTimeout(() => {
        entry.element.style.outline = prevOutline;
        entry.element.style.boxShadow = prevBoxShadow;
      }, 2500);

      // Pulse overlay badge
      if (typeof window.pulseBadge === "function") {
        window.pulseBadge(n);
      }

      sendResponse({ ok: true, requestId: message.requestId, data: { found: true, n } });
    } else {
      sendResponse({ ok: false, requestId: message.requestId, error: "Element not found" });
    }
    return false;
  }

  if (message.type === "EXECUTE_ACTION") {
    const proposal = message.payload && message.payload.proposal;
    executeAction(proposal)
      .then((result) => {
        sendResponse({
          ok: result.ok,
          requestId: message.requestId,
          error: result.error,
          data: result.data,
        });
      })
      .catch((err) => {
        sendResponse({
          ok: false,
          requestId: message.requestId,
          error: err.message || "Action execution failed",
        });
      });
    return true; // Keep channel open for async execution
  }

  return false;
});
}
