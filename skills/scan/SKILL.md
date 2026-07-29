---
name: scan
description: >
  Deep-scan approved features and generate verified feature guides: read the
  code inside each feature's boundary, extract grounded behavioral rules, and
  assemble chaptered guides the server publishes for review. No arguments scans
  ALL approved features in a loop; --next scans only the next feature needing a
  guide; a feature-key scans exactly that one. Use for "scan a feature",
  "generate feature guides", "document what this feature does", "scan
  everything".
argument-hint: "[--next | feature-key] [repo-slug] [--non-interactive]"
disable-model-invocation: true
---

# Kanon Scan

## Non-interactive mode (the worker daemon)

`--non-interactive` means NO ONE is watching — the Kanon worker daemon is
running this headlessly for a task queued from the Kanon UI. Three rules
replace every `AskUserQuestion` below:

1. **Never ask, never wait.** Repo slug comes from `KANON_REPO_SLUG`; the
   feature (if any) comes from the arguments. Skip the §10 up-front
   confirmation and every per-feature confirmation — proceed immediately.
2. **No argument = the full sweep.** Scan every approved feature exactly as
   the no-argument loop does, honoring the freshness pre-skip and continuing
   past individual failures. `--next` is meaningless headless (it exists to
   ask); treat it as the full sweep.
3. **Report, don't prompt, on missing boundaries.** A feature with no
   boundary globs is skipped with a note in the output — never a question.

Take approved features from taxonomy to published guides. The pipeline (§1–§9)
runs ONE feature at a time: you select the files inside the feature's boundary,
read the code, extract behavioral rules grounded in what you actually read, and
hand the server structured chapters it renders and publishes. The guide lands
for human review — nothing is "fact" until approved. **Fidelity over
completeness: every sentence traces to code you read, or it does not ship.**

**Claims land Asserted, not Verified.** A scan *infers* behavioral rules from the
code — the server stores them **Asserted** (honest inference), never Verified. A
claim earns **Verified** only when a passing test covers its source line, and
that evidence is wired up SEPARATELY by the customer via **`/kanon:setup-ci`**
(per-test CI coverage → `/api/tests`). Scanning alone never turns a claim green.
So whenever you report pushed guides (§9, §10), end with the **verification
footer**:

> Claims land **Asserted** (inferred from code). To verify them with your own
> tests, run **`/kanon:setup-ci`** — passing tests then move the guide's
> coverage bar off 0%. (Already set up? Coverage you've pushed is applied
> automatically; nothing to do.)

## Modes (parse `$ARGUMENTS` first)

- **No arguments — scan all (default).** Queue every approved feature and run
  the pipeline over the queue, one feature at a time. See §10.
- **`--next`** — scan ONE feature: `AskUserQuestion` over that same queue,
  recommending the first (the next approved feature with a boundary and no
  guide yet), then stop and report what's left.
- **`<feature-key>`** — scan exactly that feature.

An `owner/repo`-shaped argument (contains `/`) is the repo-slug, never a
feature key.

The tools do the mechanical work (file closure, fact extraction, assembly,
push); you do the reading and the grounding. The disk is your memory: write a
chapter, then forget it — `dives/`, `claims.jsonl`, and `readlog.jsonl` hold
the state, not your context window.

Reference files (read when you reach that stage):
- `${CLAUDE_PLUGIN_ROOT}/skills/scan/references/research-method.md` — the per-aspect research loop (§5)
- `${CLAUDE_PLUGIN_ROOT}/skills/scan/references/guide-shape.md` — the guide skeleton the content targets (§7–8)
- `${CLAUDE_PLUGIN_ROOT}/skills/scan/references/run-format-scan.md` — the on-disk run-dir spec

## Progress rendering (standing rule)

After EVERY state change, re-render this one line (states: ⬜ not started ·
🔄 in progress (with a parenthetical) · ✅ done · ⚠️ done-with-caveat · ❌ failed):

`✅ Preflight · 🔄 Select · ⬜ Facts · ⬜ Aspects · ⬜ Research (0/N) · ⬜ Synthesis · ⬜ Front matter · ⬜ Assemble · ⬜ Push`

`Research (0/N)` counts resolved aspects marked `researched`. In scan-all mode
prefix the line with the fleet position: `Feature k/M · <featureKey> —`. Then,
in at most three short lines: **what just happened**, **what's happening now**,
and **what the user should do RIGHT NOW** (or "nothing — I'm working"). Never
go silent across a tool call.

## Standing grounding rules (inviolable)

These are the discipline the server's gates enforce. Violating them wastes a
gate round-trip; internalize them instead.

- **Ground every sentence.** Every paragraph AND every flow step cites its
  evidence: a `ruleRef` (a `normalizedRuleKey` from `claims.jsonl`) and/or an
  anchor `"path:line"` pointing at code you actually READ. A flow step is an
  assertion — ground it like any other sentence.
- **Never cite what isn't there.** Never reference a rule key that doesn't
  exist in `claims.jsonl`. Never anchor a file that isn't in your `readlog`.
  Uncited paragraphs render as *unverified* — if you can't ground a sentence,
  research it or drop it.
- **Never fabricate values.** Do not invent ratios, fees, thresholds, caps,
  schedules, states, or table/column names — READ them. Every CONSTANT in a
  worked example must be the real one from the facts or claims. Invent only
  illustrative inputs with no real counterpart (a sample balance, a date). A
  made-up ratio is a fabrication even inside an example.
- **The disk is the memory.** Research fans out (§5): each aspect worker
  appends to its OWN `claims/<aspectKey>.jsonl` and `readlog/<aspectKey>.jsonl`
  and writes its own `dives/<aspectKey>.json` — never the shared flat files.
  `check:"merge"` folds the per-aspect files into the flat `claims.jsonl` +
  `readlog.jsonl` once every aspect has passed.
- **Never hand-write tool files.** `files.json`, `facts.json`,
  `guide-bundle.json`, and — after `check:"merge"` — the flat `claims.jsonl` +
  `readlog.jsonl` are written by the tools ONLY. If assembly complains, fix the
  run artifacts you own (`aspects.json`, the per-aspect `claims/*` +
  `readlog/*`, `dives/*`, `synthesis.json`, `front-matter.json`) and re-run —
  re-run `check:"merge"` rather than editing a merged flat file by hand.

Non-tool sessions (no `kanon_*` MCP tools) use the `dist/cli.js` twins:
`node ${CLAUDE_PLUGIN_ROOT}/mcp-server/dist/cli.js select-files|collect-facts|assemble-guide|push-guide …`.

## 0. Resume detection (do this first)

Find the newest `.kanon/runs/*-scan-*/manifest.json`. If its `status` is
anything other than `pushed` or `failed`, this is a resume: re-read
`manifest.json`, `aspects.resolved.json`, and which `dives/*.json` already
exist, then continue from the recorded `status`/`currentAspect`. Re-derive
`Research (n/N)` from aspects marked `researched`. Do not restart; do not
re-scan an aspect whose dive already passed.

Research runs in parallel (§5): each aspect owns `claims/<key>.jsonl`,
`readlog/<key>.jsonl`, and `dives/<key>.json`, all append-only per aspect. So
re-dispatch ONLY the aspects whose dive is missing or still bouncing — a dive
that already passed is never re-run. Once every aspect has passed, (re-)run
`kanon_assemble_guide { check:"merge" }` before §6 (it's idempotent).

In scan-all mode, finish the interrupted run first, then rebuild the queue
(§10) and continue — there is no fleet state file; features already pushed drop
out of the queue via `hasGuide`, so re-deriving is safe.

## 1. Preflight

1. `kanon_whoami`. Not signed in → stop, point at `/kanon:setup`.
2. **Git root + cleanliness**: find the repo root; run `git status --porcelain`.
   Guides pin the current commit, so a dirty tree makes anchors ambiguous —
   ⚠️ warn and offer to commit (or let the user proceed knowingly).
3. `kanon_get_taxonomy` — it returns a **compact** projection by default
   (`view: "compact" | "full"`), which drops `description` and `capabilities`
   but keeps every structural field this skill needs: `key`, `parentKey`,
   `state`, `route`, `space`, `boundary`, `hasGuide`, `guideUpdatedAt`. Ask for
   `view: "full"` only when you actually need the prose. Resolve the mode
   (see **Modes**):
   - **`<feature-key>` given** → pick that approved feature (unknown key →
     `AskUserQuestion` from the approved features).
   - **`--next`** → build the §10 queue and `AskUserQuestion` which ONE
     feature to scan, recommending its first (the next needing a guide); empty
     queue → report "every approved feature already has a guide" and stop.
   - **no arguments** → jump to §10 (scan-all); per queued feature the loop
     re-enters at step 5 below, with the boundary already read from the
     taxonomy.
   Read the chosen feature's `boundary: { globs, routePrefixes } | null`.
   - **`boundary` null or empty** → the feature isn't scannable yet. Offer to
     run `/kanon:discover` (code-mode derives boundaries), OR ask the user
     for 1–4 prefix globs (`dir/**` semantics) to seed the scan.
4. **Optional, and single-feature modes ONLY**: the taxonomy already gave you
   `hasGuide` + `guideUpdatedAt`. When a guide exists, you may spend one
   `kanon_get_guide_status { domainKey, featureKey }` to confirm before
   committing to a scan, then **offer to skip**. For a DEFINITIVE answer, carry
   its `inputHash` to the §2 freshness pre-skip (it needs `files.json`, which
   doesn't exist until select runs). **Never call `get_guide_status` per feature
   in scan-all mode** (§10.1) — see §10.2 for the re-scan pre-skip.
5. Create the run dir `.kanon/runs/<UTC-stamp>-scan-<featureKey>/` and
   `manifest.json` (`kind:"scan"`, `status:"selecting"`, the feature identity,
   your `model`, empty `aspects`). Record the feature's `capabilities` from the
   taxonomy when you have them — the §2 freshness pre-skip hashes them, so a
   missing/empty list only makes that skip fall back to researching (never a
   false skip). `capabilities` come from `view:"full"` (compact drops them), so
   populate them only when a pre-skip is in play (§10.2). Announce the path. See
   run-format-scan.md.

## 2. Select

Call `kanon_select_files { runDir, globs }` (the boundary globs). It walks
the import closure and writes `files.json` — **adopt it; never hand-write it.**

- **`closureUnavailable`** (non-TS repo, no import graph): widen the seed by
  grepping the feature's nouns — e.g. `grep -rlniE
  '<noun1>|<noun2>|<featureName>' <boundary-dir>` — add the hits to the globs,
  re-run, and note in `manifest.notes` that closure was unavailable.
- **> 300 files selected**: re-run with `maxForwardDepth: 2` to bound the
  closure. Set `status:"researching"` once `files.json` is adopted.

**Freshness pre-skip (only when the feature already has a guide).** Once
`files.json` is adopted you can prove nothing changed BEFORE spending any
research: call `kanon_get_guide_status { domainKey, featureKey }` for its
`inputHash`, then `kanon_assemble_guide { runDir, check:"freshness",
storedInputHash:"<inputHash>" }`.

- **`unchanged: true`** → the closure, model, feature name and capabilities are
  byte-identical to the stored guide; skip §3–§9 entirely (a push would only
  return `skipped:true`). Set `manifest.status:"pushed"`, report ⏭ skipped, done.
- **`unchanged: false` / `null`** → research is warranted; continue. (`null` =
  no stored hash passed; a `false` from a missing/mismatched `capabilities` or
  name fails safe toward researching — never a false skip.)

This is the biggest lever on re-scans (cron refreshes, whole-repo re-runs). It
needs `manifest.capabilities` populated to fire on features that have them (§1.5).

## 3. Collect facts

`kanon_collect_facts { runDir }` writes `facts.json` — the mechanical fact
surface (data-model table, route map, cron/schedule table, constants) **plus the
structured product-and-risk facts the collector can pattern-match: feature
flags, analytics events, experiments, and security findings.** **The server
renders these facts in the guide; your prose REFERENCES them, it never restates
them as tables.** Adopt `facts.json`; never hand-write it. The collector is a
floor, not a ceiling — research (§5) actively sweeps the same five dimensions to
catch what patterns miss (the flag's off-branch, the uncovered interaction, the
testing gap, the missing-auth finding).

## 4. Plan aspects

Write `aspects.json`: **3–8 business-meaningful chapters**, grouped by what the
code MEANS, not by directory. Each: kebab `key`, `name`, `description`,
optional `order`, and `pathPatterns` (globs, first-match-wins — put specific
patterns early). Order user-facing flow first, internals after. Examples:
`signup-approval-flow`, `scheduled-jobs-engine`, `risk-controls`,
`admin-operations`, `customer-ui`, `vendor-integration`. (Aspects over 40 files
auto-split during resolution.)

Then `kanon_assemble_guide { runDir, check:"aspects" }`. It materializes
`filePaths` (first-match over the selected files) + `priorityFiles` and writes
`aspects.resolved.json`. **Adopt the resolved keys + `priorityFiles`** and copy
them into `manifest.aspects` (each `{ key, status:"pending" }`). Set
`status:"researching"`.

## 5. Research — fan out one worker per aspect

The aspects are independent — a stateless, read-only closure per chapter — so
research them IN PARALLEL, not one at a time. Dispatch each resolved aspect to
its own subagent (the Task tool), **up to 4 at a time** (drop to 2 if you hit
rate limits; raise only if you don't). The research wall collapses from the sum
of every aspect to about the longest single one, and the guide is the quality it
would be serially: every dive still passes the SAME grounding gate. Parallelism
trades tokens for wall-clock — each worker reasons on its own context — but the
closure reads and the gate are unchanged.

**Do NOT nest workers.** If THIS feature is itself running inside a scan-all
feature worker (§10), research its aspects SERIALLY in that worker — the fleet
already parallelizes across features, and a worker spawning workers is not
supported. Fan out only when this is the top-level feature (single-feature or
`--next` modes).

Give each worker this brief (it works entirely from disk — the run dir is the
shared memory, not your context):

> Research aspect `<aspectKey>` of feature `<featureName>` in run dir `<runDir>`.
> Read `${CLAUDE_PLUGIN_ROOT}/skills/scan/references/research-method.md` and the
> standing grounding rules first. Your files are the aspect's `filePaths`; your
> `priorityFiles` are both in `aspects.resolved.json`.
>
> 1. **Read every `priorityFile` FULLY, first.** Append each path to
>    `readlog/<aspectKey>.jsonl` (your OWN per-aspect readlog — a bare JSON
>    string per line) as you read.
> 2. **Extract behavioral rules to `claims/<aspectKey>.jsonl` AS YOU READ** —
>    one per line: `{ statement, codeAnchor:"path::Symbol", normalizedRuleKey,
>    sourcePath, sourceLine }`. Each `normalizedRuleKey` is a stable kebab key,
>    unique WITHIN your aspect (a key two aspects happen to share is deduped
>    first-wins at merge — name by meaning, not by number). **Sweep the five
>    lenses in research-method.md on every aspect — tracking, testing, security,
>    experiments, flags — grounding each finding (and each GAP) as a claim.**
> 3. **Write `dives/<aspectKey>.json`** grounding EVERY paragraph and EVERY flow
>    step with a `ruleRef` (a key from your claims) and/or an anchor
>    `"path:line"` onto a file you read. Worked-example constants must be real.
> 4. `kanon_assemble_guide { runDir, check:"dive", aspectKey:"<key>" }`.
>    It grades against YOUR per-aspect claims + readlog. Fix bounces (unread
>    priority file → read it; <80% grounded → add a `ruleRef`/anchor or drop the
>    sentence; bad anchor → read the file or fix the path) and re-check until it
>    PASSES. Never lower the bar by deleting evidence.
> 5. Report back `{ aspectKey, passed, grounded, total }`.
>
> **Isolation (inviolable):** write ONLY `claims/<aspectKey>.jsonl`,
> `readlog/<aspectKey>.jsonl`, and `dives/<aspectKey>.json`. NEVER touch the
> flat `claims.jsonl` / `readlog.jsonl` or `manifest.json` — those are the
> parent's, and concurrent writes to one shared file corrupt it.

As each worker returns a pass, YOU (the parent) flip its `manifest.aspects[]` to
`researched`, bump `Research (n/N)`, and re-render the progress line. A worker
that cannot pass after honest effort → leave it `pending`, note why, and go on;
the guide ships thinner (the size gate counts blocks, and a lost chapter beats a
stalled fleet).

**Then merge.** Once every aspect has resolved, run
`kanon_assemble_guide { runDir, check:"merge" }`. It folds every
`claims/<key>.jsonl` + `readlog/<key>.jsonl` into the flat `claims.jsonl` +
`readlog.jsonl` that §6–§8 read (first-wins dedup). If it reports a `conflict`
(one rule key claimed by two DIFFERENT statements), rename one key in its owning
per-aspect file and re-run merge; identical restatements dedupe silently. Then
go to §6 (which sets `status:"synthesizing"`).

## 6. Synthesis

Set `status:"synthesizing"`. Write `synthesis.json` from the claims + source
(mirrors the server's `SynthesizedFeature`): `name`, `domainName`, `overview`,
`rules[]` (each with `requirementLevel` MUST/MUST_NOT/SHOULD/SHOULD_NOT/MAY and
the claim's `codeAnchor`/`normalizedRuleKey`/`sourcePath`/`sourceLine` reused
EXACTLY), `edgeCases`, `lifecycle | null`, `entities`, `integrations`,
`routines`, `parameters`, `decisions`, `openQuestions`, `knownIssues`. **Read
the source and actively extract every typed section you can support with
evidence. Leave a section empty ONLY if the source truly has none — don't
fabricate, but don't be lazy.** Then `kanon_assemble_guide {
runDir, check:"synthesis" }`.

**Lifecycle is REQUIRED when the feature has states.** If the data carries a
status/state enum (a `status`/`state` column, a `CreditCard_status`-style enum, a
freeze/suspend/reactivate flow), write `lifecycle` — **every state needs a
`tone`, every transition an `on` trigger** — and carry it into
`front-matter.lifecycle` too (§7), so the guide renders the state diagram.
`check:"synthesis"` scans facts/dives/claims for status signals and **warns when
they exist but `lifecycle` is null, naming the signal it found. Treat that
warning as a bounce** — write the lifecycle — unless the feature is genuinely
stateless, in which case record why in `manifest.notes`.

## 7. Front matter

Set `status:"composing"`. **Re-read the dives on disk** and write
`front-matter.json` FROM THEM:
- `narrative`: 2–4 paragraphs, each anchored to a `path:line` drawn from the
  chapters. The narrative summarizes what the feature does — it must **NOT
  restate the principles**; those render separately.
- `principles`: cross-cutting invariants, each spanning **≥2 aspect keys** — "a
  rule seen once is a detail, not a principle." Assembly DROPS any principle
  spanning <2 aspects.
- `keyFacts`: 4–8 at-a-glance facts (`label`, `value`, optional `unit`/`meaning`,
  `ruleRefs`/`anchors`). These render as the top-of-guide stat band. **Every
  `value` must be a REAL constant** from `facts.json` or a claim — the same rule
  as worked-example constants. Assembly DROPS any row grounded by neither a
  `ruleRef` nor an `anchor`.
- `feeSchedule`: only when the feature charges fees (`fee`, `amount`, `trigger`,
  optional `timing`/`waiver`, each row grounded by a `ruleRef`/`anchor`). Omit
  the field entirely for fee-less features — never invent a fee.
- `lifecycle`: carry `synthesis.lifecycle` here (§6) whenever the feature has
  states, so the guide renders the state diagram.
- `glossary`: 6–15 terms in plain language.
- Do NOT invent values or states no chapter mentions.
- **Any enumeration of 3+ like items must be a markdown list, never a
  comma-splice** — paragraph text renders as markdown, so "the six evaluators:
  A, B, C, D, E and F" in one run-on sentence renders as an unreadable wall.
  Write it as a list.

Then `kanon_assemble_guide { runDir, check:"front-matter" }`. See
guide-shape.md for what belongs in front matter vs the fact surface vs prose.

## 8. Assemble

`kanon_assemble_guide { runDir, check:"full", model:"<your model id>" }`.
It writes `guide-bundle.json` (tool-written — never hand-edit it). Fix any fatal
errors it lists by correcting the run artifacts you own and re-running (missing
dive → write it; unknown ruleRef → add the claim or drop the ref; duplicate rule
key → rename; >12 aspects → merge; no commit → commit). Show the stats +
warnings. Set `status:"assembled"`.

## 9. Push

1. Confirm `repoSlug` + the feature with the user (`AskUserQuestion`) —
   single-feature modes only. In scan-all mode the one-time §10 confirmation
   covers every push in the loop; never re-ask per feature.
2. `kanon_push_guide { path:"<runDir>/guide-bundle.json" }` (pass
   `repoSlug` if the bundle doesn't carry it).
   - **`skipped:true`** → "unchanged — the server kept the existing guide"
     (nothing in the boundary changed since the input hash).
   - **else** → report claim counts + the `reviewUrl`; link the KB
     (`<server_url>/kb/<repoSlug>`). In single-feature modes, offer to scan
     the next feature (or the rest of the queue).
3. Set `manifest.status:"pushed"`.
4. If any guide was pushed (not `skipped`), end with the **verification footer**
   (intro) — the claims just landed Asserted, and `/kanon:setup-ci` is how
   they earn Verified.

## 10. Scan-all loop (default — no arguments)

1. Build the queue **from the taxonomy alone**, in taxonomy order, from every
   approved feature. `kanon_get_taxonomy` already returns `boundary` and
   `hasGuide` per feature, so this costs **zero extra round-trips**:
   - **queued** — non-empty `boundary`, `hasGuide: false`;
   - **has a guide** — `hasGuide: true`; skipped by default;
   - **not scannable** — `boundary` null/empty (needs `/kanon:discover`).

   **Do NOT call `kanon_get_guide_status` per feature to partition.** At
   60 features that is 60 round-trips for an answer it cannot give: input-hash
   staleness is computed from the local file closure, which does not exist until
   `select_files` runs in §2. Queue on `hasGuide` and let the server's hash-skip
   be authoritative on push (§9.2) — an unchanged feature ends `skipped:true`,
   which is cheap and correct.
2. Show the partition, then confirm ONCE (`AskUserQuestion`): scan the M queued
   features, skipping X that already have guides and Y unscannable? Offer
   re-scanning the guided ones as an explicit choice — the user knows what
   changed, and the server drops any that didn't. This confirmation covers
   every push in the loop. **If the user opts to re-scan guided features**, do
   ONE `kanon_get_taxonomy { view: "full" }` and record each feature's
   `capabilities` into its manifest, so the §2 freshness pre-skip can cheaply
   drop the unchanged ones (otherwise each does a full research pass only to get
   `skipped:true` on push).
3. Run the queued features through a bounded worker POOL — dispatch each to its
   own subagent (the Task tool), **FLEET_CONCURRENCY = 3 at a time**. Each
   feature worker runs §1.5–§9 in its own run dir + manifest (with the feature
   identity, boundary, and — when re-scanning — capabilities in its brief),
   researching its aspects SERIALLY inside the worker (NO nested workers — the
   pool IS the parallelism at scan-all scale). Re-render the fleet-prefixed
   progress line as workers report. A feature that fails terminally (assemble
   fatal the worker cannot fix, push error, unapproved on push) → its worker
   sets `manifest.status:"failed"`, records why in `manifest.notes`, marks it
   ❌, and the pool moves on — one bad feature never stops the fleet. Pushes are
   independent and the server hash-skip is authoritative, so ordering never
   matters.
4. Finish with a summary table — feature · result (✅ pushed / ⏭ skipped (has a
   guide, or the push returned unchanged) / ⚠️ not scannable / ❌ failed +
   one-line reason) · `reviewUrl` — and link the KB
   (`<server_url>/kb/<repoSlug>`) once. If anything was ✅ pushed, close with the
   **verification footer** (intro).

The loop keeps NO fleet state file. Interrupted mid-fleet, the next
`/kanon:scan` finishes the interrupted run (§0) and re-derives the queue —
already-pushed features fall out via `hasGuide`.

## Failure playbook

| Symptom | Do |
|---|---|
| `whoami` not signed in | Stop; run `/kanon:setup`. |
| Feature not approved (guide push 404) | Approve it at `/discovery/<slug>` (or bulk-approve), then re-scan. |
| `boundary` null/empty | Run `/kanon:discover` (derives boundaries) or ask the user for 1–4 prefix globs. |
| `select_files` `closureUnavailable` | Widen the seed with a grep over the feature's nouns; note it in the manifest. |
| >300 files selected | Re-run `select_files` with `maxForwardDepth: 2`. |
| Dive bounce: priority file unread | Read the listed files fully, append to `readlog.jsonl`, re-check. |
| Dive bounce: <80% grounded | Add `ruleRef`s/anchors to the listed previews, or drop the unsupportable sentence. |
| Dive bounce: bad anchor | Anchor only files in `readlog ∪ closure`; read the file first or fix the path. |
| Assemble fatal: missing dive | Write the dive for the named aspect and re-run. |
| Assemble fatal: unknown ruleRef | Add the claim to `claims.jsonl` or remove the ref. |
| Assemble fatal: duplicate rule key | Rename one `normalizedRuleKey` to be unique. |
| Assemble fatal: >12 aspects | Merge aspects down to ≤8 business chapters. |
| Assemble fatal: no commit | Commit the working tree (guides pin the commit) and re-run. |
| `check:merge` reports a `conflict` | One rule key claimed by two DIFFERENT statements — rename one in its `claims/<aspect>.jsonl` and re-run merge. Identical restatements dedupe silently, no action. |
| Freshness `unchanged:false` when you expected unchanged | The manifest's `capabilities`/`featureName` likely don't match the approved feature — populate them from `get_taxonomy view:"full"`. Harmless: a mismatch only researches, never a false skip; the push still returns `skipped:true`. |
| Push `skipped:true` | Unchanged — the server kept the existing guide. Nothing to do. |
| Scan-all: one feature fails terminally | Mark its manifest `failed` with a note, continue the fleet, report it in the summary. |
| `--next` / scan-all finds an empty queue | Every approved feature already has a guide — report that and stop. |
| `get_taxonomy` payload too large | You asked for `view: "full"`. The default compact projection carries every field §1/§10 need. |

## Resumability

The scan survives interruptions: the run dir is the source of truth. On restart,
§0 re-reads `manifest.json`, `aspects.resolved.json`, and the existing
`dives/*.json`, and continues from the recorded `status`/`currentAspect`. A dive
that already passed its gate is never re-run; `claims.jsonl` and `readlog.jsonl`
are append-only, so partial progress is never lost.
