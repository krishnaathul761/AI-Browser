importScripts("../lib/utils.js", "ai/prompts.js", "ai/gemini.js", "ai/groq.js", "ai/ai.js", "ai/cache.js", "router.js");

async function enableActionOpensPanel() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (_err) {
    // Side panel behaviour is best-effort; Chrome still loads the extension.
  }
}

chrome.runtime.onInstalled.addListener(() => {
  enableActionOpensPanel();
});

enableActionOpensPanel();

chrome.action.onClicked.addListener(async (tab) => {
  try {
    const windowId = tab && tab.windowId;
    if (typeof windowId === "number") {
      await chrome.sidePanel.open({ windowId: windowId });
    }
  } catch (_err) {
    // Restricted pages (chrome://, Web Store) cannot host a side panel.
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  Promise.resolve(routeMessage(message, sender))
    .then(sendResponse)
    .catch(() => {
      sendResponse({
        ok: false,
        requestId: message && message.requestId,
        error: "Unexpected error",
      });
    });
  return true;
});
