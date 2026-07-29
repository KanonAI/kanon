# Scan run directory format

Everything for one scan lives under
`.kanon/runs/<UTC-stamp>-scan-<featureKey>/` (e.g.
`runs/2026-07-16T14-05-00Z-scan-corporate-cards/`). The disk is the source of
truth — the assemble tool reads these files mechanically, and *you* re-read them
to recover state (§0 resume) and to compose front matter (§7).

```
manifest.json              # the scan state machine — update after EVERY state change  (session)
files.json                 # selected file closure                                      (TOOL: select_files)
facts.json                 # mechanical fact surface                                    (TOOL: collect_facts)
aspects.json               # your chapter plan                                          (session)
aspects.resolved.json      # materialized filePaths + priorityFiles                     (TOOL: assemble_guide check:aspects)
claims/<aspectKey>.jsonl   # per-aspect: rules a worker discovered (append-only)        (session — one worker per aspect)
readlog/<aspectKey>.jsonl  # per-aspect: files a worker READ (append-only)              (session — one worker per aspect)
dives/<aspectKey>.json     # one grounded chapter per resolved aspect                   (session)
claims.jsonl               # flat: the per-aspect claims folded in + deduped            (TOOL: assemble_guide check:merge)
readlog.jsonl              # flat: the per-aspect reads folded in + unioned             (TOOL: assemble_guide check:merge)
synthesis.json             # typed SynthesizedFeature index                             (session)
front-matter.json          # narrative + principles + glossary                          (session)
guide-bundle.json          # the assembled bundle — never by hand                       (TOOL: assemble_guide check:full)
```

Research fans out (SKILL.md §5): one worker per resolved aspect, each writing
ONLY its own `claims/<key>.jsonl`, `readlog/<key>.jsonl`, and `dives/<key>.json`
— so concurrent workers never race on a shared file. `check:merge` folds the
per-aspect files into the flat `claims.jsonl` + `readlog.jsonl` afterward.

**Tool-written, never hand-write**: `files.json`, `facts.json`,
`aspects.resolved.json`, `guide-bundle.json`, and — after `check:merge` — the
flat `claims.jsonl` + `readlog.jsonl`. If a tool complains, fix the
session-owned artifacts (the per-aspect `claims/*` + `readlog/*`, `dives/*`,
`synthesis.json`, `front-matter.json`) and re-run the check.

**Every JSON block below is parsed by the validator in CI** — what you see is
what passes. Two standing rules they encode:

- **An unknown key is an error, not a no-op.** Session-written artifacts reject
  fields that aren't in the schema rather than dropping them silently. If a
  field isn't shown here, it does not exist — don't invent one.
- **`null` means "there isn't one"** for `stateMachine`, `lifecycle`, and
  `currentAspect`. Omitting the key does the same thing.

If you'd rather read the contract than the prose, call
`kanon_assemble_guide { check: "schema" }` — it returns a full and a
minimal example for every artifact. A shape rejection returns them too, so you
never have to guess twice.

## manifest.json  (session)

<!-- kanon:example schema=manifest -->
```json
{
  "kind": "scan",
  "repoSlug": "acme/app",
  "domainKey": "banking",
  "featureKey": "corporate-cards",
  "featureName": "Corporate Cards",
  "capabilities": ["issue-virtual-card", "freeze-card"],
  "startedAt": "2026-07-16T14:05:00Z",
  "model": "<your model id>",
  "status": "researching",
  "relevanceBand": 0,
  "aspects": [
    { "key": "card-issuance", "status": "researched" },
    { "key": "risk-controls", "status": "pending" }
  ],
  "currentAspect": "risk-controls",
  "notes": ["closureUnavailable — seeded from grep over card/limit/authorization"],
  "timings": {
    "select": { "startedAt": "2026-07-16T14:05:10Z", "endedAt": "2026-07-16T14:05:40Z" },
    "research:card-issuance": { "startedAt": "2026-07-16T14:07:02Z", "endedAt": "2026-07-16T14:14:31Z" }
  }
}
```

`status` is one of `selecting · researching · synthesizing · composing ·
assembled · pushed · failed`; each `aspects[].status` is `pending` or
`researched`. `currentAspect` is `null` (or absent) when no aspect is in flight.

`relevanceBand` records the depth this run committed to (the SKILL's depth
policy) so a resume never re-derives the band and changes depth mid-run.
`timings` is the phase telemetry (SKILL "Timing telemetry"): one
`{ startedAt, endedAt }` per phase, plus `research:<aspectKey>` spans from the
worker reports. Both are diagnostic — the schema is loose and never rejects a
manifest over them — but stamp them as you go: a run with no timings can't
tell anyone where its wall-clock went.

`startedAt` is UTC ISO with a `Z`. `status` is the resume anchor — §0 reads it
to know where to pick up. Update it at every transition (`selecting` →
`researching` after files/aspects → `synthesizing` → `composing` → `assembled`
→ `pushed`). `aspects[]` is seeded from `aspects.resolved.json`; flip each to
`researched` only after its dive passes the gate. `Research (n/N)` in the
progress line = count of `researched` aspects.

## aspects.json  (session) → aspects.resolved.json  (tool)

You write the plan; the tool materializes it.

<!-- kanon:example schema=aspects -->
```json
[
  {
    "key": "card-issuance",
    "name": "Issuing a card",
    "description": "How a virtual or physical card is created and activated.",
    "order": 0,
    "pathPatterns": ["src/services/card-service.ts", "src/issuing/**"]
  },
  {
    "key": "risk-controls",
    "name": "Risk controls & authorization",
    "description": "How spend limits and balance checks gate every card transaction.",
    "order": 1,
    "pathPatterns": ["src/risk/**"]
  },
  {
    "key": "settlement",
    "name": "Settlement & posting",
    "description": "How an authorization becomes a posted ledger transaction.",
    "order": 2,
    "pathPatterns": ["src/jobs/settlement-runner.ts", "src/ledger/**"]
  }
]
```

3–8 aspects, kebab keys, business-meaningful — **fewer than 3 is rejected**, so
the example above is the minimum shape, not a one-entry template. `pathPatterns`
are globs matched with `dir/**`, `dir`, or `dir/*.ext` semantics ONLY: a
mid-directory wildcard like `src/*/handlers/**` matches **nothing** and silently
dumps its files into `unassigned`. Resolution is **first-match-wins**, so put
specific patterns before broad ones.
`assemble_guide check:aspects` writes `aspects.resolved.json` adding `filePaths`
(the files that matched, first-match over `files.json`) and `priorityFiles` (the
load-bearing subset to read first). **Adopt the resolved keys + priorityFiles**
— an aspect over 40 files is auto-split, so the resolved keys can differ from
what you wrote.

## readlog/<aspectKey>.jsonl  (session) → readlog.jsonl  (tool: merge)

During research each aspect worker appends to its OWN
`readlog/<aspectKey>.jsonl` — one bare JSON string per line, the path of a file
it actually read:

```
"src/services/card-service.ts"
"src/risk/limit-engine.ts"
```

This is the anchor allow-list: `check:dive` (against the aspect's own readlog),
and after `check:merge` the flat `readlog.jsonl`, reject any dive/synthesis
anchor onto a file not in `readlog ∪ closure`. Append the instant you open a
file, before you write anything that cites it. `check:merge` unions every
worker's readlog into the flat `readlog.jsonl`.

## claims/<aspectKey>.jsonl  (session) → claims.jsonl  (tool: merge)

During research each aspect worker appends to its OWN
`claims/<aspectKey>.jsonl` — one behavioral rule per line. `normalizedRuleKey`
must be unique WITHIN the aspect; a key two aspects happen to share is deduped
first-wins when `check:merge` folds them into the flat `claims.jsonl` (a key
claimed by two DIFFERENT statements is reported as a conflict to fix).

<!-- kanon:example schema=claim -->
```json
{"statement":"A card over its monthly limit is declined","codeAnchor":"src/risk/limit-engine.ts::check","normalizedRuleKey":"card-declined-over-monthly-limit","sourcePath":"src/risk/limit-engine.ts","sourceLine":88}
```

All five fields are required and there are no others. A line that doesn't parse
is **reported**, not skipped — it would otherwise make every `ruleRef` pointing
at it read as unknown and leave your dive looking ungrounded for the wrong
reason.

See research-method.md for the field discipline. Dives reference these by
`ruleRef` (the key string); synthesis rules reuse the anchor fields verbatim.

## dives/<aspectKey>.json  (session)

One per resolved aspect. Full shape and a worked example are in
research-method.md. Every paragraph and flow step carries `ruleRefs` (key
strings) and/or `anchors` (`"path:line"`). In the run dir `ruleRefs` are the
rule KEY strings; assembly maps them to the symbolic `[R1]` indices.

## synthesis.json  (session)

The typed index the server renders as the feature's fact surface. Only `name`,
`domainName`, and `overview` are required — every other section defaults to
empty. But **empty means "the source truly has none", not "I didn't look"**:
extract every section you can support with evidence.

<!-- kanon:example schema=synthesis -->
```json
{
  "name": "Corporate Cards",
  "domainName": "Banking & Cash Management",
  "overview": "Corporate Cards issues virtual and physical cards against the business checking balance, authorizing each transaction in real time.",

  "rules": [
    { "statement": "A card authorization above the account's available balance is declined",
      "requirementLevel": "MUST",
      "codeAnchor": "src/services/card-service.ts::authorize",
      "normalizedRuleKey": "card-declined-insufficient-balance",
      "sourcePath": "src/services/card-service.ts",
      "sourceLine": 142 }
  ],

  "edgeCases": [
    { "description": "A frozen card is declined before the balance check runs.",
      "sourceRef": "src/services/card-service.ts:118" }
  ],

  "lifecycle": {
    "states": [
      { "key": "requested", "label": "Requested", "tone": "neutral" },
      { "key": "active", "label": "Active", "tone": "success" },
      { "key": "frozen", "label": "Frozen", "tone": "warning" }
    ],
    "transitions": [
      { "from": "requested", "to": "active", "on": "issuer approves the card" },
      { "from": "active", "to": "frozen", "on": "admin freezes the card" }
    ]
  },

  "entities": [
    { "table": "cards",
      "columns": [{ "name": "id", "type": "uuid" }, { "name": "status", "type": "text" }] }
  ],
  "integrations": [{ "provider": "Unit", "purpose": "Card issuing and authorization" }],
  "routines": [
    { "name": "settlement-runner", "schedule": "0 4 * * *",
      "description": "Posts settled authorizations to the ledger." }
  ],
  "parameters": [{ "name": "THREAD_LIMIT_RATIO", "value": "0.8" }],
  "decisions": [
    { "ref": "ADR-014",
      "title": "Authorize against available, not posted, balance",
      "status": "accepted",
      "context": "Posted balance lags settlement by up to a day.",
      "decision": "Authorization reads the available balance including holds.",
      "consequences": "A pending authorization reduces spending power immediately." }
  ],
  "openQuestions": ["Whether physical card replacement re-runs the risk check."],
  "knownIssues": [
    { "description": "The decline reason is not surfaced to the cardholder UI.",
      "issueRef": "CARD-812" }
  ]
}
```

Four things that bite, all of them enforced:

- **`lifecycle` here is stricter than a dive's `stateMachine`.** Its states
  require `tone` (`neutral · success · warning · danger`) and its transitions
  require `on`. A dive's may omit both. Use `null` (or omit) when the feature
  has no lifecycle.
- **`entities` is the table and its columns — nothing else.** There is no
  display `name` and no `description`. Columns are objects (`{"name","type"}`),
  never bare strings. Prose about an entity belongs in a dive.
- **The field names are not synonyms**: `integrations[].provider` (not `name`),
  `decisions[].title` (the headline) alongside `decisions[].decision` (what was
  decided), `knownIssues[].issueRef` (not `sourceRef`).
- `requirementLevel` is `MUST · MUST_NOT · SHOULD · SHOULD_NOT · MAY`, and each
  rule reuses its claim's anchor fields **verbatim**.

## front-matter.json  (session)

<!-- kanon:example schema=front-matter -->
```json
{
  "narrative": [
    { "text": "Corporate Cards issues virtual and physical cards…", "ruleRefs": ["card-issuance-virtual-default"], "anchors": ["src/services/card-service.ts:40"] }
  ],
  "principles": [
    { "title": "Every authorization is balance-checked", "statement": "No card transaction settles above available balance.", "anchors": ["src/services/card-service.ts:142"], "aspects": ["risk-controls", "settlement"] }
  ],
  "lifecycle": null,
  "glossary": [
    { "term": "authHold", "definition": "The reserved-but-not-settled amount on a pending authorization." }
  ]
}
```

Written FROM the dives on disk (re-read them in §7). Each principle must list
**≥2 `aspects`** or assembly drops it — that drop is reported by name, so it's a
diagnostic, not a shape error. Glossary 6–15 terms. `lifecycle` here is a dive's
looser state machine (`tone`/`on` optional); `null` or absent means none.

## guide-bundle.json  (tool)

Written by `assemble_guide check:full`. Never hand-edit it — fix the
session-owned artifacts above and re-run.

## Resumability

`status` in `manifest.json` is the resume anchor. On restart, re-read
`manifest.json` + `aspects.resolved.json` + the existing `dives/*.json`, then
continue from `status`/`currentAspect`. `readlog.jsonl` and `claims.jsonl` are
append-only; a dive that already passed its gate is never re-run. Nothing is
lost to a compaction or restart.
