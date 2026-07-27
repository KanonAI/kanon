import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// src/ci/vitest-setup.ts
import { afterEach, beforeEach } from "vitest";

// src/ci/coverage-core.ts
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync
} from "node:fs";
import { join, relative, sep } from "node:path";
function normalizeCoveragePath(abs, repoRoot) {
  const rel = relative(repoRoot, abs).split(sep).join("/");
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
  return env.KANON_COVERAGE_DIR || join(repoRoot, ".kanon", "coverage");
}
function appendShard(shardDir, shardId, entry) {
  mkdirSync(shardDir, { recursive: true });
  appendFileSync(
    join(shardDir, `shard-${shardId}.ndjson`),
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
  end(testRef) {
    const cov = this.cfg.coverage();
    const baseline = this.baseline;
    this.baseline = null;
    if (!cov || !baseline) return;
    const files = diffCoveredFiles(baseline, cov, this.cfg.repoRoot);
    if (files.length > 0) {
      appendShard(this.cfg.shardDir, this.cfg.shardId, { testRef, files });
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

// src/ci/vitest-setup.ts
var recorder = recorderFromEnv(process.env, process.pid);
if (!recorder.instrumented()) {
  console.warn(
    "[kanon] no globalThis.__coverage__ \u2014 enable Istanbul coverage (coverage.provider='istanbul', run with --coverage) or per-test coverage is skipped."
  );
}
function testRefOf(task) {
  if (!task) return "unknown";
  const file = task.file?.name ?? task.file?.filepath ?? "test";
  const line = task.location?.line;
  if (typeof line === "number") return `${file}:${line}`;
  const suite = task.suite?.name ? `${task.suite.name} > ` : "";
  return `${file}::${suite}${task.name ?? "test"}`;
}
beforeEach(() => {
  recorder.begin();
});
afterEach((ctx) => {
  recorder.end(testRefOf(ctx?.task));
});
