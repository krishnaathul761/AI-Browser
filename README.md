# Sahayak — Chrome AI Side-Panel Assistant

Sahayak is a Chrome extension (Manifest V3) that lives in the browser's side panel and acts as an intelligent reading and browsing assistant. It reads articles and YouTube videos, explains selected text, and — in later phases — chats with page content, takes browser actions, and remembers your profile. **Every browser action requires your explicit approval. Nothing runs autonomously.**

---

## What's built (Phase 1 — Week 1)

| Feature | Status |
|---|---|
| Chrome side panel shell + settings | ✅ |
| Gemini API key storage (never in source) | ✅ |
| Groq API key storage + fallback | ✅ |
| Article summarisation via Mozilla Readability | ✅ |
| Structured summary — TL;DR, 5 key points, next steps | ✅ |
| Public YouTube video summarisation (Gemini multimodal) | ✅ |
| Clickable timestamp / chapter links for YouTube | ✅ |
| Explain selected text | ✅ |
| English / Hinglish language toggle | ✅ |
| Auto / Gemini-only / Groq-only provider selector | ✅ |
| Automatic Groq fallback on Gemini rate limits | ✅ |

---

## Roadmap

| Week | Theme | Covers |
|---|---|---|
| **1 ✅** | The Eyes | Shell, summarise, explain, YouTube, language |
| **2** | The Brain | Page chat, context menus, screenshot Q&A, resilience |
| **3** | The Hands | Element scanner, find-it, approval-based agent loop, logs |
| **4** | Ship | Profile memory, skills import/export, safety rails, release ZIP |

---

## Installation (Load Unpacked)

**Requirements:** Google Chrome desktop, a [Gemini API key](https://aistudio.google.com) (free tier works), and optionally a [Groq API key](https://console.groq.com) for fallback.

1. Download or clone this repository
2. Open Chrome → `chrome://extensions` → enable **Developer mode**
3. Click **Load unpacked** → select the `AI-Browser` folder (the one containing `manifest.json`)
4. Pin Sahayak from the toolbar puzzle-piece icon
5. Click the Sahayak icon → side panel opens → click **Settings** → paste your Gemini API key → Save

> **Note:** After loading, reload any tabs you want to use Sahayak on — content scripts only inject into tabs opened after the extension loads.

---

## API Keys

Keys are stored exclusively in `chrome.storage.local` on your device. They are never committed to this repository and never sent anywhere except the respective AI provider's API endpoint from the Chrome service worker.

| Key | Where to get it | Required |
|---|---|---|
| Gemini | [aistudio.google.com](https://aistudio.google.com) → Get API key | For YouTube & vision |
| Groq | [console.groq.com](https://console.groq.com) → API Keys | Optional fallback |

---

## Provider modes

Open **Settings** in the panel to choose:

- **Auto** — Gemini runs first; Groq takes over automatically if Gemini is rate-limited or unavailable
- **Gemini only** — always use Gemini (required for YouTube summaries and screenshots)
- **Groq only** — always use Groq (text tasks only, faster on the free tier)

YouTube summarisation always requires a Gemini key regardless of provider mode — Groq cannot process video URLs.

---

## Usage

### Summarise an article
Open any article or news page → open the Sahayak panel → click **Summarise this page**.
Output: one-line TL;DR, five key points, and a "what to do next" suggestion.

### Summarise a YouTube video
Open a public YouTube video → open the panel → click **Summarise this page**.
Output: TL;DR, key points, clickable chapter timestamps (when available).

### Explain selected text
Highlight any text on a page → click **Explain selection** in the panel.

### Switch language
Click **EN** or **Hinglish** in the panel header. All AI responses switch immediately and the preference is saved.

---

## Permissions

| Permission | Why |
|---|---|
| `sidePanel` | Render the Sahayak UI in Chrome's side panel |
| `storage` | Save API keys and preferences on-device |
| `tabs`, `activeTab` | Read the current tab's URL to detect YouTube, route summaries |
| `scripting` | Inject content scripts for article extraction |
| `https://generativelanguage.googleapis.com/*` | Gemini API calls (service worker only) |
| `https://api.groq.com/*` | Groq API calls (service worker only) |

API calls are made exclusively from the background service worker — keys are never exposed to page content or the side panel DOM.

---

## Project structure

```
AI-Browser/
├── manifest.json
├── assets/                  # Extension icons (16, 48, 128 px)
├── background/
│   ├── service-worker.js    # Event wiring
│   ├── router.js            # Message router + handlers
│   └── ai/
│       ├── gemini.js        # Gemini API client
│       ├── groq.js          # Groq API client
│       ├── ai.js            # Unified dispatcher + fallback logic
│       └── prompts.js       # Prompt templates + model IDs
├── content/
│   ├── extract.js           # Readability wrapper + DOM helpers
│   └── index.js             # Content script message listener
├── lib/
│   ├── readability.js       # Vendored Mozilla Readability 0.6.0
│   ├── readability-readerable.js
│   └── utils.js             # uuid(), safeJson*, envelope()
├── sidepanel/
│   ├── index.html
│   ├── panel.js
│   └── styles.css
├── options/
│   ├── index.html           # Settings page
│   ├── options.js
│   └── styles.css
└── Docs/
    ├── ProblemStatment.md
    ├── architecture.md
    ├── implementation-plan.md
    └── edge-case.md
```

---

## Safety

- API keys live in `chrome.storage.local` only — never in source, never in prompts
- All AI fetch calls run from the service worker, not the page
- Restricted pages (`chrome://`, Web Store) are blocked from extraction and AI calls
- Phase 3 will add full safety rails: payment page blocks, password/OTP field protection, extra confirmation on consequential actions

---

## Tech stack

- **Runtime:** Chrome MV3, Side Panel API, content scripts
- **AI:** Gemini 2.5 Flash-Lite (text), Gemini 2.5 Flash (YouTube/vision), Groq Llama 3.1 8B (text fallback)
- **Extraction:** Mozilla Readability.js 0.6.0
- **Language:** Vanilla JS — no bundler, no framework

---

## License

MIT
