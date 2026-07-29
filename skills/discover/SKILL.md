---
name: discover
description: >
  Analyze this project's codebase (and optionally crawl the running app with
  Claude in Chrome) to build a Kanon taxonomy proposal (domains →
  features → capabilities). Use for "discover my app", "crawl the product",
  "build the knowledge base", "map what our app does".
argument-hint: "[target-url (only needed with --refine)] [repo-slug] [--refine (adds browser crawl)] [--auto-approve] [--non-interactive]"
disable-model-invocation: true
---

# Kanon Discover

## Non-interactive mode (the worker daemon)

`--non-interactive` means NO ONE is watching — the Kanon worker daemon is
running this headlessly for a task queued from the Kanon UI:

1. **Never ask anything.** Repo slug and server URL come from
   `KANON_REPO_SLUG` / `KANON_URL` in the environment; if the slug is
   genuinely missing, fail with a clear message rather than waiting.
2. **Always code-only.** Never crawl (`--refine` is ignored — there is no
   browser), never ask for a target URL.
3. **Push without asking.** After assembly, validate and push the bundle
   directly (`kanon_push_bundle`) instead of handing off to `/kanon:push`'s
   confirmation.
4. **Never auto-approve.** The result lands as proposals; a human reviews
   them in the Kanon UI. `--auto-approve` remains a deliberate, separate
   flag that the worker never passes.
5. End by printing the review URL on its own line.

Turn the codebase into a **taxonomy proposal**: analyze routes, navigation
components, middleware guards, schemas, module structure and the product's own
documentation to build a capability-oriented taxonomy at the altitude a founder
or PM can read — domains a stakeholder would name, features that are things the
user manages rather than pages the app happens to have. Optionally **refine** by crawling the running
app in Chrome (pass `--refine`) to corroborate with what
users actually see. The bundle is pushed later with `/kanon:push`; it
lands as **proposals for human review**, never as published fact. Fidelity
over completeness: record only what you found, mark gaps, never invent.

## Mode selection

The discover command has two axes:

**Source mode** (how signals are gathered):
- **Code-only (default)**: reads the codebase directly — routes, nav
  components, layouts, middleware/guards, schemas, i18n, modules, ownership.
  Fast, requires no running app, covers most taxonomy signal. The server-side
  pipeline runs 9 signal collectors, digests the signals, and makes one LLM
  triangulation call to propose the taxonomy.
- **Code + browser refine** (`--refine`, and only `--refine`): after the
  code-only pass, also crawls the running app in Chrome to add visual
  navigation breadcrumbs, page titles, and UI features. Use when the codebase
  alone doesn't capture the full IA (dynamic menus, runtime plugins, etc.).

A target URL being available — as an argument, from `.kanon/config.json`,
or handed over by `/kanon:setup` — is **not** a request to crawl. Only the
explicit `--refine` flag opens a browser.

**Only refine mode needs a target URL, so only refine mode asks for one.** The
URL describes a crawl; a code-only run never opens a browser, so there is
nothing to point it at. Use one if it's already in the args or config, but in
code-only mode **never prompt the user for it** — assembly falls back to the
repo the code was read from. Asking for a URL a code-only run will not visit is
a dead-end question that makes the run look like it wants to crawl.

**Approval mode** (what happens after proposals land):
- **Human review (default)**: proposals land on the server for review at the
  `/discovery/<repoSlug>` page. The pipeline pauses until the user approves.
- **Auto-approve** (`--auto-approve`): after push, all proposals are
  bulk-approved and scanning starts immediately. For CI, scheduled runs, or
  when the user trusts the proposer. The trust gate is the product's value —
  never default to this.

Reference files (read when you reach that stage):
- `${CLAUDE_PLUGIN_ROOT}/skills/discover/references/crawl-method.md` — the crawl procedure (refine mode only)
- `${CLAUDE_PLUGIN_ROOT}/skills/discover/references/run-format.md` — the on-disk run format
- `${CLAUDE_PLUGIN_ROOT}/skills/discover/references/synthesis.md` — nav→capability synthesis rules
- `${CLAUDE_PLUGIN_ROOT}/skills/discover/references/example-taxonomy.md` — what a golden output looks like

## Progress rendering (standing rule)

After EVERY state change, re-render this one line (states: ⬜ not started ·
🔄 in progress (with a parenthetical) · ✅ done · ⚠️ done-with-caveat · ❌ failed):

`✅ Preflight · 🔄 Code analysis (4/6 mappers) · ⬜ Boundaries · ⬜ Crawl · ⬜ Synthesis · ⬜ Assemble · ⬜ Push`

Drop `Crawl` from the line entirely in code-only mode — don't render a step you
will never run. During the §3a fan-out, count delivered mapper reports
(`Code analysis (4/6 mappers)`); during §3b, count boundary workers the same
way (`Boundaries (2/4)`). Then, in at most three short lines: **what just
happened**, **what's happening now**, and **what the user should do RIGHT NOW**
(or "nothing — I'm working"). Never go silent across a tool call.

## Timing telemetry (standing rule)

At every phase transition, stamp `manifest.timings` —
`"<phase>": { "startedAt", "endedAt" }`, UTC ISO from
`date -u +%Y-%m-%dT%H:%M:%SZ` (never invent a timestamp). Phases:
`preflight`, `mappers`, `boundaries`, `crawl` (refine only), `synthesis`,
`assemble`. Timings are diagnostic — nothing validates them, nothing blocks
on them — but a run with no timings cannot tell anyone where its wall-clock
went, so stamp as you go, not retroactively.

## 1. Preflight

1. **Mode check**: this is a refine run (code + browser) **only if the user
   passed `--refine`**. Otherwise, code-only — including when a target URL was
   passed as an argument, read from config, or carried over from
   `/kanon:setup`. When in doubt, code-only: it is the cheaper, safer
   default, and the user can re-run with `--refine`.
2. **Chrome** (refine mode only): confirm the Claude in Chrome tools respond
   (`tabs_context`). If unavailable in refine mode, fall back to code-only
   with a note: "Chrome not available — running code-only discovery. Use
   --refine with Chrome connected to also crawl the running app."
3. **Node**: run `node --version` — need ≥ 20 for the bundled tools. If
   missing, stop with install guidance.
4. **Config**: read `.kanon/config.json` if present. Merge `$ARGUMENTS`
   (first = target URL, second = repo slug). Ask the user for the **repo slug**
   (`owner/app`) if it's still missing. **The target URL is asked for ONLY in
   refine mode** — there it's required, because it's the page you crawl. In
   code-only mode use it if args or config already supply one, and otherwise
   move on silently: assembly derives the bundle's `targetUrl` from the repo
   slug. Write the merged config back to `.kanon/config.json` (never write
   tokens there).
   *If there's no `.kanon/config.json` AND no Kanon credential yet*
   (a first-time project — `kanon_whoami` returns not-signed-in and the
   shell env is unset), suggest running **`/kanon:setup`** first: it signs
   in, verifies the workspace, and writes this config for you. You can still
   crawl fresh and push later, but setup is the smoother path.
5. **Server state**: call `kanon_get_taxonomy`. If it returns approved
   nodes → **shaped mode** (section 2). If the server is unreachable, tell the
   user and continue in fresh mode — the bundle can be pushed later.
   *If the `kanon_*` MCP tools themselves are missing* (common in
   `--plugin-dir` dev sessions), don't stop: the CLI twin at
   `${CLAUDE_PLUGIN_ROOT}/mcp-server/dist/cli.js` covers validate/assemble
   (section 7), and taxonomy state can be fetched directly when the shell env
   is set: `curl -H "authorization: Bearer $KANON_API_TOKEN"
   "$KANON_URL/api/taxonomy?repoSlug=<slug>"`. Otherwise crawl fresh.
6. **Run dir**: create `.kanon/runs/<UTC timestamp>/` with
   `manifest.json` (see run-format.md) and `screens/`. Announce the path.

## 2. Shaped mode (only when an approved taxonomy exists)

The approved structure is the **user's**; you propose against it, never
rewrite it:
- Reuse approved `key`s verbatim for anything that still exists.
- Never rename, re-describe, or re-parent an approved domain/feature — even if
  you'd structure it differently.
- New capabilities you observe → propose as **new** features/domains.
- Approved features you could NOT find in the crawl → keep them out of your
  proposal but list them in `report.md` under "possibly removed" with what you
  checked. Never silently omit the discrepancy.

## 3. Code-only analysis (always runs)

Read the codebase to extract taxonomy signals. The server-side pipeline
handles the heavy lifting (9 signal collectors), but you can enrich the
proposal by reading key files directly:

1. **Routes & pages**: read the app's route definitions (file-based routing
   dirs, route config files, Rails routes.rb). Note the URL structure — it
   reveals the feature boundaries.
2. **Navigation components**: find and read sidebar, nav, menu, header, and
   breadcrumb components. Extract the label→route mappings — these are the
   user-facing feature names and the information architecture.
3. **Middleware & guards**: find auth middleware, permission checks, role
   gates. Note which routes require which roles — this feeds persona-scoped
   features.
4. **Layouts**: read layout files to understand nesting (a layout wrapping a
   group of routes = a domain boundary).
5. **Page metadata**: read title/description exports from page files.
6. **Feature boundary** (code-mode only): for each feature, derive a
   `boundary` — **1–4 simple prefix globs** (`dir/**` semantics ONLY, from the
   feature's route handlers / feature directories) plus `routePrefixes` from the
   routes it owns. Grep the feature's nouns to find where its code lives
   (`grep -rlniE '<noun1>|<noun2>' src`), then reduce the hits to a few
   directory prefixes — not per-file globs. A boundary is what **enables
   `/kanon:scan`** (the deep guide reads only the files inside it) and it
   **un-halves the feature's confidence** — the server halves crawl-only
   confidence because there's no code boundary; supplying one removes that
   penalty. Leave `globs: []` only when you genuinely can't locate the code.
   A capability with **no user-facing surface** — a backend service, a workflow
   engine, an RBAC model, app chrome — gets `routePrefixes: []` and **no
   `route`**: omit the field. **Never invent a route to satisfy validation** —
   a wrong anchor lets the schema rewrite the taxonomy, which is backwards.
7. **Ownership**: read `.github/CODEOWNERS` (also a root `CODEOWNERS` and
   `docs/CODEOWNERS`). The team that owns a path is the strongest signal you
   have for a feature's `space`, and it groups directories the routes don't.
   Cite it as `ownership` evidence.

8. **Product vocabulary**: read the README's opening paragraph, the package
   description, and the titles of any published docs pages (`content/docs/**`,
   `docs/**` with front-matter). This is the only place the team's own words for
   what they SELL appear — everything else in this list is code structure, and a
   taxonomy built from code structure alone can only be named after the code.

Record your findings in `proposal.json` using the synthesis rules (read
synthesis.md). Include evidence references pointing to the actual source
files you read.

**The unit is a job, not a page.** A feature is a thing the user manages, across
its whole lifecycle — its list, detail, create flow, settings tab and API are
ONE feature. The server checks this deterministically and will reject a proposal
that breaks it: 5–12 domains, ≥3 features each, `space` empty below 10 domains,
no feature named after its parent, after machinery (`…-api`, `…-service`) or
after a screen type (`…-page`, `…-list`). See synthesis.md for the full list —
it is cheaper to follow than to have bounced back.

### 3a. Mapper fan-out (any codebase you can't read in one pass)

Don't walk the areas above serially. Spawn **one mapper subagent per area** —
routes/pages (with layouts + page metadata) · nav components · guards &
middleware · data schema · module structure · ownership — **all in a single
message** so they run in parallel. Partition by area so no two mappers read the
same files. Step 6's boundary derivation needs the merged picture, not one
area's slice — so it runs AFTER the merge, as its own fan-out (§3b), never
inside a mapper.

**State the return contract in every mapper prompt: the mapper's final message
IS its report.** Not a file on disk. Not a follow-up message. Not a one-line
summary with the detail held back. The last thing the mapper says is the whole
of what you receive — a mapper that signs off with "done, ask me for details"
has delivered nothing and costs a round-trip to recover.

The prompt template that produced adopt-verbatim output:

> Map the **<area>** of the codebase at `<repo root>`. Read only what that area
> covers — don't stray into the others. Report, **as your final message**:
> - every capability you found, each with the **concrete file paths** that
>   prove it;
> - an explicit **confidence** (high / medium / low) per finding, and why;
> - an honest **"could not verify"** section — what you looked for, where you
>   looked, and why it stayed unresolved. A named gap beats a confident guess.
>
> Do not write files. Do not propose taxonomy structure — report evidence.
> Your final message is your report; nothing else reaches me.

You merge the reports into `proposal.json` yourself under the synthesis rules —
the mappers supply evidence, you decide structure. Two mappers landing on the
same capability is corroboration: raise its confidence. One mapper alone is a
single signal: don't. Carry their "could not verify" items into `report.md` as
gaps rather than dropping them.

### 3b. Boundary fan-out (after the merge)

Boundary derivation (step 6) is one grep sweep + a reduce-to-prefixes
judgment PER FEATURE — 15–60+ features make it the longest serial stretch in
a discover run if you do it alone. Once the merged feature list exists,
partition it across **up to 4 boundary subagents in a single message**
(contiguous slices, so siblings in one domain land together) and derive in
parallel. State the same return contract as §3a: **the final message IS the
report** — no files, no follow-ups.

The prompt template:

> Derive code boundaries for these features of the codebase at `<repo root>`:
> `<the slice — each feature's key, name, domain, route(s), and the evidence
> paths the mappers found for it>`. For each feature, report as your final
> message:
> - `globs`: **1–4 simple prefix globs** (`dir/**` semantics ONLY) locating
>   its code — grep its nouns (`grep -rlniE '<noun1>|<noun2>' src`), then
>   reduce the hits to directory prefixes, never per-file globs;
> - `routePrefixes`: from the routes it owns (empty for a capability with no
>   user-facing surface — and then NO `route` either);
> - a one-line **why** (the evidence behind the prefixes), and `globs: []`
>   with a note when you genuinely can't locate the code — never guess.
> Do not write files. Do not restructure the taxonomy — the feature list is
> settled; you supply boundaries only.

Fold the reported boundaries into `proposal.json` yourself, applying step
6's rules verbatim (boundary quality is what un-halves confidence — a wrong
prefix is worse than an honest `globs: []`). A worker that returns nothing
gets ONE re-ask with the contract restated; after that, derive its slice
yourself. Boundary workers never touch `proposal.json` or `manifest.json`.

## 4. Browser crawl — REFINE MODE ONLY (skip in code-only mode)

Only if running in refine mode (the user passed `--refine`). A target URL on
its own does **not** put you here — skip to section 5.

### 4a. Login handoff (hard boundary)

Navigate to the target URL. The moment a credential field appears: **stop
interacting**. Tell the user to type their email, password, and any MFA code
directly into the browser window, and to tell you when they're in. You never
type, read, store, or screenshot credentials, one-time codes, or recovery
codes, and you never click through an SSO consent screen on the user's
behalf. Decline non-essential cookies if a consent banner offers the choice.

### 4b. Crawl (procedure in crawl-method.md — read it now)

The non-negotiables, even without the reference:
- Read pages as the **accessibility tree**, not screenshots.
- Map the full nav skeleton FIRST (expand every collapsible group), write it
  to `manifest.json`, then go breadth-first over the frontier.
- Navigate by **clicking in-app links**, not by typing deep-link URLs.
- After EVERY page: write `screens/NNN-<slug>.json`, append to
  `transitions.jsonl`, update `manifest.json` (frontier/visited). The disk is
  the source of truth, not your memory.
- **If you lose track of crawl state for any reason (compaction, restart,
  distraction): re-read `manifest.json` and resume from its `frontier`. Do not
  revisit `visited`. Do not start over.**

### 4c. Read-only guardrails (standing, no exceptions)

You are a read-only observer in someone's real product tenant.
- Never click: Save, Submit, Confirm, Send, Pay, Approve, Reject, Delete,
  Archive, Remove, Transfer, Invite, Buy, Withdraw, Cancel, Terminate,
  Activate, or any toggle/switch.
- Never fill form fields (search boxes used for navigation are the one
  exception). Never complete a wizard past observing its first step. Never
  upload, download-that-emails, or export.
- Opening tabs, accordions, menus, modals, and read-only detail views is fine;
  close modals with Escape or the X.
- **Unsure whether a click mutates? Don't click it.** Record it as an observed
  action instead — that's still evidence.

## 5. Synthesize (rules in synthesis.md — read it before this step)

**Code-only mode**: apply the synthesis rules to the code signals you
gathered in step 3 to produce `proposal.json`. Confidence is based on signal
strength: routes + nav + guard = high confidence; routes-only = medium;
directory-inferred = low.

**Refine mode**: when the frontier is empty, set manifest
`status: "synthesizing"`, then **read back every `screens/*.json` from
disk** (not from memory) and merge with code signals. Apply the
nav→capability transformations to produce `proposal.json`. Screens that
corroborate code signals boost confidence; screens with NO code match get
flagged as "runtime-only" with reduced confidence.

Before proposing, in both modes: **resolve every nav-parent route** against a
real page or route file. A sidebar entry pointing at nothing is a dead link —
list those in `report.md` under "dead nav links" (label · route · where the link
is defined) instead of turning them into features. That check is real output the
user can act on, and the skill is the only thing that will ask for it.

The inverse holds too: a capability with no user-facing route is still a
feature. **Omit its `route`** rather than anchoring it to the nearest URL — see
synthesis.md.

In both modes: confidence must be honest — permission-gated areas,
single-signal features, and inferred boundaries get lower confidence, and
the evidence summary says why. Write `report.md`: a domains → features
table with routes, source evidence, dead nav links, plus flagged gaps.

## 6. Assemble & hand off

1. Call `kanon_assemble_bundle` with the run dir and your model id.
   If the MCP tool is unavailable, use the CLI twin instead:
   `node ${CLAUDE_PLUGIN_ROOT}/mcp-server/dist/cli.js assemble <runDir>`
   (then `… validate <runDir>/bundle.json`). Either way it dedups screens,
   resolves transitions, stamps metadata, and validates.
2. If invalid: fix `proposal.json` or the screen records and re-assemble.
   **Never edit `bundle.json` by hand.**
3. Show the user the `report.md` summary + bundle stats.

## 7. Push, approve, and next steps

After assembly, run `/kanon:push` to send the bundle to the server.

### If `--auto-approve` was passed:

After the push lands, call `kanon_approve_all` to bulk-approve all
proposed nodes. Then immediately proceed to scan: call
`POST /api/scan-all` with `{ repoSlug, guide: true }` (use curl with the
API token). Report the fleet status.

The full autonomous pipeline: **discover → push → approve → scan** runs
end-to-end without human intervention. Use this for CI, scheduled
re-discovery, or when the user trusts the proposer's output.

### If `--auto-approve` was NOT passed (default):

Tell the user clearly:

> **Next steps:**
>
> 1. Open the review UI: `<server_url>/discovery/<repoSlug>`
> 2. Review each proposed domain and feature — accept, edit, or reject
> 3. Once approved, the pipeline can continue. Run one of:
>    - `/kanon:scan <feature>` to generate the deep, verified guide for
>      a single approved feature (needs a code boundary — code-mode discovery
>      derives one)
>    - `/kanon:discover` again (re-discovery auto-detects the
>      approved structure and runs in shaped mode)
>    - `make scan-all` or call `POST /api/scan-all` to deep-scan all
>      approved features
>
> To resume this pipeline automatically after approval, re-run
> `/kanon:discover --auto-approve` — it will detect the approved
> nodes and run a shaped re-discovery followed by scan.

The trust gate is the product's value: proposals become fact only after a
human decides they're right. Never skip this without the user's explicit
`--auto-approve` flag.

## Failure playbook

| Symptom | Do |
|---|---|
| No target URL, code-only mode | Don't ask — assembly derives it from the repo slug. A code-only run never visits it. |
| No target URL, `--refine` mode | Ask for it — it's the page you're about to crawl. Don't invent one. |
| `--refine` passed, Claude in Chrome absent | ⚠️ fall back to code-only, say so, and note that `--refine` works once the extension is connected. Never skip the run. |
| `kanon_*` MCP tools missing (`--plugin-dir` dev) | Use the CLI twin at `${CLAUDE_PLUGIN_ROOT}/mcp-server/dist/cli.js` for assemble/validate; fetch taxonomy with curl (§1.5). |
| `get_taxonomy` unreachable | Continue in fresh mode — the bundle pushes later. Say which mode you ended up in. |
| `get_taxonomy` 404 | Slug owned by another workspace — never "not created yet", since an unclaimed slug is auto-claimed by the fetch. Pick another, move the repo in the app, or re-run `/kanon:setup` as the owning account. |
| Any call reports `redirectedTo` | The configured host redirects, and the hop strips the auth header. Set `url` in `.kanon/config.json` to the reported value, then re-run `/kanon:setup`. |
| A mapper delivers nothing / goes idle | Its final message *was* the report. Re-ask ONCE with the return contract restated; if it's still empty, map that area yourself. |
| A boundary worker (§3b) delivers nothing | Same contract as mappers: re-ask ONCE, then derive its slice of boundaries yourself. Never ship features whose boundaries were simply never attempted. |
| Assemble reports the bundle invalid | Fix `proposal.json` or the screen records and re-assemble. **Never hand-edit `bundle.json`.** |
| Assemble rejects `crawl` evidence with zero screens | Code-only mode has no screens — re-source that evidence as `route`/`nav`/`module`. |
| Crawl interrupted (compaction, restart) | Re-read `manifest.json`, resume from `frontier`, skip `visited`. Never start over. |
| Push 401 | Not signed in — run `/kanon:setup`, or set `KANON_API_TOKEN` for CI. |
| Push 404 | Same as `get_taxonomy` 404 — the slug belongs to another workspace. |
| A feature's code won't localize | `globs: []`, lower confidence, and say so in `report.md`. Never guess a boundary. |
