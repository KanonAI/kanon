---
name: status
description: >
  Show the Kanon taxonomy state for this project — what's approved,
  what's proposed, and whether recent pushes landed. Use when asked "what's
  approved", "did my push land", "kanon status", or before starting a
  new discovery crawl.
---

# Kanon Status

1. Resolve the repo slug (`.kanon/config.json`, then the `repo_slug`
   plugin setting). Missing → ask the user. If nothing is configured at all and
   `kanon_whoami` reports not-signed-in, point the user at
   **`/kanon:setup`** first — it signs in and writes the project config.
2. Call `kanon_get_taxonomy` and `kanon_ingest_status`.
3. Render two short tables:
   - **Taxonomy**: approved vs proposed counts per space, then per domain
     (name, state, feature count). Call out low-confidence proposals — they
     need triage.
   - **Guides** (per approved feature): whether it's **scannable** — a feature
     is scannable when it has a `boundary` (the taxonomy wire carries
     `boundary: { globs, routePrefixes } | null`; non-null with globs =
     scannable) — plus `hasGuide` and `guideUpdatedAt`. Read these straight off
     the feature nodes returned by `kanon_get_taxonomy`. Flag approved
     features with no boundary ("run `/kanon:discover` to derive one, or
     pass globs to `/kanon:scan`") and scannable features with no guide
     yet ("run `/kanon:scan <feature>`").
   - **Recent runs** (last 5): run id, status, started, what it proposed
     (domains/features/refreshed). Agent-produced runs carry
     `stats.source: "agent"` — label them "plugin push".
4. Link the review UI: `<server_url>/discovery/<repoSlug>`.

If the server is unreachable or the endpoints are missing, say so plainly and
point the user at the review UI URL instead — never guess at state.
