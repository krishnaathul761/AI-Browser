# Sahayak Architecture

This document is the technical blueprint for building Sahayak from [ProblemStatment.md](./ProblemStatment.md). It describes **how** the extension is structured so implementers can ship vertical slices without redesigning the core each week.

Sahayak is a **user-controlled Chrome side-panel agent**: it reads the current tab, reasons about text and visible UI, proposes **one** browser action at a time, and executes **only after explicit approval**. Safety rules live in extension code, not only in model prompts.

---

## 1. Design principles

| Principle | Implication |
|-----------|-------------|
| Human in the loop | No click/type/select/scroll until Approve (or extra confirm for consequential actions). |
| Grounded answers | Page chat and summaries use extracted page (or screenshot) context; inventing facts is forbidden. |
| Deterministic safety | URL/field/action blocks run in code **before** any model call or DOM mutation. |
| Local-first secrets | API keys and profile stay in `chrome.storage.local`; never in source or GitHub. |
| Cheap by default | Gemini Flash-Lite for everyday text; Flash only for vision/hard reasoning; Groq as text fallback. |
| Survive SW sleep | Agent progress, pending approval, and action log persist in storage so the service worker can die. |
| Strict JSON for actions | Models may draft text freely; **agent decisions** are parsed, validated, then executed by app code. |

---

## 2. System context

```
┌─────────────────────────────────────────────────────────────────┐
│                         User (Chrome desktop)                    │
│  Webpage tab  │  Side panel (Sahayak UI)  │  Options / Settings  │
└───────┬───────────────────────┬───────────────────────┬─────────┘
        │ content script        │ chrome.runtime        │ storage
        ▼                       ▼                       ▼
┌───────────────────┐   ┌───────────────────┐   ┌─────────────────┐
│ Content world     │   │ Background SW     │   │ chrome.storage  │
│ - Readability     │◄─►│ - Message router  │◄─►│ - keys          │
│ - Element scanner │   │ - Safety gate     │   │ - profile       │
│ - Badges / HL     │   │ - Agent session   │   │ - skills        │
│ - Action execute  │   │ - AI orchestrator │   │ - agent state   │
│ - Selection       │   │ - Tab capture     │   │ - prefs         │
└───────────────────┘   └─────────┬─────────┘   └─────────────────┘
                                  │ HTTPS (user key)
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
              Gemini Flash-Lite   Gemini Flash   Groq (text)
              + YouTube URL       (vision /     fallback
                summarisation     hard tasks)
```

**External systems:** Gemini API (text, vision, public YouTube URL), optional Groq, GitHub (source, Releases ZIP, Pages). No backend of our own in the core build.

---

## 3. Chrome MV3 component map

### 3.1 Manifest (extension contract)

`manifest.json` (MV3) should declare, at minimum:

| Area | APIs / entries |
|------|----------------|
| UI | `side_panel`, `action` (open side panel), `options_page` or `options_ui` |
| Background | `background.service_worker` |
| Content | scripts matching `http(s)://*/*` (exclude chrome://, extension pages) |
| Permissions | `sidePanel`, `storage`, `activeTab`/`tabs`, `scripting`, `contextMenus` |
| Host permissions | Gemini + Groq origins needed for `fetch` from the service worker |
| Web accessible | badge CSS/fonts if injected into pages |

Keep host permissions **narrow** (API hosts + `<all_urls>` only if required for content scripts and `captureVisibleTab`). Document why each permission exists in README.

### 3.2 Four runtimes

| Runtime | Lifetime | Owns |
|---------|----------|------|
| **Service worker** | Ephemeral; can sleep | Message hub, AI HTTP, context menus, tab capture, agent persistence, safety pre-checks |
| **Side panel** | Tied to the user’s panel session | Chat UI, summaries, approval cards, action log, language toggle, skills, screenshot crop UI |
| **Content script** | Per tab/frame (main frame first) | DOM extract, scanner, numbered badges, highlight, execute approved actions, selection capture |
| **Options page** | On demand | Gemini/Groq keys, language, tone, dry-run default, practice-mode flag |

The **service worker must not** hold the only copy of agent state. Persist after every step.

### 3.3 Message protocol

All cross-context communication uses `chrome.runtime.sendMessage` / `tabs.sendMessage` with a **typed envelope**:

```json
{
  "type": "PAGE_EXTRACT_REQUEST",
  "requestId": "uuid",
  "tabId": 123,
  "payload": {}
}
```

**Convention:** `type` is `NOUN_VERB` in `SCREAMING_SNAKE`. Every response is `{ ok, requestId, data?, error? }`. Unknown types are ignored, never thrown uncaught.

#### Side panel → background

| `type` | Purpose |
|--------|---------|
| `SETTINGS_GET` / `SETTINGS_SET` | Keys and prefs |
| `PAGE_CONTEXT_GET` | Extract article + metadata for active tab |
| `SUMMARY_ARTICLE` | Structured summary |
| `SUMMARY_YOUTUBE` | Public YouTube summary |
| `CHAT_SEND` | Grounded page chat (streaming via ports if used) |
| `SELECTION_ACTION` | Explain / translate / draft |
| `SCREENSHOT_CAPTURE` | Visible tab PNG |
| `SCREENSHOT_ASK` | Vision Q&A (optional cropped data URL) |
| `FIND_ELEMENT` | Natural language → numbered target (JSON) |
| `AGENT_START` / `AGENT_APPROVE` / `AGENT_SKIP` / `AGENT_STOP` | Agent loop control |
| `AGENT_STATE_GET` | Restore UI after SW sleep |
| `SKILLS_*` / `PROFILE_*` | Local memory CRUD |
| `BADGES_TOGGLE` | Show/hide numbered overlays |

#### Background → content

| `type` | Purpose |
|--------|---------|
| `EXTRACT_ARTICLE` | Run Readability + title/url |
| `GET_SELECTION` | Current selection text |
| `SCAN_INTERACTIVE` | Build action map + optional badges |
| `HIGHLIGHT_ELEMENT` | Find-it / dry-run highlight |
| `EXECUTE_ACTION` | click / type / select / scroll after approval |
| `CLEAR_OVERLAYS` | Remove badges |

#### Background → side panel

| `type` | Purpose |
|--------|---------|
| `CONTEXT_MENU_RESULT` | Open panel with explain/translate/draft payload |
| `AGENT_PROPOSAL` | Next step JSON + human-readable reason |
| `STREAM_CHUNK` / `STREAM_DONE` | Chat/summary streaming |
| `ERROR_USER` | Friendly error (429, blocked page, etc.) |

Use a **long-lived `chrome.runtime.connect` port** named `sahayak-stream` for token streaming so the panel does not miss chunks if a one-shot message races SW sleep.

---

## 4. Repository layout

Build in this tree so week-1 files stay stable as later weeks land:

```
AI-Browser/
├── Docs/
│   ├── ProblemStatment.md
│   └── architecture.md
├── README.md
├── LICENSE
├── .gitignore                 # keys, node_modules, dist zips with secrets
├── manifest.json
├── background/
│   ├── service-worker.js      # event wiring only
│   ├── router.js              # message switch
│   ├── ai/
│   │   ├── gemini.js
│   │   ├── groq.js
│   │   ├── router.js          # model selection + 429 retry
│   │   └── prompts.js
│   ├── agent/
│   │   ├── loop.js
│   │   ├── schema.js          # JSON parse + Zod/manual validate
│   │   └── persist.js
│   └── safety/
│       ├── pages.js           # URL/host blocklists
│       ├── fields.js
│       └── actions.js         # consequential extra-confirm
├── content/
│   ├── index.js               # message listener
│   ├── extract.js             # Readability wrapper
│   ├── scanner.js             # interactive map
│   ├── overlay.js             # numbered badges + highlight
│   └── execute.js             # DOM actions
├── sidepanel/
│   ├── index.html
│   ├── panel.js
│   ├── styles.css
│   └── views/                 # chat, summary, agent, skills
├── options/
│   ├── index.html
│   └── options.js
├── lib/
│   ├── readability.js         # vendored Mozilla Readability
│   └── utils.js
├── assets/                    # icons
├── pages/                     # GitHub Pages landing (week 4)
└── scripts/
    └── package-release.sh     # zip without .git / Docs secrets
```

**Vanilla JS first** (no bundler required for Load unpacked). Add a bundler later only if needed. Keep the side panel a small SPA with hash or tab state, not a separate framework unless it clearly speeds week 2–3.

---

## 5. Data architecture

### 5.1 `chrome.storage.local` keys

| Key | Shape | Notes |
|-----|--------|--------|
| `settings` | `{ geminiApiKey, groqApiKey, language: "en"\|"hinglish", translateTarget, dryRunDefault, maxAgentSteps }` | Keys never logged |
| `profile` | `{ name, college, skills, links, preferredLanguage, preferredTone }` | User-editable; injected into drafts/forms when relevant |
| `skills` | `Skill[]` | `{ id, name, prompt, createdAt }` |
| `agentSession` | See §7.4 | Survives SW sleep |
| `actionLog` | `LogEntry[]` | Cap length (e.g. last 200) |
| `chatByTab` | `{ [tabId]: { messages, pageUrl, pageHash } }` | Drop if URL changes |

Do **not** store screenshots long-term. Keep crop data URLs in memory in the panel until the ask completes.

### 5.2 Page context snapshot

Produced by the content script, consumed by AI and agent:

```ts
type PageContext = {
  url: string;
  title: string;
  isYouTube: boolean;
  article?: { title: string; byline?: string; text: string; excerpt?: string };
  selection?: string;
  safety: { blocked: boolean; reason?: string; category?: string };
  actionMap?: ActionElement[];
  capturedAt: number;
};

type ActionElement = {
  n: number;                 // 1-based, stable for this scan
  tag: string;
  role?: string;
  type?: string;             // input type
  name?: string;
  id?: string;
  text: string;              // visible label, truncated
  placeholder?: string;
  href?: string;
  checked?: boolean;
  disabled?: boolean;
  sensitive: boolean;        // password/otp/card → never type
  consequential: boolean;    // submit/pay/send
};
```

Truncation: article text ~12–20k chars; each element `text` ~80 chars; map max ~80–120 elements (prefer visible viewport + important forms).

### 5.3 Agent action JSON (strict)

The model must return **only** JSON matching this schema. Invalid JSON → user-visible error, no DOM action.

```ts
type AgentAction =
  | { action: "click";  n: number; reason: string }
  | { action: "type";   n: number; value: string; reason: string }
  | { action: "select"; n: number; value: string; reason: string }
  | { action: "scroll"; direction: "up" | "down"; reason: string }
  | { action: "done";   reason: string };

type FindElementResult = {
  n: number;
  reason: string;
  confidence: "high" | "medium" | "low";
};
```

Validation in `background/agent/schema.js`:

1. `JSON.parse` (strip markdown fences if the model wraps them).
2. `action` ∈ allowed set.
3. `n` integer in current map range when required.
4. `value` string length capped; reject if target `sensitive`.
5. `reason` required, non-empty, max ~200 chars.

---

## 6. AI orchestration

### 6.1 Model router

```
task
  ├─ vision (screenshot)              → Gemini Flash
  ├─ public YouTube URL summary       → Gemini (YouTube-capable Flash / Flash-Lite per current API)
  ├─ agent next-step JSON             → Gemini Flash-Lite; escalate Flash if parse fails once
  ├─ find-element JSON                → Gemini Flash-Lite
  ├─ article summary / page chat      → Gemini Flash-Lite
  ├─ explain / translate / draft      → Gemini Flash-Lite
  └─ any of the above text tasks
        on 429 / quota / outage       → wait+retry, then Groq text fallback
                                           (never send images to Groq)
```

**Default everyday model:** Gemini Flash-Lite.  
**Stronger model:** Gemini Flash for images and failed structured reasoning.  
**Fallback:** Groq free tier, **text-only**.

### 6.2 Retry and errors

1. Detect HTTP **429** and retryable 5xx.
2. Exponential backoff (e.g. 1s, 2s, 4s) with jitter; max 2–3 retries.
3. Switch to lighter model if already on Flash and the task allows it.
4. Switch to Groq for eligible text tasks.
5. Surface a **non-crashing** panel error: “Rate limited—try again in a minute” / “Key missing” / “This page is blocked for privacy.”
6. Never leave the agent in “executing” if the SW dies; persist `awaiting_approval` or `idle`.

### 6.3 Prompt contracts (high level)

Store templates in `prompts.js`. Always inject:

- Output language: English or Hinglish (`settings.language`).
- Grounding: “Use only the provided page context. If missing, say so.”
- For agent: “Return a single JSON object. No extra keys. One action.”
- Profile snippets **only** when the skill/task is fill-form or draft-reply.

**Never** put API keys in prompts. **Never** send password/OTP/card values (they should not be in the action map). **Do not** send page text when `safety.blocked` is true.

### 6.4 Streaming

Where the Gemini/Groq API supports streaming:

- Background reads the stream and posts `STREAM_CHUNK` on the panel port.
- Panel appends to the current assistant bubble.
- Agent JSON **must not** execute from a partial stream; wait until complete then validate.

---

## 7. Feature pipelines

### 7.1 Article summarisation (Week 1)

```
User: Summarise
  → panel asks background PAGE_CONTEXT_GET
  → safety check URL
  → content EXTRACT_ARTICLE (Readability.js clone of document)
  → if empty: fallback to visible main text / “not an article”
  → Gemini Flash-Lite with structured output:
       TL;DR (1 line), 5 key points, What to do next
  → render in panel; language toggle re-runs or rewrites last summary
```

YouTube: if `url` matches `youtube.com/watch` or `youtu.be`, skip Readability; send the **public URL** to Gemini YouTube input. Ask for chapter-style notes with timestamps. Panel renders timestamps as links (`https://www.youtube.com/watch?v=ID&t=SECONDS`). Private/unavailable videos: friendly error, out of scope.

### 7.2 Selection explain (Week 1) and context menus (Week 2)

1. Register `chrome.contextMenus`: Explain this, Translate, Draft a reply.
2. On click: `chrome.sidePanel.open`, store pending payload `{ mode, selection, url }`.
3. Panel on load reads pending payload and shows the result.
4. Translate target from settings (Hindi or user-selected).
5. Draft may include **profile name/tone** from storage.

### 7.3 Page chat (Week 2)

- System + page snapshot + conversation history for that tab.
- If user navigates (URL change), reset or warn and refresh context.
- Refuse to answer from world knowledge when the page does not contain it.
- Optional: attach a short action-map excerpt if the user asks “where is X?” without starting the full agent.

### 7.4 Screenshot-and-ask (Week 2)

```
User: Capture
  → background chrome.tabs.captureVisibleTab (active tab, png)
  → panel shows image + crop overlay (canvas)
  → user question + cropped (or full) image
  → safety: if page blocked, do not upload image
  → Gemini Flash vision
  → answer in panel
```

Cropping is **client-side** in the panel so the model receives only the focused region when possible.

### 7.5 Interactive scanner and action map (Week 3)

Content `scanner.js` query (main frame):

- `a[href]`, `button`, `[role=button]`, `input` (not hidden), `textarea`, `select`, `[role=checkbox]`, `[role=combobox]`, `summary`, clickable `[onclick]` sparingly.

Assign `n` in **document order**, skip `disabled`/`hidden`/`aria-hidden` where feasible. Mark:

- `sensitive` if `type=password`, autocomplete/otp/one-time, name/id matching card/cvv/otp/pin.
- `consequential` if text/value matches submit/pay/send/confirm/delete/purchase (case-insensitive, multi-language later if needed).

`overlay.js` paints numbered badges using a shadow-root overlay so page CSS is less likely to break them. Re-scan after each executed action (SPA mutations): `MutationObserver` debounce or explicit rescan on `EXECUTE_ACTION` complete.

### 7.6 Find it for me (Week 3)

```
User query → SCAN_INTERACTIVE → compact ActionElement[] to model
  → FindElementResult JSON → HIGHLIGHT_ELEMENT
  → no click
```

Low confidence: still highlight but tell the user it may be wrong.

### 7.7 Approval-based agent loop (Week 3)

```
AGENT_START(goal, tabId)
  persist session { status: "running", step: 0, goal, tabId, dryRun, maxSteps }

loop:
  if stop flag or step >= maxSteps → status complete/stopped
  safety page check → abort if blocked
  SCAN_INTERACTIVE
  ask model: goal + last log + action map → AgentAction
  persist { status: "awaiting_approval", proposal }
  show panel: type, n, value, reason, target label
  wait user:
    STOP  → persist stopped; clear overlays
    SKIP  → log skipped; continue loop without execute
    APPROVE →
      if consequential → second confirm in panel
      if dryRun → HIGHLIGHT only; log dry-run
      else EXECUTE_ACTION in content
      if execute fails (stale n) → rescan, do not invent a new click
      append action log
      if action === "done" → complete
      else step++ and loop
```

**Progress persistence:** write `agentSession` after every state change. On SW `onInstalled` / first message / panel `AGENT_STATE_GET`, restore “awaiting_approval” UI so sleep does not lose the proposal.

**Execute path** (content `execute.js`): resolve `n` → element; if missing, return error. Click via `.click()`. Type via focus + set value + `input`/`change` events. Select via `value` + change. Scroll `window` or nearest scroll parent. **Never** execute if `sensitive` or page blocked—even if the model asked.

### 7.8 Profile, skills, packaging (Week 4)

- Profile form in options or panel Settings tab; used as extra context for draft + form-fill skills.
- Skills: CRUD in panel; **Export** JSON file; **Import** validates schema then merges.
- Example skills: Exam notes, Explain in Hinglish, Reply politely, Fill this form from my profile.
- Release: zip extension root excluding `.git`, `Docs` optional include, never include user storage. GitHub Pages one-pager in `/pages`.

---

## 8. Safety architecture (FR-10)

Safety is a **pipeline of gates**, all in TypeScript/JS you control.

```
Incoming request
  → Page gate (URL / title / known payment hosts)
  → Task gate (agent vs read-only)
  → Payload gate (strip secrets; refuse screenshot on blocked pages)
  → Model (if allowed)
  → Action gate (schema, n, sensitive field, consequential confirm)
  → DOM execute (content re-checks field type)
```

### 8.1 Page gate

Block **agent actions** and **outbound page content** on:

- Banking, UPI, payment hosts (maintain a list + heuristics: `/upi`, `razorpay`, `stripe`, `paypal`, `netbanking`, `paytm`, `phonepe`, `bhims`, bank TLDs).
- `chrome://`, Web Store, extension pages.

Read-only features (summary/chat) should also **refuse** to send private/sensitive pages to free-tier APIs when the page gate fires. Show why in the panel.

### 8.2 Field gate

Never `type` into:

- `input[type=password]`
- OTP / 2FA (autocomplete `one-time-code`, names like `otp`, `totp`, `2fa`)
- Card fields (`cc-number`, `cc-csc`, `cc-exp`, labels like card/CVV)

Content script marks `sensitive: true`; background rejects even if JSON targets them.

### 8.3 Action gate

- Extra modal: Submit, Pay, Send, Purchase, Delete, Confirm order.
- Kill switch: Stop always visible while `agentSession.status` is running or awaiting.
- No login/password/OTP/payment workflows as skills.

### 8.4 Practice vs arbitrary sites

Default **practice mode**: agent start allowed on localhost, bundled practice pages, or a user-confirmed “I control this page” checkbox stored per-origin for the session. Document that risky third-party errands are out of scope.

---

## 9. Side panel UX architecture

Keep one shell with tabs so FR-1 holds:

| Tab | Week | Contents |
|-----|------|----------|
| Chat | 2 | Messages, composer, grounded disclaimer |
| Summarise | 1 | Article / YouTube result, language toggle |
| Agent | 3 | Goal input, proposal card, Approve/Skip/Stop, dry-run, log |
| Skills | 4 | List, run, export/import |
| Settings shortcut | 1 | Link to options; language toggle duplicated here |

**Proposal card** must show: action type, element number + label, value preview (masked if looks like a secret—should already be blocked), one-line reason.

Errors: banner, not `alert()`. Empty states: “Open an article tab”, “Enter API key in Settings”.

---

## 10. Security and privacy

| Topic | Rule |
|-------|------|
| API keys | Options → `chrome.storage.local` only; `.gitignore` any env files |
| Network | Fetch AI APIs from **service worker** so keys are not injected into the page |
| Content script | Untrusted page JS cannot read extension storage; use isolated world |
| Screenshots | Transient; no upload if page gated |
| Profile | Local only; included in prompts only for explicit draft/fill skills |
| CSP | Extension pages: restrictive CSP in manifest; no inline eval |
| Logging | No keys, no full page dumps in `console` in production |

---

## 11. Failure modes

| Failure | User-visible behaviour |
|---------|------------------------|
| Missing API key | Settings CTA, no network call |
| 429 / quota | Retry, then fallback, then wait message |
| Readability empty | Explain + offer screenshot or selection |
| YouTube private | Unsupported message |
| Stale element `n` | Rescan, new proposal, no blind click |
| SW killed mid-wait | Restore proposal from `agentSession` |
| Invalid model JSON | Show raw/error, ask to retry step |
| Blocked page | Hard stop with category reason |

---

## 12. Build order mapped to architecture

Implement **smallest working slice**, load unpacked, then next. Do not generate the whole tree empty.

| Slice | Primary files | Done when |
|-------|---------------|-----------|
| 1 Extension shell | `manifest.json`, SW, `sidepanel/`, `options/` | Load unpacked, panel opens, key saves |
| 2 Gemini text | `background/ai/gemini.js` | Explain selection in panel |
| 3 Article summary | `content/extract.js`, Readability | TL;DR + 5 points + next |
| 4 YouTube | summary path + timestamp links | Public video notes |
| 5 Language | settings + prompt suffix | EN / Hinglish |
| 6 Page chat | panel chat + context | Grounded answers |
| 7 Context menus | SW menus + panel open | Explain/Translate/Draft |
| 8 Screenshot | capture + crop + Flash | Visual Q&A |
| 9 Resilience | `ai/router.js` | 429 does not crash |
| 10 Scanner | `scanner.js`, `overlay.js` | Numbered badges |
| 11 Find-it | JSON schema + highlight | Correct element, no click |
| 12 Agent loop | `agent/loop.js`, `execute.js` | Approve then act |
| 13 Persist/dry-run/log | `agent/persist.js` | SW sleep safe |
| 14 Profile | options + prompt inject | Local memory |
| 15 Skills | CRUD + JSON file | Import/export |
| 16 Safety | `safety/*` | Blocks proven on test URLs |
| 17 Ship | README, zip, `pages/` | Install from Release |

---

## 13. Testing strategy

| Layer | How |
|-------|-----|
| Schema | Unit tests for JSON validate / fence stripping (Node or browser) |
| Safety | Fixture URLs and dummy forms (password, OTP, Pay button) |
| Extract | 2–3 public articles; one SPA news page |
| YouTube | One public video with chapters if possible |
| Agent | Practice multi-step form + practice shop filters (two errands) |
| Persistence | Start agent, wait for SW inactive in chrome://serviceworker-internals, reopen panel |
| Manual | Load unpacked after each slice |

No requirement for Playwright in week 1; add a small practice HTML page under `pages/practice/` for week 3 demos.

---

## 14. Distribution architecture

```
GitHub repo (source, no keys)
  ├── GitHub Release: sahayak-extension.zip  → Load unpacked
  └── GitHub Pages: /pages  → landing, install steps, screenshots
```

The ZIP root must contain `manifest.json`. Do not nest the extension one folder too deep.

---

## 15. Explicit non-goals (architecture)

Do not design for: mobile Chrome, unattended loops, payment/login/OTP automation, a custom cloud backend, Chrome Web Store review, or sending gated pages to free-tier models “because the user asked.” Those would violate the problem statement and FR-8 / FR-10.

---

## 16. Glossary

| Term | Meaning |
|------|---------|
| Action map | Compact numbered list of interactive elements for the model |
| Dry run | Highlight target, do not mutate the page |
| Flash-Lite | Default cheap Gemini text model |
| Gate | Deterministic check that can block model or execute |
| SW | Manifest V3 background service worker |

This architecture is the source of truth for module boundaries. Feature behaviour remains defined by [ProblemStatment.md](./ProblemStatment.md). When they conflict, **the problem statement wins** and this file should be updated.
