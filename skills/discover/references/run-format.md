# Run directory format

Everything lives under `.canonize/runs/<UTC-stamp>/` (e.g.
`runs/2026-07-16T14-05-00Z/`). The disk is the crawl's source of truth — the
assemble tool reads these files mechanically, and *you* re-read them to
recover state and to synthesize.

```
manifest.json          # the crawl state machine — update after EVERY screen
screens/NNN-<slug>.json# one file per visited screen, written immediately
transitions.jsonl      # append-only: one {fromUrl, action, toUrl} per line
proposal.json          # synthesis output (you write this in step 6)
report.md              # human-readable summary table (you write this too)
bundle.json            # written by canonize_assemble_bundle — never by hand
```

## manifest.json

```json
{
  "targetUrl": "https://app.example.com",
  "repoSlug": "acme/app",
  "role": "admin",
  "startedAt": "2026-07-16T14:05:00Z",
  "model": "<your model id>",
  "status": "crawling | synthesizing | assembled | pushed",
  "navSkeleton": [ { "label": "Treasury", "url": "…", "group": "Banking" } ],
  "frontier": ["<urls not yet visited>"],
  "visited": [ { "url": "…", "file": "004-treasury.json" } ],
  "notes": ["permission-gated: /admin returned 403 for this role"]
}
```

`startedAt` must be UTC ISO with a `Z` suffix — it becomes the bundle's
`capturedAt`.

## screens/NNN-\<slug\>.json

`NNN` is a zero-padded visit counter; `<slug>` is a short kebab name.

```json
{
  "url": "https://app.example.com/v2/banking/treasury",
  "title": "Treasury",
  "trail": ["Banking", "Treasury"],
  "depth": 1,
  "digestLines": ["heading Treasury", "tab Positions", "…(≤ 24 lines)"],
  "tabs": ["Positions", "History"],
  "headings": ["Live rates", "Interest & fees"],
  "tableColumns": { "Positions": ["Cost basis", "Market value", "YTM"] },
  "actions": ["Buy", "Withdraw"],
  "statuses": ["Active", "Matured"],
  "detailRecordOf": "position",
  "emptyState": false
}
```

Only `url` is required; include what the page actually showed. `trail` is the
nav breadcrumb you clicked to get here — it becomes the information
architecture, so keep it accurate.

## transitions.jsonl

One JSON object per line: `{"fromUrl": "…", "action": "link: Treasury",
"toUrl": "…"}`. Append as you navigate; the assemble tool resolves URLs to
screen ids and drops what it can't resolve (it reports the count).
