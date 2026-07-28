---
name: setup
description: >
  One-command onboarding for Kanon: sign in, verify the workspace, and
  configure this project so /kanon:discover can run. Use for "set up
  kanon", "connect kanon", "sign in to kanon", "onboard this
  project", "get started with kanon".
argument-hint: "[--host <url>]"
disable-model-invocation: true
---

# Kanon Setup

Take the user from zero to a project ready to map: sign in with a browser
approval, confirm which workspace the token belongs to, write
`.kanon/config.json`, and hand off to discovery. The token is issued to a
local file you never see — you drive the flow, the user approves it.

## Progress rendering (standing rule)

After EVERY state change, re-render this one line (states: ⬜ not started ·
🔄 in progress (with a parenthetical) · ✅ done · ⚠️ done-with-caveat · ❌ failed):

`✅ Prerequisites · ✅ Server · 🔄 Sign-in (waiting for approval…) · ⬜ Verify · ⬜ Project · ⬜ First discovery`

Then, in at most three short lines: **what just happened**, **what's happening
now**, and **what the user should do RIGHT NOW** (or "nothing — I'm working").
Never go silent across a tool call.

## Secrets rule (standing)

Never read, `cat`, print, or screenshot `~/.kanon/credentials.json` or
`~/.kanon/device-pending.json`; never echo a token or device code. Only
the `kanon_setup_*` tools (or the `dist/cli.js` twins) touch those files.
The token never enters the conversation — if you ever find yourself about to
show it, stop. Verification is done via `kanon_whoami`, which returns the
workspace and the token's *source*, never its value.

## 0. Resume detection (do this first)

1. Call `kanon_whoami`.
   - **`ok: true` AND the project is already configured** — `.kanon/config.json`
     carries `url` + `targetUrl` and its `repoSlug` matches `git remote get-url
     origin` → **fast path**: skip §2–§4 entirely and confirm the whole set in
     ONE `AskUserQuestion` — *server · workspace · repo slug · target URL* —
     offering *(a)* correct, continue; *(b)* change one of them (then walk §5
     field by field); *(c)* sign in as a different account (§2); *(d)* exit. On
     *(a)*, still run §5.2's claim+verify, then go to §6. **Never re-ask a field
     that already agrees.**
   - **`ok: true`, config missing or disagreeing with the remote** → show the
     workspace + `tokenSource`, then `AskUserQuestion`: *(a)* project setup (§5),
     *(b)* reconfigure / sign in as a different account (continue to §2),
     *(c)* exit.
   - **`ok: false`** → not signed in; continue.
2. Call `kanon_setup_poll` with `maxWaitSeconds: 0` (a non-blocking probe).
   - **`status: "pending"`** → a sign-in is already in flight. Announce it
     (user code, `secondsLeft` remaining) and resume the poll loop in §3.3.
   - **`status: "no_pending"`** → run the full flow from §1.

## 1. Prerequisites

- **Node ≥ 20**: `node --version`. Below 20 or missing → ❌, stop, and give
  install guidance (nvm / the nodejs.org LTS installer). The bundled tools need it.
- **Claude in Chrome**: check the `tabs_context` tool responds. Absent → ⚠️ warn
  only and link the extension; nothing here is blocked. Discovery in §6 is
  code-only by default — the extension matters only for the optional
  `/kanon:discover --refine` browser crawl.
- Read `.kanon/config.json` if present — it may already hold `url` /
  `repoSlug` / `targetUrl` to pre-fill later steps.

## 2. Server URL

**Default to `https://gokanon.com` — do NOT ask.** The only override is a
`--host` flag in `$ARGUMENTS` (`--host <url>` or `--host=<url>`); use that value
instead when present (a bare host like `localhost:3000` gets `https://`
assumed, so pass `http://localhost:3000` for local dev). Ignore any bare
positional argument — only `--host` switches the server. Do NOT probe with
curl — the reachability probe **is** §3's `kanon_setup_begin`. If begin fails,
show the actionable error and, only then, suggest a corrected `--host`; never
silently re-loop and never fall back to prompting for the URL.

As soon as §3's begin succeeds, **write the `serverUrl` it returned into
`.kanon/config.json`** (`{ "url": … }`, merging with any existing file) —
that exact string, never the one you passed in. They differ when the host
redirects (a www/apex fold either way, or http→https), and `serverUrl` is the
one the credential is filed under. This must happen BEFORE §4: the credentials store is keyed by
server URL, so `kanon_whoami` can only find the fresh token once the project
names the same URL.

If the result carries `redirectedFrom`, say so plainly — *"`<redirectedFrom>`
redirects to `<serverUrl>`; using the latter, since the redirect would drop the
auth header"* — and use `serverUrl` everywhere from then on.

## 3. Sign in & approve

1. Call `kanon_setup_begin`. Pass `{ serverUrl }` **only** when §2 found a
   `--host` override; otherwise call it with no arguments so it targets the
   default `https://gokanon.com`.
   - Failure → surface the `guidance` (typo, server down, http-vs-https, VPN, or
     "too old / wrong URL" for a 404) and go back to §2 (re-check the `--host`,
     or note the default instance is unreachable).
   - Success → you get `verifyUrl`, `userCode`, `expiresInSeconds`,
     `pollIntervalSeconds`.
2. Present the approval clearly:
   - Render `verifyUrl` as a clickable link.
   - Show the **user code big**, in its own code block:
     ```
     F43Z-GHG6
     ```
   - Say that **signing UP is fine** — a new account and workspace are created
     right there in the browser. If Claude in Chrome is available, offer to open
     the page for them via `navigate` (they still type credentials and click
     Approve themselves — you never touch login fields).
3. Poll loop: call `kanon_setup_poll { maxWaitSeconds: 20 }` repeatedly.
   - Between ticks, narrate: *"still waiting — approve at {verifyUrl}, code
     **{userCode}**, {secondsLeft}s left"*.
   - **`approved`** → ✅ Sign-in; persist the URL now (§2's config write, if
     you haven't already), then go to §4.
   - **`denied`** → report it; only restart (§3.1) if the user asks.
   - **`expired`** → automatically run `kanon_setup_begin` ONCE for a fresh
     code, announce the **new** code loudly, then resume polling. Do not loop
     restarts beyond that one.
   - **`error`** → the pending sign-in is kept. Retry the poll; after **3
     consecutive** errors, stop, tell the user to check connectivity, and note
     that re-running `/kanon:setup` resumes the same code.

## 4. Verify

Call `kanon_whoami`.
- Show the **workspace** (name + slug) and **token name**, and state: *"the
  token is stored at `~/.kanon/credentials.json` (0600); it was never
  shown to me."*
- Inspect `config.tokenSource`. If it is anything other than the credentials
  file (e.g. `shell env` = a `KANON_API_TOKEN` export, or
  `plugin setting (keychain)`), that value is **shadowing** the fresh sign-in.
  Say so plainly and how to fix it (unset the shell/keychain override so the new
  credential is used), then continue.

## 5. Project configuration

1. **Repo slug** (`owner/app`): prefer `.kanon/config.json`; else infer
   from `git remote get-url origin`; else ask. Confirm the final value with
   `AskUserQuestion`.
2. **Claim + verify** via `kanon_get_taxonomy { repoSlug }`. EXPLAIN first:
   *fetching the taxonomy CLAIMS an unclaimed slug into your workspace.*
   - `exists: false` → the slug was just claimed fresh (empty taxonomy).
   - `exists: true` → summarize approved/proposed counts.
   - **404** → **always** "owned by another workspace", never "not created
     yet" — an unclaimed slug is auto-claimed by this very call, so it could
     not have 404'd. Do not retry, and do not guess which workspace: offer the
     three real options and let the user pick — *(a)* sign in as the owning
     account, *(b)* move the repo to this workspace in the app (keeps its
     existing taxonomy), *(c)* claim a different slug (starts empty).
3. **Target app URL**: ask (staging/test tenant preferred over production).
   This is recorded as bundle metadata for every discovery run; it does not by
   itself cause a browser crawl. Optionally ask the role a `--refine` crawl
   would run as.
4. **Write** `.kanon/config.json` = `{ url, repoSlug, targetUrl, role? }` —
   **never a token**. If `.kanon/` isn't gitignored, offer to add it.

## 6. First discovery (handoff)

`AskUserQuestion`: *"Start `/kanon:discover` now?"* — say that it reads
the codebase; no browser opens unless they ask for `--refine`.
- **Yes** → read `${CLAUDE_PLUGIN_ROOT}/skills/discover/SKILL.md` and follow it
  from its Preflight, carrying `targetUrl` and `repoSlug`. Carrying a
  `targetUrl` is **not** a request to crawl — run code-only unless the user
  explicitly asked for `--refine`.
- Either way, render the all-✅ checklist and a summary card:
  **server** · **workspace** · **repo slug** · **target URL** · **credential
  location** (`~/.kanon/credentials.json`) · **next commands**
  (`/kanon:discover`, `/kanon:status`).

## Failure playbook

| Symptom | Do |
|---|---|
| `node --version` < 20 / missing | ❌ stop; install Node 20 LTS (nvm or nodejs.org), re-run. |
| Claude in Chrome absent | ✅ not blocking — discovery is code-only by default; the extension is only needed for `/kanon:discover --refine`. |
| `setup_begin` unreachable (status 0) | Typo / server down / http-vs-https / VPN, or the default instance is down. Retry, or pass a corrected `--host` (§2). |
| `setup_begin` 404 or HTML | Server has no device sign-in — too old or wrong URL. Pass the right `--host` (§2). |
| `poll` denied | User rejected in browser. Restart only on request. |
| `poll` expired | ONE auto-restart with a new code (announce it), then poll. |
| `poll` error ×3 | Stop; pending is kept; check connectivity; re-run to resume. |
| `whoami` shows non-credentials `tokenSource` after approval | A shell/keychain token is shadowing the sign-in. Unset it (§4). |
| `get_taxonomy` 404 | Slug owned by another workspace (never "not created yet") — switch account, move the repo in the app, or pick another slug. |
| Any call reports `redirectedTo` | The host redirects and the hop drops the auth header. Set `url` in `.kanon/config.json` to the reported value and re-run `/kanon:setup` so the credential is filed under it. |
| `whoami` 401 with a token resolved | The stored credential was refused — it is revoked, or issued for a different server. Re-run `/kanon:setup`; clear any shell/keychain override first. |
| `.kanon/config.json` write fails | Report the path + error; it's just JSON — offer to write it manually. |

## Resumability

Sign-in survives interruptions. A `device-pending.json` persists the in-flight
handshake; re-running `/kanon:setup` (or §0's non-blocking poll) picks it
back up. The approved token is written to `credentials.json` **before** the
pending file is cleared, so an approval is never lost. A denied/expired sign-in
clears the pending file, so the next run starts clean.
