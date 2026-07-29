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

Run in the foreground so the user sees the daemon's own log lines:

```bash
node ${CLAUDE_PLUGIN_ROOT}/mcp-server/dist/cli.js daemon
```

Tell the user before it starts:
- It polls their Kanon workspace every few seconds and executes queued tasks
  **on this machine** — one at a time, each in its own git worktree under
  `.kanon/worktrees/`. Task types: implement a pending change (PR comes
  back), run a code-only discovery (proposals land for review), or scan
  approved features into guides.
- Code never leaves the box; Kanon receives one-line activity labels and the
  PR URL.
- Stop it with Ctrl-C (a task in flight fails honestly via lease expiry and
  can be re-queued).
- For an always-on worker, run the same command under launchd/systemd on a
  box that stays up — the laptop-lid problem is real.

The command blocks for as long as the daemon runs. That is the point — do
not background it and move on; the session IS the worker while it runs.
