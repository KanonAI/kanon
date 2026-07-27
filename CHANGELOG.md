# Changelog

## 0.10.1 — 2026-07-25

**Published from a dedicated public marketplace.** The plugin now ships from
`KanonAI/kanon` — a self-contained, dist-only mirror — instead of the
private product repo. Install with:

    claude plugin marketplace add KanonAI/kanon
    claude plugin install kanon

- Fixed the README install command, which still pointed customers at the
  private `kanon-web` product repo.
- Documented the short install form (`kanon`, not `kanon@kanon`) —
  the `@marketplace` suffix is only needed to disambiguate across marketplaces.

## 0.8.0 — 2026-07-21

**Passing tests now verify claims.** Until now every scanned claim landed
_Asserted_ (inferred from code) and stayed there — guides showed 0% Verified
because nothing linked the customer's tests to claims. This release adds the CI
half of that link.

### Per-test line coverage → Verified

- **`/kanon:setup-ci`** — wires a tiny coverage collector into your test
  suite. It ships as `dist/ci/vitest-setup.js` (Vitest) and
  `dist/ci/jest-setup.cjs` (Jest); both require an **Istanbul** coverage
  provider. The collector snapshots `globalThis.__coverage__` around each test
  and records the exact source lines that test executed, into per-worker shards
  under `.kanon/coverage`.
- **`cli.js push-tests [repoSlug]`** (and the `kanon_push_tests` MCP tool)
  — merges the shards and POSTs them to the new **`POST /api/tests`**. The
  server replaces the repo's coverage snapshot and re-links its claims, so a
  covered claim earns **Verified** immediately — no re-scan needed. Run it only
  after a green suite: `vitest run --coverage && node dist/cli.js push-tests`
  (the `&&` is what makes every recorded test a pass).
- `coverage-merge <out.json>` writes the merged payload without pushing, for
  inspection. The wire contract is vendored as `schemas/test-coverage.schema.json`
  and validated offline before every push.
- `/kanon:scan` now closes with a verification footer — a fresh scan's
  claims land **Asserted**, and the footer points the user at
  `/kanon:setup-ci` so they know how to make passing tests verify them.

Requires a Kanon server with `/api/tests` (deploy the server before
releasing this plugin). Additive — no existing wire contract changed.

## 0.7.0 — 2026-07-20

**Guides that answer, not just record.** A two-expert evaluation of a generated
guide found it an honest *source of record* but a weak *answering instrument*:
the flows and business logic were on the wire but flattened, there was no
at-a-glance layer, and a textbook Active→Frozen feature shipped with zero state
diagrams. This release makes the scan produce the structure the guide renders.

### An at-a-glance layer

- **`frontMatter.keyFacts`** — 4–8 at-a-glance facts (`label`, `value`, optional
  `unit`/`meaning`, plus `ruleRefs`/`anchors`) that render as the stat band at
  the top of the guide: the spending cap, the grace period, the interest rate a
  stakeholder asks first. Every value is held to the worked-example bar — a real
  constant from `facts.json` or a claim — and **assembly DROPS any row grounded
  by neither a `ruleRef` nor an `anchor`**, with a named warning. The
  anti-fabrication number scan now covers key-fact values too.
- **`frontMatter.feeSchedule`** — a fee table (`fee`, `amount`, `trigger`,
  optional `timing`/`waiver`) for features that charge fees, grounded row by row.
  Omit it entirely for fee-less features; never manufacture a fee. Fee amounts
  join the number scan.
- Both are additive-optional on the wire — `bundleVersion` is unchanged and old
  bundles stay valid. The vendored `guide-bundle.schema.json` carries the new
  fields; `unit`/`meaning`/`timing`/`waiver` are stripped when absent (the wire
  marks them optional, not nullable).

### The lifecycle is no longer silently optional

- **`check:"synthesis"` warns when a feature looks status-bearing but
  `synthesis.lifecycle` is null**, and NAMES the signal it found — a
  status/state enum in `facts.json`, a dive that already declares a
  `stateMachine`, or a claim describing a freeze/suspend/reactivate transition.
  It's a warning, never a bounce (a generic open/closed enum shouldn't block a
  session), but the skill now says to treat it as a bounce unless the feature is
  genuinely stateless — in which case record why in `manifest.notes`.
- `check:"front-matter"` notes when `synthesis.lifecycle` exists but
  `frontMatter.lifecycle` is absent — carry it across so the guide renders the
  state diagram — and validates key-fact/fee anchors against the same read∪
  closure universe as the narrative.

### Cleaner constants, honester prose

- **Schema-default parameter facts are restricted to seed-evidenced tables.** A
  near-neighbor table dragged in by the import closure kept its entity fact but
  no longer leaks its column defaults into an unrelated feature's constants
  table (the payroll `futa_rate` in a credit feature). Unknown closure depth now
  coarsens to `2`, not `1`, so a neighbor never reads as a strong-evidence
  near file.
- **Parameter facts carry an optional `category`
  (`fee`/`limit`/`threshold`/`timing`/`toggle`) and `unit`
  (`cents`/`percent`/`ratio`/`days`/…)**, classified heuristically, so the guide
  can group and humanize constants instead of dumping a flat list.
- **Prose discipline, documented and enforced by the skill.** The narrative must
  not restate the principles (which now render *after* the chapters, under "Under
  the hood", not as a redundant opening); any enumeration of 3+ like items is a
  markdown list, never a comma-splice, because paragraph text renders as
  markdown.

### Parallel research

- **Aspect research fans out.** Each aspect worker appends to its OWN
  `claims/<aspectKey>.jsonl` and `readlog/<aspectKey>.jsonl` and writes its own
  `dives/<aspectKey>.json`, so concurrent workers never race on one append-only
  file. **New `check:"merge"`** folds the per-aspect files into the flat
  `claims.jsonl` + `readlog.jsonl` once every dive has passed — first-wins on
  `normalizedRuleKey` (the same rule surfacing in two aspects is expected), and
  only a genuine one-key-two-statements CONFLICT is reported. Resume re-dispatches
  only the aspects whose dive is missing or still bouncing.
- **`scan-all` runs a feature pool.** Approved features go through a bounded pool
  of workers (FLEET_CONCURRENCY 3) instead of a serial loop; aspects stay serial
  *inside* each feature worker (no nested workers), so at scan-all scale the
  parallelism is across features. One feature failing terminally never stalls the
  fleet.
- **Pre-research freshness skip — `check:"freshness"`.** After `select_files`,
  the skill computes the server's plugin guide-input hash locally (the SAME
  `computePluginGuideInputHash` the server stamps, so the two can't drift) and
  compares it to the stored hash from `kanon_get_guide_status`; an
  `unchanged:true` skips §3–§9 entirely — a re-scan of an untouched feature no
  longer pays a full research pass just to reach `skipped:true` on push. The hash
  folds in the feature's `capabilities` (new `manifest.capabilities`, copied from
  the taxonomy); a missing or mismatched value fails toward researching, never a
  false skip, and the push stays authoritative.

## 0.6.0 — 2026-07-20

**The pipeline stopped making sessions guess.** A full dogfood run — setup →
discover → push → scan of a 16k-file monorepo — spent **29% of its Kanon
tool calls (11 of 38) being rejected for shape**, and another ~5 minutes
retrieving reports from subagents that had already finished. The grounding gates
themselves were flawless (309/309 assertions grounded, zero bad anchors) and are
untouched here; everything below is the friction around them.

### A shape rejection now carries the contract

The dominant cost was discovering required fields by submitting and being
rejected — worst of all because the reference docs demonstrated shapes the
validator refuses (`"stateMachine": null`, `"lifecycle": null`).

- **Rejections name the file and include a working example.** `checkFull` parses
  five artifacts back to back; a bare `rules.0.requirementLevel: ...` never said
  which file to open. Every shape failure now returns `artifact`, `requiredKeys`,
  and a validator-accurate `example` — the contract arrives *with* the
  rejection, so it costs zero extra round-trips.
- **`check: "schema"`** returns a full and a minimal example per artifact and
  needs no run dir, for a session that wants the shape before writing.
- **`null` means "there isn't one"** for `dives[].stateMachine`,
  `frontMatter.lifecycle`, `manifest.currentAspect`, and the other wire-optional
  fields — the form the docs already taught. The three fields the wire requires
  *present and nullable* keep their defaults, so an omitted key still
  serializes.
- **Unknown keys are rejected, not dropped.** Session-written artifacts are
  strict now. A session that wrote `entities[].name` and `.description` had that
  research silently deleted on its way to the wire, with no error at any stage.
  Tool-written artifacts, the resume anchor (`manifest.json`), and
  `readlog.jsonl` stay permissive on purpose — strictness there would break
  resume, or shrink the read set and bounce a dive for the wrong reason.
- **`synthesis.json` finally has a literal example.** It was the one artifact
  documented only in prose. Both new tests are drift guards: every example must
  parse *and* exercise every field in its schema, and every JSON block in the
  reference docs is parsed by the validator in CI. A doc example the validator
  would reject now fails the build.
- **Invalid `claims.jsonl` lines are reported.** They were counted and never
  surfaced, so a typo'd claim silently shrank the valid rule-key set and
  resurfaced as a bogus "unknown ruleRef" blamed on the dive.
- Synthesis lifecycle is validated against the *stricter* of the wire's two
  state-machine contracts, so `tone`/`on` failures surface at `check:"synthesis"`
  instead of four stages later at `check:"full"`.

### Discovery documents the fan-out it was already doing

`/kanon:discover` §3 was a serial six-step procedure; sessions improvised a
parallel mapper fan-out that produced adopt-verbatim output — then lost minutes
because nothing told the mappers how to deliver.

- **§3a prescribes the fan-out and the return contract**: one mapper per area,
  all spawned in a single message, each told that **its final message IS its
  report**. Includes the prompt template that produced the good output
  (file-path evidence, per-finding confidence, an honest "could not verify").
- **`.github/CODEOWNERS` is now swept** (§3.7) — the strongest available signal
  for a domain's `space`, previously only namedropped as an evidence source.
- **Nav links are resolved** against real page files during synthesis; dead
  entries are reported as gaps.
- Discovery gained the progress-rendering rule and failure playbook that setup
  and scan already had.

### `route` is optional — a feature may have no surface

The contract required `route` on every feature, so a workflow engine, an RBAC
model, and four pieces of app chrome were anchored to `/v2` purely to pass
validation: the schema editing the taxonomy. Every layer below already accepted
absence (`ProposedFeature` documents `""`, ingest maps it to SQL NULL, the column
is nullable). **Omit `route` when there is no user-facing route; never invent
one.** `bundle.schema.json` re-emitted; this is a backward-compatible
relaxation, so `bundleVersion` is unchanged and existing bundles stay valid.

### Fewer, smaller round-trips

- **`kanon_get_taxonomy` returns a compact projection by default.** At 77
  approved nodes the full payload is 77 KB and **exceeded the MCP response limit
  outright** — in three separate preflights. Compact drops `description` and
  `capabilities` and keeps every structural field; pass `view: "full"` for the
  prose.
- **The scan-all queue is built from the taxonomy alone** — zero extra calls,
  down from one `get_guide_status` per feature (60+ at real scale) for an answer
  it could not give: input-hash staleness needs the local file closure, which
  does not exist until `select_files` runs.
- **A >300-file closure is re-walked at depth 2 automatically.** The graph is
  already in memory, so the retry is one BFS; an explicit `maxForwardDepth` is
  never overridden.
- **`/kanon:setup` fast-paths** a signed-in session whose config already
  agrees with `git remote` — one confirmation instead of re-walking §2–§5.

### Gates that were crying wolf

- **The worked-example number check compares numeric values, not digit
  strings.** `0.80` became `"080"` and never matched the real `0.8`, so the
  anti-fabrication warning fired on the very constants it exists to protect —
  ~90% false positives, which trains sessions to ignore it. File paths no longer
  count as corroboration either (a digit in `v2/` is not evidence).
- **`check:"aspects"` warns when an entry point goes unassigned.** A route table
  and every cron handler landed in `unassigned` and were caught only by
  eyeballing a ten-item sample. It also warns when a `pathPattern` matches
  nothing — usually a mid-directory wildcard like `src/*/handlers/**`, which the
  matcher cannot take.

## 0.5.2 — 2026-07-20

**Fix: a code-only run could not produce a valid bundle.** The bundle contract
required `screenGraph.screens` to have at least one entry, and the assembler
threw `nothing was crawled` when `screens/` was absent — so the mode 0.5.1 made
the default was unassemblable. Code-only mode has been documented since 0.4.0
but was never able to complete; 0.5.1 is what made that reachable.

`screens` may now be empty. The invariant it was standing in for is preserved
where it actually belongs: a bundle citing **`crawl` evidence** with zero
screens is rejected by `/api/ingest`, because that pair is fabricated support
for a taxonomy a human is asked to trust. Empty screens plus code-signal
evidence (`route`, `nav`, `guard`, `schema`, …) is the legitimate code-only
shape.

- `schemas/bundle.schema.json` re-emitted (`minItems` dropped from `screens`).
  The cross-field crawl-evidence rule is not expressible in JSON Schema, so the
  plugin-side validator does not enforce it — the server does, at ingest.
- The synthesis reference now lists the code-signal evidence sources and states
  that `"crawl"` is refine-mode only; previously it offered only
  `crawl`/`nav`/`agent`, which pushed code-only runs toward mislabeling.

## 0.5.1 — 2026-07-19

**Fix: `/kanon:discover` ran the browser crawl by default.** Code-only
was already the documented default, but refine mode triggered on "`--refine`
**or a target URL**" — and a target URL is present on essentially every run,
because `/kanon:setup` asks for one, writes it to
`.kanon/config.json`, and hands it to discovery, while discover's own
preflight asks for one when it's missing. The condition was true by
construction, so the default was unreachable.

`--refine` is now the sole trigger. A `targetUrl` from any source — argument,
config, or setup handoff — is bundle metadata (the bundle contract requires
it) and never implies a crawl. Docs that still described discovery as
crawl-first are corrected: both plugin manifests, the README, and
`/kanon:setup` (Claude in Chrome is no longer presented as a
prerequisite — it's only needed for `--refine`).

## 0.4.0 — 2026-07-18

`/kanon:scan` with no arguments now scans **all** approved features in a
loop: it partitions the taxonomy into queued / up-to-date (server input hash
unchanged) / not-scannable (no boundary), confirms once, then runs the full
pipeline feature by feature — one failure never stops the fleet, and a final
summary lists pushed / skipped / failed with review links. The previous
single-feature behavior moved behind **`--next`** (an interactive pick over
the queue, the next feature needing a guide recommended first); naming a
feature-key still scans exactly that one. The loop
keeps no fleet state: an interrupted run resumes per §0 and the queue is
re-derived from the server's hash-skip.

## 0.3.0 — 2026-07-18

Plugin-generated feature guides: **`/kanon:scan`**. The session researches
one approved feature natively (Read/Grep) while the mechanical stages run the
**real Kanon server code**, bundled into the MCP server at build time
(esbuild aliases `@/*` → the app's `src`, with a `server-only` shim) — the same
import-graph closure, file selection, pruning, and fact collection the server
uses, so a guide built on your machine matches a server-side scan.

- New tools: `kanon_select_files` (boundary globs → research file set via
  the real import graph, written to `files.json`), `kanon_collect_facts`
  (the real fact collector → `facts.json`), `kanon_assemble_guide` (the
  grounding gate: `aspects`/`dive`/`synthesis`/`front-matter`/`freshness`/`full`),
  `kanon_push_guide`, `kanon_get_guide_status`. CLI twins:
  `dist/cli.js select-files|collect-facts|assemble-guide|push-guide`.
- The gate enforces the server's discipline mechanically: priority files must be
  read, ≥80% of paragraphs and flow steps must be grounded (a claim ruleRef or a
  `path:line` anchor onto a file actually read), principles must span ≥2 aspects,
  worked-example constants must be real, and the assembled `guide-bundle.json` is
  validated against the vendored wire schema before push. Rule references are
  written as human keys in the run dir and mapped to symbolic `rule:`/`cited:`
  indices at assembly. The model never hand-writes facts or the bundle.
- `/kanon:discover` now derives a per-feature `boundary` (prefix globs +
  route prefixes) when run inside a repo — this un-halves the feature's
  confidence and is what makes it scannable. `/kanon:status` shows which
  features are scannable and which already have a guide.

## 0.2.0 — 2026-07-17

One-command onboarding: **`/kanon:setup`**. Sign in from your own Claude
Code session via device authorization — `kanon_setup_begin` returns a
short code + verify URL you approve in a browser (sign-up and workspace creation
happen there), and `kanon_setup_poll` waits for approval and writes the
machine token to `~/.kanon/credentials.json` (0600). The token is issued
to disk and **never returned to the model or shown in the conversation**; the
device secret lives only in `~/.kanon/device-pending.json` and is likewise
never surfaced. The skill then verifies the workspace (`kanon_whoami`),
writes `.kanon/config.json`, and hands off to `/kanon:discover`.

- New tools: `kanon_setup_begin`, `kanon_setup_poll`,
  `kanon_whoami`. CLI twins: `dist/cli.js setup-begin|setup-poll|whoami`.
- New config tier: `~/.kanon/credentials.json`, keyed by normalized server
  URL (multiple instances supported). Precedence now: shell env → plugin
  settings (keychain) → credentials file → project file. Sign out = delete the
  entry (or the file). `KANON_HOME` overrides the location.
- Config resolution is per-tool-call, so a fresh sign-in is picked up without an
  MCP restart. `kanon_whoami` reports each field's *source*, surfacing a
  shell `KANON_API_TOKEN` that shadows a fresh sign-in.
- Guidance across the API/skills now points at `/kanon:setup`; 404 reflects
  the "unclaimed slug claims into your workspace on first fetch/ingest" model.

## 0.1.1 — 2026-07-17

Fix: the bundled MCP server never started in `--plugin-dir` dev sessions —
`required: true` userConfig fields fail validation when the install-time
prompt hasn't run, and Claude Code withholds the plugin's MCP server
entirely. Config fields are no longer required (the config tiers in
`config.ts` — shell env → userConfig → `.kanon/config.json` — handle
absence, and tools return actionable guidance when unset). Skills now carry
explicit fallbacks for tool-less sessions: `dist/cli.js validate|assemble`
and a curl-based push.

## 0.1.0 — 2026-07-16

Initial release.

- `/kanon:discover` — breadth-first crawl via Claude in Chrome
  (human-in-the-loop login, read-only guardrails, incremental disk recording,
  compaction-safe resume), nav→capability synthesis, validated bundle
  assembly.
- `/kanon:push` — schema validation + POST to `/api/ingest`; proposals
  land behind Kanon's human review gate.
- `/kanon:status` — taxonomy state + recent ingest runs.
- Bundled MCP server: `kanon_validate_bundle`,
  `kanon_assemble_bundle`, `kanon_push_bundle`,
  `kanon_get_taxonomy`, `kanon_ingest_status`.
- Bundle contract v1 (`schemas/bundle.schema.json`, emitted from the server's
  Zod schema).
