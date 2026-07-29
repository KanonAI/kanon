# The research method (per aspect)

This is the loop that turns code into a grounded chapter. You run it once per
resolved aspect. The whole game is **grounding**: every sentence you write must
trace to code you actually read, via a rule key or a `path:line` anchor. The
dive gate is unforgiving on purpose — an ungrounded guide is worse than no
guide, because it looks verified.

## Priority files first — fully

`aspects.resolved.json` gives each aspect a `priorityFiles` list: the files the
server judged most load-bearing for this chapter. **Read every one, top to
bottom, before you write a single paragraph.** Skimming loses the edge cases
that make a guide worth reading (the early-return, the off-by-one guard, the
`if (status === 'frozen')` branch). The gate BOUNCES if a priority file is
unread, and lists exactly which — so there's no shortcut.

As you open each file, append its path to your `readlog/<aspectKey>.jsonl` — one
bare JSON string per line, immediately:

```
"src/services/card-service.ts"
"src/jobs/settlement-runner.ts"
```

The readlog is the anchor allow-list: the gate rejects any anchor onto a file
that isn't in `readlog ∪ closure`. Read it, then you may cite it. Write ONLY
your per-aspect `readlog/<aspectKey>.jsonl` — never the shared flat `readlog.jsonl`
(a sibling worker is writing its own, and concurrent writes to one file corrupt
it). `check:merge` unions them later.

## Extract rules as you read — into claims.jsonl

Don't wait until the end. The moment you understand a behavioral rule, append it
to your `claims/<aspectKey>.jsonl` (one JSON object per line):

<!-- kanon:example schema=claim -->
```json
{"statement":"A card is declined when the account balance is below the pending authorization amount","codeAnchor":"src/services/card-service.ts::authorize","normalizedRuleKey":"card-declined-insufficient-balance","sourcePath":"src/services/card-service.ts","sourceLine":142}
```

- `statement` — the rule in plain business language.
- `codeAnchor` — `path::Symbol` (the function/class/method that enforces it).
- `normalizedRuleKey` — a stable kebab-ish key, unique WITHIN your aspect. A key
  two aspects happen to share is deduped first-wins when `check:merge` folds the
  per-aspect files together; a key on two DIFFERENT rules is reported as a
  conflict to fix. Name by meaning (`card-declined-insufficient-balance`), not by
  number.
- `sourcePath` / `sourceLine` — the exact line you read it at.

A claim is the reusable unit of evidence: the dive references it by `ruleRef`,
and synthesis reuses its anchor verbatim. Extract generously — an unused claim
costs nothing, but a paragraph with no claim to cite has to be dropped.

## Five lenses to sweep every aspect (per your lens policy)

Behavioral rules are the spine, but a scan must ALSO surface five
product-and-risk dimensions. `kanon_collect_facts` (SKILL §3) already
extracts what its patterns can match — analytics events, feature flags,
experiments, and security patterns land structured in `facts.json`, and the
guide renders them. Your job here is the safety net: read for these, ground
each as a claim (with a `codeAnchor`) and carry it into the dive (a paragraph,
an `edgeCase`, or a `terminologyNote`), AND flag the GAPS the regex can't infer.

**Which lenses you sweep ACTIVELY is set by your brief's lens policy** (the
SKILL's depth policy, by relevance band): band 0 sweeps all five actively;
band 1 sweeps security + flags actively and records the others only where the
code you already read surfaces them; band 2 (capsule) sweeps security only.
Two rules survive every band: a finding you DID encounter is always recorded
(no policy says "ignore what you saw"), and an ACTIVE lens is left empty only
when the aspect genuinely has nothing — not because you didn't look.

- **Tracking (product analytics).** For each analytics call you read
  (`analytics.track`, `posthog.capture`, `amplitude.track`, `gtag`, a tracking
  constants/registry module), capture the event name, its properties, the
  provider, and the user action that fires it. Then flag **uncovered
  interactions**: a form submit, button click, page view, or state change with
  NO tracking nearby — product teams need to know which behaviors they're blind
  to. That gap is a suggestion, not a fact; word it as one.
- **Testing (E2E coverage).** For each nearby test file (`*.test.ts`,
  `*.spec.ts`, `*_spec.rb`, …), note which flow it covers and what it asserts.
  Then flag **testing gaps**: a flow, error handler, or edge case you documented
  with no matching test — "this flow has no E2E test coverage." If a scenario is
  reproducible enough that a tester could verify it, say so; that's a suggested
  test.
- **Security (audit every aspect).** Note auth/authz on each mutation (what's
  protected, the guard, the failure response) — missing auth on a mutation is a
  finding. Flag injection risk (user input into SQL/shell/`eval`), hardcoded
  secrets/keys/tokens, stack-trace/internal-detail leaks in error responses,
  cookies without httpOnly/secure/SameSite, JWT decoded without verify, sessions
  without CSRF, and sensitive data (PII, financial, credentials) logged, stored
  unencrypted, or put in URL params. Each finding names a severity
  (critical/high/medium/low), the code pattern, and what to do about it.
- **Experiments (A/B tests).** For experiment code (`getExperiment`,
  `useExperiment`, `getVariation`, `abTest`, `splitTest`), document the name,
  variants, hypothesis, the metric it moves, and whether it's still active or is
  stale (a concluded experiment left in code is tech debt — flag cleanup
  TODOs). Note which user flows branch on it.
- **Flags (feature flags).** For each flag gate (`isEnabled`, `useFlag`,
  `getFlag`, a LaunchDarkly/Statsig/Unleash/env-var check), name the flag, its
  default, and the feature it gates. When behavior branches on a flag, describe
  BOTH branches — flagged-on and flagged-off are two behaviors, and a stakeholder
  needs both.

These findings ground exactly like any rule: no anchor onto an unread file, no
fabricated event name or severity. A suggestion (an uncovered interaction, a
testing gap) is still grounded — anchor the code that has the gap, and phrase it
as a gap, not as an existing fact.

## Write the dive — dives/<aspectKey>.json

One file per resolved aspect. Every `paragraph` and every `flow step` carries
`ruleRefs` (rule KEY strings — assembly maps them to symbolic indices) and/or
`anchors` (`"path:line"`). Shape:

<!-- kanon:example schema=dive -->
```json
{
  "aspectKey": "risk-controls",
  "sections": [
    {
      "heading": "Authorization checks",
      "paragraphs": [
        {
          "text": "Every card authorization is checked against the account's available balance before it is approved; an authorization for more than the available balance is declined at the gateway.",
          "ruleRefs": ["card-declined-insufficient-balance"],
          "anchors": ["src/services/card-service.ts:142"]
        }
      ]
    }
  ],
  "flows": [
    {
      "name": "Authorize a card transaction",
      "steps": [
        { "text": "The gateway posts the pending amount to authorize().", "anchor": "src/services/card-service.ts:120", "ruleRefs": [] },
        { "text": "The service compares it to available balance and declines if short.", "anchor": "src/services/card-service.ts:142", "ruleRefs": ["card-declined-insufficient-balance"] }
      ]
    }
  ],
  "edgeCases": [
    { "description": "A frozen card is declined before the balance check runs.", "sourceRef": "src/services/card-service.ts:118" }
  ],
  "workedExamples": [
    { "title": "Declined for insufficient funds", "markdown": "Available balance **$40.00**, authorization **$52.30** → declined. The gateway sees code `51`." }
  ],
  "stateMachine": null,
  "terminologyNotes": [
    { "codeTerm": "authHold", "businessTerm": "pending authorization", "note": "The reserved-but-not-settled amount." }
  ]
}
```

Notes:
- **A flow step is an assertion.** Ground it exactly like a paragraph — an
  `anchor` and/or `ruleRefs`. "The service declines if short" is a claim about
  code; point at the code.
- **Enumerations are markdown lists, not comma-splices.** Paragraph and
  worked-example text renders as markdown. Any enumeration of 3+ like items —
  steps, states, roles, checks — is a `-`/numbered list, never a run-on "there
  are six checks: A, B, C, D, E and F" that renders as a wall of text.
- `edgeCases[].sourceRef`, `terminologyNotes`, `stateMachine` are optional but
  are where the depth lives — each edge case should carry the WHY. `null` and
  omitting the key mean the same thing.
- **An aspect whose code carries a status/state enum MUST emit a
  `stateMachine`** — the `status`/`state` column, the `if (status === 'frozen')`
  branch, the freeze/suspend/reactivate transitions. List every state and every
  transition WITH ITS TRIGGER (`on`); a status-bearing chapter with no state
  machine is an incomplete chapter, and synthesis will warn about the missing
  lifecycle. A dive's `stateMachine` is the **loose** one: `states[].tone` and
  `transitions[].on` may be omitted (`synthesis.json`'s `lifecycle` requires
  them — see run-format-scan.md) — but supplying them makes a richer diagram.
- **Only the keys shown exist.** An unknown key is rejected, not ignored, so a
  rejection tells you the field name is wrong rather than silently dropping
  what you wrote.
- In the run dir, `ruleRefs` are the rule KEY strings. Assembly resolves them to
  the symbolic `[R1]` indices the rendered guide shows.

## Worked-example constants are real, or it's a fabrication

Every CONSTANT in a worked example — ratio, fee, threshold, cap, schedule, rate,
gateway code — must be the real value from `facts.json` or a claim. You may
invent only illustrative inputs that have no real counterpart: a sample balance,
a chosen date, a fictional customer name.

- ✅ "Balance **$40.00**, authorization **$52.30**" — $40 and $52.30 are made-up
  *inputs*; fine. The **decline threshold** (balance < amount) and the gateway
  **code `51`** are the real behavior, read from the source.
- ❌ "A 2.9% + $0.30 processing fee applies" — if you didn't read 2.9% / $0.30
  in the code or facts, that's a fabricated constant, even inside an example.
  Read the fee schedule or drop the sentence.

## Responding to a dive bounce

Run `kanon_assemble_guide { check:"dive", aspectKey:"<key>" }`. If it
bounces, it tells you exactly why:

| Bounce | Meaning | Fix |
|---|---|---|
| Shape failure (names the file + fields) | An artifact doesn't match its schema | The error carries the required keys and a working example — fix that file against it. Unknown keys are rejected, so a complaint about one means the field name is wrong, not that the content is unwanted. |
| Invalid `claims.jsonl` line(s) | Those claims never loaded | Fix the listed lines FIRST. Until they parse their rule keys don't exist, so every `ruleRef` citing them reads as unknown and the dive looks ungrounded for the wrong reason. |
| Priority files unread (lists them) | You wrote before reading | Read each listed file fully, append to `readlog.jsonl`, re-check. |
| <80% grounded (lists ≤8 previews) | Too many bare sentences | For each 90-char preview: add a `ruleRef`/`anchor`, or delete the sentence. Never pad with a wrong anchor. |
| Anchor onto an unread file | Cited what you didn't read | Read that file (then it's allowed), or fix the path to one you did read. |
| Unknown rule key in `ruleRefs` | Key not in `claims.jsonl` | Add the claim, or correct the key string. |

Re-check until it passes. **Do not lower the grounding ratio by deleting good
sentences to dodge the gate** — the point is a guide that says true things with
receipts. If a sentence is true but you can't cite it, the fix is to go read the
code that makes it true and cite that.

## Then forget it

Once your dive passes, report back `{ aspectKey, passed, grounded, total }` — the
parent flips the aspect to `researched` in `manifest.json` (a worker never writes
the manifest). You do not need to hold the finished chapter in your head — §7
re-reads the dives from disk to write the front matter. The disk is the memory.
