# Synthesis: nav → capability taxonomy

A knowledge base is organized around **what a user is trying to accomplish**,
not around how the app's screens happen to be wired. The navigation you found
— in nav components and route definitions (code-only mode), plus what the
pages actually showed (`--refine`) — is evidence, not the final structure. In
refine mode, read back ALL `screens/*.json` from disk first.

## The unit: what a FEATURE is

A feature is **a thing the user manages** — a noun, named as they would say it
("Invoices", "Pay runs", "Time off") — or a surface they work in ("Inbox"). It
spans that thing's **whole lifecycle**: its list, its detail page, its
create/edit flow, its settings tab and its API are **one feature, not five**.

Split two views of one thing **only when they serve different jobs at different
times** (a planning backlog vs an execution board). Never split because there
are several routes. This is how the navigation of every mature B2B product is
built — HubSpot ships "Invoices", not "Invoice list" + "Invoice detail" +
"Invoice settings".

## Transformations

| Transformation | When | Example |
|---|---|---|
| **Merge a lifecycle** | List, detail, create and settings screens of one thing | `/invoices` + `/invoices/new` + `/invoices/[id]` → one "Invoices" |
| **Split** an overloaded nav section | One nav bucket serves distinct user jobs | "Banking" (checking, cards, transactions) → Banking & Cash Management · Corporate Cards · Spend Management |
| **Promote** buried capabilities | A major business function lives under Settings | Accounting/Bookkeeping settings → their own domain |
| **Merge** scattered pieces | One reader-concept spans several screens | Receipts on transactions + policy settings + personal ledger → one Receipts feature |
| **Fold in** machinery | An endpoint, worker or webhook serving a feature | `/api/chat/*` → the boundary of "Ask the knowledge base", never its own feature |
| **Extract** cross-cutting themes | A reader's mental category the app never groups | Compliance items spread across 5 domains → note them; they inform descriptions |
| **Name by capability** | Route slugs are not names | `/banking/home` → "Business Checking" |

## Hard rules — the server rejects and re-asks when one is broken

- **5–12 domains.** Named as a stakeholder would say them, never after code
  layout (`apps`, `libs`, `components`, `services`) or a directory.
- **Every domain holds at least 3 features** (aim 4–8). One or two means it is
  not a domain — merge it into the domain whose job it serves.
- **`space` must be `""`** unless you are proposing 10+ domains, and then every
  space must group at least 2 of them. A space layer over a short domain list
  just repeats it. **Empty is the normal case.**
- **A parent never shares a name with its child** — no space named after its
  only domain, no feature named after its domain.
- **A feature must be nameable without its parent.** "Members", not "Settings
  members". If the key needs the domain's name to make sense, you split on a
  route instead of a job.
- **Never name a feature after machinery** (`…-api`, `…-service`, `…-handler`,
  `…-worker`, `…-webhook`, `…-repo`) **or after a screen type** (`…-page`,
  `…-list`, `…-detail`, `…-overview`, `…-home`).
- **20–40 features total** for a single-purpose product.

## Rules of consistency

- Uniform depth: every domain has features; every feature has capabilities.
  `route` is the feature's **nav entry point** (one destination);
  `routePrefixes` carries the whole lifecycle including the `/api/*` URLs that
  serve it. A capability with **no user-facing surface** (a backend service, a
  workflow engine, an RBAC model, app chrome) is still a feature: **omit `route`
  entirely and leave `routePrefixes: []` — NEVER invent a route to satisfy
  validation.** A wrong anchor lets the schema rewrite the taxonomy; an absent
  one is just the truth.
- `capabilities` are **5–12 things a person can DO with the thing across its
  lifecycle** (create it, review it, export it, the states it moves through) —
  not the widgets on one page. When features get coarser this is where the
  detail goes; never fewer than 2.
- Keys are stable kebab-case (`banking`, `corporate-cards`); in shaped mode
  reuse approved keys verbatim.
- Retain provider/integration names you observed (they answer real questions:
  "who administers our 401k?").
- **Cover the whole product** — marketing pages, billing, settings, admin,
  auth. But cover them by FOLDING them into the right feature, not by minting
  one feature per page: the four screens of a marketing site are one "Marketing
  site" feature whose capabilities name the screens.

## proposal.json field spec

Exactly this shape (the assemble tool validates it):

```json
{
  "domains": [
    {
      "key": "banking",
      "name": "Banking & Cash Management",
      "description": "The core business bank account and how money moves.",
      "space": "",
      "subdomainType": "core | supporting | generic",
      "confidence": 0.8,
      "features": [
        {
          "key": "treasury",
          "name": "Treasury / Cash Management",
          "description": "Yield on idle cash across Treasuries and money market.",
          "route": "/v2/banking/treasury",
          "capabilities": [
            "See live rates and current yield",
            "Review positions (cost basis, market value, YTM)",
            "Buy into and withdraw from a position",
            "Turn per-position autopilot on or off",
            "Read interest and fees history"
          ],
          "confidence": 0.7,
          "evidence": [
            { "source": "crawl", "summary": "Banking › Treasury — positions table (cost basis, market value, YTM)" },
            { "source": "nav", "summary": "sidebar: Banking group" }
          ],
          "globs": [],
          "routePrefixes": ["/v2/banking/treasury", "/api/treasury"]
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

- `route` is the feature's **nav entry point** — the one destination a person
  clicks to. The rest of the lifecycle (`/x/new`, `/x/[id]`, `/api/x`) belongs in
  `routePrefixes`, not in a second feature. **Omit the key (or send
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
    `/kanon:scan`** to deep-scan just those files. Leave `[]` only when
    you truly can't locate the code.
- `confidence` (0–1) is honest: 0.8+ only for features you saw fully working;
  ~0.5 for empty states or single-glance pages; lower if permission-gated.
- `subdomainType`: `core` = the product's differentiating jobs; `supporting` =
  necessary but generic to the domain; `generic` = table stakes (auth,
  settings, notifications).
