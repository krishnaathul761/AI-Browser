const form            = document.getElementById("settings-form");
const geminiInput     = document.getElementById("gemini-key");
const geminiHint      = document.getElementById("key-hint");
const groqInput       = document.getElementById("groq-key");
const groqHint        = document.getElementById("groq-hint");
const statusEl        = document.getElementById("status");
const providerStatus  = document.getElementById("provider-status");

// ── Status banner ─────────────────────────────────────────────────────────────

function setStatus(message, kind) {
  if (!message) {
    statusEl.hidden = true;
    statusEl.textContent = "";
    return;
  }
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.className = "status";
  statusEl.classList.toggle("is-ok", kind === "ok");
  statusEl.classList.toggle("is-err", kind === "err");
}

// ── Provider status pill ──────────────────────────────────────────────────────

function updateProviderStatus(settings) {
  const hasGemini  = Boolean(settings.geminiApiKey);
  const hasGroq    = Boolean(settings.groqApiKey);
  const provider   = settings.preferredProvider || "auto";

  let text = "";
  let kind = "ok";

  if (!hasGemini && !hasGroq) {
    text = "⚠ No keys saved — AI features are disabled.";
    kind = "warn";
  } else if (provider === "auto") {
    if (hasGemini && hasGroq) {
      text = "✓ Gemini is active · Groq ready as automatic fallback";
    } else if (hasGemini) {
      text = "✓ Gemini is active · Add Groq key for automatic fallback";
    } else {
      text = "✓ Groq is active (only key saved) · Add Gemini key for YouTube & vision";
    }
  } else if (provider === "gemini") {
    text = hasGemini
      ? "✓ Gemini only mode active"
      : "⚠ Gemini selected but no Gemini key saved";
    kind = hasGemini ? "ok" : "warn";
  } else if (provider === "groq") {
    text = hasGroq
      ? "✓ Groq only mode active (text tasks only)"
      : "⚠ Groq selected but no Groq key saved";
    kind = hasGroq ? "ok" : "warn";
  }

  providerStatus.hidden = !text;
  providerStatus.textContent = text;
  providerStatus.className = "provider-status provider-status--" + kind;
}

// ── Messaging ─────────────────────────────────────────────────────────────────

async function send(type, payload) {
  if (!globalThis.chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
    throw new Error("Load unpacked in Chrome to save settings.");
  }
  const message = envelope(type, payload);
  const response = await chrome.runtime.sendMessage(message);
  if (!response || !response.ok) {
    throw new Error((response && response.error) || "Request failed");
  }
  return response.data;
}

// ── Apply loaded settings to form ─────────────────────────────────────────────

function applySettings(settings) {
  // Never populate password inputs with stored key values.
  geminiInput.value = "";
  geminiInput.placeholder = settings.geminiApiKey
    ? "Key saved — paste a new key to replace it"
    : "Paste key, then Save";
  geminiHint.textContent = settings.geminiApiKey
    ? "Key saved. Leave blank to keep it, or paste a new one to replace it."
    : "Google AI Studio · free tier available";

  groqInput.value = "";
  groqInput.placeholder = settings.groqApiKey
    ? "Key saved — paste a new key to replace it"
    : "Paste key, then Save";
  groqHint.textContent = settings.groqApiKey
    ? "Key saved. Leave blank to keep it, or paste a new one to replace it."
    : "console.groq.com · free tier available";

  // Provider radio
  const provider = settings.preferredProvider || "auto";
  const providerRadio = form.querySelector('input[name="preferredProvider"][value="' + provider + '"]');
  if (providerRadio) providerRadio.checked = true;

  // Language radio
  const language = settings.language === "hinglish" ? "hinglish" : "en";
  const langRadio = form.querySelector('input[name="language"][value="' + language + '"]');
  if (langRadio) langRadio.checked = true;

  updateProviderStatus(settings);
}

// ── Live provider status update as user changes radio ─────────────────────────

form.querySelectorAll('input[name="preferredProvider"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    // Read current saved settings, override provider for the preview.
    send("SETTINGS_GET").then((s) => {
      updateProviderStatus(Object.assign({}, s, { preferredProvider: radio.value }));
    }).catch(() => {});
  });
});

// ── Save ──────────────────────────────────────────────────────────────────────

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const languageInput = form.querySelector('input[name="language"]:checked');
    const providerInput = form.querySelector('input[name="preferredProvider"]:checked');

    const patch = {
      language:          languageInput ? languageInput.value : "en",
      preferredProvider: providerInput ? providerInput.value : "auto",
    };

    // Only include a key when the user typed one.
    const newGemini = geminiInput.value.trim();
    if (newGemini) patch.geminiApiKey = newGemini;

    const newGroq = groqInput.value.trim();
    if (newGroq) patch.groqApiKey = newGroq;

    const saved = await send("SETTINGS_SET", patch);
    applySettings(saved);
    setStatus("Saved.", "ok");
  } catch (err) {
    setStatus(err.message || "Could not save settings.", "err");
  }
});

// ── Load on open ──────────────────────────────────────────────────────────────

send("SETTINGS_GET")
  .then(applySettings)
  .catch((err) => {
    setStatus(err.message || "Could not load settings.", "err");
  });
