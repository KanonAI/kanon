# Example: the shape of a golden output

A trimmed outline of a real, human-approved taxonomy for an all-in-one
finance/HR platform. Note the **properties**, not the content: six domains each
holding 4–6 features, **no `space` layer at all**, features named for the thing
the user manages, and each one spanning that thing's whole lifecycle.

- **Banking & Cash Management**
  - Business Checking (`/v2/banking/home`) — available vs reserved balance,
    balance trend chart, account details, autopilot settings
  - Treasury (`/v2/banking/treasury`) — yield on idle cash, live rates,
    positions, Buy/Withdraw, interest & fees history
  - Money Movement — ACH, domestic & international wires, book transfers
  - External Accounts — link via Plaid, linked balances
- **Corporate Cards & Spend**
  - Company Cards — issue virtual & physical, freeze, set PIN, statuses
    Active / Frozen / Inactive / Pending / Closed
  - Card Controls — spend limits, budgets, per-card tracking
  - Transactions Ledger (`/v2/banking/transactions`) — unified feed, filters,
    export
  - Receipts — capture, "Missing Receipt" flags, require-receipt policies
    *(merged from three screens that touch receipts)*
  - Rewards & Cashback — earn rates, redemption
- **Bill Pay & Accounting**
  - Bills & Reimbursements · Vendors · Ledger Sync · Bookkeeping Service ·
    Reports
- **Payroll & Time**
  - Pay Runs (`/v2/payroll`) — Draft / Overdue / Failed / Paid
  - Payroll Taxes — federal + per-state settings, tax-filing signatory
  - Time Off — requests, approvals, policies, holiday calendars
  - Timesheets — hourly tracking, feeds the pay run
- **People, Benefits & Documents**
  - Team Directory · Org Structure · Hiring & Onboarding · Benefits ·
    Document Templates · Document Vault
- **Administration & Platform**
  - Company & Administrators · My Cards · My Transactions · AI Assistant ·
    Billing

Why this is golden:

- **Six domains, 4–6 features each.** Nothing wraps a single feature.
- **No `space`.** Six domains do not need a layer above them — it would just
  repeat the list. The app's own Finance / People Ops split survives *inside the
  domain names*. A space layer earns its place at 10+ domains.
- **Features are things, not pages.** "Pay Runs" covers the list, a single run,
  the approval flow and its API. There is no "Pay run detail" entry.
- **Merges are visible.** Receipts came from three screens; Bill Pay and
  Accounting were separate thin domains until they were folded together.
- **No machinery.** The API routes, workers and webhooks are inside the
  boundaries of the features they serve, not siblings of them.
