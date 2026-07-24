# Synthesis: nav → capability taxonomy

A knowledge base is organized around **what a user is trying to accomplish**,
not around how the app's screens happen to be wired. The navigation you found
— in nav components and route definitions (code-only mode), plus what the
pages actually showed (`--refine`) — is evidence, not the final structure. In
refine mode, read back ALL `screens/*.json` from disk first. Then apply these
transformations:

| Transformation | When | Example |
|---|---|---|
| **Split** an overloaded nav section | One nav bucket serves distinct user jobs | "Banking" (checking, cards, transactions) → Banking & Cash Management · Corporate Cards · Spend Management |
| **Promote** buried capabilities | A major business function lives under Settings | Accounting/Bookkeeping settings → their own domain |
| **Merge** scattered pieces | One reader-concept spans several screens | Receipts on transactions + policy settings + personal ledger → one Receipts feature |
| **Extract** cross-cutting themes | A reader's mental category the app never groups | Compliance items spread across 5 domains → note them; they inform descriptions |
| **Preserve** the familiar top-level shape | Users know the app's own spaces | Keep Finance vs People Ops as `space` values |
| **Name by capability** | Route slugs are not names | `/banking/home` → "Business Checking" |

Rules of consistency:
- Uniform depth: every domain has features; every feature has capabilities.
  A feature is a **route-anchored sub-area** — keep its primary route
  attached; capabilities are the page's user-facing bullets. A capability with
  **no user-facing surface** (a backend service, a workflow engine, an RBAC
  model, app chrome) is still a feature: **omit `route` entirely and leave
  `routePrefixes: []` — NEVER invent a route to satisfy validation.** A wrong
  anchor lets the schema rewrite the taxonomy; an absent one is just the truth.
- `space` is the app's own top-level shape, derived in this order of strength:
  the owning team in `.github/CODEOWNERS`, then the top-level nav group the
  feature's routes sit under, then the shared route prefix. Prefer the product's
  existing vocabulary over a category you invented, and keep one space per
  domain.
- Keys are stable kebab-case (`banking`, `corporate-cards`); in shaped mode
  reuse approved keys verbatim.
- Retain provider/integration names you observed (they answer real questions:
  "who administers our 401k?").

## proposal.json field spec

Exactly this shape (the assemble tool validates it):

```json
{
  "domains": [
    {
      "key": "banking",
      "name": "Banking & Cash Management",
      "description": "The core business bank account and how money moves.",
      "space": "Finance",
      "subdomainType": "core | supporting | generic",
      "confidence": 0.8,
      "features": [
        {
          "key": "treasury",
          "name": "Treasury / Cash Management",
          "description": "Yield on idle cash across Treasuries and money market.",
          "route": "/v2/banking/treasury",
          "capabilities": ["Live rates", "Positions table", "Per-position autopilot"],
          "confidence": 0.7,
          "evidence": [
            { "source": "crawl", "summary": "Banking › Treasury — positions table (cost basis, market value, YTM)" },
            { "source": "nav", "summary": "sidebar: Banking group" }
          ],
          "globs": [],
          "routePrefixes": ["/v2/banking/treasury"]
        },
        {
          "key": "payment-rails",
          "name": "Payment Rails",
          "description": "ACH and wire execution — no screen of its own; other features drive it.",
          "capabilities": ["ACH batch submission", "Wire cutoff windows", "Return handling"],
          "confidence": 0.6,
          "evidence": [
            { "source": "module", "summary": "src/payments/rails/ — ach.ts, wire.ts, settlement.ts" },
            { "source": "ownership", "summary": "CODEOWNERS: src/payments/** → @finance-platform" }
          ],
          "globs": ["src/payments/rails/**"],
          "routePrefixes": []
        }
      ]
    }
  ]
}
```

The second feature is the routeless shape: **no `route` key at all**, empty
`routePrefixes`, a real code boundary. That is a complete, valid feature.

- `route` is the feature's primary user-facing route. **Omit the key (or send
  `""`) when the capability has no user-facing surface** — a backend service, a
  workflow engine, an RBAC model, app chrome. Below the wire that stores as
  NULL; it is a supported state, not a gap to paper over. Never anchor such a
  feature to the nearest URL to make validation pass.
- `evidence[].source`: name the signal you actually used.
  - **Code signals** (available in every mode): `"route"` for a route
    definition, `"nav"` for a navigation/menu component, `"guard"` for an auth
    or permission check, `"schema"` for a data model, `"module"` / `"dir"` for
    module structure, `"i18n"` for translated labels, `"ownership"` for
    CODEOWNERS-style attribution.
  - **`"crawl"`** — ONLY for what a page actually showed in a `--refine` run.
    A bundle that cites `crawl` evidence while carrying zero screens is
    **rejected by `/api/ingest`**: crawl evidence asserts a human-visible
    surface was observed, and there'd be nothing backing it. In code-only mode
    you have no screens, so you must never use this source.
  - **`"agent"`** for a synthesis-level judgment (e.g. a split/merge you made).

  Summaries must trace back to what you actually read — a file path in code
  mode, an observed screen in refine mode. A reviewer will read them.
- `globs` + `routePrefixes` are the feature's **boundary**:
  - **Crawl-only** (no repo access): `globs` is always `[]`; `routePrefixes`
    comes from the routes you observed. The server halves this confidence
    because there's no code boundary — don't pre-discount for that.
  - **Code-mode** (a repo is present): derive `globs` as **1–4 simple prefix
    globs** (`dir/**` semantics ONLY) over the feature's code — grep its nouns
    to find the directories, then reduce to a few prefixes, not per-file globs.
    A real boundary **un-halves** the confidence and **enables
    `/canonize:scan`** to deep-scan just those files. Leave `[]` only when
    you truly can't locate the code.
- `confidence` (0–1) is honest: 0.8+ only for features you saw fully working;
  ~0.5 for empty states or single-glance pages; lower if permission-gated.
- `subdomainType`: `core` = the product's differentiating jobs; `supporting` =
  necessary but generic to the domain; `generic` = table stakes (auth,
  settings, notifications).
