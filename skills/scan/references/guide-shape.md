# The guide shape (content-parity target)

You produce structured content; **the server renders it into the guide.** So
you aim at *content parity*, not format parity — the goal is that every part of
the skeleton below has the evidence behind it, not that you emit markdown that
looks like it. Your artifacts (`facts.json`, `aspects.json` + dives,
`synthesis.json`, `front-matter.json`) each feed a region of the rendered guide.

## The three surfaces — keep them separate

1. **The fact surface** (`facts.json`, tool-written). The mechanical truth: the
   data-model table, the route map, the cron/schedule table, the constants list.
   The server renders these as tables. **Your prose must NOT restate them.** A
   mechanical fact already in the guide gets *referenced* in prose where it's
   relevant ("the settlement job — see the schedule table — runs nightly"), not
   re-tabulated.
2. **The chapters** (dives, one per aspect). The behavioral prose: how the
   feature actually works, the flows, the edge cases, the worked examples. This
   is where the reading pays off.
3. **The front matter** (`front-matter.json`). The cross-cutting frame: the
   narrative summary, the principles that span chapters, the glossary.

## The rendered skeleton (what the content maps to)

```
At a glance (top of guide)
  ├─ key facts (stat band)                        ← front-matter.keyFacts
  └─ Fees (table, only if the feature charges)    ← front-matter.feeSchedule

Overview / narrative (2–4 paragraphs)             ← front-matter.narrative
Lifecycle (state diagram)                         ← front-matter.lifecycle

Overview / system map = the FACT surface          ← facts.json (rendered as tables)
  ├─ data-model table
  ├─ route map
  ├─ cron / schedule table
  └─ constants
  (prose must NOT restate these — reference them)

Deep-dive Parts — one per aspect                  ← dives/<aspectKey>.json
  each Part:
  ├─ overview / purpose
  ├─ data model / entities (in prose, referencing the fact table)
  ├─ user-facing flow                             ← dive.flows
  ├─ server-side behavior
  ├─ formula + WORKED EXAMPLE (real constants)    ← dive.workedExamples
  ├─ lifecycle / states                           ← dive.stateMachine
  ├─ failure modes
  └─ business rules, edge cases & gotchas         ← dive.edgeCases (each with its WHY)

Under the hood — Principles (cross-cutting)       ← front-matter.principles
Glossary                                          ← front-matter.glossary
Source map                                        ← anchors across all dives
```

Order the Parts **user-facing flow first, internals after** — a reader meets the
feature the way a user does, then descends into the engine. Note the top/bottom
split: the **at-a-glance layer** (key facts, fees) and the narrative open the
guide; the **principles render AFTER the deep dives** as an "Under the hood"
section — a reader earns them by reading the chapters, they aren't the opening.

## What makes a chapter deep (not a summary)

- **Every edge case carries its WHY.** "A frozen card is declined before the
  balance check" is a fact; "…so a compromised card can't drain a topped-up
  balance in the window between freeze and settlement" is the reason a reader
  came for.
- **The worked example uses real constants.** See research-method.md: invent
  inputs, never the ratios/fees/thresholds/codes. A worked example with a
  fabricated fee is worse than none.
- **Flows are step-by-step and anchored.** Each step points at the code that
  performs it.
- **Terminology is bridged.** Where the code term differs from the business
  term (`authHold` vs "pending authorization"), note it — that's how a
  non-engineer reads the code map.
- **Enumerations are markdown lists, not comma-splices.** Paragraph text renders
  as markdown. Any enumeration of 3+ like items — steps, states, roles, checks —
  is a `-`/numbered list, never "there are six checks: A, B, C, D, E and F" in
  one run-on sentence, which renders as an unreadable wall.

## Front matter rules

- **Narrative**: 2–4 paragraphs. Each anchored to a `path:line` drawn from the
  chapters — it's a summary of what you found, not a fresh essay. Do not
  introduce a value or state no chapter mentions. The narrative must **NOT
  restate the principles** — they render separately (below the chapters), so
  repeating them here just triples the opening.
- **Key facts** (`keyFacts`): 4–8 at-a-glance facts, each `{ label, value,
  unit?, meaning?, ruleRefs, anchors }`. They render as the stat band at the top
  of the guide. **Every `value` is a REAL constant** from `facts.json` or a
  claim — the worked-example rule applies here too; a fabricated key fact is a
  fabrication. Assembly DROPS any row grounded by neither a `ruleRef` nor an
  `anchor`. Pick the numbers a stakeholder would ask first: the spending cap,
  the grace period, the interest rate.
- **Fee schedule** (`feeSchedule`): ONLY for features that charge fees, each row
  `{ fee, amount, trigger, timing?, waiver?, ruleRefs, anchors }`. Same grounding
  bar. **Omit the field entirely for fee-less features** — never manufacture a
  fee to fill the section.
- **Lifecycle** (`lifecycle`): whenever the feature has states, carry
  `synthesis.lifecycle` here so the guide renders the state diagram (see §6 —
  every state needs a `tone`, every transition an `on`).
- **Principles**: cross-cutting invariants, each spanning **≥2 aspect keys**.
  "A rule seen once is a detail, not a principle" — assembly DROPS any principle
  whose `aspects` array lists fewer than 2 keys. A principle is something true
  across the feature ("every money movement is double-entry and idempotent"),
  visible in multiple chapters. Principles render AFTER the chapters, under
  "Under the hood" — not in the opening.
- **Glossary**: 6–15 terms, plain-language definitions. Cover the code-vs-
  business terms and the domain nouns a new reader would stumble on.

## Synthesis vs dives — two lenses on the same evidence

The dives are the *narrative* chapters; `synthesis.json` is the *structured
index* — the typed sections (rules, entities, integrations, routines,
parameters, decisions, lifecycle, edge cases, open questions, known issues) the
server cross-links. They draw on the same claims: a synthesis `rule` reuses a
claim's `codeAnchor` / `normalizedRuleKey` / `sourcePath` / `sourceLine`
EXACTLY. Extract every typed section the source supports; leave one empty only
when the source genuinely has no evidence for it — don't fabricate, don't be
lazy.
