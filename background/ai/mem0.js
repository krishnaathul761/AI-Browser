/**
 * Mem0 REST API Client for Sahayak.
 * Enables cross-session long-term memory for user preferences and facts.
 * Base URL: https://api.mem0.ai/v1
 */

const MEM0_BASE_URL = "https://api.mem0.ai/v1";

/**
 * Add memories from conversation turns asynchronously.
 *
 * @param {{ apiKey: string, userId: string, messages: { role: string, content: string }[] }} params
 * @returns {Promise<{ ok: boolean, data?: any, error?: string }>}
 */
async function mem0AddMemories({ apiKey, userId, messages }) {
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, error: "MISSING_KEY", disabled: true };
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, error: "NO_MESSAGES" };
  }

  const uid = (userId && userId.trim()) ? userId.trim() : "sahayak_default_user";

  try {
    const res = await fetch(`${MEM0_BASE_URL}/memories/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Token ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        messages,
        user_id: uid,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `Mem0 API error (${res.status}): ${errText}` };
    }

    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message || "Network error contacting Mem0" };
  }
}

/**
 * Search relevant memories for a given query or context.
 *
 * @param {{ apiKey: string, userId: string, query: string, limit?: number }} params
 * @returns {Promise<{ ok: boolean, memories: Array<{ id: string, memory: string, score?: number }>, error?: string }>}
 */
async function mem0SearchMemories({ apiKey, userId, query, limit = 5 }) {
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, memories: [], error: "MISSING_KEY", disabled: true };
  }
  if (!query || !query.trim()) {
    return { ok: true, memories: [] };
  }

  const uid = (userId && userId.trim()) ? userId.trim() : "sahayak_default_user";

  try {
    const res = await fetch(`${MEM0_BASE_URL}/memories/search/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Token ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        query: query.trim(),
        user_id: uid,
        limit,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, memories: [], error: `Mem0 API error (${res.status}): ${errText}` };
    }

    const data = await res.json();
    const memories = Array.isArray(data)
      ? data.map((item) => ({
          id: item.id || "",
          memory: item.memory || item.text || "",
          score: item.score || 0,
        }))
      : [];

    return { ok: true, memories };
  } catch (err) {
    return { ok: false, memories: [], error: err.message || "Network error contacting Mem0" };
  }
}

/**
 * List all memories saved for a user.
 *
 * @param {{ apiKey: string, userId: string }} params
 * @returns {Promise<{ ok: boolean, memories: Array<{ id: string, memory: string, created_at?: string }>, error?: string }>}
 */
async function mem0ListMemories({ apiKey, userId }) {
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, memories: [], error: "MISSING_KEY", disabled: true };
  }

  const uid = (userId && userId.trim()) ? userId.trim() : "sahayak_default_user";

  try {
    const res = await fetch(`${MEM0_BASE_URL}/memories/?user_id=${encodeURIComponent(uid)}`, {
      method: "GET",
      headers: {
        "Authorization": `Token ${apiKey.trim()}`,
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, memories: [], error: `Mem0 API error (${res.status}): ${errText}` };
    }

    const data = await res.json();
    const rawList = Array.isArray(data) ? data : (Array.isArray(data.results) ? data.results : []);
    const memories = rawList.map((item) => ({
      id: item.id || "",
      memory: item.memory || item.text || "",
      created_at: item.created_at || "",
    }));

    return { ok: true, memories };
  } catch (err) {
    return { ok: false, memories: [], error: err.message || "Network error contacting Mem0" };
  }
}

/**
 * Delete a specific memory item by ID.
 *
 * @param {{ apiKey: string, memoryId: string }} params
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function mem0DeleteMemory({ apiKey, memoryId }) {
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, error: "MISSING_KEY" };
  }
  if (!memoryId || !memoryId.trim()) {
    return { ok: false, error: "MISSING_MEMORY_ID" };
  }

  try {
    const res = await fetch(`${MEM0_BASE_URL}/memories/${encodeURIComponent(memoryId.trim())}/`, {
      method: "DELETE",
      headers: {
        "Authorization": `Token ${apiKey.trim()}`,
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `Mem0 API error (${res.status}): ${errText}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || "Network error contacting Mem0" };
  }
}

