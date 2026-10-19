importScripts("../lib/utils.js", "ai/prompts.js", "ai/gemini.js", "ai/groq.js", "ai/ai.js", "ai/cache.js", "router.js");

// ── Side panel behaviour ──────────────────────────────────────────────────────

async function enableActionOpensPanel() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (_err) {
    // Side panel behaviour is best-effort; Chrome still loads the extension.
  }
}

// ── Context menus ─────────────────────────────────────────────────────────────

const MENU_PARENT   = "sahayak-root";
const MENU_EXPLAIN  = "sahayak-explain";
const MENU_TRANSLATE = "sahayak-translate";
const MENU_DRAFT    = "sahayak-draft";

function createContextMenus() {
  // Remove any stale items first — avoids duplicate errors on reload.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id:       MENU_PARENT,
      title:    "Sahayak",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id:       MENU_EXPLAIN,
      parentId: MENU_PARENT,
      title:    "Explain this",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id:       MENU_TRANSLATE,
      parentId: MENU_PARENT,
      title:    "Translate",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id:       MENU_DRAFT,
      parentId: MENU_PARENT,
      title:    "Draft a reply",
      contexts: ["selection"],
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  enableActionOpensPanel();
  createContextMenus();
});

enableActionOpensPanel();

// ── Context menu click handler ────────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const modeMap = {
    [MENU_EXPLAIN]:   "explain",
    [MENU_TRANSLATE]: "translate",
    [MENU_DRAFT]:     "draft",
  };

  const mode = modeMap[info.menuItemId];
  if (!mode) return;

  const selection = (info.selectionText || "").trim();
  if (!selection) return;

  // Stash the pending action so the panel can pick it up on load.
  const pending = {
    mode,
    selection,
    url: (tab && tab.url) || "",
    tabId: (tab && tab.id) || null,
  };

  await chrome.storage.local.set({ pendingContextAction: pending });

  // Open the side panel.
  try {
    if (tab && tab.windowId) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }
  } catch (_err) {
    // Restricted pages (chrome://, Web Store) cannot host a side panel.
  }
});

// ── Action click ──────────────────────────────────────────────────────────────

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

// ── Message handler ───────────────────────────────────────────────────────────

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
