# Sahayak Implementation Plan

Phase-wise build plan for Sahayak. Product behaviour is defined in [Problemstatment.md](./Problemstatment.md). Module boundaries and message types are defined in [architecture.md](./architecture.md). If they conflict, **the problem statement wins**.

**Goal:** In four weeks, ship an installable Manifest V3 Chrome side-panel agent that can read, explain, see, remember, and act—with **user approval on every browser action**.

**How to use this file:** Complete phases in order. Finish a slice’s acceptance checks (Load unpacked on a real page) before starting the next slice. Do not scaffold empty stubs for later weeks unless a later file needs a stable import path.

---

## Rules for every phase

1. Vanilla JS first. No bundler unless Load unpacked becomes painful.
2. API keys only in `chrome.storage.local` via Options. Never commit keys.
3. All AI `fetch` calls from the **service worker**, not the page.
4. Typed messages: `{ type, requestId, tabId?, payload }` → `{ ok, requestId, data?, error? }`.
5. User-visible errors as panel banners. Never crash the extension on 429 or bad JSON.
6. Safety gates in code as soon as a feature can send page data or mutate the DOM (stubs in Week 1, full lists in Week 4).
7. Reload the unpacked extension after each slice and test the slice on a real tab.

**Stack (locked):** Chrome desktop MV3, Side Panel, content scripts, `captureVisibleTab`, context menus, `chrome.storage.local`, Gemini Flash-Lite (default), Gemini Flash (vision / hard JSON), Groq text fallback, Mozilla Readability.js.

---

## Phase 0 — Prep (half day, before Week 1)

**Objective:** Repo and secrets hygiene so Week 1 can Load unpacked on day one.

| Task | Output |
|------|--------|
| Confirm folder layout from architecture §4 | Empty dirs only as files are created |
| `.gitignore` | Ignore `.env`, `*.pem`, local zips with keys, `node_modules` |
| Placeholder icons | `assets/` 16/48/128 PNG |
| Decide Gemini model IDs | Document current Flash-Lite / Flash names in `prompts.js` comments |
| Get a Gemini API key | Used only in Options, never in git |

**Exit:** Repo is clean; you can create `manifest.json` next.

---

## Phase 1 — Week 1: The Eyes (read the web)

**Objective:** Extension loads, side panel works, key is stored, selection can be explained, articles and public YouTube can be summarised, English/Hinglish toggle works.

**FR covered:** FR-1, FR-2, FR-3, FR-4.

### Slice 1.1 — Extension shell + side panel + settings

**Days:** 1–2

**Build**

- `manifest.json` (MV3): `side_panel`, `action`, `background.service_worker`, `options_ui`, `storage`, `sidePanel`, `tabs`/`activeTab`, `scripting`, host permissions for Gemini.
- `background/service-worker.js`: open side panel on action click; `onMessage` stub.
- `background/router.js`: handle `SETTINGS_GET` / `SETTINGS_SET` only.
- `sidepanel/index.html` + `panel.js` + `styles.css`: shell with tabs **Summarise** (active), Chat/Agent/Skills as disabled placeholders, language toggle, error banner, Settings link.
- `options/index.html` + `options.js`: Gemini API key, language default. Save to `settings` in `chrome.storage.local`.
- `lib/utils.js`: `uuid()`, safe JSON helpers.

**Do not yet:** content scripts, AI calls, agent UI.

**Test**

- Chrome → Extensions → Developer mode → Load unpacked (folder that contains `manifest.json`).
- Toolbar icon opens side panel beside a normal webpage.
- Options: save key, reload panel, `SETTINGS_GET` returns it (do not log the key).
- Panel survives tab switch (panel still open).

**Done when:** Extension loads; panel opens; key is entered through settings, not hard-coded.

---

### Slice 1.2 — First Gemini text call (explain selection)

**Days:** 2–3

**Build**

- `content/index.js` + `content/extract.js`: `GET_SELECTION` returns `window.getSelection()`.
- Register content script in manifest (`http`/`https`).
- `background/ai/gemini.js`: non-streaming `generateContent` with user key from storage.
- `background/ai/prompts.js`: explain-in-plain-language template + language suffix.
- Panel: “Explain selection” button → `SELECTION_ACTION` `{ mode: "explain" }`.
- Missing key: banner + Settings CTA; **no fetch**.

**Test**

- On Wikipedia or a news article, select a jargon sentence → Explain → result in panel.
- Empty selection → friendly “select text first”.
- Invalid key → banner, panel still usable.

**Done when:** Selected text is explained in the side panel.

---

### Slice 1.3 — Article extraction + structured summary

**Days:** 3–4

**Build**

- Vendor Readability into `lib/readability.js`.
- `EXTRACT_ARTICLE`: clone document, parse, return `{ title, byline, text, excerpt }` truncated (~12–20k chars).
- Fallback if Readability empty: visible `document.body.innerText` truncated, plus “this may not be an article”.
- `SUMMARY_ARTICLE` in router: page context + Gemini Flash-Lite.
- Prompt must return: one-line **TL;DR**, **five key points**, **What to do next**.
- Summarise tab: button, loading state, structured render.
- Stub page gate: refuse `chrome://` and extension pages.

**Test**

- Long-form article: noise (nav/ads/footer) mostly gone; three sections present.
- SPA or thin page: fallback message, no crash.
- Two different articles in a row: context is from the **current** tab.

**Done when:** A normal article summarises into the required structure.

---

### Slice 1.4 — Public YouTube summarisation

**Days:** 4–5

**Build**

- Detect `youtube.com/watch` and `youtu.be` on active tab URL.
- `SUMMARY_YOUTUBE`: send **public URL** to Gemini YouTube-capable generate path (no transcript scraping required for core).
- Prompt: structured notes + chapter-style timestamps.
- Panel: clickable `t=` links that open/jump the video (`https://www.youtube.com/watch?v=ID&t=SECONDS`).
- Private / unsupported: user-readable error; out of scope to “fix”.

**Test**

- One public video with clear sections.
- Timestamp click jumps (or opens) the right time.
- Non-YouTube tab does not take the YouTube path.

**Done when:** A supported public YouTube link produces a useful structured summary with timestamps when the model returns them.

---

### Slice 1.5 — English / Hinglish toggle

**Days:** 5

**Build**

- Panel toggle writes `settings.language` (`en` | `hinglish`).
- All text prompts append language instruction from `prompts.js`.
- Re-run last summary **or** rewrite last assistant output when toggle changes (pick one; rewrite is cheaper).
- Options page language stays in sync.

**Test**

- Same article: English then Hinglish clearly different.
- Toggle persists after panel close.

**Done when:** Switching output language works for summarise and explain.

---

### Week 1 acceptance gate (do not start Week 2 until all pass)

- [ ] Load unpacked succeeds  
- [ ] Side panel opens next to a normal webpage  
- [ ] API key via Options, not source  
- [ ] Selection explain works  
- [ ] Article → TL;DR + 5 points + next  
- [ ] Public YouTube summary works  
- [ ] English / Hinglish works  

**Stretch (optional, skip if device/API unsupported):** Chrome built-in on-device article summary. Do not block Week 2.

---

## Phase 2 — Week 2: The Brain (understand page and screen)

**Objective:** Grounded page chat, right-click actions, screenshot Q&A, graceful rate limits and fallbacks.

**FR covered:** FR-5, FR-6; reliability NFR.

### Slice 2.1 — Grounded page chat + streaming

**Days:** 1–2

**Build**

- Enable **Chat** tab: message list, composer, “answers only from this page” disclaimer.
- `CHAT_SEND`: attach latest `PageContext` (article text or body fallback + title + url).
- Store `chatByTab[tabId]`; if `pageUrl` changes, reset or warn and refresh context.
- Prompt: if answer not in context, say so; no invented facts.
- `chrome.runtime.connect` port `sahayak-stream`: `STREAM_CHUNK` / `STREAM_DONE`.
- If streaming API fails, fall back to one-shot fill of the bubble.

**Test**

- Question answered by a sentence on the page → grounded answer.  
- Question not on the page → explicit “not on this page”.  
- Navigate to another article → chat does not mix old context.  
- History remains during the same tab session.

**Done when:** User can chat with the current page; answers stay grounded.

---

### Slice 2.2 — Context-menu Explain / Translate / Draft

**Days:** 2–3

**Build**

- `contextMenus` permission; create three items under “Sahayak”.
- On click: capture selection, `sidePanel.open`, stash pending `{ mode, selection, url }` in storage.
- Panel on load: `CONTEXT_MENU_RESULT` or pending-payload read → run `SELECTION_ACTION`.
- Translate: target from `settings.translateTarget` (default Hindi).
- Draft: email / LinkedIn / forum-style reply; later Week 4 injects profile tone.
- All results render in the side panel (Chat or a result pane).

**Test**

- Right-click selection on a page with panel closed: panel opens with result.  
- All three modes produce distinct outputs.  
- No selection: menu can hide or show “select text”.

**Done when:** Explain, Translate, and Draft a reply work from the right-click menu and land in the panel.

---

### Slice 2.3 — Screenshot-and-ask

**Days:** 3–4

**Build**

- `SCREENSHOT_CAPTURE`: `chrome.tabs.captureVisibleTab` PNG (needs `tabs` + host access).
- Panel: preview image, optional canvas crop, question field, send.
- `SCREENSHOT_ASK`: Gemini **Flash** vision with cropped (preferred) or full data URL.
- Do **not** persist screenshots in `chrome.storage`.
- If page gate later blocks, skip upload (wire a simple block check if URL looks like payment; full list Week 4).

**Test**

- Chart, error dialog, or form screenshot + question → useful answer.  
- Crop sends a smaller image than full tab.  
- Capture failure (chrome://) → banner, no crash.

**Done when:** User can ask a question about visible non-text content.

---

### Slice 2.4 — Free-tier resilience (model router)

**Days:** 4–5

**Build**

- `background/ai/router.js`: task → model (architecture §6.1).
- `background/ai/groq.js`: text-only fallback; **never** send images.
- On HTTP 429 / retryable 5xx: backoff 1s, 2s, 4s + jitter, max 2–3 retries.
- Then lighter Gemini if on Flash; then Groq for text tasks.
- Map errors to `ERROR_USER`: missing key, rate limit, blocked page, network.
- Panel never uncaught-throws on API failure.

**Test**

- Temporarily wrong key / missing Groq: text path still explains if Gemini works.  
- Simulate 429 (mock or real quota): retry or fallback message, extension stays up.  
- Screenshot path does not call Groq.

**Done when:** Rate limits and model errors do not crash the extension; default model is Flash-Lite; Flash only when needed.

---

### Week 2 acceptance gate

- [ ] Page chat uses current page as source of truth  
- [ ] Admits missing answers  
- [ ] Explain / Translate / Draft from context menu  
- [ ] Screenshot Q&A works  
- [ ] 429 / errors show a helpful state, no crash  

---

## Phase 3 — Week 3: The Hands (act with approval)

**Objective:** Numbered interactive map, find-it (no auto-click), one-step agent loop with Approve / Skip / Stop, dry-run, step limit, persistence, action log. Complete **at least two** practice errands with approval every step.

**FR covered:** FR-7, FR-8.

**Do this week with a practice-mode default:** agent start allowed on `localhost`, `pages/practice/`, or “I control this page” confirm. Do not automate logins or payments.

### Slice 3.0 — Practice surfaces (build first, small)

**Days:** start of week (parallel with 3.1)

**Build** two local pages under `pages/practice/`:

1. **Internship form:** multi-step (name, college, skills, next, review, submit).  
2. **Practice shop:** search + 2–3 filters + product list (for “apply filters” / collect table).

These are the Week 3 demo targets and later safety “Submit” extra-confirm tests.

---

### Slice 3.1 — Interactive scanner + numbered badges

**Days:** 1–2

**Build**

- `content/scanner.js`: buttons, links, inputs, textareas, selects, checkboxes, other action roles (architecture §7.5).
- Assign stable `n` for **this scan**; skip hidden/disabled where practical.
- Mark `sensitive` (password, otp, card) and `consequential` (submit/pay/send) even before full Week 4 lists.
- Cap ~80–120 elements; truncate labels.
- `content/overlay.js`: shadow-root numbered badges; `BADGES_TOGGLE`; `CLEAR_OVERLAYS`.
- `SCAN_INTERACTIVE` returns `ActionElement[]`.
- Enable **Agent** tab: “Scan page” to show badges without AI.

**Test**

- Practice form: inputs and Next/Submit numbered, badges readable.  
- Shop: filters and links numbered.  
- Rescan after a DOM change: numbers refresh; old badges cleared.

**Done when:** Interactive elements are detected and numbered on supported pages.

---

### Slice 3.2 — Find it for me (structured JSON, highlight only)

**Days:** 2–3

**Build**

- `background/agent/schema.js`: parse JSON, strip markdown fences, validate `FindElementResult`.
- `FIND_ELEMENT`: map + user query → Flash-Lite → `{ n, reason, confidence }`.
- `HIGHLIGHT_ELEMENT`: scroll into view + highlight; **no click**.
- Invalid JSON: banner, retry; no DOM mutation.

**Test**

- “Where do I upload my resume?” / “Where is the email field?” on practice form → correct `n`.  
- Low confidence still highlights but copy says it may be wrong.  
- Model cannot trigger `EXECUTE_ACTION` from this path.

**Done when:** Natural-language find highlights the right element and does not act.

---

### Slice 3.3 — Approval-based agent loop

**Days:** 3–4

**Build**

- `background/agent/loop.js` + `content/execute.js`.
- Messages: `AGENT_START`, `AGENT_APPROVE`, `AGENT_SKIP`, `AGENT_STOP`.
- Supported actions: `click`, `type`, `select`, `scroll`, `done` (architecture §5.3).
- Flow: scan → one JSON action → **wait** → only then execute.
- Panel proposal card: action type, `n` + label, value, one-line reason, **Approve / Skip / Stop**.
- `maxAgentSteps` from settings (default e.g. 20).
- Stop is always visible while status is `running` or `awaiting_approval`.
- Execute: click / fill+input/change / select / scroll. If `n` stale: error, rescan, **do not** guess another element.
- Refuse `type` into `sensitive` in **both** background and content.

**Test**

- Fill practice internship form from a short instruction; **every** step needs Approve.  
- Skip one field; loop continues.  
- Stop mid-task; no further execute.  
- Unapproved proposal never mutates the DOM (DevTools watch).

**Done when:** Next action is strict JSON; no browser action before approval; Approve / Skip / Stop and step limit work.

---

### Slice 3.4 — Persistence, dry-run, action log

**Days:** 4–5

**Build**

- `background/agent/persist.js`: write `agentSession` after every state change (`idle` | `running` | `awaiting_approval` | `stopped` | `complete`).
- `AGENT_STATE_GET`: panel restores proposal after SW sleep.
- Dry-run setting: Approve → highlight only; log `decision: "dry-run"`.
- `actionLog[]`: `{ step, proposal, reason, decision, at }` capped (e.g. 200).
- Panel log view for the current task.

**Test**

- Pause on proposal → `chrome://serviceworker-internals` stop worker → reopen panel → proposal still there.  
- Dry-run shop filter: highlight, filters unchanged.  
- Log shows proposed step, reason, Approve/Skip/Stop.

**Done when:** Agent survives normal SW sleep; dry-run and log work.

---

### Slice 3.5 — Two practice errands (integration)

**Days:** 5 (buffer)

**Run end-to-end with approval every step**

1. Multi-step internship application from a short instruction (use type/click/select).  
2. Practice shop: search and apply filters (optional: collect names into a simple table in the panel).

**Done when:** At least two supported practice errands complete with approval at every step.

---

### Week 3 acceptance gate

- [ ] Elements numbered reliably on practice pages  
- [ ] Find-it identifies and highlights, no auto-action  
- [ ] Agent JSON validated before use  
- [ ] No action before Approve  
- [ ] Approve, Skip, Stop, step limit, dry-run  
- [ ] Progress saved across SW sleep  
- [ ] Action log preserved  
- [ ] Two practice errands succeed  

---

## Phase 4 — Week 4: Memory, safety, and shipping

**Objective:** Local profile, reusable skills (export/import), full safety rails, public repo packaging.

**FR covered:** FR-9, FR-10; privacy/safety NFR; Definition of Done.

### Slice 4.1 — Local profile memory

**Days:** 1

**Build**

- Profile fields: name, college, skills, links, preferred language, preferred tone.
- UI in Options and/or panel Settings; `PROFILE_GET` / `PROFILE_SET`.
- Inject profile into prompts **only** for draft-reply and form-fill (not raw page chat by default).
- Agent `type` values may use profile when the skill/goal says “from my profile”.

**Test**

- Fill practice form using profile without retyping name/college.  
- Draft reply uses preferred tone.  
- Profile remains after browser restart (`chrome.storage.local`).

**Done when:** Local profile works for forms and drafts.

---

### Slice 4.2 — One-click skills + import/export

**Days:** 1–2

**Build**

- Enable **Skills** tab: create, rename, delete, run on current page.
- Seed examples: Exam notes; Explain in Hinglish; Reply to this email politely; Fill this form from my profile.
- Run skill = send skill prompt + current page context through existing summarise/chat/agent entry points (form-fill starts agent loop).
- Export JSON file; import validates `{ id?, name, prompt }` then merges.
- Block skills that claim to “log in” or “pay” (name/prompt keywords + no execute on gated pages).

**Test**

- Run “Exam notes” on an article.  
- Export, clear, import → skills restored.  
- Invalid file → error, existing skills intact.

**Done when:** Skills can be created, reused, exported, and imported.

---

### Slice 4.3 — Safety rails (code, not just prompts)

**Days:** 2–3

**Build** (architecture §8)

- `background/safety/pages.js`: banking / payment / UPI hosts + path heuristics; `chrome://`; Web Store.
- `background/safety/fields.js` + content re-check: never type password / OTP / card.
- `background/safety/actions.js`: extra confirmation for Submit / Pay / Send / Purchase / Delete.
- Kill switch already in Agent tab; verify it is always visible during a task.
- Page gate: **do not** send blocked page text or screenshots to Gemini/Groq.
- Practice mode: agent errands limited to practice pages or user-owned confirm.
- No login / payment / OTP automation paths.

**Test (must be explicit)**

| Case | Expected |
|------|----------|
| Known payment/UPI URL | Agent + page send blocked, reason shown |
| Password field `n` | Type action rejected even if model asks |
| OTP / card-like field | Type rejected |
| Submit on practice form | Second confirm before click |
| Stop | Immediate halt |
| Screenshot on blocked page | No upload |

**Done when:** Restricted pages, fields, and consequential actions are blocked by extension code.

---

### Slice 4.4 — README, release ZIP, GitHub Pages

**Days:** 3–5

**Build**

- Root `README.md`: install (Load unpacked), API key setup, usage of all DoD flows, safety, permissions why-list, screenshots.
- `LICENSE` (e.g. MIT).
- Screenshots: panel, summary, badges, approval card, settings (no live API keys in images).
- `scripts/package-release.sh` (or PowerShell): zip **extension root** with `manifest.json` at zip root; exclude `.git`, secrets, `node_modules`.
- `pages/`: one-page landing (what Sahayak is, install from Release, not autonomous).
- GitHub: public repo; Release asset `sahayak-extension.zip`; Pages from `/pages`.
- Grep repo: no API keys, no `.env`.

**Test**

- Fresh Chrome profile: unzip Release → Load unpacked → paste **your** key → run Definition of Done checklist below.  
- Landing page loads on GitHub Pages.

**Done when:** Another user can install from the release package and follow the README.

---

### Week 4 acceptance gate / Definition of Done

A new user can:

1. Summarise an article or supported public YouTube link  
2. Switch English / Hinglish  
3. Chat with the current page  
4. Use Explain, Translate, or Draft from selected text  
5. Ask about visible screen content  
6. Find a relevant interactive element  
7. Give a supported browser task  
8. Review and approve each step; Stop or Skip anytime  
9. Review the action log  
10. Reuse local profile and a saved skill  
11. Confirm protected pages, fields, and actions are blocked  

---

## Cross-phase schedule (4 weeks)

```
Week 1  1.1 shell ─► 1.2 Gemini ─► 1.3 Readability ─► 1.4 YouTube ─► 1.5 language
Week 2  2.1 chat ─► 2.2 menus ─► 2.3 screenshot ─► 2.4 router/429/Groq
Week 3  3.0 practice pages ─► 3.1 scanner ─► 3.2 find-it ─► 3.3 loop ─► 3.4 persist ─► 3.5 two errands
Week 4  4.1 profile ─► 4.2 skills ─► 4.3 safety ─► 4.4 ship
```

If behind schedule, **cut in this order** (keep core DoD): on-device summary stretch → shop “collect into table” polish → Groq (keep 429 message even without Groq) → streaming (one-shot chat is acceptable) → extra practice pages. **Do not cut:** approval gate, page/field safety, local key storage, article summary, page chat.

---

## Suggested Cursor execution (one slice per session)

Work in vertical slices. After each slice: Load unpacked, run that slice’s tests, commit.

1. Extension shell + side panel + settings  
2. Gemini text call  
3. Article extraction and summary  
4. Public YouTube summary  
5. English/Hinglish toggle  
6. Grounded page chat  
7. Context-menu actions  
8. Screenshot-and-ask  
9. API error handling and fallback  
10. Interactive scanner and badges  
11. Structured element selection (find-it)  
12. Approval-based agent loop  
13. Persistence, dry-run, step limits, action logs  
14. Local profile memory  
15. Saved skills import/export  
16. Safety rails  
17. README, release packaging, landing page  

---

## Out of scope (do not schedule)

- Chrome on Android/iPhone  
- Autonomous execution without approval  
- Banking / payment / login / OTP automation  
- Chrome Web Store publication  
- Custom backend  
- Private or unsupported YouTube  

---

## Traceability

| Phase | Architecture | Problem statement |
|-------|----------------|-------------------|
| 0–1 | §3, §4, §7.1, §12 slices 1–5 | Week 1 Eyes, FR-1–4 |
| 2 | §6, §7.2–7.4, slices 6–9 | Week 2 Brain, FR-5–6 |
| 3 | §5.3, §7.5–7.7, slices 10–13 | Week 3 Hands, FR-7–8 |
| 4 | §7.8, §8, §14, slices 14–17 | Week 4 Ship, FR-9–10, DoD |
