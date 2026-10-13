# Sahayak

**Sahayak** is a Chrome side-panel AI assistant that understands the page you are on and helps you act on it **safely**. It reads articles and videos, chats with page context, explains or drafts from selected text, answers questions about what is visible on screen, and proposes **one browser action at a time**—only after you approve each step.

You stay in control. Sahayak is not a fully autonomous browser bot.

---

## What Sahayak Can Do

| Capability | Description |
|------------|-------------|
| **Summarise** | Articles (via Readability) and supported **public** YouTube links, with structured output (TL;DR, key points, next steps) |
| **Language** | Switch responses between **English** and **Hinglish** |
| **Page chat** | Ask follow-ups grounded in the current page; admits when the answer is not on the page |
| **Quick actions** | Right-click selected text: **Explain**, **Translate**, **Draft a reply** |
| **Screenshot Q&A** | Capture the visible tab and ask about charts, errors, forms, and other non-text UI |
| **Find it for me** | Natural-language navigation hints with numbered highlights (no auto-click) |
| **Agent loop** | Detect buttons, links, inputs, dropdowns, checkboxes; propose actions as strict JSON; **Approve / Skip / Stop** |
| **Local memory** | Profile and one-click **skills** stored only on your device (`chrome.storage.local`) |
| **Safety** | Code-enforced blocks on sensitive pages and fields; extra confirmation for consequential actions |

---

## Target Platform & Stack

- **Browser:** Google Chrome (desktop), Manifest V3, Side Panel API  
- **Interaction:** Content scripts, `chrome.scripting`, `chrome.tabs.captureVisibleTab`, context menus  
- **Storage:** `chrome.storage.local` for settings, profile, skills, and agent progress  
- **AI (free-tier friendly):** Gemini Flash-Lite (default), Gemini Flash (harder vision/reasoning), Groq text fallback where appropriate; Gemini for supported public YouTube URLs  
- **Article extraction:** [Mozilla Readability.js](https://github.com/mozilla/readability)  
- **Distribution:** GitHub repo, [Releases](https://github.com/) (installable ZIP), GitHub Pages landing page  

---

## Prerequisites

1. **Google Chrome** (desktop)  
2. A **Gemini API key** (enter in extension settings—never commit keys to the repo)  
3. Optional: **Groq API key** for text-only fallback when rate limits hit  

---

## Installation (Load Unpacked)

### From source (development)

1. Clone this repository:
   ```bash
   git clone https://github.com/YOUR_ORG/sahayak.git
   cd sahayak
   ```
2. Open Chrome → **Extensions** → enable **Developer mode**.  
3. Click **Load unpacked** and select the extension root folder (where `manifest.json` lives).  
4. Pin the extension if desired; open **Sahayak** from the toolbar or side panel entry point.  

### From a release

1. Download the latest **`sahayak-extension.zip`** from [GitHub Releases](https://github.com/YOUR_ORG/sahayak/releases).  
2. Unzip to a folder on your machine.  
3. Follow steps 2–4 above, selecting the unzipped folder.  

---

## First-Time Setup

1. Open **Sahayak Settings** (from the side panel or extension options).  
2. Paste your **Gemini API key** and save.  
3. Choose default language: **English** or **Hinglish**.  
4. Optionally add a **Groq** key for fallback and fill your **local profile** (name, college, skills, links, tone) for forms and drafts.  

> **Privacy:** API keys and profile data stay on your device. Do not send banking, payment, or other sensitive pages to free-tier models.

---

## Usage Overview

### Summarise an article or YouTube video

1. Open a normal article or a **supported public** YouTube URL.  
2. Open the Sahayak side panel → **Summarise**.  
3. Review TL;DR, five key points, and suggested next steps. Toggle **English / Hinglish** as needed.  

### Chat with the current page

1. Open the side panel **Chat** tab.  
2. Ask questions about content on the active tab.  
3. If the page does not contain the answer, Sahayak will say so.  

### Selected text (context menu)

1. Select text on the page → right-click → **Sahayak** → **Explain**, **Translate**, or **Draft a reply**.  
2. Results appear in the side panel.  

### Screenshot and ask

1. Use **Capture & ask** in the panel (optionally crop/focus the region of interest).  
2. Ask about visible UI, charts, or error messages.  

### Browser tasks (with approval)

1. Describe a task (e.g. fill a practice form, apply shop filters).  
2. Sahayak builds a **numbered action map** on interactive elements.  
3. For each step, review the proposed action (type, target #, value, reason).  
4. Choose **Approve**, **Skip**, or **Stop**. Only approved steps run.  
5. Use **Dry run** to highlight targets without acting. Review the **action log** when done.  

### One-click skills

Save prompt recipes (e.g. exam notes, polite email reply, fill form from profile). **Export** and **import** skills as a small local file to share or back up.  

---

## Four-Week Build Plan (Roadmap)

| Week | Theme | Focus |
|------|--------|--------|
| **1** | The Eyes | Extension shell, side panel, settings, explain selection, article + YouTube summary, English/Hinglish |
| **2** | The Brain | Grounded page chat, context-menu actions, screenshot Q&A, rate-limit handling and fallbacks |
| **3** | The Hands | Element scanner, action map, find-it, approval-based agent loop, logs, persistence, practice tasks |
| **4** | Ship | Local profile, skills import/export, safety rails, README, release ZIP, GitHub Pages |

Recommended implementation order in the repo: extension shell → Gemini text → Readability summary → YouTube → language toggle → page chat → context menus → screenshot → API resilience → scanner → agent loop → profile/skills → safety → packaging.

---

## Functional Requirements (Summary)

- **FR-1:** Primary UI in Chrome side panel  
- **FR-2:** Settings for API keys and preferences  
- **FR-3–4:** Article extraction and structured summarisation (English/Hinglish)  
- **FR-5:** Page chat grounded in current tab content  
- **FR-6:** Visual understanding via tab capture  
- **FR-7–8:** Agent decisions as strict JSON; **human approval** before every action  
- **FR-9:** Local profile and skills in Chrome storage  
- **FR-10:** Safety rules enforced in **extension code**, not prompts alone  

---

## Safety

Sahayak applies deterministic safety rules:

- **Block** agent actions on banking, payment, and UPI pages  
- **Never type** into password, OTP, or card fields  
- **Extra confirmation** before Submit, Pay, Send, and similar consequential controls  
- **Stop / kill switch** always visible during agent tasks  
- **No** login, payment, or OTP automation  
- Restrict risky agent errands to **practice environments** or pages you own/control  
- Do not send private or sensitive pages to external free-tier APIs  

---

## Out of Scope (Core Build)

- Mobile Chrome  
- Autonomous execution without approval  
- Banking/payment/login/OTP automation  
- Chrome Web Store listing (GitHub release + Load unpacked is sufficient)  
- Private or unsupported YouTube content  

---

## Definition of Done

A new user can install from a release, add their API key, open the side panel, and:

1. Summarise an article or supported public YouTube link  
2. Switch English / Hinglish  
3. Chat with the page  
4. Use Explain, Translate, Draft from selection  
5. Ask about a screenshot  
6. Find a relevant interactive element  
7. Run a supported browser task with per-step approval  
8. Stop or skip steps and review the action log  
9. Reuse profile and saved skills  
10. Confirm sensitive pages, fields, and actions are blocked  

---

## Development

- **Editor:** [Cursor](https://cursor.com) (recommended)  
- **Test:** Load unpacked after each vertical slice; test on real articles, YouTube, and practice forms  
- **Secrets:** Use `.env.example` or documented placeholders only; add real keys via settings, never in git  

### Project structure (expected)

```
sahayak/
├── manifest.json
├── background/          # service worker
├── sidepanel/           # side panel UI
├── content/             # content scripts (extraction, scanner, badges)
├── options/             # settings page
├── lib/                 # Readability, API clients, safety
└── assets/
```

*(Layout may evolve; `manifest.json` remains the load root.)*

---

## Screenshots

_Add screenshots here after Week 4: side panel, summary, action map with badges, approval UI, settings._

---

## License

_Specify license (e.g. MIT) before public release._

---

## Acknowledgments

Built for a user-controlled browser assistant: read, explain, see, remember, and act—with you approving every consequential step.
