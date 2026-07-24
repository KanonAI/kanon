---
name: push
description: >
  Validate and upload the latest Canonize bundle to the server, where it
  lands as taxonomy proposals for human review. Use for "push the bundle",
  "send the taxonomy", "upload the discovery".
argument-hint: "[path-to-bundle.json]"
disable-model-invocation: true
---

# Canonize Push

1. **Locate the bundle**: `$ARGUMENTS` if given, else the newest
   `.canonize/runs/*/bundle.json`. None found → tell the user to run
   `/canonize:discover` first.
2. **Validate**: call `canonize_validate_bundle`. On failure, show the
   violations and stop — fix the run files and re-assemble with
   `canonize_assemble_bundle`; never hand-edit `bundle.json`.
3. **Confirm with the user** before sending: repo slug, server URL, and the
   stats (domains/features/screens). This posts to a shared review queue and
   replaces the repo's current un-reviewed proposals (approved/rejected nodes
   are never touched).
4. **Push**: call `canonize_push_bundle`. Report `runId`, counts
   (domains / features / refreshed), and the `reviewUrl` where a human
   approves or rejects each proposal.
   *If the MCP tool is unavailable* and `CANONIZE_URL` +
   `CANONIZE_API_TOKEN` are in the shell env, push directly (after step 2's
   validation — via `node ${CLAUDE_PLUGIN_ROOT}/mcp-server/dist/cli.js
   validate <bundle>`):
   `python3 -c 'import json;print(json.dumps({"repoSlug":"<slug>","bundle":json.load(open("<bundle>"))}))' | curl -sS -X POST "$CANONIZE_URL/api/ingest" -H 'content-type: application/json' -H "authorization: Bearer $CANONIZE_API_TOKEN" -d @-`
5. **Bookkeep**: set `status: "pushed"` in the run's `manifest.json`.

## When it fails

- **401** — not signed in (or the token is wrong). Run **`/canonize:setup`**
  to sign in; for CI/dogfood, set `CANONIZE_API_TOKEN` in the shell.
- **404** — the repo slug is owned by another workspace. An unclaimed slug is
  claimed into your token's workspace on first taxonomy fetch / ingest; if it's
  already claimed elsewhere, pick a different slug or run `/canonize:setup`
  signed in as the account that owns it.
- **413 / timeout** — bundle too large: re-assemble without a transcript, or
  split the crawl into smaller runs and push each.
- **Unreachable** — check `server_url` / `CANONIZE_URL` and that the
  server is running; the bundle keeps: push again any time.
