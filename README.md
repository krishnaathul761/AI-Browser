# Sahayak — Chrome AI Side-Panel Assistant

Sahayak is a Chrome extension (Manifest V3) that lives in the browser's side panel and acts as an intelligent reading and browsing assistant. It reads articles and YouTube videos, explains selected text, chats with page content, analyses screenshots, and — in later phases — takes browser actions and remembers your profile. **Every browser action requires your explicit approval. Nothing runs autonomously.**

---

## What's built (Phases 1, 2, & 3 — Weeks 1, 2, & 3)

| Feature | Status |
|---|---|
| Chrome side panel shell + settings | ✅ |
| Gemini API key storage (never in source) | ✅ |
| Groq API key storage + automatic fallback | ✅ |
| Article summarisation via Mozilla Readability | ✅ |
| Structured summary — TL;DR, 5 key points, next steps | ✅ |
| Public YouTube video summarisation (Gemini multimodal) | ✅ |
| Clickable chapter timestamps — seeks existing tab, no new tab | ✅ |
| Explain selected text | ✅ |
| English / Hinglish language toggle (instant EN restore, no extra API call) | ✅ |
| Auto / Gemini-only / Groq-only provider selector | ✅ |
| Gemini-first routing with automatic Groq text fallback | ✅ |
| Retry / backoff with Retry-After support (both providers) | ✅ |
| Helpful rate-limit errors with actual wait time shown | ✅ |
| Grounded page chat (answers only from current page) | ✅ |
| Chat context reset on page navigation | ✅ |
| Right-click → Explain / Translate / Draft a reply | ✅ |
| Screenshot capture + canvas crop with enlarged preview | ✅ |
| Screenshot Q&A via Gemini Flash vision | ✅ |
| Dark mode (system default + manual toggle) | ✅ |
| Summary cache always stored in English | ✅ |
| Interactive element scanner with numbered shadow-DOM badges | ✅ |
| "Find it for me" element identification + pulse highlight | ✅ |
| Strict schema validation, alias normalization & fence stripping | ✅ |
| Human-in-the-loop agent loop (zero action without explicit Approve) | ✅ |
| Step controls: Approve, Skip, Stop, max step limit | ✅ |
| Dry-run simulation mode (highlights target without mutating DOM) | ✅ |
| Session persistence across service worker sleep & termination | ✅ |
| Persistent action log (capped at 200 items in `chrome.storage.local`) | ✅ |
| Clear errand steps history & session reset | ✅ |
| Strict safety refusal on sensitive fields (passwords, PINs, card info) | ✅ |
| Practice pages & automated Acceptance Gate test suite | ✅ |

---

## Roadmap

| Week | Theme | Status |
|---|---|---|
| **1 ✅** | The Eyes | Shell, summarise, explain, YouTube, language toggle |
| **2 ✅** | The Brain | Page chat, context menus, screenshot Q&A, rate-limit resilience, UI polish |
| **3 ✅** | The Hands | Element scanner, find-it, approval-based agent loop, dry-run, action log, practice pages |
| **4** | Ship | Profile memory, skills import/export, safety rails, release ZIP |

---

## Installation (Load Unpacked)

**Requirements:** Google Chrome desktop, a [Gemini API key](https://aistudio.google.com) (free tier works), and optionally a [Groq API key](https://console.groq.com) for automatic fallback.

1. Download or clone this repository
2. Open Chrome → `chrome://extensions` → enable **Developer mode**
3. Click **Load unpacked** → select the `AI-Browser` folder (the one containing `manifest.json`)
4. Pin Sahayak from the toolbar puzzle-piece icon
5. Click the ⚙ settings icon in the panel → paste your Gemini API key → Save

> **Note:** After loading, reload any tabs you want to use Sahayak on — content scripts only inject into tabs opened after the extension loads.

---

## API Keys

Keys are stored exclusively in `chrome.storage.local` on your device. They are never committed to this repository and never sent anywhere except the respective AI provider's API endpoint from the Chrome service worker.

| Key | Where to get it | Required for |
|---|---|---|
| Gemini | [aistudio.google.com](https://aistudio.google.com) → Get API key | Everything (YouTube, vision, text) |
| Groq | [console.groq.com](https://console.groq.com) → API Keys | Optional text fallback |

---

## Provider modes

Open **Settings** (⚙ icon in panel header) to choose:

- **Auto** — Gemini runs first; Groq takes over automatically on 429 / rate limits (text tasks only)
- **Gemini only** — always use Gemini
- **Groq only** — text tasks only; YouTube uses text-only summary, vision unavailable

YouTube summarisation and screenshot Q&A always use Gemini — Groq cannot process video or image data.

---

## Usage

### Summarise an article
Open any article → open the Sahayak panel → click **Summarise this page**.
Output: one-line TL;DR, five key points, and a "what to do next" suggestion.

### Summarise a YouTube video
Open a public YouTube video → open the panel → click **Summarise this page**.
Output: TL;DR, key points, clickable chapter timestamps. Clicking a timestamp seeks the existing YouTube tab — no new tab opened.

### Explain selected text
Highlight any text on a page → click **Explain selection** in the panel.

### Right-click actions
Select text on any page → right-click → **Sahayak** → **Explain this** / **Translate** / **Draft a reply**.
The panel opens automatically if it was closed.

### Chat with the page
Switch to the **Chat** tab → ask any question about the current page.
Answers are grounded in page content only. If the answer isn't on the page, Sahayak says so.
Navigating to a new page resets context automatically.

### Screenshot & Ask
**Summarise** tab → **Capture screen** → drag to crop a region (enlarged preview shown) → type a question → send.
Uses Gemini Flash vision. Groq cannot be used as a fallback for vision tasks.

### Switch language
Click **EN** or **Hinglish** in the panel header. Summaries translate in place from the stored English source — switching back to EN is instant with no API call.

### Dark mode
Click the ☀/🌙 icon in the panel header. Defaults to your system theme.

---

## Permissions

| Permission | Why |
|---|---|
| `sidePanel` | Render the Sahayak UI in Chrome's side panel |
| `storage` | Save API keys, preferences, and summary cache on-device |
| `tabs`, `activeTab` | Read the current tab's URL; seek YouTube tabs on timestamp click |
| `scripting` | Inject content scripts for article extraction |
| `contextMenus` | Add Explain / Translate / Draft to the right-click menu |
| `windows` | Find the correct browser window for screenshot capture |
| `<all_urls>` | Required for `captureVisibleTab` from the side panel context |
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
│   ├── service-worker.js    # Event wiring, context menus
│   ├── router.js            # Message router + all handlers
│   ├── ai/
│   │   ├── gemini.js        # Gemini API client (text, video, vision) + retry/backoff
│   │   ├── groq.js          # Groq API client + retry/backoff
│   │   ├── ai.js            # Unified dispatcher + Gemini-first fallback logic
│   │   ├── prompts.js       # Prompt templates + model IDs
│   │   └── cache.js         # Summary cache (chrome.storage.local, 24h TTL)
│   └── agent/
│       ├── loop.js          # Human-in-the-loop agent step loop & dry-run
│       ├── schema.js        # Strict JSON schema validation & alias normalization
│       └── persist.js       # Session persistence & capped 200 action log
├── content/
│   ├── extract.js           # Readability wrapper + DOM helpers
│   ├── scanner.js           # Interactive element scanner & numbering
│   ├── overlay.js           # Shadow-DOM numbered badges & element pulse
│   ├── execute.js           # DOM action executor with safety guards
│   └── index.js             # Content script message listener
├── pages/
│   └── practice/
│       ├── internship-form.html # Multi-step practice form errand
│       ├── shop.html            # Practice e-commerce search & filter errand
│       └── acceptance-gate.html # Interactive unit & contract test suite
├── lib/
│   ├── readability.js       # Vendored Mozilla Readability
│   ├── readability-readerable.js
│   └── utils.js             # uuid(), envelope(), safe JSON
├── sidepanel/
│   ├── index.html           # Sidepanel tabs: Summarise, Chat, Agent
│   ├── panel.js             # Panel UI logic, errand approval, history
│   └── styles.css           # Light + dark mode styles
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

## Safety & Human-in-the-Loop Architecture

- **Approval-first**: Every DOM interaction (click, type, select) MUST be explicitly approved by the human user. No action executes autonomously.
- **Dry-run mode**: Simulate errands with highlighting only — zero DOM changes.
- **Sensitive field protection**: Passwords, OTPs, PINs, card numbers, and CVVs are strictly forbidden from automated typing (`SAFETY_REFUSAL`).
- **Restricted pages**: `chrome://`, Chrome Web Store, payment endpoints, and banking URLs block agent automation.
- **Local storage**: API keys and logs live in `chrome.storage.local` on-device only.
- **Service worker resilience**: Errand state survives service worker sleep and wakes seamlessly upon panel reopen.

---

## Tech stack

- **Runtime:** Chrome MV3, Side Panel API, content scripts
- **AI:** Gemini 3.5 Flash-Lite (text), Gemini 3.8 Flash (YouTube / vision), Groq (text fallback)
- **Extraction:** Mozilla Readability.js
- **Language:** Vanilla JS — no bundler, no framework

---

## License

MIT
