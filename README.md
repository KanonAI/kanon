# Canonize — Claude Code plugin

Map your web app from your own Claude Code session, synthesize a capability
taxonomy, and push it to Canonize, where it lands as **proposals for human
review**. Discovery reads your **codebase** by default — no running app, no
browser. Add `--refine` to also crawl the live app in Chrome when the code
alone doesn't capture the full IA; there your browser session does the
authentication (you type credentials/MFA yourself — the agent never touches
them). Your Claude subscription pays for the tokens, and nothing leaves your
machine except the structured bundle you approve for push.

## Install

```bash
claude plugin marketplace add CanonizeAI/canonize-web
claude plugin install canonize@canonize
```

Then, from a project you want to map:

```
/canonize:setup
```

That is the whole onboarding path. It signs you in (a browser approval — no
credentials touch the agent), stores a machine token locally, verifies your
workspace, writes `.canonize/config.json`, and offers to kick off the first
discovery. You do **not** need to pre-configure anything; the `server_url` /
`api_token` / `repo_slug` install prompts are optional overrides (see
[Configuration](#configuration)).

The marketplace is a private repo: you need GitHub read access and a git
credential helper (`gh auth setup-git`). If background marketplace updates
fail over HTTPS, set `CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE=1`.

Requirements: **node ≥ 20** on PATH. The **Claude in Chrome** extension (with
access granted to your app's site) is only needed for the optional
`/canonize:discover --refine` browser crawl.

## Use

| Command | What it does |
|---|---|
| `/canonize:setup [url]` | Sign in (browser approval), verify the workspace, write project config, hand off to discovery |
| `/canonize:discover [url] [slug]` | Analyze the codebase (routes, nav, guards, layouts), synthesize the taxonomy, assemble a validated `bundle.json`. Add `--refine` to also crawl the running app breadth-first (you log in when prompted) |
| `/canonize:scan [--next \| feature] [slug]` | Deep-dive approved features from your code into grounded guides (research → aspects → dives → assemble → push) — all of them by default, `--next` to pick one interactively, or name a feature |
| `/canonize:push [bundle]` | Validate and POST the bundle to `/api/ingest`; returns the review URL |
| `/canonize:status` | What's approved, what's proposed, did the last push land |

State lives in your project's `.canonize/` (gitignore it):
`config.json` holds `{url, repoSlug, targetUrl, role}` — never the token.
`targetUrl` is recorded as bundle metadata on every run (the bundle contract
requires it); it does **not** trigger a browser crawl, only `--refine` does.
`runs/<stamp>/` holds each run's incremental record. A `--refine` crawl
survives compaction and restarts: the run's `manifest.json` is the source of
truth and discovery resumes from its frontier. For very large apps, crawl in
shifts — re-run `/canonize:discover --refine`, point it at the existing run
dir, and it continues.

### Feature guides (`/canonize:scan`)

Once a feature is approved **with a boundary** (prefix globs over its code —
`/canonize:discover` derives these when run inside a repo), `/canonize:scan`
generates a deep guide from the source. With no arguments it loops over **every**
approved feature — one up-front confirmation, then feature by feature, skipping
guides the server already has current and continuing past individual failures.
`--next` asks which single feature to scan (recommending the next one needing
a guide); naming a feature scans exactly that one. The mechanical stages — selecting the
feature's files through the import-graph closure, pruning, and collecting
deterministic facts (tables, routes, cron, constants) — run the **real
Canonize server code**, bundled into the plugin's MCP server, so a guide
built on your machine matches a server-side scan. The session researches each
aspect natively (Read/Grep); a grounding gate (`canonize_assemble_guide`)
enforces that every paragraph is backed by a claim or a `path:line` anchor onto
a file actually read before the guide is assembled and pushed. Runs land in
`.canonize/runs/<stamp>-scan-<feature>/` and resume from `manifest.json`.

## Configuration

Each field is resolved independently, first hit wins:

| Tier | `url` | `token` | `repoSlug` | Set by |
|---|:-:|:-:|:-:|---|
| **Shell env** (CI / dogfood) | `CANONIZE_URL` | `CANONIZE_API_TOKEN` | `CANONIZE_REPO_SLUG` | you / CI |
| **Plugin settings** (keychain) | `server_url` | `api_token` | `repo_slug` | optional install-time override |
| **Credentials file** | — | ✓ | — | `/canonize:setup` |
| **Project file** | ✓ | never | ✓ | `/canonize:setup` / `/canonize:discover` |

- **`~/.canonize/credentials.json`** — written by setup, `0600`, keyed by
  normalized server URL, so one machine can hold tokens for several Canonize
  instances. The token lives here and nowhere else the model can read.
  **Sign out** = delete that URL's entry (or the whole file). `CANONIZE_HOME`
  overrides the directory. A **second machine** just runs `/canonize:setup`
  again — tokens aren't synced.
- **`.canonize/config.json`** (per project) — `{url, repoSlug, targetUrl,
  role}`, never a token. Gitignore `.canonize/`.
- Run `canonize_whoami` (or `dist/cli.js whoami`) any time to see which
  workspace you're bound to and **which tier** each field came from.

**Security note.** The token and the in-flight device secret are written with
`0600` under `~/.canonize/`, and *only* the `canonize_setup_*` tools (and
their CLI twins) ever read or write them — the skills carry a standing
instruction never to `cat`, print, or screenshot those files, and no tool
returns a token to the model. This is a **same-user** protection: it relies on
the tooling's shape plus that instruction, not on OS sandboxing. Anyone with
your shell/user account can read the files; treat the token like any other
`~/.netrc`-class credential.

**Crawl a staging/test tenant when you can.** The skill enforces a read-only
discipline (never clicks destructive or submit actions), but an agent in a
production tenant deserves the same caution as any automation.

## Dogfood / develop (this repo)

```bash
make dev                          # Canonize server on :3000
export CANONIZE_URL=http://localhost:3000
export CANONIZE_API_TOKEN=<your local token>
cd <any project dir>
claude --plugin-dir /path/to/Canonize/plugin/canonize
# /canonize:discover https://dev.every.io every-io/every
```

`/reload-plugins` picks up skill edits mid-session. `make plugin-validate`,
`make plugin-build`, `make plugin-test`, `make plugin-release-check` from the
repo root.

## Troubleshooting

- **`canonize_*` tools missing in a `--plugin-dir` session** — userConfig
  is only prompted for on marketplace install, never for `--plugin-dir`; the
  server now starts with empty config and falls through to the shell env, so
  export `CANONIZE_URL` + `CANONIZE_API_TOKEN` before launching. (For a
  real install you can also pre-seed values:
  `claude plugin install canonize@canonize --config server_url=…`.)
  The skills degrade deliberately when tools are absent: assembly/validation
  fall back to `mcp-server/dist/cli.js`, push falls back to curl.
- **Tools missing / `/mcp` shows the server down** — `node --version` ≥ 20?
  `plugin/canonize/mcp-server/dist/` present (it's checked in)?
- **401 on push / discover** — not signed in. Run `/canonize:setup` (CI:
  `CANONIZE_API_TOKEN`).
- **404 on push / taxonomy** — the slug is owned by another workspace. An
  unclaimed slug is claimed into your token's workspace on first taxonomy
  fetch/ingest; if it's claimed elsewhere, pick a different slug or re-run
  `/canonize:setup` as the account that owns it.
- **Sign-in code expired** before you approved it — just run `/canonize:setup`
  again for a fresh code (it auto-restarts once on expiry, too).
- **`whoami` says the token came from `shell env` but I just signed in** — a
  `CANONIZE_API_TOKEN` export is shadowing the credentials file (shell env
  wins). `unset CANONIZE_API_TOKEN` to use the fresh sign-in.
- **Signed in but tools still say "not signed in"** — usually a `HOME` mismatch:
  setup wrote to `$HOME/.canonize` but the MCP server sees a different `HOME`
  (or `CANONIZE_HOME`). Check both point at the same place.
- **Second machine / new laptop** — tokens aren't synced; run
  `/canonize:setup` there too.
- **413 / timeout** — re-assemble without a transcript or split the crawl.

## Releasing

`mcp-server/dist/` is **checked in** (installed plugins are cache-copied, so
the plugin must be self-contained) — rebuild it whenever `mcp-server/src`
changes. Every user-visible change bumps `version` in
`.claude-plugin/plugin.json` and gets a CHANGELOG entry; installed customers
only receive updates on a version bump. `make plugin-release-check` guards
both. The bundle schema (`schemas/bundle.schema.json`) is emitted from the
app's Zod contract via `pnpm emit:bundle-schema` — never edit it by hand.
