---
name: setup-ci
description: >
  Wire per-test line coverage from the user's test suite into Canonize so
  passing tests VERIFY claims (moving guides off 0% Verified). Use for
  "set up CI coverage", "verify claims with tests", "why is everything asserted",
  "connect my tests to Canonize".
disable-model-invocation: true
---

# Canonize CI coverage setup

Canonize infers claims from code — they land **Asserted**. A claim becomes
**Verified** only when a passing test covers its source line. This skill wires a
per-test coverage collector into the user's suite and pushes it, so passing
tests verify the matching claims.

Supported today: **Vitest** and **Jest**, both requiring an **Istanbul**
coverage provider (V8 coverage has no per-test line data to collect).

## 1. Detect the test runner

Look at `package.json` (`scripts.test`, `devDependencies`) and any
`vitest.config.*` / `jest.config.*`. Pick Vitest or Jest. If neither, tell the
user only Vitest/Jest are supported today and stop.

`PLUGIN=${CLAUDE_PLUGIN_ROOT}/mcp-server/dist` — the collector files live at
`$PLUGIN/ci/vitest-setup.js` and `$PLUGIN/ci/jest-setup.cjs`.

## 2. Wire the collector (make the edits, then show the user)

**Vitest** — in `vitest.config.ts`, add the setup file and enable Istanbul
coverage:

```ts
export default defineConfig({
  test: {
    setupFiles: ["<PLUGIN>/ci/vitest-setup.js"],
    coverage: { provider: "istanbul", enabled: true },
  },
});
```

**Jest** — in `jest.config.js`:

```js
module.exports = {
  setupFilesAfterEnv: ["<PLUGIN>/ci/jest-setup.cjs"],
  coverageProvider: "babel", // Istanbul-based; populates global.__coverage__
};
```

Substitute the real absolute `$PLUGIN` path (or a repo-relative one). The
collector writes per-worker shards to `.canonize/coverage/` — add that to
`.gitignore`.

## 3. Add the CI step

The push must run **only after the suite passes** — a green suite is what makes
every recorded test a passing test. Use `&&`:

```bash
# with coverage enabled in config, `run` is enough; else pass --coverage
vitest run && node ${CLAUDE_PLUGIN_ROOT}/mcp-server/dist/cli.js push-tests <repoSlug>
# Jest:
# jest --coverage && node .../dist/cli.js push-tests <repoSlug>
```

Auth in CI is `CANONIZE_API_TOKEN` (a workspace machine token) + `CANONIZE_URL`
in the environment — same as the other CI/Make targets. `repoSlug` may be omitted
if `.canonize/config.json` or `CANONIZE_REPO_SLUG` is set.

## 4. Verify it works

Have the user run the suite once locally with coverage, then:

- `node $PLUGIN/cli.js coverage-merge /tmp/cov.json <repoSlug>` — inspect the
  merged payload (test count, covered files) without pushing.
- `node $PLUGIN/cli.js push-tests <repoSlug>` — or the `canonize_push_tests`
  MCP tool. It returns `{ storedRows, tests, verified, features }`. `verified > 0`
  means claims moved to Verified; reload a feature guide to see the coverage bar.

## When it fails

- **`no coverage shards`** — the suite didn't run with the setup file, or
  coverage wasn't Istanbul-instrumented. Confirm `coverage.provider: "istanbul"`
  (Vitest) / `coverageProvider: "babel"` (Jest) and that the run passed
  `--coverage` (or `enabled: true`).
- **`verified: 0` but tests stored** — the tests cover files, but no covered line
  falls within ±5 of a claim's anchor. Check that the collector's paths are
  repo-relative and match the scanned source paths (they must be identical
  strings). A feature that hasn't been scanned yet has no claims to verify.
- **401 / 404** — see `/canonize:setup` (auth) and the push skill (slug
  ownership). `/api/tests` requires a server that has this release deployed.
