"use strict";

// src/ci/coverage-core.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
function normalizeCoveragePath(abs, repoRoot) {
  const rel = (0, import_node_path.relative)(repoRoot, abs).split(import_node_path.sep).join("/");
  if (!rel || rel === ".." || rel.startsWith("../")) return null;
  if (rel.split("/").includes("node_modules")) return null;
  return rel;
}
function snapshotCounts(coverage) {
  const m = /* @__PURE__ */ new Map();
  for (const [abs, fc] of Object.entries(coverage)) m.set(abs, { ...fc.s });
  return m;
}
function diffCoveredFiles(baseline, coverage, repoRoot) {
  const out = [];
  for (const [abs, fc] of Object.entries(coverage)) {
    const rel = normalizeCoveragePath(abs, repoRoot);
    if (!rel) continue;
    const base = baseline.get(abs);
    const lines = /* @__PURE__ */ new Set();
    for (const [id, count] of Object.entries(fc.s)) {
      if (count > (base?.[id] ?? 0)) {
        const loc = fc.statementMap[id];
        if (!loc) continue;
        for (let L = loc.start.line; L <= loc.end.line; L++) {
          if (L >= 1) lines.add(L);
        }
      }
    }
    if (lines.size > 0) {
      out.push({ path: rel, lines: [...lines].sort((a, b) => a - b) });
    }
  }
  return out;
}
function resolveShardDir(env, repoRoot) {
  return env.KANON_COVERAGE_DIR || (0, import_node_path.join)(repoRoot, ".kanon", "coverage");
}
function appendShard(shardDir, shardId, entry) {
  (0, import_node_fs.mkdirSync)(shardDir, { recursive: true });
  (0, import_node_fs.appendFileSync)(
    (0, import_node_path.join)(shardDir, `shard-${shardId}.ndjson`),
    `${JSON.stringify(entry)}
`
  );
}
var PerTestRecorder = class {
  constructor(cfg) {
    this.cfg = cfg;
  }
  baseline = null;
  /** True when the run is Istanbul-instrumented (else there is nothing to record). */
  instrumented() {
    return this.cfg.coverage() !== void 0;
  }
  begin() {
    const cov = this.cfg.coverage();
    this.baseline = cov ? snapshotCounts(cov) : /* @__PURE__ */ new Map();
  }
  end(testRef2) {
    const cov = this.cfg.coverage();
    const baseline = this.baseline;
    this.baseline = null;
    if (!cov || !baseline) return;
    const files = diffCoveredFiles(baseline, cov, this.cfg.repoRoot);
    if (files.length > 0) {
      appendShard(this.cfg.shardDir, this.cfg.shardId, { testRef: testRef2, files });
    }
  }
};
function recorderFromEnv(env, shardId) {
  const repoRoot = env.KANON_REPO_ROOT || process.cwd();
  return new PerTestRecorder({
    repoRoot,
    shardDir: resolveShardDir(env, repoRoot),
    shardId,
    coverage: () => globalThis.__coverage__
  });
}

// src/ci/jest-setup.ts
var recorder = recorderFromEnv(process.env, process.pid);
if (!recorder.instrumented()) {
  console.warn(
    "[kanon] no global.__coverage__ \u2014 enable Istanbul coverage (coverageProvider='babel', run with --coverage) or per-test coverage is skipped."
  );
}
function testRef() {
  const state = typeof expect !== "undefined" && expect.getState ? expect.getState() : {};
  const path = state.testPath ?? "test";
  const name = state.currentTestName ?? "test";
  const shortPath = path.split(/[\\/]/).slice(-2).join("/");
  return `${shortPath}::${name}`;
}
beforeEach(() => {
  recorder.begin();
});
afterEach(() => {
  recorder.end(testRef());
});
