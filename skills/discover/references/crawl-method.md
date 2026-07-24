# The crawl method

Derived from the methodology that produced Canonize's golden KB: treat the
app's navigation as *evidence*, capture structure over pixels, breadth first,
depth selectively.

## Map the skeleton first

1. Read the left/top navigation as an accessibility tree.
2. **Expand every collapsible group** — collapsed groups hide routes. Re-read
   the nav after each expansion to collect newly revealed links.
3. Record the full skeleton in `manifest.json` (`navSkeleton`: label, URL,
   group) and seed `frontier` with every route, before visiting anything.
   Discovering the skeleton first prevents a depth-first rabbit hole where you
   lose track of what's left.

## Visit breadth-first

Work the frontier top-down. For each page:

- **Navigate by clicking** the in-app link (SPAs often redirect hard-loaded
  deep links back to a default view; clicking exercises the router the way a
  user would).
- Read the page as an accessibility tree. Capture, in the screen record:
  - **tabs** — they reveal sub-features
  - **section headings** — they reveal the page's shape
  - **table names + column names** — they reveal the data model
  - **action buttons** — they reveal user tasks
  - **statuses / badges** — they reveal lifecycle and workflow
  - a short **digestLines** slice of name-bearing a11y lines (headings, nav,
    tabs, landmarks) — ≤ 24 lines
- Write the screen file IMMEDIATELY (see run-format.md), append the transition
  you took, update `manifest.json`. Then pick the next frontier item.

## Depth selectively

- Open **ONE representative detail record per record type** (one employee, one
  card, one invoice…) and mark it `detailRecordOf`. The schema repeats;
  visiting every record adds cost without structure.
- **Settings** swaps in its own sub-navigation: enter it, sweep every sub-page.
- Capture cross-cutting surfaces once: global search, in-app assistant,
  dashboard widgets, workspace/entity switcher, mobile nav if present.

## Dedup and caps

- Skip a URL whose parameterized shape you already recorded (`/users/123` and
  `/users/456` are the same screen) unless the page structure is clearly
  different.
- Pagination, calendars, and infinite feeds: capture one instance, move on.
- Empty states still count — record the page with `emptyState: true` and infer
  features from headers/columns, noting that in the record.

## Honesty notes to carry into the record

- Your account's role shapes what you can see; note areas that look
  permission-gated.
- Demo/test data values are not facts — capture structure and capabilities,
  not figures.
