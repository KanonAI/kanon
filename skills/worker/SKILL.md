---
name: worker
description: >
  Start the Kanon worker daemon — it claims tasks queued from the Kanon UI
  (changes to implement, discovery runs, guide scans), executes them
  headlessly in git worktrees, and reports back (a PR, or pushed proposals).
  Use for "start the worker", "run the kanon daemon", "listen for kanon
  tasks".
disable-model-invocation: true
---

# Kanon Worker

Start the long-running worker daemon for THIS repository. Once it's up, your
team queues changes from the Kanon UI and PRs come back — no one needs to
open Claude Code for individual changes.

## Preconditions (check, then fix or stop)

1. You are inside the target repo (a git root with `.kanon/config.json` — if
   missing, run `/kanon:setup` first).
2. `gh auth status` succeeds — the worker opens PRs with `gh`.
3. `claude --version` succeeds — the worker spawns headless Claude Code
   sessions (this machine's subscription pays for them).

## Start it

**Ask first which one they want** — the difference decides whether their team
can queue work tomorrow:

### A. Managed service (recommended for a machine that stays up)

```bash
node ${CLAUDE_PLUGIN_ROOT}/mcp-server/dist/cli.js worker-install
```

Writes a LaunchAgent (macOS) or systemd user unit (Linux) and starts it, so the
worker survives this session, a logout, and a crash. It bakes the current
`PATH` into the unit — a service manager's minimal PATH cannot find `claude`,
`gh` or `git`, which would otherwise fail preflight at boot. Logs land in
`~/.kanon/logs/`. Remove it with `worker-uninstall`. Report the printed
`unitPath` and `logPath`.

### B. This session (a trial run, or a laptop)

```bash
node ${CLAUDE_PLUGIN_ROOT}/mcp-server/dist/cli.js daemon
```

Blocks for as long as the daemon runs, and **dies when the session ends**.

> Run it in the FOREGROUND when your harness permits a command to run
> indefinitely — the user then sees the daemon's own log lines. If your harness
> caps foreground commands (Claude Code kills one at 10 minutes), that cap would
> take the worker down mid-task: start it in the background instead, say so
> plainly, and keep the session on it rather than moving to other work. Either
> way the session is the worker's lifetime — never background it and wander off.

Tell the user before it starts:
- It polls their Kanon workspace every few seconds and executes queued tasks
  **on this machine** — one at a time, each in a git worktree under
  `.kanon/worktrees/` keyed by the task's lineage, so a re-queued task resumes
  where the dead one stopped. Task types: implement a pending change (PR comes
  back), run a code-only discovery (proposals land for review), or scan
  approved features into guides.
- Code never leaves the box; Kanon receives one-line activity labels and the
  PR URL.
- Transient failures (a provider fault, a session that goes silent for 15
  minutes) are retried automatically, up to 3 attempts, resuming the same
  worktree. A failure in the work itself is reported, not retried.
- Every session's raw stream is kept at `.kanon/sessions/<taskId>-attemptN.jsonl`
  — that is where to look when a task fails.
- Stop it with Ctrl-C: the daemon finishes the running task first. Press it
  again to abandon that task — its lease expires and it re-queues into the
  worktree it left behind.
