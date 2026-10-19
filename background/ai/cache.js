/**
 * background/ai/cache.js
 *
 * Summary result cache stored in chrome.storage.local.
 *
 * Keys live under "summaryCache" as a map:
 *   { [url]: { data: SummaryData, cachedAt: number } }
 *
 * TTL: 24 hours. Videos never change so the cache is almost always valid.
 * Cache is silently skipped on any storage error — callers always fall back
 * to a live API call.
 *
 * Exported symbols (available globally after importScripts):
 *   getCachedSummary(url)           → Promise<object|null>
 *   setCachedSummary(url, data)     → Promise<void>
 *   clearCachedSummary(url)         → Promise<void>
 */

const CACHE_KEY    = "summaryCache";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ENTRIES  = 50; // cap to avoid unbounded storage growth

/**
 * Return cached summary data for a URL, or null if missing / expired.
 *
 * @param {string} url
 * @returns {Promise<object|null>}
 */
async function getCachedSummary(url) {
  if (!url) return null;
  try {
    const bag  = await chrome.storage.local.get(CACHE_KEY);
    const cache = bag[CACHE_KEY];
    if (!cache || typeof cache !== "object") return null;

    const entry = cache[url];
    if (!entry || !entry.data || !entry.cachedAt) return null;

    const age = Date.now() - entry.cachedAt;
    if (age > CACHE_TTL_MS) {
      // Expired — delete lazily and return null.
      delete cache[url];
      chrome.storage.local.set({ [CACHE_KEY]: cache }).catch(() => {});
      return null;
    }

    return entry.data;
  } catch (_e) {
    return null;
  }
}

/**
 * Store a summary result for a URL.
 * Silently evicts the oldest entry when the cache is full.
 *
 * @param {string} url
 * @param {object} data
 * @returns {Promise<void>}
 */
async function setCachedSummary(url, data) {
  if (!url || !data) return;
  try {
    const bag   = await chrome.storage.local.get(CACHE_KEY);
    const cache = (bag[CACHE_KEY] && typeof bag[CACHE_KEY] === "object")
      ? bag[CACHE_KEY]
      : {};

    // Evict oldest entry if at capacity.
    const keys = Object.keys(cache);
    if (keys.length >= MAX_ENTRIES) {
      let oldestKey = keys[0];
      let oldestTime = cache[keys[0]].cachedAt || 0;
      keys.forEach((k) => {
        if ((cache[k].cachedAt || 0) < oldestTime) {
          oldestTime = cache[k].cachedAt || 0;
          oldestKey  = k;
        }
      });
      delete cache[oldestKey];
    }

    cache[url] = { data, cachedAt: Date.now() };
    await chrome.storage.local.set({ [CACHE_KEY]: cache });
  } catch (_e) {
    // Storage errors are non-fatal — the result was still shown to the user.
  }
}

/**
 * Remove a single cached entry (used when user force-refreshes).
 *
 * @param {string} url
 * @returns {Promise<void>}
 */
async function clearCachedSummary(url) {
  if (!url) return;
  try {
    const bag   = await chrome.storage.local.get(CACHE_KEY);
    const cache = bag[CACHE_KEY];
    if (!cache || !cache[url]) return;
    delete cache[url];
    await chrome.storage.local.set({ [CACHE_KEY]: cache });
  } catch (_e) {}
}
