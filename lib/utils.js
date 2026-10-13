function uuid() {
  if (globalThis.crypto && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const n = (Math.random() * 16) | 0;
    const v = ch === "x" ? n : (n & 0x3) | 0x8;
    return v.toString(16);
  });
}

function safeJsonParse(text, fallback) {
  if (typeof text !== "string") {
    return arguments.length > 1 ? fallback : null;
  }
  try {
    return JSON.parse(text);
  } catch (_err) {
    return arguments.length > 1 ? fallback : null;
  }
}

function safeJsonStringify(value, fallback) {
  try {
    return JSON.stringify(value);
  } catch (_err) {
    return arguments.length > 1 ? fallback : "{}";
  }
}

function envelope(type, payload, extra) {
  const message = {
    type,
    requestId: uuid(),
    payload: payload == null ? {} : payload,
  };
  if (extra && typeof extra.tabId === "number") {
    message.tabId = extra.tabId;
  }
  return message;
}
