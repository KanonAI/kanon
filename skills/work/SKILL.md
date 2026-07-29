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

Call `kanon_update_change` with `status: "implementing"` and update the
change summary to reference the plan.

If `--plan-only` was passed, stop here:
> **Plan created:** `.kanon/plans/{change-id}.md`
> Run `/kanon:work {change-id} --slice 1` to start implementing.

Otherwise, proceed to slice 1.

## 4. Slice execution (features with a plan)

If `--slice N` was passed, or if continuing from step 3:

1. Read `.kanon/plans/{change-id}.md`
2. Find Slice N (default: the first slice with unchecked criteria)
3. Show the slice to the user:
   > **Executing Slice {N}:** {name}
   > **Goal:** {goal}
   > **Files:** {list}
4. Proceed to step 5 with scope limited to THIS SLICE ONLY. Do not touch
   files outside the slice's listed changes.

After the PR is opened, update the plan file: check off the completed
criteria, mark the slice as done, and tell the user:
> **Slice {N} complete.** PR: {url}
> Next: `/kanon:work {change-id} --slice {N+1}`

When all slices are complete, mark the change as resolved.

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

- Call `kanon_update_change` with `status: "resolved"` (bug/improvement)
  or update the plan file with slice completion (feature).
- Tell the user the PR URL and next steps.

## When it fails

- **No changes found:** inform user plainly.
- **Confirmation declined:** stop, don't mark implementing.
- **Verification fails 3x:** leave branch, don't open PR, report failures.
  Leave change as "implementing."
- **Git conflicts:** don't force-push. Tell the user to resolve manually.
- **Missing `gh`:** commit + push, give the user the PR command.
- **Plan file not found for --slice:** tell the user to run without --slice
  first to create the plan.
