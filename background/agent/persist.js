/**
 * background/agent/persist.js
 *
 * Persistence for agent session and global action log (Slice 3.4, Architecture §7.7).
 * Capped action log (200 entries), storage persistence across service worker sleep.
 */

const AGENT_STORAGE_KEY = "agentSession";
const ACTION_LOG_KEY = "actionLog";
const MAX_ACTION_LOG_ENTRIES = 200;

/**
 * Persist active agent session to chrome.storage.local.
 *
 * @param {Object|null} session
 * @returns {Promise<void>}
 */
async function saveAgentSession(session) {
  try {
    if (session) {
      await chrome.storage.local.set({ [AGENT_STORAGE_KEY]: session });
    } else {
      await chrome.storage.local.remove(AGENT_STORAGE_KEY);
    }
  } catch (err) {
    console.error("[Sahayak Persist] Failed to save agent session:", err);
  }
}

/**
 * Load persisted agent session from chrome.storage.local.
 *
 * @returns {Promise<Object|null>}
 */
async function loadAgentSession() {
  try {
    const bag = await chrome.storage.local.get(AGENT_STORAGE_KEY);
    return (bag && bag[AGENT_STORAGE_KEY]) || null;
  } catch (err) {
    console.error("[Sahayak Persist] Failed to load agent session:", err);
    return null;
  }
}

/**
 * Remove agent session from storage.
 *
 * @returns {Promise<void>}
 */
async function clearAgentSession() {
  try {
    await chrome.storage.local.remove(AGENT_STORAGE_KEY);
  } catch (err) {
    console.error("[Sahayak Persist] Failed to clear agent session:", err);
  }
}

/**
 * Append an entry to the persistent action log (capped at MAX_ACTION_LOG_ENTRIES).
 *
 * @param {Object} entry
 * @param {number} entry.step - step number
 * @param {Object} entry.proposal - proposed action object
 * @param {string} [entry.reason] - step reason
 * @param {"approved"|"dry-run"|"skipped"|"stopped"|"error"} entry.decision
 * @param {string} [entry.taskGoal] - overall user errand goal
 * @param {number} [entry.at] - epoch timestamp
 * @returns {Promise<Array<Object>>} updated log
 */
async function appendActionLog(entry) {
  try {
    const bag = await chrome.storage.local.get(ACTION_LOG_KEY);
    const log = Array.isArray(bag[ACTION_LOG_KEY]) ? bag[ACTION_LOG_KEY] : [];

    const record = {
      step: entry.step || 1,
      proposal: entry.proposal || null,
      reason: entry.reason || (entry.proposal && entry.proposal.reason) || "",
      decision: entry.decision || "approved",
      taskGoal: entry.taskGoal || "",
      at: entry.at || Date.now(),
    };

    log.push(record);

    // Keep only the most recent MAX_ACTION_LOG_ENTRIES items
    const trimmed = log.length > MAX_ACTION_LOG_ENTRIES ? log.slice(-MAX_ACTION_LOG_ENTRIES) : log;
    await chrome.storage.local.set({ [ACTION_LOG_KEY]: trimmed });
    return trimmed;
  } catch (err) {
    console.error("[Sahayak Persist] Failed to append action log:", err);
    return [];
  }
}

/**
 * Retrieve the current persistent action log.
 *
 * @returns {Promise<Array<Object>>}
 */
async function getActionLog() {
  try {
    const bag = await chrome.storage.local.get(ACTION_LOG_KEY);
    return Array.isArray(bag[ACTION_LOG_KEY]) ? bag[ACTION_LOG_KEY] : [];
  } catch (err) {
    console.error("[Sahayak Persist] Failed to get action log:", err);
    return [];
  }
}

/**
 * Clear the persistent action log.
 *
 * @returns {Promise<Array<Object>>}
 */
async function clearActionLog() {
  try {
    await chrome.storage.local.set({ [ACTION_LOG_KEY]: [] });
    return [];
  } catch (err) {
    console.error("[Sahayak Persist] Failed to clear action log:", err);
    return [];
  }
}
