# Example: the shape of a golden output

A trimmed outline of a real, human-approved taxonomy for an all-in-one
finance/HR platform. Note the properties, not the content: two spaces + a
cross-cutting layer, capability-named domains, route-anchored features,
consistent granularity.

## Space: Finance

- **Banking & Cash Management** — routes `/v2/banking/home`, `/v2/banking/treasury`
  - Business Checking (`/v2/banking/home`) — available vs reserved balance,
    balance trend chart, account details, autopilot settings
  - Treasury / Cash Management (`/v2/banking/treasury`) — yield on idle cash,
    live rates, positions table, Buy/Withdraw, interest & fees history
  - Money Movement — ACH, domestic & international wires, book transfers
- **Corporate Cards** — routes `/v2/banking/credit`, `/v2/banking/cards`
  - Company Cards — issue virtual & physical, freeze, set PIN,
    statuses: Active / Frozen / Inactive / Pending / Closed
  - Card Controls — spend limits, budgets, per-card tracking
- **Spend Management** — route `/v2/banking/transactions`
  - Transactions Ledger — unified feed, filters, export
  - Receipts — capture, "Missing Receipt" flags, require-receipt policies
    *(merged from three screens that touch receipts)*

## Space: People Ops

- **Payroll** — routes `/v2/payroll`, `/v2/settings/payroll`
  - Pay Runs — Draft / Overdue / Failed / Paid
  - Payroll Taxes — federal + per-state settings, tax-filing signatory
- **People / HR** — route `/v2/people`
  - Team Directory — employees & contractors, statuses
  - Employee Profile — tabs: Job & pay · Personal · Time off · Benefits · Docs
    *(one representative record captured the tab structure)*

## Admin / Platform (cross-cutting)

- **Administration & Settings** — `/v2/settings/*` *(each sub-page swept)*
- **Platform** — AI assistant, global search, dashboard widgets,
  multi-entity switcher *(captured once, spans every domain)*

Why this is golden: every feature maps to a real route (traceable), names are
capabilities not slugs (searchable), buried functions were promoted
(Accounting lived under Settings), and the app's own Finance/People split
survived as spaces (familiar to its users).
