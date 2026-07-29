---
name: work
description: >
  Execute a pending product change from the knowledge base — plan it if it's
  a feature, then implement it, verify, and open a PR. Use for "work on the
  next change", "implement ENG-42", "fix the next ticket", "work on the next
  item", "plan the feature", "implement slice 1".
argument-hint: "[change-id | linear-id | --next] [--slice N] [--plan-only] [--non-interactive]"
---

# Kanon Work

Pick up a pending product change, plan it if it's a feature (or execute an
existing plan), implement it, verify, and open a review-ready PR. Nothing
auto-merges.

## Non-interactive mode (the worker daemon)

`--non-interactive` means NO ONE is watching: the Kanon worker daemon runs
this skill headlessly for a task queued from the Kanon UI. Three rules
replace every "ask the user" below:

1. **Never wait for confirmation.** Skip the step-1 "Shall I proceed?".
2. **Unknown change type → feature path.** Planning first is the safe
   default; never ask.
3. **The PR is a DRAFT unless verification is fully green.** When in doubt,
   draft — a human promotes it.

Additionally, when the env var `KANON_TASK_BRANCH` is set, the daemon already
created and checked out that branch in a dedicated worktree — **skip
`git checkout -b` entirely** and work on the current branch. Use
`$KANON_TASK_BRANCH` as `{branchName}` everywhere (push, PR head).

## Resuming an interrupted run

A worker run can die mid-slice: a lost lease, a killed daemon, a provider
fault. The daemon reattaches the same worktree on the next attempt, so **the
working tree you wake up in may already hold work** — commits, uncommitted
edits, a plan file. Never assume you are starting clean:

1. `git status` and `git log --oneline origin/main..HEAD` before writing code.
   Finish what is there rather than redoing it.
2. **`kanon_get_plan` is the authority on slice progress**, not the local plan
   file. The file is gitignored and may be missing (a fresh worktree, another
   machine); the server's `nextSlice` is always right. If the plan came back
   and the local file is gone, write `body` to `.kanon/plans/{change-id}.md`
   before you start.
3. A slice already marked done is done, even if its code looks incomplete —
   it shipped in a PR. Move to `nextSlice`.

## 1. Select the change

Parse `$ARGUMENTS`:
- A **Linear ticket ID** (e.g., `ENG-42`) → call `kanon_list_changes` with
  `linearId: "ENG-42"`.
- A **change ID** → call `kanon_list_changes` and find it by id.
- `--next` or no argument → call `kanon_list_changes` with
  `status: "open"`, `limit: 1`. First open change.
- `--slice N` → execute only slice N of an existing plan (skip planning).
- `--plan-only` → create the plan but don't implement.
- If no open changes exist: "No pending changes — the knowledge base is
  aligned with the code."

Show the user what you're about to work on:
> **Working on:** {title}
> **Type:** {bug | improvement | feature}
> **Source:** {linearIdentifier ?? "KB change"} · {direction}
> **Summary:** {summary}

Ask: "Shall I proceed?" Wait for confirmation. (`--non-interactive`: skip the
question, print the block, and proceed immediately.)

## 2. Route by change type

Determine the change type from the title prefix or content:
- Starts with `Fix:` or is labeled `bug` → **bug path** (step 5, skip planning)
- Starts with `Improve:` → **improvement path** (step 5, skip planning)
- Starts with `Add:` or is labeled `feature` → **feature path** (step 3)
- If a `--slice` was passed → **slice execution** (step 4)
- Unknown → ask the user: "Is this a bug fix, an improvement, or a new feature?"
  (`--non-interactive`: never ask — take the feature path, planning first is
  the safe default.)

## 3. Feature planning (features only)

A feature needs a plan BEFORE code is written. The plan breaks the work into
**vertical slices** — each slice is a thin, shippable increment that delivers
user-visible value and can be merged independently.

### 3a. Research the feature

Read the change's summary, affected claims, and the relevant parts of the
knowledge base (use `kanon_list_changes` to get the claims, then read the
source files they reference). Understand:
- What the feature should do (from the ticket/change description)
- What exists today (from the affected claims and code)
- What's adjacent (other features/routes in the same domain)
- What constraints exist (auth, data model, external deps)

### 3b. Design the slices

Create an implementation plan with 2-6 vertical slices. Each slice:

```
Slice {N}: {name}
─────────────────
Goal: one sentence — what user-visible value this slice delivers
Depends on: [slice N-1] or "none" (the first slice has no deps)

Changes:
- {file}: {what to add/modify and why}
- {file}: {what to add/modify and why}

Tests:
- {what to test}: {how to verify}

Acceptance criteria:
- [ ] {concrete, testable criterion}
- [ ] {concrete, testable criterion}

Risk: {what could go wrong, what to watch for}
```

**Slice design principles:**
- **Vertical, not horizontal.** Each slice touches all layers (model, logic,
  route, UI) for ONE narrow capability — never "slice 1 = data model, slice 2
  = business logic." A horizontal slice can't be reviewed, tested, or shipped
  alone.
- **The first slice is the smallest possible thing that works.** A form that
  saves to the DB. An endpoint that returns hardcoded data. A flag-gated UI
  with a stub backend. Prove the path end-to-end before elaborating.
- **Each slice builds on the previous one.** Slice 2 assumes slice 1 is
  merged. This means each PR is small, reviewable, and independently green.
- **The last slice removes scaffolding.** Feature flags, hardcoded fallbacks,
  TODO comments — cleaned up in the final slice.
- **Name the files.** Every slice lists the exact files it will touch. A slice
  that says "update the backend" is not a plan.

### 3c. Write the plan file

Write the plan to `.kanon/plans/{change-id}.md`:

```markdown
# Implementation Plan: {title}

**Change:** {change-id} · {linearIdentifier}
**Type:** feature
**Created:** {ISO date}
**Status:** planned

## Overview
{2-3 sentences: what this feature is, who uses it, why it matters}

## Slices

### Slice 1: {name}
Goal: {one sentence}
Depends on: none

Changes:
- `path/to/file.ts`: {what to add/modify}

Tests:
- {what}: {how}

Acceptance criteria:
- [ ] {criterion}

Risk: {risk}

### Slice 2: {name}
...

## Open questions
- {anything unresolved}

## Out of scope
- {things this plan deliberately does NOT cover}
```

### 3d. Sync the plan to the app

Call `kanon_push_plan` with the change id, the plan markdown verbatim as
`body`, and the slice roster (`[{n: 1, name: "..."}, …]`, numbered 1..N with no
gaps). **This is not optional.** The plan file is gitignored and lives in a
worktree that gets deleted, so until the plan is pushed an interrupted run has
nothing to resume from and will re-plan the same feature from scratch.

Then call `kanon_update_change` with `status: "implementing"` and update the
change summary to reference the plan.

If `--plan-only` was passed, stop here:
> **Plan created:** `.kanon/plans/{change-id}.md`
> Run `/kanon:work {change-id} --slice 1` to start implementing.

Otherwise, proceed to slice 1.

## 4. Slice execution (features with a plan)

If `--slice N` was passed, or if continuing from step 3:

1. Call `kanon_get_plan` for the change. Its `nextSlice` is which slice to run
   when no `--slice N` was given; the stored `body` is the plan even when
   `.kanon/plans/{change-id}.md` is missing (write the file back if so).
2. Find Slice N in the plan.
3. Show the slice to the user:
   > **Executing Slice {N}:** {name}
   > **Goal:** {goal}
   > **Files:** {list}
4. Proceed to step 5 with scope limited to THIS SLICE ONLY. Do not touch
   files outside the slice's listed changes.

After the PR is opened:
1. Call `kanon_complete_slice` with the slice number and the PR URL. **Do this
   immediately** — it is the only durable record that the slice shipped, and
   without it the next run redoes merged work.
2. Update the local plan file too: check off the completed criteria and mark
   the slice done (the human-readable copy).
3. Tell the user:
   > **Slice {N} complete.** PR: {url}
   > Next: `/kanon:work {change-id} --slice {N+1}`

`kanon_complete_slice` resolves the change automatically when the last slice
lands — its response carries `nextSlice: null`. Don't call
`kanon_update_change` with `resolved` for a planned feature.

## 5. Implement

Mark as implementing: call `kanon_update_change` with `status: "implementing"`.

Create a working branch — UNLESS `KANON_TASK_BRANCH` is set (the daemon's
worktree is already on it; use it as `{branchName}` and skip the checkout):
```bash
git checkout -b {branchName} main
```
Branch naming:
- Bug: `fix/{id-slug}`
- Improvement: `improve/{id-slug}`
- Feature slice: `feat/{id-slug}-slice-{N}`

### 5a. Read before writing

**This is the most important step.** For each affected file:
1. Read the source file and understand the current implementation.
2. Read existing tests in the same directory.
3. Build a mental model of what changes and what stays.

### 5b. Write the code

**Quality bar:**
- **Minimal.** Touch only what the change requires. No refactoring, no
  adjacent improvements, no unrelated fixes.
- **Conforming.** Match the existing code style: indentation, naming,
  patterns, imports. Read the surrounding code and blend in.
- **Tested.** Every behavioral change has a test. Every bug fix has a
  regression test. A change without a test is incomplete.

### 5c. Verify

Run the full verification suite:
```bash
npm run typecheck   # or the project's typecheck command
npm run lint        # fix only YOUR issues, not pre-existing ones
npm test            # run the relevant test suite
```

All must pass. Max 3 fix-and-verify cycles. If you can't make it green
in 3 tries, stop and report what's failing.

## 6. Self-review

```bash
git diff
```

Check each changed file:
- [ ] Only touches what the change/slice requests? No scope creep?
- [ ] No hardcoded values that should be constants?
- [ ] Error paths handled?
- [ ] Imports clean?
- [ ] Would a reviewer understand every line from the PR body?

## 7. Commit and PR

```bash
git add -A
git commit -m "{type}: {description} ({linear-id})"
git push -u origin {branchName}
```

Write `.pr-body.md`:

```markdown
## What
One-line summary.

## Why
{Closes LINEAR-ID | Resolves KB change}. {context}

## Changes
- `file.ts`: what changed and why

## Verification
- Tests: {pass/fail + count}
- Lint: {pass/fail}
- Typecheck: {pass/fail}

## Acceptance criteria
- [x] {criterion}

## Affected product rules
{Claim statements from the KB that this change alters}

## Implementation plan
{For features: "This is slice {N} of {total}. See `.kanon/plans/{id}.md`
for the full plan."}

## Notes for reviewer
{Non-obvious decisions, assumptions, follow-ups}
```

```bash
gh pr create --base main --head {branchName} --title "{title}" --body-file .pr-body.md --draft
```

Draft if verification failed. Ready if all green. (`--non-interactive`:
ALWAYS `--draft` unless typecheck, lint, AND tests all passed.)

At the very end, print the PR URL on its own line — the daemon extracts it
from the transcript to report back to the Kanon UI.

## 8. Finalize

- **Bug/improvement:** call `kanon_update_change` with `status: "resolved"`.
- **Feature slice:** call `kanon_complete_slice` (step 4) — it records the
  checkpoint and resolves the change on the last slice. Update the local plan
  file as well.
- Tell the user the PR URL and next steps.

## When it fails

- **No changes found:** inform user plainly.
- **Confirmation declined:** stop, don't mark implementing.
- **Verification fails 3x:** leave branch, don't open PR, report failures.
  Leave change as "implementing."
- **Git conflicts:** don't force-push. Tell the user to resolve manually.
- **Missing `gh`:** commit + push, give the user the PR command.
- **Plan file not found for --slice:** call `kanon_get_plan` — the server's copy
  survives a deleted worktree. Write `body` back to
  `.kanon/plans/{change-id}.md` and carry on. Only if that returns
  `{plan: null}` is there genuinely no plan: tell the user to run without
  `--slice` first to create one.
- **`--slice N` on a slice already done:** don't redo it. Report that it
  shipped (the plan carries its PR URL) and run `nextSlice` instead.
