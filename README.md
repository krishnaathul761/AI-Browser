# Sahayak (सहायक) — Chrome AI Side-Panel Assistant

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Pure Vanilla JS](https://img.shields.io/badge/Language-Vanilla%20JavaScript-yellow.svg)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Gemini AI](https://img.shields.io/badge/AI-Google%20Gemini-orange.svg)](https://aistudio.google.com/)
[![Groq Fast Fallback](https://img.shields.io/badge/Fallback-Groq%20Cloud-green.svg)](https://console.groq.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)
[![GitHub Profile](https://img.shields.io/badge/Author-krishnaathul761-181717.svg?logo=github)](https://github.com/krishnaathul761)

**Sahayak** (Sanskrit/Hindi for *“Assistant”* or *“Companion”*) is a privacy-first, human-in-the-loop Chrome Extension built on **Manifest V3**. Operating directly within Chrome's Side Panel, Sahayak assists with reading articles, analyzing YouTube videos, answering grounded questions about page content, inspecting cropped screenshots, and executing step-by-step browser errands.

> [!IMPORTANT]
> **Zero Autonomous Mutation:** Sahayak strictly adheres to a human-in-the-loop safety principle. The AI can inspect pages and propose single actions, but **it cannot click, type, or mutate the DOM without explicit user approval for each step**.

---

## 📌 Implementation Progress & Roadmap

| Phase | Milestone | Theme | Description | Status |
|:---:|:---:|:---:|:---|:---:|
| **Phase 1** | Week 1 | **The Eyes** | Readability article summaries, YouTube multimodal video analysis, clickable seeking timestamps, selection explanations, EN/Hinglish instant translation. | **`COMPLETED`** ✅ |
| **Phase 2** | Week 2 | **The Brain** | Grounded page chat, navigation context auto-reset, right-click context menus, screen capture + canvas cropper, visual screenshot Q&A, dark mode. | **`COMPLETED`** ✅ |
| **Phase 3** | Week 3 | **The Hands** | Interactive element scanner, shadow-DOM badges, "Find it for me", approval-based agent loop, dry-run mode, session persistence, 200-item action log, practice pages. | **`COMPLETED`** ✅ |
| **Phase 4** | Week 4 | **Memory & Ship** | User profile memory, reusable skills export/import, packaging, and final production hardening. | *Planned* ⏳ |

---

## ✨ Features Built to Date

### 👁️ Phase 1 — The Eyes (Reading & Comprehension)
- **Article Summarisation:** Extracts core article text using Mozilla Readability, stripping ads, popups, and sidebars. Delivers a 1-sentence TL;DR, 5 bullet points, and an actionable "Next Steps" recommendation.
- **YouTube Video Analysis:** Uses Gemini's native multimodal capabilities to analyze public YouTube videos. Extracts summaries and generates clickable chapter timestamps that jump directly to the target time in the active YouTube tab without opening a new tab.
- **Instant Language Toggle:** Switch between **English** and **Hinglish** instantly. Source summaries are preserved in English so switching back never triggers redundant AI requests.
- **Dual-Provider Architecture:** Primary inference powered by **Google Gemini** (`gemini-2.0-flash-lite` / `gemini-2.0-flash`) with automatic, transparent fallback to **Groq Cloud** (`llama-3.3-70b-versatile`) on rate limits or service disruptions.
- **24-Hour Local Cache:** Article and YouTube summaries are cached in `chrome.storage.local` with LRU eviction to prevent repeated API calls.

### 🧠 Phase 2 — The Brain (Grounded Reasoning & Vision)
- **Grounded Page Chat:** Conversational Q&A restricted exclusively to the content of the current tab. If a fact isn't present in the page text, Sahayak states that it cannot be found.
- **Navigation Awareness:** Chat context and article memory automatically reset upon navigating to a new domain or page.
- **Right-Click Context Menus:** Highlight any text on any webpage → right-click → **Sahayak** → **Explain this**, **Translate**, or **Draft a reply**. Automatically launches the side panel.
- **Screenshot Crop & Ask:** Built-in canvas cropper allowing users to highlight a specific UI element, chart, code block, or diagram, and ask visual questions using Gemini Vision.
- **Adaptive UI:** Supports system dark/light modes with a manual toggle in the side panel header.

### ✋ Phase 3 — The Hands (Interactive Agent & Automation)
- **Interactive Element Scanner:** Automatically detects interactive buttons, links, inputs, selects, and textareas. Numbers them with clean, sequential 1-based badges rendered in an isolated Shadow DOM.
- **"Find It For Me":** Type what you are looking for (e.g. *"login button"*, *"filter under $100"*). Sahayak identifies the matching element and smoothly scrolls to and pulses it on the page without taking any action.
- **Human-in-the-Loop Agent Loop:**
  - The model scans the page and proposes exactly **ONE** action at a time (`click`, `type`, `select`, `scroll`, `done`).
  - The loop pauses in `awaiting_approval`.
  - The user reviews the target badge number, input value, reasoning, and consequential warnings.
  - The action executes **ONLY** when the user clicks **Approve**.
- **Action Controls:**
  - **Approve:** Executes the proposed step and scans for the next step.
  - **Skip:** Bypasses the proposed step and asks the model to re-plan.
  - **Stop:** Halts the errand immediately and removes all badges.
  - **Dry-Run Mode:** Runs through errands by highlighting targets and logging decisions without mutating the underlying webpage.
- **Resilient Persistence:** Errand state and proposals are saved to `chrome.storage.local`. If the background Service Worker goes to sleep or restarts, the side panel seamlessly restores the exact errand proposal upon reopening.
- **Action & History Logging:**
  - **Errand Steps Log:** Live trace of steps taken in the current errand with a one-click **Clear** button.
  - **Persistent Action Log:** Capped 200-entry global history log with timestamps, decisions, and refresh/clear controls.
- **Sensitive Field Safety Barrier:** Strict hardcoded refusal (`SAFETY_REFUSAL`) that blocks automated typing into passwords, OTPs, PINs, and credit card numbers.
- **Built-in Practice Pages:** Local offline test environments located in `pages/practice/`:
  - `internship-form.html`: Multi-step form for testing complex input and navigation.
  - `shop.html`: Practice e-commerce catalog for search and filter testing.
  - `acceptance-gate.html`: Automated test suite verifying schema validation, alias normalization, and security barriers.

---

## 🏗️ Architecture & Topology

Sahayak is built with **zero external frameworks and zero bundlers**—written entirely in modular, modern Vanilla JavaScript for maximum performance, auditability, and minimal extension footprint.

```
AI-Browser/
├── manifest.json            # MV3 Manifest with scripting, tabs, and storage permissions
├── assets/                  # Extension icons (16px, 48px, 128px)
├── background/
│   ├── service-worker.js    # Service worker lifecycle & context menus
│   ├── router.js            # Central dispatcher routing UI & content script messages
│   ├── ai/
│   │   ├── gemini.js        # Gemini API client (text, video, vision) + backoff
│   │   ├── groq.js          # Groq Cloud API client + rate-limit handler
│   │   ├── ai.js            # Unified model router with automatic fallback
│   │   ├── prompts.js       # System prompts with 50-element capping for rate limits
│   │   └── cache.js         # 24h TTL summary cache with LRU eviction
│   └── agent/
│       ├── loop.js          # Human-in-the-loop step loop, dry-run & state machine
│       ├── schema.js        # Strict JSON validation, alias normalizer & sensitive refusal
│       └── persist.js       # Session persistence & 200-entry action log
├── content/
│   ├── extract.js           # Readability DOM extractor & fallback parser
│   ├── scanner.js           # Interactive DOM element scanner & 1-based numbering
│   ├── overlay.js           # Isolated Shadow-DOM numbered badges & element pulsing
│   ├── execute.js           # DOM action executor (click, type, select) with safety checks
│   └── index.js             # Content script message router with duplicate guards
├── sidepanel/
│   ├── index.html           # Sidepanel layout (Summarise, Chat, Agent tabs)
│   ├── panel.js             # UI state machine, approval cards, history renderers
│   └── styles.css           # Premium design tokens, animations, light & dark themes
├── options/
│   ├── index.html           # Dedicated options & API key settings page
│   ├── options.js
│   └── styles.css
├── pages/
│   └── practice/
│       ├── internship-form.html # Multi-step practice form errand
│       ├── shop.html            # Practice e-commerce search & filter errand
│       └── acceptance-gate.html # Interactive unit & contract test suite
├── lib/
│   ├── readability.js       # Mozilla Readability library
│   ├── readability-readerable.js
│   └── utils.js             # UUID generation, message envelope, safe JSON helpers
└── Docs/
    ├── ProblemStatment.md   # Product specifications & requirements
    ├── architecture.md      # Detailed system architecture document
    ├── implementation-plan.md # 4-week phase breakdown & acceptance gates
    └── edge-case.md         # Edge cases & mitigation strategies
```

### Chromium MV3 Isolation Topology

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Chrome Browser Window                           │
│                                                                        │
│  ┌──────────────────────────┐         ┌─────────────────────────────┐  │
│  │     Web Page Tab         │         │     Chrome Side Panel       │  │
│  │                          │         │     (sidepanel/index.html)  │  │
│  │  ┌────────────────────┐  │         │                             │  │
│  │  │ Host Page DOM      │  │         │  - Summarise / Chat / Agent │  │
│  │  └────────────────────┘  │ Messages│  - Errand Goal Input        │  │
│  │  ┌────────────────────┐  │◄───────►│  - Proposal Approval Card   │  │
│  │  │ Isolated Content   │  │         │  - Persistent Action Log    │  │
│  │  │ Script & Overlay   │  │         │  - Options & Dark Mode      │  │
│  │  │ (Shadow DOM)       │  │         └──────────────┬──────────────┘  │
│  └────────────▲─────────────┘                        │                 │
│               │                                      │                 │
│               │ chrome.tabs.sendMessage              │ Messages        │
│               ▼                                      ▼                 │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │             Background Service Worker (background/...)            │  │
│  │                                                                  │  │
│  │  - Router & Dispatcher (router.js)                               │  │
│  │  - Agent Step Loop & State Machine (loop.js)                     │  │
│  │  - Schema Normalizer & Safety Barriers (schema.js)               │  │
│  │  - Session & Action Log Persistence (persist.js)                 │  │
│  │  - Gemini & Groq Unified AI Clients (ai.js, gemini.js, groq.js)  │  │
│  └───────────────────────────────────┬──────────────────────────────┘  │
└──────────────────────────────────────┼─────────────────────────────────┘
                                       │ HTTPS Fetch
                                       ▼
                     ┌───────────────────────────────────┐
                     │ Google Gemini API / Groq Cloud    │
                     └───────────────────────────────────┘
```

---

## 🔒 Safety, Privacy & Security Guardrails

Sahayak treats user privacy and browser security as foundational requirements:

1. **Local Key Storage:** API keys are stored solely in `chrome.storage.local` on your physical machine. They are never transmitted to third-party tracking servers or stored in source code.
2. **Zero Autonomous Action:** The agent loop will never execute a click, text entry, or selection without explicit human approval via the **Approve** button.
3. **Sensitive Field Barrier:** Automated typing into fields identified as passwords, OTPs, PINs, card numbers, or CVVs is prohibited by hardcoded regular expressions and autocomplete flags.
4. **Restricted Domain Gating:** Agent automation and page extraction are completely blocked on internal browser pages (`chrome://`, `about:`, `edge://`) and the Chrome Web Store.
5. **Dry-Run Mode:** Users can preview exactly what elements the model wants to touch by activating Dry-Run mode, which highlights elements and logs actions without modifying page state.
6. **Consequential Action Warnings:** High-stakes actions matching keywords like *Submit*, *Pay*, *Purchase*, *Delete*, or *Checkout* display prominent warning banners on the approval card.

---

## 🚀 Installation & Getting Started

### Prerequisites
- **Google Chrome** (v116+ recommended for Side Panel API support).
- A **[Google Gemini API Key](https://aistudio.google.com)** (Free tier available).
- *(Optional)* A **[Groq Cloud API Key](https://console.groq.com)** for instant fallback during rate limits.

### Setup Instructions

1. **Clone the repository:**
   ```bash
   git clone https://github.com/krishnaathul761/AI-Browser.git
   ```
2. **Open Extensions in Chrome:**
   - Navigate to `chrome://extensions/` in your browser.
   - Toggle **Developer mode** on (top-right corner).
3. **Load Unpacked:**
   - Click **Load unpacked** (top-left).
   - Select the `AI-Browser` folder (the root directory containing `manifest.json`).
4. **Pin Sahayak:**
   - Click the Chrome puzzle-piece icon in the browser toolbar and pin **Sahayak**.
5. **Add Your API Key:**
   - Click the Sahayak icon or open the Chrome Side Panel.
   - Click the ⚙ icon in the top right to open **Settings**.
   - Paste your Gemini API key (and optionally Groq key) and click **Save settings**.

---

## 🧪 Testing with Practice Pages

Sahayak includes dedicated, self-contained practice pages to safely test features without affecting real-world accounts:

1. In the Sahayak side panel, switch to the **Agent** tab.
2. Under the Errand form, click any of the practice links:
   - **[Internship Form](pages/practice/internship-form.html):** Multi-step registration form. Test entering details like name, email, college, selecting dropdowns, and advancing steps.
   - **[Shop](pages/practice/shop.html):** E-commerce catalog. Test searching for items (e.g. *"Search headphones"*) and toggling filters.
   - **[Acceptance Gate](pages/practice/acceptance-gate.html):** Automated test suite running unit checks for markdown fence stripping, alias normalization, sensitive field barriers, element resolution, and 200-log FIFO capping.

---

## 👨‍💻 Author & Maintainer

Developed by **[Athul Krishna](https://github.com/krishnaathul761)**.

- **GitHub:** [@krishnaathul761](https://github.com/krishnaathul761)
- **Repository:** [krishnaathul761/AI-Browser](https://github.com/krishnaathul761/AI-Browser)

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
