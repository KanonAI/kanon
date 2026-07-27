import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/cli.ts
import { existsSync as existsSync5, mkdirSync as mkdirSync3, readFileSync as readFileSync8, writeFileSync as writeFileSync4 } from "node:fs";
import { join as join14, resolve as resolve2 } from "node:path";

// src/api.ts
var GUIDANCE = {
  401: "authentication failed \u2014 run /kanon:setup to sign in (CI/dogfood: check KANON_API_TOKEN)",
  404: "repo slug not found or owned by another workspace \u2014 an unclaimed slug is claimed into your token's workspace on first taxonomy fetch/ingest; if it's claimed elsewhere, pick a different slug or run /kanon:setup with the right account",
  413: "bundle too large \u2014 drop the transcript, or split the crawl into smaller runs"
};
async function request(target, method, path, body) {
  let res;
  try {
    res = await fetch(`${target.url.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        ...target.token ? { authorization: `Bearer ${target.token}` } : {},
        ...body !== void 0 ? { "content-type": "application/json" } : {}
      },
      ...body !== void 0 ? { body: JSON.stringify(body) } : {}
    });
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: `cannot reach ${target.url}: ${e instanceof Error ? e.message : String(e)}`,
      guidance: "check the server URL (KANON_URL / .kanon/config.json) and that the Kanon server is running; run /kanon:setup to (re)configure"
    };
  }
  let json = void 0;
  try {
    json = await res.json();
  } catch {
  }
  if (!res.ok) {
    const body2 = json;
    return {
      ok: false,
      status: res.status,
      error: body2?.error ?? `HTTP ${res.status}`,
      guidance: GUIDANCE[res.status],
      ...body2?.detail !== void 0 ? { detail: body2.detail } : {}
    };
  }
  return { ok: true, ...json };
}
function deviceStart(url) {
  return request({ url }, "POST", "/api/device/start", {});
}
function devicePoll(url, deviceCode) {
  return request(
    { url },
    "GET",
    `/api/device/poll?deviceCode=${encodeURIComponent(deviceCode)}`
  );
}
function whoami(config2) {
  return request(config2, "GET", "/api/whoami");
}
async function pushGuide(config2, bundle, repoSlug) {
  const r = await request(config2, "POST", "/api/guide", {
    repoSlug,
    bundle
  });
  if (!r.ok) {
    if (r.status === 404) {
      return {
        ...r,
        guidance: `feature not approved \u2014 approve it at ${config2.url.replace(/\/$/, "")}/discovery/${encodeURIComponent(repoSlug)}, or POST /api/taxonomy to bulk-approve, then push again`
      };
    }
    return r;
  }
  if ("skipped" in r && r.skipped) return r;
  return {
    ...r,
    reviewUrl: `${config2.url.replace(/\/$/, "")}/discovery/${encodeURIComponent(repoSlug)}`
  };
}
async function pushTests(config2, coverage, repoSlug) {
  return request(config2, "POST", "/api/tests", {
    ...coverage,
    repoSlug
  });
}

// src/assemble.ts
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
var PAGINATION_KEYS = /* @__PURE__ */ new Set([
  "page",
  "offset",
  "cursor",
  "limit",
  "p",
  "start",
  "per_page",
  "perpage"
]);
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var LONG_HEX = /^[0-9a-f]{12,}$/i;
function isDynamicSegment(seg) {
  if (seg.length === 0) return false;
  if (/^\d+$/.test(seg)) return true;
  if (UUID.test(seg)) return true;
  if (LONG_HEX.test(seg)) return true;
  if (seg.length >= 8) {
    const digits = (seg.match(/\d/g) ?? []).length;
    if (digits / seg.length >= 0.4) return true;
  }
  return false;
}
function templateUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl, "http://internal.local");
  } catch {
    return rawUrl;
  }
  const path = "/" + u.pathname.split("/").filter((s) => s.length > 0).map((seg) => isDynamicSegment(seg) ? ":id" : seg.toLowerCase()).join("/");
  const keys = [...u.searchParams.keys()].filter((k) => !PAGINATION_KEYS.has(k.toLowerCase())).map((k) => k.toLowerCase()).sort();
  const uniqueKeys = [...new Set(keys)];
  return uniqueKeys.length > 0 ? `${path}?${uniqueKeys.join("&")}` : path;
}
var MAX_DIGEST_LINES = 40;
function composeDigest(s) {
  const lines = [...s.digestLines ?? []];
  for (const t of s.tabs ?? []) lines.push(`tab ${t}`);
  for (const h of s.headings ?? []) lines.push(`heading ${h}`);
  for (const [table, cols] of Object.entries(s.tableColumns ?? {})) {
    lines.push(`table ${table}: ${cols.join(", ")}`);
  }
  for (const a of s.actions ?? []) lines.push(`action ${a}`);
  if (s.statuses?.length) lines.push(`statuses: ${s.statuses.join(" / ")}`);
  if (s.detailRecordOf) lines.push(`detail record of: ${s.detailRecordOf}`);
  if (s.emptyState) lines.push("empty state (features inferred from headers)");
  return [...new Set(lines.map((l) => l.trim()).filter(Boolean))].slice(0, MAX_DIGEST_LINES).join("\n");
}
function structuralKeyOf(digest) {
  return createHash("sha256").update(digest).digest("hex").slice(0, 16);
}
function screenIdOf(urlTemplate, structuralKey2) {
  return `scr_${createHash("sha256").update(`${urlTemplate}::${structuralKey2}`).digest("hex").slice(0, 16)}`;
}
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function readScreens(runDir) {
  const dir = join(runDir, "screens");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => readJson(join(dir, f)));
}
function readTransitions(runDir) {
  const path = join(runDir, "transitions.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}
function assembleBundle(opts) {
  const manifest = existsSync(join(opts.runDir, "manifest.json")) ? readJson(join(opts.runDir, "manifest.json")) : {};
  const records = readScreens(opts.runDir);
  const proposalPath = join(opts.runDir, "proposal.json");
  if (!existsSync(proposalPath)) {
    throw new Error(
      `no proposal.json in ${opts.runDir} \u2014 run the synthesis step first`
    );
  }
  const proposal = readJson(proposalPath);
  const targetUrl = opts.targetUrl ?? manifest.targetUrl;
  if (!targetUrl) {
    throw new Error("no targetUrl \u2014 pass it or set it in manifest.json");
  }
  const repoSlug = opts.repoSlug ?? manifest.repoSlug;
  if (!repoSlug) {
    throw new Error("no repoSlug \u2014 pass it or set it in manifest.json");
  }
  const screens = [];
  const byKey = /* @__PURE__ */ new Map();
  const byUrl = /* @__PURE__ */ new Map();
  const byTemplate = /* @__PURE__ */ new Map();
  for (const r of records) {
    const urlTemplate = templateUrl(r.url);
    const digest = composeDigest(r);
    const structuralKey2 = structuralKeyOf(digest);
    const dedupKey = `${urlTemplate}::${structuralKey2}`;
    let id = byKey.get(dedupKey);
    if (!id) {
      id = screenIdOf(urlTemplate, structuralKey2);
      byKey.set(dedupKey, id);
      if (!byTemplate.has(urlTemplate)) byTemplate.set(urlTemplate, id);
      const trail = r.trail ?? [];
      screens.push({
        id,
        url: r.url,
        urlTemplate,
        structuralKey: structuralKey2,
        title: r.title ?? "",
        ...r.role ?? manifest.role ?? opts.role ? { role: r.role ?? manifest.role ?? opts.role } : {},
        trail,
        ...trail.length > 0 ? { area: trail[0] } : {},
        digest,
        depth: r.depth ?? trail.length
      });
    }
    byUrl.set(r.url, id);
  }
  const transitions = [];
  let dropped = 0;
  for (const t of readTransitions(opts.runDir)) {
    const fromId = byUrl.get(t.fromUrl) ?? byTemplate.get(templateUrl(t.fromUrl));
    const toId = byUrl.get(t.toUrl) ?? byTemplate.get(templateUrl(t.toUrl));
    if (!fromId || !toId) {
      dropped++;
      continue;
    }
    transitions.push({ fromId, action: t.action, toId });
  }
  const bundle = {
    bundleVersion: 1,
    meta: {
      repoSlug,
      targetUrl,
      capturedAt: manifest.startedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
      agent: {
        harness: "claude-code",
        model: opts.model ?? manifest.model ?? "unknown",
        pluginVersion: opts.pluginVersion
      },
      ...opts.role ?? manifest.role ? { role: opts.role ?? manifest.role } : {}
    },
    screenGraph: { screens, transitions },
    proposal
  };
  const proposalShape = proposal;
  const domains = proposalShape.domains ?? [];
  const bundlePath = join(opts.runDir, "bundle.json");
  writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}
`);
  return {
    bundlePath,
    bundle,
    stats: {
      screens: screens.length,
      dedupedFrom: records.length,
      transitions: transitions.length,
      droppedTransitions: dropped,
      domains: domains.length,
      features: domains.reduce((n, d) => n + (d.features?.length ?? 0), 0)
    }
  };
}

// src/ci/coverage-core.ts
import {
  appendFileSync,
  existsSync as existsSync2,
  mkdirSync,
  readdirSync as readdirSync2,
  readFileSync as readFileSync2,
  rmSync
} from "node:fs";
import { join as join2, relative, sep } from "node:path";
var COVERAGE_VERSION = 1;
function assemblePayload(params) {
  const byRef = /* @__PURE__ */ new Map();
  for (const raw of params.raws) {
    let fileMap = byRef.get(raw.testRef);
    if (!fileMap) {
      fileMap = /* @__PURE__ */ new Map();
      byRef.set(raw.testRef, fileMap);
    }
    for (const f of raw.files) {
      let ls = fileMap.get(f.path);
      if (!ls) {
        ls = /* @__PURE__ */ new Set();
        fileMap.set(f.path, ls);
      }
      for (const l of f.lines) ls.add(l);
    }
  }
  const tests = [...byRef.entries()].map(
    ([testRef, fileMap]) => ({
      testRef,
      status: "passed",
      lastPassedAt: params.capturedAt,
      files: [...fileMap.entries()].map(([path, ls]) => ({
        path,
        lines: [...ls].sort((a, b) => a - b)
      }))
    })
  );
  return {
    coverageVersion: COVERAGE_VERSION,
    repoSlug: params.repoSlug,
    capturedAt: params.capturedAt,
    tests
  };
}
function resolveShardDir(env, repoRoot2) {
  return env.KANON_COVERAGE_DIR || join2(repoRoot2, ".kanon", "coverage");
}
function readShards(shardDir) {
  if (!existsSync2(shardDir)) return [];
  const out = [];
  for (const f of readdirSync2(shardDir)) {
    if (!f.endsWith(".ndjson")) continue;
    const text = readFileSync2(join2(shardDir, f), "utf8");
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        out.push(JSON.parse(t));
      } catch {
      }
    }
  }
  return out;
}
function clearShards(shardDir) {
  if (existsSync2(shardDir)) rmSync(shardDir, { recursive: true, force: true });
}

// src/ci/validate-coverage.ts
import { readFileSync as readFileSync3 } from "node:fs";
import { dirname, join as join3 } from "node:path";
import { fileURLToPath } from "node:url";

// node_modules/.pnpm/@cfworker+json-schema@4.1.1/node_modules/@cfworker/json-schema/dist/esm/deep-compare-strict.js
function deepCompareStrict(a, b) {
  const typeofa = typeof a;
  if (typeofa !== typeof b) {
    return false;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) {
      return false;
    }
    const length = a.length;
    if (length !== b.length) {
      return false;
    }
    for (let i = 0; i < length; i++) {
      if (!deepCompareStrict(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }
  if (typeofa === "object") {
    if (!a || !b) {
      return a === b;
    }
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    const length = aKeys.length;
    if (length !== bKeys.length) {
      return false;
    }
    for (const k of aKeys) {
      if (!deepCompareStrict(a[k], b[k])) {
        return false;
      }
    }
    return true;
  }
  return a === b;
}

// node_modules/.pnpm/@cfworker+json-schema@4.1.1/node_modules/@cfworker/json-schema/dist/esm/pointer.js
function encodePointer(p) {
  return encodeURI(escapePointer(p));
}
function escapePointer(p) {
  return p.replace(/~/g, "~0").replace(/\//g, "~1");
}

// node_modules/.pnpm/@cfworker+json-schema@4.1.1/node_modules/@cfworker/json-schema/dist/esm/dereference.js
var schemaArrayKeyword = {
  prefixItems: true,
  items: true,
  allOf: true,
  anyOf: true,
  oneOf: true
};
var schemaMapKeyword = {
  $defs: true,
  definitions: true,
  properties: true,
  patternProperties: true,
  dependentSchemas: true
};
var ignoredKeyword = {
  id: true,
  $id: true,
  $ref: true,
  $schema: true,
  $anchor: true,
  $vocabulary: true,
  $comment: true,
  default: true,
  enum: true,
  const: true,
  required: true,
  type: true,
  maximum: true,
  minimum: true,
  exclusiveMaximum: true,
  exclusiveMinimum: true,
  multipleOf: true,
  maxLength: true,
  minLength: true,
  pattern: true,
  format: true,
  maxItems: true,
  minItems: true,
  uniqueItems: true,
  maxProperties: true,
  minProperties: true
};
var initialBaseURI = typeof self !== "undefined" && self.location && self.location.origin !== "null" ? new URL(self.location.origin + self.location.pathname + location.search) : new URL("https://github.com/cfworker");
function dereference(schema, lookup = /* @__PURE__ */ Object.create(null), baseURI = initialBaseURI, basePointer = "") {
  if (schema && typeof schema === "object" && !Array.isArray(schema)) {
    const id = schema.$id || schema.id;
    if (id) {
      const url = new URL(id, baseURI.href);
      if (url.hash.length > 1) {
        lookup[url.href] = schema;
      } else {
        url.hash = "";
        if (basePointer === "") {
          baseURI = url;
        } else {
          dereference(schema, lookup, baseURI);
        }
      }
    }
  } else if (schema !== true && schema !== false) {
    return lookup;
  }
  const schemaURI = baseURI.href + (basePointer ? "#" + basePointer : "");
  if (lookup[schemaURI] !== void 0) {
    throw new Error(`Duplicate schema URI "${schemaURI}".`);
  }
  lookup[schemaURI] = schema;
  if (schema === true || schema === false) {
    return lookup;
  }
  if (schema.__absolute_uri__ === void 0) {
    Object.defineProperty(schema, "__absolute_uri__", {
      enumerable: false,
      value: schemaURI
    });
  }
  if (schema.$ref && schema.__absolute_ref__ === void 0) {
    const url = new URL(schema.$ref, baseURI.href);
    url.hash = url.hash;
    Object.defineProperty(schema, "__absolute_ref__", {
      enumerable: false,
      value: url.href
    });
  }
  if (schema.$recursiveRef && schema.__absolute_recursive_ref__ === void 0) {
    const url = new URL(schema.$recursiveRef, baseURI.href);
    url.hash = url.hash;
    Object.defineProperty(schema, "__absolute_recursive_ref__", {
      enumerable: false,
      value: url.href
    });
  }
  if (schema.$anchor) {
    const url = new URL("#" + schema.$anchor, baseURI.href);
    lookup[url.href] = schema;
  }
  for (let key in schema) {
    if (ignoredKeyword[key]) {
      continue;
    }
    const keyBase = `${basePointer}/${encodePointer(key)}`;
    const subSchema = schema[key];
    if (Array.isArray(subSchema)) {
      if (schemaArrayKeyword[key]) {
        const length = subSchema.length;
        for (let i = 0; i < length; i++) {
          dereference(subSchema[i], lookup, baseURI, `${keyBase}/${i}`);
        }
      }
    } else if (schemaMapKeyword[key]) {
      for (let subKey in subSchema) {
        dereference(subSchema[subKey], lookup, baseURI, `${keyBase}/${encodePointer(subKey)}`);
      }
    } else {
      dereference(subSchema, lookup, baseURI, keyBase);
    }
  }
  return lookup;
}

// node_modules/.pnpm/@cfworker+json-schema@4.1.1/node_modules/@cfworker/json-schema/dist/esm/format.js
var DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
var DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
var TIME = /^(\d\d):(\d\d):(\d\d)(\.\d+)?(z|[+-]\d\d(?::?\d\d)?)?$/i;
var HOSTNAME = /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i;
var URIREF = /^(?:[a-z][a-z0-9+\-.]*:)?(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'"()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
var URITEMPLATE = /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i;
var URL_ = /^(?:(?:https?|ftp):\/\/)(?:\S+(?::\S*)?@)?(?:(?!10(?:\.\d{1,3}){3})(?!127(?:\.\d{1,3}){3})(?!169\.254(?:\.\d{1,3}){2})(?!192\.168(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u{00a1}-\u{ffff}0-9]+-?)*[a-z\u{00a1}-\u{ffff}0-9]+)(?:\.(?:[a-z\u{00a1}-\u{ffff}0-9]+-?)*[a-z\u{00a1}-\u{ffff}0-9]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu;
var UUID2 = /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
var JSON_POINTER = /^(?:\/(?:[^~/]|~0|~1)*)*$/;
var JSON_POINTER_URI_FRAGMENT = /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i;
var RELATIVE_JSON_POINTER = /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/;
var EMAIL = (input) => {
  if (input[0] === '"')
    return false;
  const [name, host, ...rest] = input.split("@");
  if (!name || !host || rest.length !== 0 || name.length > 64 || host.length > 253)
    return false;
  if (name[0] === "." || name.endsWith(".") || name.includes(".."))
    return false;
  if (!/^[a-z0-9.-]+$/i.test(host) || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(name))
    return false;
  return host.split(".").every((part) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(part));
};
var IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
var IPV6 = /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i;
var DURATION = (input) => input.length > 1 && input.length < 80 && (/^P\d+([.,]\d+)?W$/.test(input) || /^P[\dYMDTHS]*(\d[.,]\d+)?[YMDHS]$/.test(input) && /^P([.,\d]+Y)?([.,\d]+M)?([.,\d]+D)?(T([.,\d]+H)?([.,\d]+M)?([.,\d]+S)?)?$/.test(input));
function bind(r) {
  return r.test.bind(r);
}
var format = {
  date,
  time: time.bind(void 0, false),
  "date-time": date_time,
  duration: DURATION,
  uri,
  "uri-reference": bind(URIREF),
  "uri-template": bind(URITEMPLATE),
  url: bind(URL_),
  email: EMAIL,
  hostname: bind(HOSTNAME),
  ipv4: bind(IPV4),
  ipv6: bind(IPV6),
  regex,
  uuid: bind(UUID2),
  "json-pointer": bind(JSON_POINTER),
  "json-pointer-uri-fragment": bind(JSON_POINTER_URI_FRAGMENT),
  "relative-json-pointer": bind(RELATIVE_JSON_POINTER)
};
function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
function date(str) {
  const matches = str.match(DATE);
  if (!matches)
    return false;
  const year = +matches[1];
  const month = +matches[2];
  const day = +matches[3];
  return month >= 1 && month <= 12 && day >= 1 && day <= (month == 2 && isLeapYear(year) ? 29 : DAYS[month]);
}
function time(full, str) {
  const matches = str.match(TIME);
  if (!matches)
    return false;
  const hour = +matches[1];
  const minute = +matches[2];
  const second = +matches[3];
  const timeZone = !!matches[5];
  return (hour <= 23 && minute <= 59 && second <= 59 || hour == 23 && minute == 59 && second == 60) && (!full || timeZone);
}
var DATE_TIME_SEPARATOR = /t|\s/i;
function date_time(str) {
  const dateTime = str.split(DATE_TIME_SEPARATOR);
  return dateTime.length == 2 && date(dateTime[0]) && time(true, dateTime[1]);
}
var NOT_URI_FRAGMENT = /\/|:/;
var URI_PATTERN = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
function uri(str) {
  return NOT_URI_FRAGMENT.test(str) && URI_PATTERN.test(str);
}
var Z_ANCHOR = /[^\\]\\Z/;
function regex(str) {
  if (Z_ANCHOR.test(str))
    return false;
  try {
    new RegExp(str, "u");
    return true;
  } catch (e) {
    return false;
  }
}

// node_modules/.pnpm/@cfworker+json-schema@4.1.1/node_modules/@cfworker/json-schema/dist/esm/types.js
var OutputFormat;
(function(OutputFormat2) {
  OutputFormat2[OutputFormat2["Flag"] = 1] = "Flag";
  OutputFormat2[OutputFormat2["Basic"] = 2] = "Basic";
  OutputFormat2[OutputFormat2["Detailed"] = 4] = "Detailed";
})(OutputFormat || (OutputFormat = {}));

// node_modules/.pnpm/@cfworker+json-schema@4.1.1/node_modules/@cfworker/json-schema/dist/esm/ucs2-length.js
function ucs2length(s) {
  let result = 0;
  let length = s.length;
  let index2 = 0;
  let charCode;
  while (index2 < length) {
    result++;
    charCode = s.charCodeAt(index2++);
    if (charCode >= 55296 && charCode <= 56319 && index2 < length) {
      charCode = s.charCodeAt(index2);
      if ((charCode & 64512) == 56320) {
        index2++;
      }
    }
  }
  return result;
}

// node_modules/.pnpm/@cfworker+json-schema@4.1.1/node_modules/@cfworker/json-schema/dist/esm/validate.js
function validate(instance, schema, draft = "2019-09", lookup = dereference(schema), shortCircuit = true, recursiveAnchor = null, instanceLocation = "#", schemaLocation = "#", evaluated = /* @__PURE__ */ Object.create(null)) {
  if (schema === true) {
    return { valid: true, errors: [] };
  }
  if (schema === false) {
    return {
      valid: false,
      errors: [
        {
          instanceLocation,
          keyword: "false",
          keywordLocation: instanceLocation,
          error: "False boolean schema."
        }
      ]
    };
  }
  const rawInstanceType = typeof instance;
  let instanceType;
  switch (rawInstanceType) {
    case "boolean":
    case "number":
    case "string":
      instanceType = rawInstanceType;
      break;
    case "object":
      if (instance === null) {
        instanceType = "null";
      } else if (Array.isArray(instance)) {
        instanceType = "array";
      } else {
        instanceType = "object";
      }
      break;
    default:
      throw new Error(`Instances of "${rawInstanceType}" type are not supported.`);
  }
  const { $ref, $recursiveRef, $recursiveAnchor, type: $type, const: $const, enum: $enum, required: $required, not: $not, anyOf: $anyOf, allOf: $allOf, oneOf: $oneOf, if: $if, then: $then, else: $else, format: $format, properties: $properties, patternProperties: $patternProperties, additionalProperties: $additionalProperties, unevaluatedProperties: $unevaluatedProperties, minProperties: $minProperties, maxProperties: $maxProperties, propertyNames: $propertyNames, dependentRequired: $dependentRequired, dependentSchemas: $dependentSchemas, dependencies: $dependencies, prefixItems: $prefixItems, items: $items, additionalItems: $additionalItems, unevaluatedItems: $unevaluatedItems, contains: $contains, minContains: $minContains, maxContains: $maxContains, minItems: $minItems, maxItems: $maxItems, uniqueItems: $uniqueItems, minimum: $minimum, maximum: $maximum, exclusiveMinimum: $exclusiveMinimum, exclusiveMaximum: $exclusiveMaximum, multipleOf: $multipleOf, minLength: $minLength, maxLength: $maxLength, pattern: $pattern, __absolute_ref__, __absolute_recursive_ref__ } = schema;
  const errors = [];
  if ($recursiveAnchor === true && recursiveAnchor === null) {
    recursiveAnchor = schema;
  }
  if ($recursiveRef === "#") {
    const refSchema = recursiveAnchor === null ? lookup[__absolute_recursive_ref__] : recursiveAnchor;
    const keywordLocation = `${schemaLocation}/$recursiveRef`;
    const result = validate(instance, recursiveAnchor === null ? schema : recursiveAnchor, draft, lookup, shortCircuit, refSchema, instanceLocation, keywordLocation, evaluated);
    if (!result.valid) {
      errors.push({
        instanceLocation,
        keyword: "$recursiveRef",
        keywordLocation,
        error: "A subschema had errors."
      }, ...result.errors);
    }
  }
  if ($ref !== void 0) {
    const uri2 = __absolute_ref__ || $ref;
    const refSchema = lookup[uri2];
    if (refSchema === void 0) {
      let message = `Unresolved $ref "${$ref}".`;
      if (__absolute_ref__ && __absolute_ref__ !== $ref) {
        message += `  Absolute URI "${__absolute_ref__}".`;
      }
      message += `
Known schemas:
- ${Object.keys(lookup).join("\n- ")}`;
      throw new Error(message);
    }
    const keywordLocation = `${schemaLocation}/$ref`;
    const result = validate(instance, refSchema, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, keywordLocation, evaluated);
    if (!result.valid) {
      errors.push({
        instanceLocation,
        keyword: "$ref",
        keywordLocation,
        error: "A subschema had errors."
      }, ...result.errors);
    }
    if (draft === "4" || draft === "7") {
      return { valid: errors.length === 0, errors };
    }
  }
  if (Array.isArray($type)) {
    let length = $type.length;
    let valid = false;
    for (let i = 0; i < length; i++) {
      if (instanceType === $type[i] || $type[i] === "integer" && instanceType === "number" && instance % 1 === 0 && instance === instance) {
        valid = true;
        break;
      }
    }
    if (!valid) {
      errors.push({
        instanceLocation,
        keyword: "type",
        keywordLocation: `${schemaLocation}/type`,
        error: `Instance type "${instanceType}" is invalid. Expected "${$type.join('", "')}".`
      });
    }
  } else if ($type === "integer") {
    if (instanceType !== "number" || instance % 1 || instance !== instance) {
      errors.push({
        instanceLocation,
        keyword: "type",
        keywordLocation: `${schemaLocation}/type`,
        error: `Instance type "${instanceType}" is invalid. Expected "${$type}".`
      });
    }
  } else if ($type !== void 0 && instanceType !== $type) {
    errors.push({
      instanceLocation,
      keyword: "type",
      keywordLocation: `${schemaLocation}/type`,
      error: `Instance type "${instanceType}" is invalid. Expected "${$type}".`
    });
  }
  if ($const !== void 0) {
    if (instanceType === "object" || instanceType === "array") {
      if (!deepCompareStrict(instance, $const)) {
        errors.push({
          instanceLocation,
          keyword: "const",
          keywordLocation: `${schemaLocation}/const`,
          error: `Instance does not match ${JSON.stringify($const)}.`
        });
      }
    } else if (instance !== $const) {
      errors.push({
        instanceLocation,
        keyword: "const",
        keywordLocation: `${schemaLocation}/const`,
        error: `Instance does not match ${JSON.stringify($const)}.`
      });
    }
  }
  if ($enum !== void 0) {
    if (instanceType === "object" || instanceType === "array") {
      if (!$enum.some((value) => deepCompareStrict(instance, value))) {
        errors.push({
          instanceLocation,
          keyword: "enum",
          keywordLocation: `${schemaLocation}/enum`,
          error: `Instance does not match any of ${JSON.stringify($enum)}.`
        });
      }
    } else if (!$enum.some((value) => instance === value)) {
      errors.push({
        instanceLocation,
        keyword: "enum",
        keywordLocation: `${schemaLocation}/enum`,
        error: `Instance does not match any of ${JSON.stringify($enum)}.`
      });
    }
  }
  if ($not !== void 0) {
    const keywordLocation = `${schemaLocation}/not`;
    const result = validate(instance, $not, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, keywordLocation);
    if (result.valid) {
      errors.push({
        instanceLocation,
        keyword: "not",
        keywordLocation,
        error: 'Instance matched "not" schema.'
      });
    }
  }
  let subEvaluateds = [];
  if ($anyOf !== void 0) {
    const keywordLocation = `${schemaLocation}/anyOf`;
    const errorsLength = errors.length;
    let anyValid = false;
    for (let i = 0; i < $anyOf.length; i++) {
      const subSchema = $anyOf[i];
      const subEvaluated = Object.create(evaluated);
      const result = validate(instance, subSchema, draft, lookup, shortCircuit, $recursiveAnchor === true ? recursiveAnchor : null, instanceLocation, `${keywordLocation}/${i}`, subEvaluated);
      errors.push(...result.errors);
      anyValid = anyValid || result.valid;
      if (result.valid) {
        subEvaluateds.push(subEvaluated);
      }
    }
    if (anyValid) {
      errors.length = errorsLength;
    } else {
      errors.splice(errorsLength, 0, {
        instanceLocation,
        keyword: "anyOf",
        keywordLocation,
        error: "Instance does not match any subschemas."
      });
    }
  }
  if ($allOf !== void 0) {
    const keywordLocation = `${schemaLocation}/allOf`;
    const errorsLength = errors.length;
    let allValid = true;
    for (let i = 0; i < $allOf.length; i++) {
      const subSchema = $allOf[i];
      const subEvaluated = Object.create(evaluated);
      const result = validate(instance, subSchema, draft, lookup, shortCircuit, $recursiveAnchor === true ? recursiveAnchor : null, instanceLocation, `${keywordLocation}/${i}`, subEvaluated);
      errors.push(...result.errors);
      allValid = allValid && result.valid;
      if (result.valid) {
        subEvaluateds.push(subEvaluated);
      }
    }
    if (allValid) {
      errors.length = errorsLength;
    } else {
      errors.splice(errorsLength, 0, {
        instanceLocation,
        keyword: "allOf",
        keywordLocation,
        error: `Instance does not match every subschema.`
      });
    }
  }
  if ($oneOf !== void 0) {
    const keywordLocation = `${schemaLocation}/oneOf`;
    const errorsLength = errors.length;
    const matches = $oneOf.filter((subSchema, i) => {
      const subEvaluated = Object.create(evaluated);
      const result = validate(instance, subSchema, draft, lookup, shortCircuit, $recursiveAnchor === true ? recursiveAnchor : null, instanceLocation, `${keywordLocation}/${i}`, subEvaluated);
      errors.push(...result.errors);
      if (result.valid) {
        subEvaluateds.push(subEvaluated);
      }
      return result.valid;
    }).length;
    if (matches === 1) {
      errors.length = errorsLength;
    } else {
      errors.splice(errorsLength, 0, {
        instanceLocation,
        keyword: "oneOf",
        keywordLocation,
        error: `Instance does not match exactly one subschema (${matches} matches).`
      });
    }
  }
  if (instanceType === "object" || instanceType === "array") {
    Object.assign(evaluated, ...subEvaluateds);
  }
  if ($if !== void 0) {
    const keywordLocation = `${schemaLocation}/if`;
    const conditionResult = validate(instance, $if, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, keywordLocation, evaluated).valid;
    if (conditionResult) {
      if ($then !== void 0) {
        const thenResult = validate(instance, $then, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, `${schemaLocation}/then`, evaluated);
        if (!thenResult.valid) {
          errors.push({
            instanceLocation,
            keyword: "if",
            keywordLocation,
            error: `Instance does not match "then" schema.`
          }, ...thenResult.errors);
        }
      }
    } else if ($else !== void 0) {
      const elseResult = validate(instance, $else, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, `${schemaLocation}/else`, evaluated);
      if (!elseResult.valid) {
        errors.push({
          instanceLocation,
          keyword: "if",
          keywordLocation,
          error: `Instance does not match "else" schema.`
        }, ...elseResult.errors);
      }
    }
  }
  if (instanceType === "object") {
    if ($required !== void 0) {
      for (const key of $required) {
        if (!(key in instance)) {
          errors.push({
            instanceLocation,
            keyword: "required",
            keywordLocation: `${schemaLocation}/required`,
            error: `Instance does not have required property "${key}".`
          });
        }
      }
    }
    const keys = Object.keys(instance);
    if ($minProperties !== void 0 && keys.length < $minProperties) {
      errors.push({
        instanceLocation,
        keyword: "minProperties",
        keywordLocation: `${schemaLocation}/minProperties`,
        error: `Instance does not have at least ${$minProperties} properties.`
      });
    }
    if ($maxProperties !== void 0 && keys.length > $maxProperties) {
      errors.push({
        instanceLocation,
        keyword: "maxProperties",
        keywordLocation: `${schemaLocation}/maxProperties`,
        error: `Instance does not have at least ${$maxProperties} properties.`
      });
    }
    if ($propertyNames !== void 0) {
      const keywordLocation = `${schemaLocation}/propertyNames`;
      for (const key in instance) {
        const subInstancePointer = `${instanceLocation}/${encodePointer(key)}`;
        const result = validate(key, $propertyNames, draft, lookup, shortCircuit, recursiveAnchor, subInstancePointer, keywordLocation);
        if (!result.valid) {
          errors.push({
            instanceLocation,
            keyword: "propertyNames",
            keywordLocation,
            error: `Property name "${key}" does not match schema.`
          }, ...result.errors);
        }
      }
    }
    if ($dependentRequired !== void 0) {
      const keywordLocation = `${schemaLocation}/dependantRequired`;
      for (const key in $dependentRequired) {
        if (key in instance) {
          const required = $dependentRequired[key];
          for (const dependantKey of required) {
            if (!(dependantKey in instance)) {
              errors.push({
                instanceLocation,
                keyword: "dependentRequired",
                keywordLocation,
                error: `Instance has "${key}" but does not have "${dependantKey}".`
              });
            }
          }
        }
      }
    }
    if ($dependentSchemas !== void 0) {
      for (const key in $dependentSchemas) {
        const keywordLocation = `${schemaLocation}/dependentSchemas`;
        if (key in instance) {
          const result = validate(instance, $dependentSchemas[key], draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, `${keywordLocation}/${encodePointer(key)}`, evaluated);
          if (!result.valid) {
            errors.push({
              instanceLocation,
              keyword: "dependentSchemas",
              keywordLocation,
              error: `Instance has "${key}" but does not match dependant schema.`
            }, ...result.errors);
          }
        }
      }
    }
    if ($dependencies !== void 0) {
      const keywordLocation = `${schemaLocation}/dependencies`;
      for (const key in $dependencies) {
        if (key in instance) {
          const propsOrSchema = $dependencies[key];
          if (Array.isArray(propsOrSchema)) {
            for (const dependantKey of propsOrSchema) {
              if (!(dependantKey in instance)) {
                errors.push({
                  instanceLocation,
                  keyword: "dependencies",
                  keywordLocation,
                  error: `Instance has "${key}" but does not have "${dependantKey}".`
                });
              }
            }
          } else {
            const result = validate(instance, propsOrSchema, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, `${keywordLocation}/${encodePointer(key)}`);
            if (!result.valid) {
              errors.push({
                instanceLocation,
                keyword: "dependencies",
                keywordLocation,
                error: `Instance has "${key}" but does not match dependant schema.`
              }, ...result.errors);
            }
          }
        }
      }
    }
    const thisEvaluated = /* @__PURE__ */ Object.create(null);
    let stop = false;
    if ($properties !== void 0) {
      const keywordLocation = `${schemaLocation}/properties`;
      for (const key in $properties) {
        if (!(key in instance)) {
          continue;
        }
        const subInstancePointer = `${instanceLocation}/${encodePointer(key)}`;
        const result = validate(instance[key], $properties[key], draft, lookup, shortCircuit, recursiveAnchor, subInstancePointer, `${keywordLocation}/${encodePointer(key)}`);
        if (result.valid) {
          evaluated[key] = thisEvaluated[key] = true;
        } else {
          stop = shortCircuit;
          errors.push({
            instanceLocation,
            keyword: "properties",
            keywordLocation,
            error: `Property "${key}" does not match schema.`
          }, ...result.errors);
          if (stop)
            break;
        }
      }
    }
    if (!stop && $patternProperties !== void 0) {
      const keywordLocation = `${schemaLocation}/patternProperties`;
      for (const pattern in $patternProperties) {
        const regex2 = new RegExp(pattern, "u");
        const subSchema = $patternProperties[pattern];
        for (const key in instance) {
          if (!regex2.test(key)) {
            continue;
          }
          const subInstancePointer = `${instanceLocation}/${encodePointer(key)}`;
          const result = validate(instance[key], subSchema, draft, lookup, shortCircuit, recursiveAnchor, subInstancePointer, `${keywordLocation}/${encodePointer(pattern)}`);
          if (result.valid) {
            evaluated[key] = thisEvaluated[key] = true;
          } else {
            stop = shortCircuit;
            errors.push({
              instanceLocation,
              keyword: "patternProperties",
              keywordLocation,
              error: `Property "${key}" matches pattern "${pattern}" but does not match associated schema.`
            }, ...result.errors);
          }
        }
      }
    }
    if (!stop && $additionalProperties !== void 0) {
      const keywordLocation = `${schemaLocation}/additionalProperties`;
      for (const key in instance) {
        if (thisEvaluated[key]) {
          continue;
        }
        const subInstancePointer = `${instanceLocation}/${encodePointer(key)}`;
        const result = validate(instance[key], $additionalProperties, draft, lookup, shortCircuit, recursiveAnchor, subInstancePointer, keywordLocation);
        if (result.valid) {
          evaluated[key] = true;
        } else {
          stop = shortCircuit;
          errors.push({
            instanceLocation,
            keyword: "additionalProperties",
            keywordLocation,
            error: `Property "${key}" does not match additional properties schema.`
          }, ...result.errors);
        }
      }
    } else if (!stop && $unevaluatedProperties !== void 0) {
      const keywordLocation = `${schemaLocation}/unevaluatedProperties`;
      for (const key in instance) {
        if (!evaluated[key]) {
          const subInstancePointer = `${instanceLocation}/${encodePointer(key)}`;
          const result = validate(instance[key], $unevaluatedProperties, draft, lookup, shortCircuit, recursiveAnchor, subInstancePointer, keywordLocation);
          if (result.valid) {
            evaluated[key] = true;
          } else {
            errors.push({
              instanceLocation,
              keyword: "unevaluatedProperties",
              keywordLocation,
              error: `Property "${key}" does not match unevaluated properties schema.`
            }, ...result.errors);
          }
        }
      }
    }
  } else if (instanceType === "array") {
    if ($maxItems !== void 0 && instance.length > $maxItems) {
      errors.push({
        instanceLocation,
        keyword: "maxItems",
        keywordLocation: `${schemaLocation}/maxItems`,
        error: `Array has too many items (${instance.length} > ${$maxItems}).`
      });
    }
    if ($minItems !== void 0 && instance.length < $minItems) {
      errors.push({
        instanceLocation,
        keyword: "minItems",
        keywordLocation: `${schemaLocation}/minItems`,
        error: `Array has too few items (${instance.length} < ${$minItems}).`
      });
    }
    const length = instance.length;
    let i = 0;
    let stop = false;
    if ($prefixItems !== void 0) {
      const keywordLocation = `${schemaLocation}/prefixItems`;
      const length2 = Math.min($prefixItems.length, length);
      for (; i < length2; i++) {
        const result = validate(instance[i], $prefixItems[i], draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${i}`, `${keywordLocation}/${i}`);
        evaluated[i] = true;
        if (!result.valid) {
          stop = shortCircuit;
          errors.push({
            instanceLocation,
            keyword: "prefixItems",
            keywordLocation,
            error: `Items did not match schema.`
          }, ...result.errors);
          if (stop)
            break;
        }
      }
    }
    if ($items !== void 0) {
      const keywordLocation = `${schemaLocation}/items`;
      if (Array.isArray($items)) {
        const length2 = Math.min($items.length, length);
        for (; i < length2; i++) {
          const result = validate(instance[i], $items[i], draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${i}`, `${keywordLocation}/${i}`);
          evaluated[i] = true;
          if (!result.valid) {
            stop = shortCircuit;
            errors.push({
              instanceLocation,
              keyword: "items",
              keywordLocation,
              error: `Items did not match schema.`
            }, ...result.errors);
            if (stop)
              break;
          }
        }
      } else {
        for (; i < length; i++) {
          const result = validate(instance[i], $items, draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${i}`, keywordLocation);
          evaluated[i] = true;
          if (!result.valid) {
            stop = shortCircuit;
            errors.push({
              instanceLocation,
              keyword: "items",
              keywordLocation,
              error: `Items did not match schema.`
            }, ...result.errors);
            if (stop)
              break;
          }
        }
      }
      if (!stop && $additionalItems !== void 0) {
        const keywordLocation2 = `${schemaLocation}/additionalItems`;
        for (; i < length; i++) {
          const result = validate(instance[i], $additionalItems, draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${i}`, keywordLocation2);
          evaluated[i] = true;
          if (!result.valid) {
            stop = shortCircuit;
            errors.push({
              instanceLocation,
              keyword: "additionalItems",
              keywordLocation: keywordLocation2,
              error: `Items did not match additional items schema.`
            }, ...result.errors);
          }
        }
      }
    }
    if ($contains !== void 0) {
      if (length === 0 && $minContains === void 0) {
        errors.push({
          instanceLocation,
          keyword: "contains",
          keywordLocation: `${schemaLocation}/contains`,
          error: `Array is empty. It must contain at least one item matching the schema.`
        });
      } else if ($minContains !== void 0 && length < $minContains) {
        errors.push({
          instanceLocation,
          keyword: "minContains",
          keywordLocation: `${schemaLocation}/minContains`,
          error: `Array has less items (${length}) than minContains (${$minContains}).`
        });
      } else {
        const keywordLocation = `${schemaLocation}/contains`;
        const errorsLength = errors.length;
        let contained = 0;
        for (let j = 0; j < length; j++) {
          const result = validate(instance[j], $contains, draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${j}`, keywordLocation);
          if (result.valid) {
            evaluated[j] = true;
            contained++;
          } else {
            errors.push(...result.errors);
          }
        }
        if (contained >= ($minContains || 0)) {
          errors.length = errorsLength;
        }
        if ($minContains === void 0 && $maxContains === void 0 && contained === 0) {
          errors.splice(errorsLength, 0, {
            instanceLocation,
            keyword: "contains",
            keywordLocation,
            error: `Array does not contain item matching schema.`
          });
        } else if ($minContains !== void 0 && contained < $minContains) {
          errors.push({
            instanceLocation,
            keyword: "minContains",
            keywordLocation: `${schemaLocation}/minContains`,
            error: `Array must contain at least ${$minContains} items matching schema. Only ${contained} items were found.`
          });
        } else if ($maxContains !== void 0 && contained > $maxContains) {
          errors.push({
            instanceLocation,
            keyword: "maxContains",
            keywordLocation: `${schemaLocation}/maxContains`,
            error: `Array may contain at most ${$maxContains} items matching schema. ${contained} items were found.`
          });
        }
      }
    }
    if (!stop && $unevaluatedItems !== void 0) {
      const keywordLocation = `${schemaLocation}/unevaluatedItems`;
      for (i; i < length; i++) {
        if (evaluated[i]) {
          continue;
        }
        const result = validate(instance[i], $unevaluatedItems, draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${i}`, keywordLocation);
        evaluated[i] = true;
        if (!result.valid) {
          errors.push({
            instanceLocation,
            keyword: "unevaluatedItems",
            keywordLocation,
            error: `Items did not match unevaluated items schema.`
          }, ...result.errors);
        }
      }
    }
    if ($uniqueItems) {
      for (let j = 0; j < length; j++) {
        const a = instance[j];
        const ao = typeof a === "object" && a !== null;
        for (let k = 0; k < length; k++) {
          if (j === k) {
            continue;
          }
          const b = instance[k];
          const bo = typeof b === "object" && b !== null;
          if (a === b || ao && bo && deepCompareStrict(a, b)) {
            errors.push({
              instanceLocation,
              keyword: "uniqueItems",
              keywordLocation: `${schemaLocation}/uniqueItems`,
              error: `Duplicate items at indexes ${j} and ${k}.`
            });
            j = Number.MAX_SAFE_INTEGER;
            k = Number.MAX_SAFE_INTEGER;
          }
        }
      }
    }
  } else if (instanceType === "number") {
    if (draft === "4") {
      if ($minimum !== void 0 && ($exclusiveMinimum === true && instance <= $minimum || instance < $minimum)) {
        errors.push({
          instanceLocation,
          keyword: "minimum",
          keywordLocation: `${schemaLocation}/minimum`,
          error: `${instance} is less than ${$exclusiveMinimum ? "or equal to " : ""} ${$minimum}.`
        });
      }
      if ($maximum !== void 0 && ($exclusiveMaximum === true && instance >= $maximum || instance > $maximum)) {
        errors.push({
          instanceLocation,
          keyword: "maximum",
          keywordLocation: `${schemaLocation}/maximum`,
          error: `${instance} is greater than ${$exclusiveMaximum ? "or equal to " : ""} ${$maximum}.`
        });
      }
    } else {
      if ($minimum !== void 0 && instance < $minimum) {
        errors.push({
          instanceLocation,
          keyword: "minimum",
          keywordLocation: `${schemaLocation}/minimum`,
          error: `${instance} is less than ${$minimum}.`
        });
      }
      if ($maximum !== void 0 && instance > $maximum) {
        errors.push({
          instanceLocation,
          keyword: "maximum",
          keywordLocation: `${schemaLocation}/maximum`,
          error: `${instance} is greater than ${$maximum}.`
        });
      }
      if ($exclusiveMinimum !== void 0 && instance <= $exclusiveMinimum) {
        errors.push({
          instanceLocation,
          keyword: "exclusiveMinimum",
          keywordLocation: `${schemaLocation}/exclusiveMinimum`,
          error: `${instance} is less than ${$exclusiveMinimum}.`
        });
      }
      if ($exclusiveMaximum !== void 0 && instance >= $exclusiveMaximum) {
        errors.push({
          instanceLocation,
          keyword: "exclusiveMaximum",
          keywordLocation: `${schemaLocation}/exclusiveMaximum`,
          error: `${instance} is greater than or equal to ${$exclusiveMaximum}.`
        });
      }
    }
    if ($multipleOf !== void 0) {
      const remainder = instance % $multipleOf;
      if (Math.abs(0 - remainder) >= 11920929e-14 && Math.abs($multipleOf - remainder) >= 11920929e-14) {
        errors.push({
          instanceLocation,
          keyword: "multipleOf",
          keywordLocation: `${schemaLocation}/multipleOf`,
          error: `${instance} is not a multiple of ${$multipleOf}.`
        });
      }
    }
  } else if (instanceType === "string") {
    const length = $minLength === void 0 && $maxLength === void 0 ? 0 : ucs2length(instance);
    if ($minLength !== void 0 && length < $minLength) {
      errors.push({
        instanceLocation,
        keyword: "minLength",
        keywordLocation: `${schemaLocation}/minLength`,
        error: `String is too short (${length} < ${$minLength}).`
      });
    }
    if ($maxLength !== void 0 && length > $maxLength) {
      errors.push({
        instanceLocation,
        keyword: "maxLength",
        keywordLocation: `${schemaLocation}/maxLength`,
        error: `String is too long (${length} > ${$maxLength}).`
      });
    }
    if ($pattern !== void 0 && !new RegExp($pattern, "u").test(instance)) {
      errors.push({
        instanceLocation,
        keyword: "pattern",
        keywordLocation: `${schemaLocation}/pattern`,
        error: `String does not match pattern.`
      });
    }
    if ($format !== void 0 && format[$format] && !format[$format](instance)) {
      errors.push({
        instanceLocation,
        keyword: "format",
        keywordLocation: `${schemaLocation}/format`,
        error: `String does not match format "${$format}".`
      });
    }
  }
  return { valid: errors.length === 0, errors };
}

// node_modules/.pnpm/@cfworker+json-schema@4.1.1/node_modules/@cfworker/json-schema/dist/esm/validator.js
var Validator = class {
  schema;
  draft;
  shortCircuit;
  lookup;
  constructor(schema, draft = "2019-09", shortCircuit = true) {
    this.schema = schema;
    this.draft = draft;
    this.shortCircuit = shortCircuit;
    this.lookup = dereference(schema);
  }
  validate(instance) {
    return validate(instance, this.schema, this.draft, this.lookup, this.shortCircuit);
  }
  addSchema(schema, id) {
    if (id) {
      schema = { ...schema, $id: id };
    }
    dereference(schema, this.lookup);
  }
};

// src/ci/validate-coverage.ts
function loadSchema(pluginRoot) {
  const candidates = [
    pluginRoot ? join3(pluginRoot, "schemas", "test-coverage.schema.json") : null,
    // Bundled into dist/cli.js → schemas/ is two levels up (plugin/kanon/schemas).
    join3(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "schemas",
      "test-coverage.schema.json"
    )
  ].filter((p) => p !== null);
  for (const p of candidates) {
    try {
      return JSON.parse(readFileSync3(p, "utf8"));
    } catch {
    }
  }
  return null;
}
function validateCoverage(payload, pluginRoot) {
  const schema = loadSchema(pluginRoot);
  if (!schema) return { valid: true, schemaMissing: true, errors: [] };
  const validator = new Validator(
    schema,
    "2020-12",
    false
  );
  const result = validator.validate(payload);
  return {
    valid: result.valid,
    schemaMissing: false,
    errors: result.errors.slice(0, 10).map((e) => ({
      instanceLocation: e.instanceLocation,
      keyword: e.keyword,
      error: e.error
    }))
  };
}

// src/config.ts
import { existsSync as existsSync3, readFileSync as readFileSync5 } from "node:fs";
import { dirname as dirname2, join as join5, resolve } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/store.ts
import {
  chmodSync,
  mkdirSync as mkdirSync2,
  readFileSync as readFileSync4,
  renameSync,
  rmSync as rmSync2,
  writeFileSync as writeFileSync2
} from "node:fs";
import { homedir } from "node:os";
import { join as join4 } from "node:path";
function clean(v) {
  if (!v) return void 0;
  const t = v.trim();
  if (t.length === 0 || t.includes("${")) return void 0;
  return t;
}
function normalizeUrl(url) {
  return url.trim().replace(/\/+$/, "");
}
function kanonHome(env = process.env) {
  return clean(env.KANON_HOME) ?? join4(homedir(), ".kanon");
}
function credentialsPath(env = process.env) {
  return join4(kanonHome(env), "credentials.json");
}
function pendingPath(env = process.env) {
  return join4(kanonHome(env), "device-pending.json");
}
function atomicWrite(path, data, env) {
  mkdirSync2(kanonHome(env), { recursive: true, mode: 448 });
  const tmp = `${path}.tmp`;
  writeFileSync2(tmp, data, { mode: 384 });
  renameSync(tmp, path);
  chmodSync(path, 384);
}
function readCredentials(env = process.env) {
  try {
    const parsed = JSON.parse(
      readFileSync4(credentialsPath(env), "utf8")
    );
    if (!parsed || typeof parsed.servers !== "object" || parsed.servers === null) {
      return { version: 1, servers: {} };
    }
    return { version: 1, servers: parsed.servers };
  } catch {
    return { version: 1, servers: {} };
  }
}
function writeCredential(env, url, cred) {
  const current = readCredentials(env);
  current.servers[normalizeUrl(url)] = cred;
  const path = credentialsPath(env);
  atomicWrite(path, JSON.stringify(current, null, 2), env);
  return path;
}
function credentialFor(env, url) {
  return readCredentials(env).servers[normalizeUrl(url)];
}
function readPending(env = process.env) {
  try {
    const parsed = JSON.parse(
      readFileSync4(pendingPath(env), "utf8")
    );
    if (!parsed || typeof parsed.deviceCode !== "string") return void 0;
    return parsed;
  } catch {
    return void 0;
  }
}
function writePending(env, pending) {
  const path = pendingPath(env);
  atomicWrite(path, JSON.stringify(pending, null, 2), env);
  return path;
}
function clearPending(env = process.env) {
  rmSync2(pendingPath(env), { force: true });
}

// src/config.ts
function readProjectConfig(cwd) {
  const path = join5(cwd, ".kanon", "config.json");
  if (!existsSync3(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync5(path, "utf8"));
    return {
      url: clean(parsed.url),
      repoSlug: clean(parsed.repoSlug),
      targetUrl: clean(parsed.targetUrl),
      role: clean(parsed.role)
    };
  } catch {
    return {};
  }
}
function defaultPluginRoot() {
  return resolve(dirname2(fileURLToPath2(import.meta.url)), "..", "..");
}
function pick(candidates) {
  for (const [raw, source] of candidates) {
    const value = clean(raw);
    if (value !== void 0) return { value, source };
  }
  return { source: "unset" };
}
function resolveInternal(env, cwd) {
  const project = readProjectConfig(cwd);
  const url = pick([
    [env.KANON_URL, "shell env"],
    [env.KANON_CFG_URL, "plugin setting (keychain)"],
    [project.url, "project file (.kanon/config.json)"]
  ]);
  const storedToken = url.value ? credentialFor(env, url.value)?.token : void 0;
  const token = pick([
    [env.KANON_API_TOKEN, "shell env"],
    [env.KANON_CFG_TOKEN, "plugin setting (keychain)"],
    [storedToken, "credentials file (~/.kanon/credentials.json)"]
  ]);
  const repoSlug = pick([
    [env.KANON_REPO_SLUG, "shell env"],
    [env.KANON_CFG_REPO_SLUG, "plugin setting (keychain)"],
    [project.repoSlug, "project file (.kanon/config.json)"]
  ]);
  return {
    url,
    token,
    repoSlug,
    pluginRoot: clean(env.KANON_PLUGIN_ROOT) ?? defaultPluginRoot()
  };
}
function resolveConfig(env = process.env, cwd = process.cwd()) {
  const d = resolveInternal(env, cwd);
  return {
    url: d.url.value,
    token: d.token.value,
    repoSlug: d.repoSlug.value,
    pluginRoot: d.pluginRoot
  };
}
function resolveConfigDetailed(env = process.env, cwd = process.cwd()) {
  const d = resolveInternal(env, cwd);
  return { ...d, token: { source: d.token.source } };
}
function pluginVersion(pluginRoot) {
  try {
    const manifest = JSON.parse(
      readFileSync5(join5(pluginRoot, ".claude-plugin", "plugin.json"), "utf8")
    );
    return manifest.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// src/scan/assemble-guide.ts
import { existsSync as existsSync4, readFileSync as readFileSync6, readdirSync as readdirSync3, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join6 } from "node:path";

// ../../../src/usecases/feature-boundary.ts
function matchesGlob(path, glob) {
  const g = glob.trim().replace(/^\.\//, "").replace(/^\//, "");
  if (g.length === 0) return false;
  if (g.endsWith("/**")) {
    return path.startsWith(g.slice(0, -2));
  }
  const starIdx = g.indexOf("*");
  if (starIdx === -1) {
    return path === g || path.startsWith(`${g}/`);
  }
  const lastSlash = g.lastIndexOf("/");
  if (starIdx > lastSlash) {
    const dir = lastSlash === -1 ? "" : g.slice(0, lastSlash + 1);
    const suffix = g.slice(starIdx + 1);
    if (!path.startsWith(dir)) return false;
    const rest = path.slice(dir.length);
    return !rest.includes("/") && rest.endsWith(suffix);
  }
  return false;
}

// ../../../src/usecases/plan-aspects.ts
function splitOversizedAspects(aspects, maxFiles = 40) {
  const out = [];
  for (const a of aspects) {
    if (a.filePaths.length <= maxFiles) {
      out.push({ ...a, order: out.length });
      continue;
    }
    const bins = packByDirectory(a.filePaths, maxFiles);
    bins.forEach((bin, i) => {
      out.push({
        key: bins.length === 1 ? a.key : `${a.key}-${i + 1}`,
        name: bins.length === 1 ? a.name : `${a.name} \u2014 ${bin.label}`,
        description: a.description,
        order: out.length,
        filePaths: bin.files
      });
    });
  }
  return out;
}
function packByDirectory(files, max, depth = 3) {
  const groups = /* @__PURE__ */ new Map();
  for (const f of files) {
    const key = f.split("/").slice(0, depth).join("/");
    const list = groups.get(key) ?? [];
    list.push(f);
    groups.set(key, list);
  }
  const bins = [];
  const sorted = [...groups.entries()].sort((x, y) => y[1].length - x[1].length);
  for (const [dir, groupFiles] of sorted) {
    if (groupFiles.length > max) {
      if (depth < 6 && groupFiles.some((f) => f.split("/").length > depth)) {
        bins.push(...packByDirectory(groupFiles, max, depth + 1));
      } else {
        for (let i = 0; i < groupFiles.length; i += max) {
          bins.push({
            label: `${tail(dir)} ${Math.floor(i / max) + 1}`,
            files: groupFiles.slice(i, i + max)
          });
        }
      }
      continue;
    }
    const fit = bins.find((b) => b.files.length + groupFiles.length <= max);
    if (fit) {
      fit.files.push(...groupFiles);
    } else {
      bins.push({ label: tail(dir), files: [...groupFiles] });
    }
  }
  return bins;
}
function tail(dir) {
  const parts = dir.split("/");
  return parts.slice(-2).join("/");
}

// ../../../src/support/result.ts
var ok = (value) => ({ ok: true, value });

// ../../../src/support/hash.ts
function fnv1a(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
function fnv1a64(input) {
  let alt = 2166136261 ^ 1540483477;
  for (let i = 0; i < input.length; i++) {
    alt ^= input.charCodeAt(i);
    alt = Math.imul(alt, 16777619);
  }
  return fnv1a(input) + (alt >>> 0).toString(16).padStart(8, "0");
}

// ../../../src/support/logger.ts
var LEVEL_ORDER = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};
var MIN_LEVEL = process.env.NODE_ENV === "production" ? "info" : "debug";
function emit(level, message, fields) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;
  const entry = { level, message, ...fields };
  if (process.env.NODE_ENV === "production") {
    console[level === "debug" ? "log" : level](JSON.stringify(entry));
    return;
  }
  console[level === "debug" ? "log" : level](
    `[${level}] ${message}`,
    fields ?? ""
  );
}
function make(base = {}) {
  return {
    debug: (m, f) => emit("debug", m, { ...base, ...f }),
    info: (m, f) => emit("info", m, { ...base, ...f }),
    warn: (m, f) => emit("warn", m, { ...base, ...f }),
    error: (m, f) => emit("error", m, { ...base, ...f }),
    child: (extra) => make({ ...base, ...extra })
  };
}
var logger = make();

// ../../../src/usecases/guide-input-hash.ts
var PLUGIN_GUIDE_BUNDLE_VERSION = 2;
function computePluginGuideInputHash(params) {
  const fileLines = params.files.map((f) => `${f.path}:${f.contentHash}`).sort();
  return fnv1a64(
    [
      `plugin-guide-v${PLUGIN_GUIDE_BUNDLE_VERSION}`,
      `plugin:${params.pluginVersion}`,
      `model:${params.writerModelId}`,
      `name:${params.featureName}`,
      `caps:${params.capabilities.join("")}`,
      `files:${fileLines.length}`,
      ...fileLines
    ].join("\n")
  );
}

// node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err2) {
        if (err2?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args2) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args2.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args2.precision}}`;
  } else if (args2.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args2.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args2) {
  return new RegExp(`^${timeRegexSource(args2)}$`);
}
function datetimeRegex(args2) {
  let regex2 = `${dateRegexSource}T${timeRegexSource(args2)}`;
  const opts = [];
  opts.push(args2.local ? `Z?` : `Z`);
  if (args2.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex2 = `${regex2}(${opts.join("|")})`;
  return new RegExp(`^${regex2}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex2 = datetimeRegex(check);
        if (!regex2.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex2 = dateRegex;
        if (!regex2.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex2 = timeRegex(check);
        if (!regex2.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex2, validation, message) {
    return this.refinement((data) => regex2.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex2, message) {
    return this._addCheck({
      kind: "regex",
      regex: regex2,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index2) {
    return new _ZodObject({
      ...this._def,
      catchall: index2
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index2 = 0; index2 < a.length; index2++) {
      const itemA = a[index2];
      const itemB = b[index2];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index2) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index2, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index2, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args2, error) {
      return makeIssue({
        data: args2,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args2) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args2, params).catch((e) => {
          error.addIssue(makeArgsIssue(args2, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args2) {
        const parsedArgs = me._def.args.safeParse(args2, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args2, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args2, returns, params) {
    return new _ZodFunction({
      args: args2 ? args2 : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = /* @__PURE__ */ Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// src/scan/shapes.ts
var kebab = external_exports.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must be kebab-case");
var anchor = external_exports.string().regex(/^.+:\d+$/, 'must be "path:line"');
var requirementLevel = external_exports.enum([
  "MUST",
  "MUST_NOT",
  "SHOULD",
  "SHOULD_NOT",
  "MAY"
]);
var tone = external_exports.enum(["neutral", "success", "warning", "danger"]);
var stateMachine = external_exports.object({
  states: external_exports.array(
    external_exports.object({
      key: external_exports.string().min(1),
      label: external_exports.string().min(1),
      // .optional(), NOT .nullish(): checkFull passes stateMachine through
      // verbatim, so a surviving `"tone": null` would reach the wire and
      // fail `type: "string"`. Null-tolerance is for object-valued fields.
      tone: tone.optional()
    }).strict()
  ),
  transitions: external_exports.array(
    external_exports.object({
      from: external_exports.string().min(1),
      to: external_exports.string().min(1),
      on: external_exports.string().optional()
    }).strict()
  )
}).strict();
var synthLifecycle = external_exports.object({
  states: external_exports.array(
    external_exports.object({
      key: external_exports.string().min(1),
      label: external_exports.string().min(1),
      tone
    }).strict()
  ),
  transitions: external_exports.array(
    external_exports.object({
      from: external_exports.string().min(1),
      to: external_exports.string().min(1),
      on: external_exports.string()
    }).strict()
  )
}).strict();
var RunClaimSchema = external_exports.object({
  statement: external_exports.string().min(1),
  codeAnchor: external_exports.string().min(1),
  // "path::Symbol"
  normalizedRuleKey: external_exports.string().min(1),
  sourcePath: external_exports.string().min(1),
  sourceLine: external_exports.number().int().min(1)
}).strict();
var diveParagraph = external_exports.object({
  text: external_exports.string().min(1),
  ruleRefs: external_exports.array(external_exports.string()).default([]),
  anchors: external_exports.array(anchor).default([])
}).strict();
var diveFlowStep = external_exports.object({
  text: external_exports.string().min(1),
  anchor: anchor.nullish(),
  ruleRefs: external_exports.array(external_exports.string()).default([])
}).strict();
var RunDiveSchema = external_exports.object({
  aspectKey: external_exports.string().min(1),
  sections: external_exports.array(
    external_exports.object({
      heading: external_exports.string().min(1),
      paragraphs: external_exports.array(diveParagraph).min(1)
    }).strict()
  ).min(1),
  flows: external_exports.array(
    external_exports.object({
      name: external_exports.string().min(1),
      steps: external_exports.array(diveFlowStep).min(1)
    }).strict()
  ).default([]),
  edgeCases: external_exports.array(
    external_exports.object({
      description: external_exports.string().min(1),
      sourceRef: external_exports.string().nullish()
    }).strict()
  ).default([]),
  workedExamples: external_exports.array(
    external_exports.object({ title: external_exports.string().min(1), markdown: external_exports.string().min(1) }).strict()
  ).default([]),
  // Wire-optional, so null is accepted as "there isn't one" — the form the
  // reference docs teach.
  stateMachine: stateMachine.nullish(),
  terminologyNotes: external_exports.array(
    external_exports.object({
      codeTerm: external_exports.string().min(1),
      businessTerm: external_exports.string().min(1),
      note: external_exports.string().default("")
    }).strict()
  ).default([])
}).strict();
var SynthesisSchema = external_exports.object({
  name: external_exports.string().min(1),
  domainName: external_exports.string().min(1),
  overview: external_exports.string().min(1),
  rules: external_exports.array(
    external_exports.object({
      statement: external_exports.string().min(1),
      requirementLevel,
      codeAnchor: external_exports.string().min(1),
      normalizedRuleKey: external_exports.string().min(1),
      sourcePath: external_exports.string().min(1),
      sourceLine: external_exports.number().int().min(1)
    }).strict()
  ).default([]),
  // The next three keep .nullable().default(null): the wire requires the key
  // PRESENT and nullable. See rule 2 in the header — do not "simplify" these
  // to .nullish().
  edgeCases: external_exports.array(
    external_exports.object({
      description: external_exports.string().min(1),
      sourceRef: external_exports.string().nullable().default(null)
    }).strict()
  ).default([]),
  lifecycle: synthLifecycle.nullable().default(null),
  entities: external_exports.array(
    external_exports.object({
      table: external_exports.string().min(1),
      columns: external_exports.array(
        external_exports.object({
          name: external_exports.string().min(1),
          type: external_exports.string().default("")
        }).strict()
      )
    }).strict()
  ).default([]),
  integrations: external_exports.array(
    external_exports.object({
      provider: external_exports.string().min(1),
      purpose: external_exports.string().default("")
    }).strict()
  ).default([]),
  routines: external_exports.array(
    external_exports.object({
      name: external_exports.string().min(1),
      schedule: external_exports.string().default(""),
      description: external_exports.string().default("")
    }).strict()
  ).default([]),
  parameters: external_exports.array(
    external_exports.object({ name: external_exports.string().min(1), value: external_exports.string().default("") }).strict()
  ).default([]),
  decisions: external_exports.array(
    external_exports.object({
      ref: external_exports.string().default(""),
      title: external_exports.string().min(1),
      status: external_exports.string().default(""),
      context: external_exports.string().default(""),
      decision: external_exports.string().default(""),
      consequences: external_exports.string().default("")
    }).strict()
  ).default([]),
  openQuestions: external_exports.array(external_exports.string().min(1)).default([]),
  knownIssues: external_exports.array(
    external_exports.object({
      description: external_exports.string().min(1),
      issueRef: external_exports.string().nullable().default(null)
    }).strict()
  ).default([])
}).strict();
var FrontMatterSchema = external_exports.object({
  narrative: external_exports.array(
    external_exports.object({
      text: external_exports.string().min(1),
      ruleRefs: external_exports.array(external_exports.string()).default([]),
      anchors: external_exports.array(anchor).default([])
    }).strict()
  ).min(1),
  principles: external_exports.array(
    external_exports.object({
      title: external_exports.string().min(1),
      statement: external_exports.string().min(1),
      anchors: external_exports.array(anchor).default([]),
      // Deliberately NOT .min(2). The "a principle spans ≥2 aspects" rule
      // is a GATE WITH TELEMETRY — checkFrontMatter reports exactly which
      // principles will drop and why. A parse error here would replace
      // that diagnostic with a shape complaint.
      aspects: external_exports.array(external_exports.string().min(1)).default([])
    }).strict()
  ).default([]),
  lifecycle: stateMachine.nullish(),
  // At-a-glance facts. Session-written, so the row objects are .strict(); the
  // whole array is .nullish() because the wire marks keyFacts optional. unit
  // and meaning are .nullish() (wire-optional) and get STRIPPED before the
  // wire — checkFull spreads them only when present. ruleRefs are
  // normalizedRuleKey STRINGS here, resolved to rule:/cited: indices at
  // assembly exactly like a narrative paragraph.
  keyFacts: external_exports.array(
    external_exports.object({
      label: external_exports.string().min(1),
      value: external_exports.string().min(1),
      unit: external_exports.string().nullish(),
      meaning: external_exports.string().nullish(),
      ruleRefs: external_exports.array(external_exports.string()).default([]),
      anchors: external_exports.array(anchor).default([])
    }).strict()
  ).nullish(),
  // Fee schedule — only for features that charge fees. Same strictness rules
  // as keyFacts: strict rows, nullish array, timing/waiver stripped before the
  // wire, ruleRefs resolved at assembly.
  feeSchedule: external_exports.array(
    external_exports.object({
      fee: external_exports.string().min(1),
      amount: external_exports.string().min(1),
      trigger: external_exports.string().min(1),
      timing: external_exports.string().nullish(),
      waiver: external_exports.string().nullish(),
      ruleRefs: external_exports.array(external_exports.string()).default([]),
      anchors: external_exports.array(anchor).default([])
    }).strict()
  ).nullish(),
  glossary: external_exports.array(
    external_exports.object({ term: external_exports.string().min(1), definition: external_exports.string().min(1) }).strict()
  ).default([])
}).strict();
var AspectsInputSchema = external_exports.array(
  external_exports.object({
    key: kebab,
    name: external_exports.string().min(1),
    description: external_exports.string().default(""),
    order: external_exports.number().int().min(0).nullish(),
    pathPatterns: external_exports.array(external_exports.string().min(1)).min(1)
  }).strict()
).min(1);
var AspectResolvedSchema = external_exports.object({
  key: kebab,
  name: external_exports.string().min(1),
  description: external_exports.string().default(""),
  order: external_exports.number().int().min(0),
  filePaths: external_exports.array(external_exports.string().min(1)).default([]),
  priorityFiles: external_exports.array(external_exports.string().min(1)).default([])
});
var AspectsResolvedSchema = external_exports.array(AspectResolvedSchema).min(1);
var FilesJsonSchema = external_exports.object({
  language: external_exports.enum(["typescript", "unknown"]),
  closureUnavailable: external_exports.boolean(),
  files: external_exports.array(
    external_exports.object({
      path: external_exports.string().min(1),
      contentHash: external_exports.string().min(1),
      seed: external_exports.boolean(),
      entryPoint: external_exports.boolean(),
      pruned: external_exports.boolean(),
      // Import-graph hops from the seed. Optional: run dirs written by older
      // plugin versions lack it; readers fall back to seed?0:1.
      depth: external_exports.number().int().min(0).optional()
    })
  ),
  pruned: external_exports.array(external_exports.string()).default([])
});
var ManifestSchema = external_exports.object({
  kind: external_exports.literal("scan"),
  repoSlug: external_exports.string().min(1),
  domainKey: external_exports.string().min(1),
  featureKey: external_exports.string().min(1),
  featureName: external_exports.string().default(""),
  // The approved feature's capabilities, copied from the taxonomy at §1.5.
  // They feed the server's plugin guide-input hash, so check:"freshness" needs
  // them to compute a hash that can line up with the stored one. Default [] —
  // an empty or wrong list only makes the pre-skip fail toward "changed" (do
  // the research), never toward a false skip.
  capabilities: external_exports.array(external_exports.string()).default([]),
  startedAt: external_exports.string().default(""),
  model: external_exports.string().default(""),
  status: external_exports.enum([
    "selecting",
    "researching",
    "synthesizing",
    "composing",
    "assembled",
    "pushed",
    "failed"
  ]),
  aspects: external_exports.array(
    external_exports.object({
      key: external_exports.string(),
      status: external_exports.enum(["pending", "researched"])
    })
  ).default([]),
  // .nullish(): the docs teach clearing this to null when no aspect is in
  // progress, and rejecting that was a pure round-trip tax.
  currentAspect: external_exports.string().nullish(),
  notes: external_exports.array(external_exports.string()).default([])
});
var ReadlogLineSchema = external_exports.union([
  external_exports.string().min(1),
  external_exports.object({ path: external_exports.string().min(1) })
]);

// src/scan/examples.ts
var MANIFEST_EXAMPLE = {
  kind: "scan",
  repoSlug: "acme/app",
  domainKey: "banking",
  featureKey: "corporate-cards",
  featureName: "Corporate Cards",
  capabilities: ["issue-virtual-card", "freeze-card"],
  startedAt: "2026-07-16T14:05:00Z",
  model: "claude-opus-4-8",
  status: "researching",
  aspects: [
    { key: "card-issuance", status: "researched" },
    { key: "risk-controls", status: "pending" }
  ],
  currentAspect: "risk-controls",
  notes: ["closureUnavailable \u2014 seeded from grep over card/limit/authorization"]
};
var MANIFEST_MINIMAL = {
  kind: "scan",
  repoSlug: "acme/app",
  domainKey: "banking",
  featureKey: "corporate-cards",
  status: "selecting",
  // currentAspect may be null or omitted when no aspect is in progress.
  currentAspect: null
};
var FILES_EXAMPLE = {
  language: "typescript",
  closureUnavailable: false,
  files: [
    {
      path: "src/services/card-service.ts",
      contentHash: "9f2b1c4e7a8d0356",
      seed: true,
      entryPoint: false,
      pruned: false,
      depth: 0
    }
  ],
  pruned: ["src/services/legacy-card-shim.ts"]
};
var FILES_MINIMAL = {
  language: "unknown",
  closureUnavailable: true,
  files: [
    {
      path: "src/services/card-service.ts",
      contentHash: "9f2b1c4e7a8d0356",
      seed: true,
      entryPoint: false,
      pruned: false
    }
  ]
};
var ASPECTS_EXAMPLE = [
  {
    key: "card-issuance",
    name: "Issuing a card",
    description: "How a virtual or physical card is created and activated.",
    order: 0,
    pathPatterns: ["src/services/card-service.ts", "src/issuing/**"]
  },
  {
    key: "risk-controls",
    name: "Risk controls & authorization",
    description: "How spend limits and balance checks gate every transaction.",
    order: 1,
    pathPatterns: ["src/risk/**"]
  },
  {
    key: "settlement",
    name: "Settlement & posting",
    description: "How an authorization becomes a posted transaction.",
    order: 2,
    pathPatterns: ["src/jobs/settlement-runner.ts", "src/ledger/**"]
  }
];
var ASPECTS_MINIMAL = [
  { key: "card-issuance", name: "Issuing a card", pathPatterns: ["src/issuing/**"] },
  { key: "risk-controls", name: "Risk controls", pathPatterns: ["src/risk/**"] },
  { key: "settlement", name: "Settlement", pathPatterns: ["src/ledger/**"] }
];
var CLAIM_EXAMPLE = {
  statement: "A card authorization above the account's available balance is declined",
  codeAnchor: "src/services/card-service.ts::authorize",
  normalizedRuleKey: "card-declined-insufficient-balance",
  sourcePath: "src/services/card-service.ts",
  sourceLine: 142
};
var DIVE_EXAMPLE = {
  aspectKey: "risk-controls",
  sections: [
    {
      heading: "Authorization checks",
      paragraphs: [
        {
          text: "Every card authorization is checked against the account's available balance before approval; an authorization for more than the available balance is declined at the gateway.",
          ruleRefs: ["card-declined-insufficient-balance"],
          anchors: ["src/services/card-service.ts:142"]
        }
      ]
    }
  ],
  flows: [
    {
      name: "Authorize a card transaction",
      steps: [
        {
          text: "The gateway posts the pending amount to authorize().",
          anchor: "src/services/card-service.ts:120",
          ruleRefs: ["card-declined-insufficient-balance"]
        }
      ]
    }
  ],
  edgeCases: [
    {
      description: "A frozen card is declined before the balance check runs.",
      sourceRef: "src/services/card-service.ts:118"
    }
  ],
  workedExamples: [
    {
      title: "Declined for insufficient funds",
      markdown: "Available balance **$40.00**, authorization **$52.30** \u2192 declined. The gateway sees code `51`."
    }
  ],
  stateMachine: {
    states: [
      { key: "pending", label: "Pending", tone: "neutral" },
      { key: "declined", label: "Declined", tone: "danger" }
    ],
    transitions: [{ from: "pending", to: "declined", on: "balance check fails" }]
  },
  terminologyNotes: [
    {
      codeTerm: "authHold",
      businessTerm: "pending authorization",
      note: "The reserved-but-not-settled amount."
    }
  ]
};
var DIVE_MINIMAL = {
  aspectKey: "risk-controls",
  sections: [
    {
      heading: "Authorization checks",
      paragraphs: [
        {
          text: "An authorization above the available balance is declined.",
          ruleRefs: ["card-declined-insufficient-balance"]
        }
      ]
    }
  ],
  // null is accepted for "there isn't one" — as is omitting the key.
  stateMachine: null
};
var SYNTHESIS_EXAMPLE = {
  name: "Corporate Cards",
  domainName: "Banking & Cash Management",
  overview: "Corporate Cards issues virtual and physical cards against the business checking balance, authorizing each transaction in real time.",
  rules: [
    {
      statement: "A card authorization above the account's available balance is declined",
      requirementLevel: "MUST",
      codeAnchor: "src/services/card-service.ts::authorize",
      normalizedRuleKey: "card-declined-insufficient-balance",
      sourcePath: "src/services/card-service.ts",
      sourceLine: 142
    }
  ],
  edgeCases: [
    {
      description: "A frozen card is declined before the balance check runs.",
      sourceRef: "src/services/card-service.ts:118"
    }
  ],
  // NOTE: unlike a dive's stateMachine, synthesis lifecycle states REQUIRE
  // `tone` and transitions REQUIRE `on` — the wire's SynthesizedFeature does.
  lifecycle: {
    states: [
      { key: "requested", label: "Requested", tone: "neutral" },
      { key: "active", label: "Active", tone: "success" },
      { key: "frozen", label: "Frozen", tone: "warning" }
    ],
    transitions: [
      { from: "requested", to: "active", on: "issuer approves the card" },
      { from: "active", to: "frozen", on: "admin freezes the card" }
    ]
  },
  // Entities are the TABLE and its columns. There is no display `name` and no
  // `description` here — put the prose in a dive.
  entities: [
    {
      table: "cards",
      columns: [
        { name: "id", type: "uuid" },
        { name: "status", type: "text" }
      ]
    }
  ],
  integrations: [{ provider: "Unit", purpose: "Card issuing and authorization" }],
  routines: [
    {
      name: "settlement-runner",
      schedule: "0 4 * * *",
      description: "Posts settled authorizations to the ledger."
    }
  ],
  parameters: [{ name: "THREAD_LIMIT_RATIO", value: "0.8" }],
  decisions: [
    {
      ref: "ADR-014",
      title: "Authorize against available, not posted, balance",
      status: "accepted",
      context: "Posted balance lags settlement by up to a day.",
      decision: "Authorization reads the available balance including holds.",
      consequences: "A pending authorization reduces spending power immediately."
    }
  ],
  openQuestions: ["Whether physical card replacement re-runs the risk check."],
  knownIssues: [
    {
      description: "The decline reason is not surfaced to the cardholder UI.",
      issueRef: "CARD-812"
    }
  ]
};
var SYNTHESIS_MINIMAL = {
  name: "Corporate Cards",
  domainName: "Banking & Cash Management",
  overview: "Corporate Cards issues cards against the business checking balance.",
  // Every other key defaults. `lifecycle: null` is legal; so is omitting it.
  lifecycle: null
};
var FRONT_MATTER_EXAMPLE = {
  narrative: [
    {
      text: "Corporate Cards issues virtual and physical cards against the business checking balance.",
      ruleRefs: ["card-declined-insufficient-balance"],
      anchors: ["src/services/card-service.ts:40"]
    }
  ],
  principles: [
    {
      title: "Every authorization is balance-checked",
      statement: "No card transaction settles above available balance.",
      anchors: ["src/services/card-service.ts:142"],
      // A principle must span ≥2 aspect keys or assembly drops it (with a note
      // naming it — that drop is a diagnostic, not a shape error).
      aspects: ["risk-controls", "settlement"]
    }
  ],
  lifecycle: {
    states: [
      { key: "active", label: "Active", tone: "success" },
      { key: "frozen", label: "Frozen", tone: "warning" }
    ],
    transitions: [{ from: "active", to: "frozen", on: "admin freezes the card" }]
  },
  // At-a-glance facts. Every value is a REAL constant from facts.json or a claim
  // (the worked-example rule) — assembly drops any row grounded by neither a
  // ruleRef nor an anchor. unit/meaning are optional and stripped before the
  // wire; ruleRefs are normalizedRuleKey strings resolved at assembly.
  keyFacts: [
    {
      label: "Spending cap",
      value: "$50,000",
      unit: "cents",
      meaning: "hard ceiling across all funding sources",
      ruleRefs: ["card-declined-insufficient-balance"],
      anchors: ["src/services/card-service.ts:51"]
    }
  ],
  // Only for features that charge fees. Each row is grounded like a key fact.
  feeSchedule: [
    {
      fee: "Late payment fee",
      amount: "$25",
      trigger: "balance unpaid after the grace period",
      timing: "posted the day after the grace period ends",
      waiver: "first occurrence per calendar year",
      ruleRefs: ["card-declined-insufficient-balance"],
      anchors: ["src/services/card-service.ts:142"]
    }
  ],
  glossary: [
    {
      term: "authHold",
      definition: "The reserved-but-not-settled amount on a pending authorization."
    }
  ]
};
var FRONT_MATTER_MINIMAL = {
  narrative: [
    {
      text: "Corporate Cards issues cards against the business checking balance.",
      anchors: ["src/services/card-service.ts:40"]
    }
  ],
  // null is accepted for "no lifecycle" — as is omitting the key.
  lifecycle: null
};
var ARTIFACT_CONTRACTS = {
  manifest: {
    file: "manifest.json",
    writer: "session",
    requiredKeys: ["kind", "repoSlug", "domainKey", "featureKey", "status"],
    example: MANIFEST_EXAMPLE,
    minimal: MANIFEST_MINIMAL
  },
  files: {
    file: "files.json",
    writer: "tool",
    requiredKeys: ["language", "closureUnavailable", "files"],
    example: FILES_EXAMPLE,
    minimal: FILES_MINIMAL
  },
  aspects: {
    file: "aspects.json",
    writer: "session",
    requiredKeys: ["key", "name", "pathPatterns"],
    example: ASPECTS_EXAMPLE,
    minimal: ASPECTS_MINIMAL
  },
  claim: {
    file: "claims.jsonl",
    writer: "session",
    requiredKeys: [
      "statement",
      "codeAnchor",
      "normalizedRuleKey",
      "sourcePath",
      "sourceLine"
    ],
    example: CLAIM_EXAMPLE,
    minimal: CLAIM_EXAMPLE
  },
  dive: {
    file: "dives/<aspectKey>.json",
    writer: "session",
    requiredKeys: ["aspectKey", "sections"],
    example: DIVE_EXAMPLE,
    minimal: DIVE_MINIMAL
  },
  synthesis: {
    file: "synthesis.json",
    writer: "session",
    requiredKeys: ["name", "domainName", "overview"],
    example: SYNTHESIS_EXAMPLE,
    minimal: SYNTHESIS_MINIMAL
  },
  "front-matter": {
    file: "front-matter.json",
    writer: "session",
    requiredKeys: ["narrative"],
    example: FRONT_MATTER_EXAMPLE,
    minimal: FRONT_MATTER_MINIMAL
  }
};

// src/scan/assemble-guide.ts
var MIN_GROUNDED_SHARE = 0.8;
var MAX_ASPECTS = 12;
var GLOSSARY_MIN = 6;
var GLOSSARY_MAX = 15;
var GateError = class extends Error {
};
var ShapeError = class extends Error {
  constructor(artifact, zerr) {
    super(`${artifact} does not match its shape`);
    this.artifact = artifact;
    this.zerr = zerr;
  }
};
function parseArtifact(schema, artifact, raw) {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ShapeError(artifact, parsed.error);
  return parsed.data;
}
function readJson2(runDir, name) {
  const path = join6(runDir, name);
  if (!existsSync4(path)) throw new GateError(`missing ${name} in the run dir`);
  try {
    return JSON.parse(readFileSync6(path, "utf8"));
  } catch (e) {
    throw new GateError(
      `${name} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}
function readJsonlLines(runDir, name) {
  const path = join6(runDir, name);
  if (!existsSync4(path)) return [];
  return readFileSync6(path, "utf8").split("\n").map((l) => l.trim()).filter((l) => l.length > 0).map((l, i) => {
    try {
      return JSON.parse(l);
    } catch {
      throw new GateError(`${name} line ${i + 1} is not valid JSON`);
    }
  });
}
function readReadPaths(runDir, aspectKey) {
  const out = /* @__PURE__ */ new Set();
  const sources = ["readlog.jsonl"];
  if (aspectKey) sources.push(join6("readlog", `${aspectKey}.jsonl`));
  for (const source of sources) {
    for (const line of readJsonlLines(runDir, source)) {
      const parsed = ReadlogLineSchema.safeParse(line);
      if (!parsed.success) continue;
      out.add(typeof parsed.data === "string" ? parsed.data : parsed.data.path);
    }
  }
  return out;
}
function readClaims(runDir, aspectKey) {
  const list = [];
  const byKey = /* @__PURE__ */ new Map();
  const duplicateKeys = [];
  const invalidLines = [];
  const sources = [
    { name: "claims.jsonl", label: "" }
  ];
  if (aspectKey) {
    const rel = join6("claims", `${aspectKey}.jsonl`);
    sources.push({ name: rel, label: `${rel} ` });
  }
  for (const { name, label } of sources) {
    readJsonlLines(runDir, name).forEach((line, i) => {
      const parsed = RunClaimSchema.safeParse(line);
      if (!parsed.success) {
        invalidLines.push(
          `${label}line ${i + 1}: ${parsed.error.errors.slice(0, 2).map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`).join("; ")}`
        );
        return;
      }
      const claim = parsed.data;
      list.push(claim);
      if (byKey.has(claim.normalizedRuleKey)) duplicateKeys.push(claim.normalizedRuleKey);
      else byKey.set(claim.normalizedRuleKey, claim);
    });
  }
  return { list, byKey, duplicateKeys, invalidLines };
}
function claimErrors(claims) {
  if (claims.invalidLines.length === 0) return [];
  return [
    `${claims.invalidLines.length} claims.jsonl line(s) do not match the claim shape and were NOT loaded \u2014 their rule keys will read as unknown: ${claims.invalidLines.slice(0, 5).join(" | ")}`
  ];
}
function zodIssues(e) {
  const issues = e.errors;
  if (!issues) return [String(e)];
  return issues.slice(0, 8).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}
function resolveAspects(runDir) {
  const aspectsInput = parseArtifact(
    AspectsInputSchema,
    "aspects",
    readJson2(runDir, "aspects.json")
  );
  const filesJson = parseArtifact(
    FilesJsonSchema,
    "files",
    readJson2(runDir, "files.json")
  );
  const claims = readClaims(runDir);
  const keys = aspectsInput.map((a) => a.key);
  const dupKey = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dupKey) throw new GateError(`duplicate aspect key "${dupKey}"`);
  if (aspectsInput.length < 3 || aspectsInput.length > 8) {
    throw new GateError(
      `aspects.json must have 3-8 aspects (found ${aspectsInput.length})`
    );
  }
  const selected = filesJson.files.map((f) => f.path);
  const assigned = new Map(aspectsInput.map((a) => [a.key, []]));
  const unassigned = [];
  for (const path of selected) {
    const owner = aspectsInput.find(
      (a) => a.pathPatterns.some((g) => matchesGlob(path, g))
    );
    if (owner) assigned.get(owner.key).push(path);
    else unassigned.push(path);
  }
  const materialized = aspectsInput.map((a, i) => ({
    key: a.key,
    name: a.name,
    description: a.description,
    order: a.order ?? i,
    filePaths: assigned.get(a.key) ?? []
  }));
  const beforeCount = materialized.length;
  const split = splitOversizedAspects(materialized, 40);
  const splits = split.length > beforeCount ? [`split oversized aspects: ${beforeCount} \u2192 ${split.length}`] : [];
  const seedSet = new Set(filesJson.files.filter((f) => f.seed).map((f) => f.path));
  const entrySet = new Set(
    filesJson.files.filter((f) => f.entryPoint).map((f) => f.path)
  );
  const claimCount = (p) => claims.list.filter((c) => c.sourcePath === p).length;
  const resolved = split.map((a, i) => {
    const priorityFiles = [...a.filePaths].map((p) => ({
      p,
      score: claimCount(p) * 2 + (entrySet.has(p) ? 3 : 0) + (seedSet.has(p) ? 2 : 0)
    })).filter((x) => x.score > 0).sort((x, y) => y.score - x.score).slice(0, 10).map((x) => x.p);
    return AspectResolvedSchema.parse({
      key: kebab2(a.key),
      name: a.name,
      description: a.description,
      order: i,
      filePaths: [...a.filePaths],
      priorityFiles
    });
  });
  const seen = /* @__PURE__ */ new Set();
  for (const a of resolved) {
    let k = a.key;
    let n = 2;
    while (seen.has(k)) k = `${a.key}-${n++}`;
    seen.add(k);
    a.key = k;
  }
  const unassignedEntryPoints = unassigned.filter((p) => entrySet.has(p));
  return { resolved, unassigned, unassignedEntryPoints, splits };
}
function kebab2(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function anchorPath(anchor2) {
  const m = /^(.+):(\d+)$/.exec(anchor2);
  return m ? m[1] : null;
}
function preview(text) {
  return text.length > 90 ? `${text.slice(0, 90)}\u2026` : text;
}
function groundDive(dive, validRuleKeys, anchorUniverse) {
  let total = 0;
  let grounded = 0;
  const ungrounded = [];
  const badAnchors = [];
  const check = (text, ruleRefs, anchors) => {
    total += 1;
    const okRule = ruleRefs.some((k) => validRuleKeys.has(k));
    const validAnchors = anchors.filter((a) => {
      const p = anchorPath(a);
      if (p && anchorUniverse.has(p)) return true;
      badAnchors.push(a);
      return false;
    });
    if (okRule || validAnchors.length > 0) grounded += 1;
    else if (ungrounded.length < 8) ungrounded.push(preview(text));
  };
  for (const section of dive.sections) {
    for (const p of section.paragraphs) check(p.text, p.ruleRefs, p.anchors);
  }
  for (const flow of dive.flows) {
    for (const s of flow.steps) {
      check(s.text, s.ruleRefs, s.anchor ? [s.anchor] : []);
    }
  }
  return { total, grounded, ungrounded, badAnchors: [...new Set(badAnchors)] };
}
function checkAspects(runDir) {
  const { resolved, unassigned, unassignedEntryPoints, splits } = resolveAspects(runDir);
  writeFileSync3(
    join6(runDir, "aspects.resolved.json"),
    JSON.stringify(resolved, null, 2)
  );
  const overCap = resolved.length > MAX_ASPECTS;
  const warnings = [];
  if (unassignedEntryPoints.length > 0) {
    warnings.push(
      `${unassignedEntryPoints.length} ENTRY POINT(S) matched no aspect and will go undocumented \u2014 route tables, controllers, webhook and cron handlers are usually the most load-bearing files in a feature: ${unassignedEntryPoints.slice(0, 12).join(", ")}`
    );
  }
  const emptyAspects = resolved.filter((a) => a.filePaths.length === 0);
  if (emptyAspects.length > 0) {
    warnings.push(
      `${emptyAspects.length} aspect(s) matched zero files: ${emptyAspects.map((a) => a.key).join(", ")} \u2014 pathPatterns support "dir/**", "dir" and "dir/*.ext" only; a mid-directory wildcard like "src/*/handlers/**" matches nothing`
    );
  }
  return {
    check: "aspects",
    ok: !overCap,
    fatal: overCap,
    aspects: resolved.map((a) => ({
      key: a.key,
      name: a.name,
      files: a.filePaths.length,
      priorityFiles: a.priorityFiles
    })),
    unassignedCount: unassigned.length,
    unassignedEntryPoints,
    unassignedSample: unassigned.slice(0, 10),
    warnings,
    notes: [
      ...splits,
      ...overCap ? [`${resolved.length} aspects exceeds the ${MAX_ASPECTS}-aspect wire cap \u2014 merge or narrow the boundary`] : []
    ],
    guidance: unassignedEntryPoints.length > 0 ? "adopt aspects.resolved.json (its keys + priorityFiles), but FIRST widen pathPatterns to cover the unassigned entry points above \u2014 an undocumented route table or cron handler is a hole in the guide, not a detail." : "adopt aspects.resolved.json (its keys + priorityFiles) as the chapters to research; read every priority file fully."
  };
}
function loadResolvedAspects(runDir) {
  if (existsSync4(join6(runDir, "aspects.resolved.json"))) {
    return z_parseResolved(readJson2(runDir, "aspects.resolved.json"));
  }
  return resolveAspects(runDir).resolved;
}
function z_parseResolved(raw) {
  if (!Array.isArray(raw)) throw new GateError("aspects.resolved.json is not an array");
  return raw.map((a) => AspectResolvedSchema.parse(a));
}
function closureAndReadUniverse(runDir, aspectKey) {
  const filesJson = parseArtifact(
    FilesJsonSchema,
    "files",
    readJson2(runDir, "files.json")
  );
  return {
    closure: new Set(filesJson.files.map((f) => f.path)),
    read: readReadPaths(runDir, aspectKey)
  };
}
function checkDive(runDir, aspectKey) {
  if (!aspectKey) throw new GateError("check:dive needs an aspectKey");
  const dive = parseArtifact(
    RunDiveSchema,
    "dive",
    readJson2(runDir, join6("dives", `${aspectKey}.json`))
  );
  if (dive.aspectKey !== aspectKey) {
    throw new GateError(
      `dive aspectKey "${dive.aspectKey}" does not match "${aspectKey}"`
    );
  }
  const resolved = loadResolvedAspects(runDir);
  const aspect = resolved.find((a) => a.key === aspectKey);
  if (!aspect) throw new GateError(`no resolved aspect "${aspectKey}"`);
  const { closure, read } = closureAndReadUniverse(runDir, aspectKey);
  const claims = readClaims(runDir, aspectKey);
  const validRuleKeys = new Set(claims.byKey.keys());
  const anchorUniverse = /* @__PURE__ */ new Set([...read, ...closure]);
  const badClaims = claimErrors(claims);
  if (badClaims.length > 0) {
    return {
      check: "dive",
      ok: false,
      aspectKey,
      reason: "invalid-claims",
      errors: badClaims,
      example: ARTIFACT_CONTRACTS.claim.example,
      guidance: "Fix the listed claims.jsonl lines first \u2014 until they parse, any ruleRef pointing at them will be reported as unknown and the dive will look ungrounded for the wrong reason."
    };
  }
  const unread = aspect.priorityFiles.filter((p) => !read.has(p));
  if (unread.length > 0) {
    return {
      check: "dive",
      ok: false,
      aspectKey,
      reason: "unread-priority-files",
      unread,
      guidance: "Not accepted yet \u2014 you never read these PRIORITY files. Read each with the Read tool, append them to readlog.jsonl, fold what they add (values, fees, thresholds, failure behavior) into the dive, then re-run check:dive."
    };
  }
  const g = groundDive(dive, validRuleKeys, anchorUniverse);
  const share = g.total === 0 ? 0 : g.grounded / g.total;
  if (share < MIN_GROUNDED_SHARE) {
    return {
      check: "dive",
      ok: false,
      aspectKey,
      reason: "ungrounded",
      grounded: g.grounded,
      total: g.total,
      needShare: MIN_GROUNDED_SHARE,
      ungrounded: g.ungrounded,
      badAnchors: g.badAnchors,
      guidance: `Not accepted yet \u2014 only ${g.grounded}/${g.total} paragraphs are grounded (need \u2265${Math.round(MIN_GROUNDED_SHARE * 100)}%). Add a ruleRef (a normalizedRuleKey from claims.jsonl) or an anchor "path:line" onto a file you actually read \u2014 or drop sentences you cannot support \u2014 then re-run check:dive. Anchors onto files you have not read are rejected.`
    };
  }
  return {
    check: "dive",
    ok: true,
    aspectKey,
    grounded: g.grounded,
    total: g.total,
    badAnchors: g.badAnchors,
    notes: g.badAnchors.length > 0 ? [`${g.badAnchors.length} anchor(s) point at unread files and were not counted as grounding`] : []
  };
}
function listAspectJsonl(runDir, subdir) {
  const dir = join6(runDir, subdir);
  if (!existsSync4(dir)) return [];
  return readdirSync3(dir).filter((f) => f.endsWith(".jsonl")).sort().map((f) => join6(subdir, f));
}
function checkMerge(runDir) {
  const claimFiles = listAspectJsonl(runDir, "claims");
  const readlogFiles = listAspectJsonl(runDir, "readlog");
  if (claimFiles.length === 0 && readlogFiles.length === 0) {
    return {
      check: "merge",
      ok: true,
      merged: false,
      guidance: "no per-aspect claims/ or readlog/ files \u2014 nothing to merge (a serial run already writes the flat claims.jsonl and readlog.jsonl directly)."
    };
  }
  const byKey = /* @__PURE__ */ new Map();
  const keySource = /* @__PURE__ */ new Map();
  const conflicts = [];
  const invalidLines = [];
  let claimLinesRead = 0;
  for (const source of ["claims.jsonl", ...claimFiles]) {
    readJsonlLines(runDir, source).forEach((line, i) => {
      claimLinesRead += 1;
      const parsed = RunClaimSchema.safeParse(line);
      if (!parsed.success) {
        invalidLines.push(
          `${source} line ${i + 1}: ${parsed.error.errors.slice(0, 2).map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`).join("; ")}`
        );
        return;
      }
      const claim = parsed.data;
      const kept = byKey.get(claim.normalizedRuleKey);
      if (kept) {
        if (kept.statement !== claim.statement) {
          conflicts.push(
            `${claim.normalizedRuleKey}: kept "${preview(kept.statement)}" (${keySource.get(claim.normalizedRuleKey)}), dropped "${preview(claim.statement)}" (${source})`
          );
        }
        return;
      }
      byKey.set(claim.normalizedRuleKey, claim);
      keySource.set(claim.normalizedRuleKey, source);
    });
  }
  const mergedClaims = [...byKey.values()];
  writeFileSync3(
    join6(runDir, "claims.jsonl"),
    mergedClaims.map((c) => JSON.stringify(c)).join("\n")
  );
  const readPaths = /* @__PURE__ */ new Set();
  for (const source of ["readlog.jsonl", ...readlogFiles]) {
    for (const line of readJsonlLines(runDir, source)) {
      const parsed = ReadlogLineSchema.safeParse(line);
      if (!parsed.success) continue;
      readPaths.add(typeof parsed.data === "string" ? parsed.data : parsed.data.path);
    }
  }
  const mergedReadlog = [...readPaths];
  writeFileSync3(
    join6(runDir, "readlog.jsonl"),
    mergedReadlog.map((p) => JSON.stringify(p)).join("\n")
  );
  return {
    check: "merge",
    ok: invalidLines.length === 0,
    merged: true,
    claimFiles: claimFiles.length,
    readlogFiles: readlogFiles.length,
    claims: mergedClaims.length,
    claimLinesRead,
    readPaths: mergedReadlog.length,
    conflicts,
    errors: invalidLines,
    guidance: invalidLines.length > 0 ? "some per-aspect claims lines did not parse and were dropped \u2014 fix them in the listed claims/<aspect>.jsonl and re-run check:merge, or their rule keys will read as unknown downstream." : conflicts.length > 0 ? "flat claims.jsonl + readlog.jsonl written. WARNING: the conflicts below are one rule key claimed by two different statements \u2014 first-wins kept one; rename a key if both rules are real, then re-run check:merge. Otherwise proceed to \xA76 synthesis." : "flat claims.jsonl + readlog.jsonl written from the per-aspect files. Proceed to \xA76 synthesis."
  };
}
var STATE_WORDS = /* @__PURE__ */ new Set([
  "active",
  "inactive",
  "pending",
  "frozen",
  "suspended",
  "closed",
  "canceled",
  "cancelled",
  "approved",
  "rejected",
  "expired",
  "completed",
  "failed",
  "paused",
  "archived",
  "draft",
  "open",
  "settled",
  "disputed",
  "locked",
  "enabled",
  "disabled",
  "terminated",
  "revoked",
  "void",
  "overdue",
  "delinquent"
]);
var STATUS_ENUM_RE = /(status|state)e?s?$/i;
var STATE_CLAIM_RE = /\b(freez\w*|unfreez\w*|suspend\w*|reactivat\w*|transitions?\s+(to|from)|status\s+(changes?|becomes|moves))\b/i;
function detectStatusSignals(runDir) {
  const signals = [];
  try {
    const facts = readJson2(runDir, "facts.json");
    if (Array.isArray(facts)) {
      for (const f of facts) {
        if (!f || f.kind !== "enum_values") continue;
        const payload = f.payload ?? {};
        const key = typeof f.key === "string" ? f.key : "";
        const table = typeof payload.table === "string" ? payload.table : "";
        const values = Array.isArray(payload.values) ? payload.values.map((v) => typeof v?.value === "string" ? v.value.toLowerCase() : "").filter((v) => v.length > 0) : [];
        const nameHit = STATUS_ENUM_RE.test(key) || STATUS_ENUM_RE.test(table);
        const stateHits = values.filter((v) => STATE_WORDS.has(v));
        if (nameHit || stateHits.length >= 2) {
          const label = key || table || "enum";
          const sample = (stateHits.length ? stateHits : values).slice(0, 4);
          signals.push(
            `the enum_values fact "${label}" looks like a status enum${sample.length ? ` (${sample.join(", ")})` : ""}`
          );
        }
      }
    }
  } catch {
  }
  try {
    const dir = join6(runDir, "dives");
    if (existsSync4(dir)) {
      for (const name of readdirSync3(dir).filter((n) => n.endsWith(".json")).sort()) {
        try {
          const parsed = RunDiveSchema.safeParse(
            readJson2(runDir, join6("dives", name))
          );
          if (parsed.success && parsed.data.stateMachine) {
            signals.push(
              `the dive "${parsed.data.aspectKey}" already declares a stateMachine`
            );
          }
        } catch {
        }
      }
    }
  } catch {
  }
  try {
    const claims = readClaims(runDir);
    const hit = claims.list.find((c) => STATE_CLAIM_RE.test(c.statement));
    if (hit) {
      signals.push(`a claim describes a state transition: "${preview(hit.statement)}"`);
    }
  } catch {
  }
  return signals;
}
function checkSynthesis(runDir) {
  const synthesis = parseArtifact(
    SynthesisSchema,
    "synthesis",
    readJson2(runDir, "synthesis.json")
  );
  const claims = readClaims(runDir);
  const keys = synthesis.rules.map((r) => r.normalizedRuleKey);
  const dupKey = keys.find((k, i) => keys.indexOf(k) !== i);
  const badClaims = claimErrors(claims);
  const fatal = Boolean(dupKey) || badClaims.length > 0;
  const warnings = [];
  if (!synthesis.lifecycle) {
    const signals = detectStatusSignals(runDir);
    if (signals.length > 0) {
      warnings.push(
        `synthesis.lifecycle is null but this feature looks status-bearing \u2014 ${signals.join("; ")}. If the feature HAS states, write synthesis.lifecycle (every state needs a tone, every transition an on) AND frontMatter.lifecycle so the guide renders the state diagram. If it is genuinely stateless, note why in manifest.notes.`
      );
    }
  }
  return {
    check: "synthesis",
    ok: !fatal,
    fatal,
    rules: synthesis.rules.length,
    edgeCases: synthesis.edgeCases.length,
    entities: synthesis.entities.length,
    duplicateRuleKey: dupKey ?? null,
    errors: badClaims,
    warnings,
    claimCoverage: `${synthesis.rules.length} rules / ${claims.list.length} claims`,
    guidance: dupKey ? `duplicate normalizedRuleKey "${dupKey}" in synthesis.rules \u2014 each rule key must be unique` : badClaims.length > 0 ? "fix the listed claims.jsonl lines \u2014 they did not load, so their rule keys do not exist" : warnings.length > 0 ? "synthesis shape OK, but treat the lifecycle warning as a bounce unless the feature is genuinely stateless \u2014 a status-bearing feature needs a lifecycle." : "synthesis shape OK; rules reuse their claim anchors verbatim."
  };
}
function checkFrontMatter(runDir) {
  const fm = parseArtifact(
    FrontMatterSchema,
    "front-matter",
    readJson2(runDir, "front-matter.json")
  );
  const resolved = loadResolvedAspects(runDir);
  const aspectKeys = new Set(resolved.map((a) => a.key));
  const { closure, read } = closureAndReadUniverse(runDir);
  const anchorUniverse = /* @__PURE__ */ new Set([...read, ...closure]);
  const dropped = [];
  const kept = fm.principles.filter((p) => {
    const real = [...new Set(p.aspects.filter((k) => aspectKeys.has(k)))];
    if (real.length < 2) {
      dropped.push(`${p.title} (spans ${real.length} known aspect(s))`);
      return false;
    }
    return true;
  });
  const badAnchors = fm.narrative.flatMap((n) => n.anchors).filter((a) => {
    const p = anchorPath(a);
    return !(p && anchorUniverse.has(p));
  });
  const keyFacts = fm.keyFacts ?? [];
  const feeSchedule = fm.feeSchedule ?? [];
  const rowBadAnchors = [
    ...new Set(
      [...keyFacts, ...feeSchedule].flatMap((row) => row.anchors).filter((a) => {
        const p = anchorPath(a);
        return !(p && anchorUniverse.has(p));
      })
    )
  ];
  let lifecycleCarryNote = null;
  try {
    const synthesis = SynthesisSchema.safeParse(readJson2(runDir, "synthesis.json"));
    if (synthesis.success && synthesis.data.lifecycle && !fm.lifecycle) {
      lifecycleCarryNote = "synthesis.lifecycle exists but frontMatter.lifecycle is absent \u2014 carry the end-to-end lifecycle into front matter so the guide renders the state diagram.";
    }
  } catch {
  }
  const glossaryWarn = fm.glossary.length < GLOSSARY_MIN || fm.glossary.length > GLOSSARY_MAX;
  return {
    check: "front-matter",
    ok: true,
    principlesKept: kept.length,
    principlesDropped: dropped,
    narrativeBadAnchors: [...new Set(badAnchors)],
    keyFacts: keyFacts.length,
    feeSchedule: feeSchedule.length,
    keyFactBadAnchors: rowBadAnchors,
    glossaryTerms: fm.glossary.length,
    notes: [
      ...glossaryWarn ? [`glossary has ${fm.glossary.length} terms (recommended ${GLOSSARY_MIN}-${GLOSSARY_MAX})`] : [],
      ...dropped.length > 0 ? [`${dropped.length} principle(s) drop at assembly (fewer than 2 known aspects)`] : [],
      ...rowBadAnchors.length > 0 ? [`${rowBadAnchors.length} keyFacts/feeSchedule anchor(s) point at unread files and will not count as grounding: ${rowBadAnchors.slice(0, 5).join(", ")}`] : [],
      ...lifecycleCarryNote ? [lifecycleCarryNote] : []
    ]
  };
}
function checkFreshness(runDir, pluginVersion2, model, storedInputHash) {
  const filesJson = parseArtifact(
    FilesJsonSchema,
    "files",
    readJson2(runDir, "files.json")
  );
  const manifest = parseArtifact(
    ManifestSchema,
    "manifest",
    readJson2(runDir, "manifest.json")
  );
  const writerModelId = model ?? (manifest.model || "unknown");
  const capabilities = manifest.capabilities ?? [];
  const localInputHash = computePluginGuideInputHash({
    files: filesJson.files.map((f) => ({
      path: f.path,
      contentHash: f.contentHash
    })),
    writerModelId,
    featureName: manifest.featureName,
    capabilities,
    pluginVersion: pluginVersion2
  });
  const unchanged = storedInputHash === void 0 ? null : storedInputHash === localInputHash;
  return {
    check: "freshness",
    ok: true,
    unchanged,
    localInputHash,
    storedInputHash: storedInputHash ?? null,
    fileCount: filesJson.files.length,
    writerModelId,
    featureName: manifest.featureName,
    capabilitiesCount: capabilities.length,
    guidance: unchanged === true ? "UNCHANGED \u2014 the stored guide already covers this exact closure/model/name/capabilities. Skip research (\xA73\u2013\xA79) for this feature; a push would only return skipped:true." : unchanged === false ? "CHANGED (or first scan / plugin upgrade) \u2014 the stored hash differs, so research is warranted. Proceed to \xA73." : "no storedInputHash passed \u2014 this is only the locally-computed hash. Pass the inputHash from kanon_get_guide_status to get a definitive unchanged:true/false. Note: manifest.featureName + manifest.capabilities must match the approved feature for the hash to line up (a mismatch fails toward 'changed', never a false skip)."
  };
}
var NUMERIC = /\d[\d,_.]*/g;
function digitsOf(s) {
  return s.replace(/[^\d]/g, "");
}
function numericForms(token) {
  const forms = [];
  const n = Number(token.replace(/[,_]/g, ""));
  if (Number.isFinite(n)) forms.push(String(n));
  const digits = digitsOf(token);
  if (digits.length > 0) forms.push(`d:${digits}`);
  return forms;
}
function unknownConstants(dives, corpus, extraTexts = []) {
  const known = /* @__PURE__ */ new Set();
  for (const tok of corpus.match(NUMERIC) ?? []) {
    for (const form of numericForms(tok)) known.add(form);
  }
  const flagged = /* @__PURE__ */ new Set();
  const consider = (text) => {
    for (const tok of text.match(NUMERIC) ?? []) {
      if (digitsOf(tok).length < 2) continue;
      if (numericForms(tok).some((form) => known.has(form))) continue;
      flagged.add(tok);
    }
  };
  for (const dive of dives) {
    for (const ex of dive.workedExamples) consider(ex.markdown);
  }
  for (const text of extraTexts) consider(text);
  return [...flagged].slice(0, 20);
}
function checkFull(params) {
  const { runDir, pluginRoot, pluginVersion: pluginVersion2, model } = params;
  const errors = [];
  const warnings = [];
  const manifest = parseArtifact(
    ManifestSchema,
    "manifest",
    readJson2(runDir, "manifest.json")
  );
  const filesJson = parseArtifact(
    FilesJsonSchema,
    "files",
    readJson2(runDir, "files.json")
  );
  const synthesis = parseArtifact(
    SynthesisSchema,
    "synthesis",
    readJson2(runDir, "synthesis.json")
  );
  const frontMatter = parseArtifact(
    FrontMatterSchema,
    "front-matter",
    readJson2(runDir, "front-matter.json")
  );
  const claims = readClaims(runDir);
  errors.push(...claimErrors(claims));
  const facts = readJson2(runDir, "facts.json");
  if (!Array.isArray(facts)) throw new GateError("facts.json is not an array");
  const readPaths = [...readReadPaths(runDir)];
  const commitSha = params.commitSha;
  if (!commitSha || !/^[0-9a-f]{40}$/.test(commitSha)) {
    errors.push(
      "no 40-hex commit sha \u2014 commit your work (a guide pins the exact commit it documents) then re-run"
    );
  }
  if (claims.duplicateKeys.length > 0) {
    errors.push(
      `duplicate normalizedRuleKey in claims.jsonl: ${[...new Set(claims.duplicateKeys)].join(", ")} \u2014 each rule key must be unique`
    );
  }
  const resolved = loadResolvedAspects(runDir);
  if (resolved.length > MAX_ASPECTS) {
    errors.push(`${resolved.length} aspects exceeds the ${MAX_ASPECTS}-aspect wire cap`);
  }
  const dives = [];
  const { closure, read } = closureAndReadUniverse(runDir);
  const validRuleKeys = new Set(claims.byKey.keys());
  const anchorUniverse = /* @__PURE__ */ new Set([...read, ...closure]);
  for (const aspect of resolved) {
    const path = join6(runDir, "dives", `${aspect.key}.json`);
    if (!existsSync4(path)) {
      errors.push(`missing dive for aspect "${aspect.key}"`);
      continue;
    }
    const dive = parseArtifact(
      RunDiveSchema,
      "dive",
      readJson2(runDir, join6("dives", `${aspect.key}.json`))
    );
    dives.push(dive);
    const g = groundDive(dive, validRuleKeys, anchorUniverse);
    const share = g.total === 0 ? 0 : g.grounded / g.total;
    if (share < MIN_GROUNDED_SHARE) {
      errors.push(
        `dive "${aspect.key}" is only ${g.grounded}/${g.total} grounded (need \u2265${Math.round(MIN_GROUNDED_SHARE * 100)}%)`
      );
    }
    const unread = aspect.priorityFiles.filter((p) => !read.has(p));
    if (unread.length > 0) {
      errors.push(`dive "${aspect.key}" left ${unread.length} priority file(s) unread`);
    }
  }
  const ruleIndexByKey = /* @__PURE__ */ new Map();
  synthesis.rules.forEach((r, i) => {
    if (!ruleIndexByKey.has(r.normalizedRuleKey)) ruleIndexByKey.set(r.normalizedRuleKey, i);
  });
  const citedRules = [];
  const citedIndexByKey = /* @__PURE__ */ new Map();
  const unknownRefs = /* @__PURE__ */ new Set();
  const mapRef = (key) => {
    const ri = ruleIndexByKey.get(key);
    if (ri !== void 0) return `rule:${ri}`;
    if (citedIndexByKey.has(key)) return `cited:${citedIndexByKey.get(key)}`;
    const claim = claims.byKey.get(key);
    if (claim) {
      const j = citedRules.length;
      citedRules.push(claim);
      citedIndexByKey.set(key, j);
      return `cited:${j}`;
    }
    unknownRefs.add(key);
    return null;
  };
  const mapRefs = (keys) => keys.map(mapRef).filter((r) => r !== null);
  const wireDives = dives.map((dive) => ({
    aspectKey: dive.aspectKey,
    sections: dive.sections.map((s) => ({
      heading: s.heading,
      paragraphs: s.paragraphs.map((p) => ({
        text: p.text,
        ruleRefs: mapRefs(p.ruleRefs),
        anchors: p.anchors
      }))
    })),
    flows: dive.flows.map((f) => ({
      name: f.name,
      steps: f.steps.map((st) => ({
        text: st.text,
        ...st.anchor ? { anchor: st.anchor } : {},
        ruleRefs: mapRefs(st.ruleRefs)
      }))
    })),
    edgeCases: dive.edgeCases.map((e) => ({
      description: e.description,
      ...e.sourceRef ? { sourceRef: e.sourceRef } : {}
    })),
    workedExamples: dive.workedExamples,
    ...dive.stateMachine ? { stateMachine: dive.stateMachine } : {},
    terminologyNotes: dive.terminologyNotes
  }));
  const aspectKeys = new Set(resolved.map((a) => a.key));
  const droppedPrinciples = [];
  const wirePrinciples = frontMatter.principles.map((p) => ({
    ...p,
    aspects: [...new Set(p.aspects.filter((k) => aspectKeys.has(k)))]
  })).filter((p) => {
    if (p.aspects.length < 2) {
      droppedPrinciples.push(p.title);
      return false;
    }
    return true;
  });
  if (droppedPrinciples.length > 0) {
    warnings.push(`dropped ${droppedPrinciples.length} principle(s) spanning <2 aspects: ${droppedPrinciples.join(", ")}`);
  }
  const wireNarrative = frontMatter.narrative.map((n) => ({
    text: n.text,
    ruleRefs: mapRefs(n.ruleRefs),
    anchors: n.anchors
  }));
  const droppedKeyFacts = [];
  const wireKeyFacts = (frontMatter.keyFacts ?? []).map((k) => ({
    label: k.label,
    value: k.value,
    ...k.unit ? { unit: k.unit } : {},
    ...k.meaning ? { meaning: k.meaning } : {},
    ruleRefs: mapRefs(k.ruleRefs),
    anchors: k.anchors
  })).filter((k) => {
    if (k.ruleRefs.length === 0 && k.anchors.length === 0) {
      droppedKeyFacts.push(k.label);
      return false;
    }
    return true;
  });
  if (droppedKeyFacts.length > 0) {
    warnings.push(
      `dropped ${droppedKeyFacts.length} ungrounded key fact(s) (no ruleRef and no anchor): ${droppedKeyFacts.join(", ")}`
    );
  }
  const droppedFees = [];
  const wireFeeSchedule = (frontMatter.feeSchedule ?? []).map((f) => ({
    fee: f.fee,
    amount: f.amount,
    trigger: f.trigger,
    ...f.timing ? { timing: f.timing } : {},
    ...f.waiver ? { waiver: f.waiver } : {},
    ruleRefs: mapRefs(f.ruleRefs),
    anchors: f.anchors
  })).filter((f) => {
    if (f.ruleRefs.length === 0 && f.anchors.length === 0) {
      droppedFees.push(f.fee);
      return false;
    }
    return true;
  });
  if (droppedFees.length > 0) {
    warnings.push(
      `dropped ${droppedFees.length} ungrounded fee(s) (no ruleRef and no anchor): ${droppedFees.join(", ")}`
    );
  }
  if (unknownRefs.size > 0) {
    errors.push(
      `unknown ruleRef(s) (not a synthesis rule or a claim key): ${[...unknownRefs].slice(0, 10).join(", ")}`
    );
  }
  const corpus = [
    synthesis.parameters.map((p) => `${p.name} ${p.value}`).join(" "),
    claims.list.map((c) => c.statement).join(" "),
    JSON.stringify(facts)
  ].join(" ");
  const extraNumericTexts = [
    ...(frontMatter.keyFacts ?? []).map((k) => k.value),
    ...(frontMatter.feeSchedule ?? []).map((f) => f.amount)
  ];
  const unknownConst = unknownConstants(dives, corpus, extraNumericTexts);
  if (unknownConst.length > 0) {
    warnings.push(
      `unverified numbers not found in facts/claims: ${unknownConst.join(", ")} \u2014 verify these worked-example, key-fact, and fee values are real constants, not invented (illustrative inputs like a sample balance or date are fine)`
    );
  }
  const bundle = {
    bundleVersion: 1,
    meta: {
      repoSlug: manifest.repoSlug,
      domainKey: manifest.domainKey,
      featureKey: manifest.featureKey,
      commitSha: commitSha ?? "0".repeat(40),
      dirty: params.dirty ?? false,
      capturedAt: params.capturedAt ?? (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d+Z$/, "Z"),
      agent: {
        harness: "claude-code",
        model: model ?? (manifest.model || "unknown"),
        pluginVersion: pluginVersion2
      }
    },
    files: filesJson.files.map((f) => ({ path: f.path, contentHash: f.contentHash })),
    readLog: readPaths,
    synthesis,
    citedRules: citedRules.map((c) => ({
      statement: c.statement,
      codeAnchor: c.codeAnchor,
      normalizedRuleKey: c.normalizedRuleKey,
      sourcePath: c.sourcePath,
      sourceLine: c.sourceLine
    })),
    aspects: resolved.map((a) => ({
      key: a.key,
      name: a.name,
      description: a.description,
      order: a.order,
      filePaths: a.filePaths
    })),
    dives: wireDives,
    frontMatter: {
      narrative: wireNarrative,
      principles: wirePrinciples,
      ...frontMatter.lifecycle ? { lifecycle: frontMatter.lifecycle } : {},
      ...wireKeyFacts.length ? { keyFacts: wireKeyFacts } : {},
      ...wireFeeSchedule.length ? { feeSchedule: wireFeeSchedule } : {},
      glossary: frontMatter.glossary
    },
    facts,
    writerModelId: model ?? (manifest.model || "unknown")
  };
  const schema = loadGuideSchema(pluginRoot);
  const validator = new Validator(
    schema,
    "2020-12",
    false
  );
  const result = validator.validate(bundle);
  const schemaErrors = result.valid ? [] : result.errors.slice(0, 12).map((e) => `${e.instanceLocation} ${e.keyword}: ${e.error}`);
  if (!result.valid) {
    errors.push(`bundle failed schema validation (${result.errors.length} issues)`);
  }
  const fatal = errors.length > 0;
  if (!fatal) {
    writeFileSync3(join6(runDir, "guide-bundle.json"), JSON.stringify(bundle, null, 2));
  }
  return {
    check: "full",
    ok: !fatal,
    fatal,
    bundlePath: fatal ? null : join6(runDir, "guide-bundle.json"),
    errors,
    warnings,
    schemaErrors,
    stats: {
      aspects: resolved.length,
      dives: wireDives.length,
      rules: synthesis.rules.length,
      citedRules: citedRules.length,
      facts: facts.length,
      files: filesJson.files.length,
      principlesKept: wirePrinciples.length,
      keyFacts: wireKeyFacts.length,
      feeSchedule: wireFeeSchedule.length
    }
  };
}
function loadGuideSchema(pluginRoot) {
  return JSON.parse(
    readFileSync6(join6(pluginRoot, "schemas", "guide-bundle.schema.json"), "utf8")
  );
}
function checkSchema(artifact) {
  const names = Object.keys(ARTIFACT_CONTRACTS);
  if (artifact && !names.includes(artifact)) {
    return {
      check: "schema",
      ok: false,
      fatal: true,
      error: `unknown artifact "${artifact}"`,
      artifacts: names
    };
  }
  const wanted = artifact ? [artifact] : names;
  return {
    check: "schema",
    ok: true,
    artifacts: names,
    contracts: Object.fromEntries(wanted.map((n) => [n, ARTIFACT_CONTRACTS[n]])),
    guidance: "These examples are the contract \u2014 each one is parsed by the validator in CI, so it cannot drift from the schema. `example` exercises every field; `minimal` is the smallest legal form. Keys not shown are rejected."
  };
}
function assembleGuide(params) {
  try {
    switch (params.check) {
      case "schema":
        return checkSchema(params.artifact);
      case "aspects":
        return checkAspects(params.runDir);
      case "dive":
        return checkDive(params.runDir, params.aspectKey);
      case "merge":
        return checkMerge(params.runDir);
      case "synthesis":
        return checkSynthesis(params.runDir);
      case "front-matter":
        return checkFrontMatter(params.runDir);
      case "freshness":
        return checkFreshness(
          params.runDir,
          params.pluginVersion,
          params.model,
          params.storedInputHash
        );
      case "full":
        return checkFull(params);
      default:
        return { check: params.check, ok: false, fatal: true, error: "unknown check" };
    }
  } catch (e) {
    if (e instanceof GateError) {
      return { check: params.check, ok: false, fatal: true, error: e.message };
    }
    if (e instanceof ShapeError) {
      const contract = ARTIFACT_CONTRACTS[e.artifact];
      return {
        check: params.check,
        ok: false,
        fatal: true,
        artifact: e.artifact,
        error: `${contract.file} does not match its shape`,
        issues: e.zerr.errors.slice(0, 8).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
        requiredKeys: contract.requiredKeys,
        example: contract.example,
        guidance: `Fix ${contract.file} against the example below and re-run. Unknown keys are rejected rather than dropped, so a field not in the example does not exist \u2014 do not invent one.`
      };
    }
    const issues = e.errors ? zodIssues(e) : [e instanceof Error ? e.message : String(e)];
    return { check: params.check, ok: false, fatal: true, error: "validation failed", issues };
  }
}

// src/scan/facts.ts
import { writeFile } from "node:fs/promises";
import { join as join9 } from "node:path";

// ../../../src/infrastructure/facts/collect-facts.ts
import { readFile, readdir as readdir2, stat } from "node:fs/promises";
import { join as join8 } from "node:path";

// ../../../src/infrastructure/parsing/walk.ts
import { readdir } from "node:fs/promises";
import { join as join7 } from "node:path";
var SKIP_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  "vendor",
  "tmp",
  "log",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".turbo",
  "storybook-static"
]);
async function walkFiles(dir, ext) {
  const exts = typeof ext === "string" ? [ext] : ext;
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
    const p = join7(dir, e.name);
    if (e.isDirectory()) out.push(...await walkFiles(p, exts));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

// ../../../src/infrastructure/facts/extract-prisma-entities.ts
var MODEL_RE = /^model\s+(\w+)\s*\{/;
function parsePrismaModels(schema) {
  const lines = schema.split("\n");
  const models = [];
  const names = /* @__PURE__ */ new Set();
  for (const l of lines) {
    const m = MODEL_RE.exec(l.trim());
    if (m) names.add(m[1]);
  }
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    const start = MODEL_RE.exec(trimmed);
    if (start) {
      current = { model: start[1], line: i + 1, columns: [], uniques: [] };
      continue;
    }
    if (!current) continue;
    if (trimmed === "}") {
      models.push({
        model: current.model,
        table: current.table ?? current.model,
        line: current.line,
        columns: current.columns,
        uniques: current.uniques
      });
      current = null;
      continue;
    }
    const mapMatch = /^@@map\("([^"]+)"\)/.exec(trimmed);
    if (mapMatch) {
      current.table = mapMatch[1];
      continue;
    }
    const uqMatch = /^@@unique\(\[([^\]]+)\]/.exec(trimmed);
    if (uqMatch) {
      current.uniques.push(uqMatch[1].replace(/\s/g, ""));
      continue;
    }
    if (trimmed.startsWith("@@") || trimmed.startsWith("//") || trimmed === "") {
      continue;
    }
    const col = /^(\w+)\s+([\w.]+(?:\[\])?[?]?)\s*(.*)$/.exec(trimmed);
    if (!col) continue;
    const [, name, type, attrs] = col;
    const bare = type.replace(/[[\]?]/g, "");
    if (names.has(bare)) continue;
    const notes = [];
    if (attrs.includes("@id")) notes.push("PK");
    if (attrs.includes("@unique")) {
      notes.push("unique");
      current.uniques.push(name);
    }
    const def = /@default\(([^)]*)\)/.exec(attrs);
    if (def) notes.push(`default ${def[1]}`);
    current.columns.push({
      name,
      type,
      ...notes.length ? { note: notes.join(", ") } : {}
    });
  }
  return models;
}
function modelsToEntityFacts(models, schemaPath, isReferenced, cap = 40) {
  const facts = [];
  for (const m of models) {
    if (!isReferenced(m.table) && !isReferenced(m.model)) continue;
    facts.push({
      kind: "entity",
      key: m.table,
      payload: { table: m.table, columns: m.columns, uniques: m.uniques },
      sourcePath: schemaPath,
      sourceLine: m.line
    });
    if (facts.length >= cap) break;
  }
  return facts;
}

// ../../../src/infrastructure/facts/extract-rails-schema.ts
var TABLE_RE = /^\s*create_table\s+"([^"]+)"/;
var COLUMN_RE = /^\s*t\.(\w+)\s+"([^"]+)"\s*(.*)$/;
var INDEX_RE = /^\s*t\.index\s+\[([^\]]*)\].*unique:\s*true/;
function parseRailsSchema(schema) {
  const lines = schema.split("\n");
  const models = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const table = TABLE_RE.exec(line);
    if (table) {
      current = { table: table[1], line: i + 1, columns: [], uniques: [] };
      continue;
    }
    if (!current) continue;
    if (/^\s*end\b/.test(line)) {
      models.push({
        model: current.table,
        table: current.table,
        line: current.line,
        columns: current.columns,
        uniques: current.uniques
      });
      current = null;
      continue;
    }
    const uq = INDEX_RE.exec(line);
    if (uq) {
      current.uniques.push(uq[1].replace(/["'\s]/g, ""));
      continue;
    }
    const col = COLUMN_RE.exec(line);
    if (!col || col[1] === "index") continue;
    const [, type, name, attrs] = col;
    const notes = [];
    const def = /default:\s*([^,\n]+)/.exec(attrs);
    if (def) notes.push(`default ${def[1].trim().replace(/^"|"$/g, "")}`);
    if (/null:\s*false/.test(attrs)) notes.push("not null");
    current.columns.push({
      name,
      type,
      ...notes.length ? { note: notes.join(", ") } : {}
    });
  }
  return models;
}

// ../../../src/infrastructure/facts/extract-seed-enums.ts
var INSERT_RE = /INSERT INTO\s+"?(?:public"?\s*\.\s*)?"?(\w+)"?\s*\(([^)]*)\)\s*VALUES\s*((?:[^;']|'(?:[^']|'')*')*);/gi;
var MAX_ENUM_ROWS = 24;
function seedEnumFacts(sqlByPath, wantedTables, cap = 20, rank2 = () => 0) {
  const byTable = /* @__PURE__ */ new Map();
  for (const [path, sql] of sqlByPath) {
    INSERT_RE.lastIndex = 0;
    let m;
    while ((m = INSERT_RE.exec(sql)) !== null) {
      const table = m[1];
      if (!wantedTables.has(table)) continue;
      const tuples = m[3].match(/\(((?:[^()']|'(?:[^']|'')*')*)\)/g) ?? [];
      if (tuples.length === 0 || tuples.length > MAX_ENUM_ROWS) continue;
      const entry = byTable.get(table) ?? {
        path,
        line: lineAt(sql, m.index),
        values: /* @__PURE__ */ new Map()
      };
      for (const t of tuples) {
        const strings = t.match(/'(?:[^']|'')*'/g) ?? [];
        const first = strings[0];
        if (!first) continue;
        const unquote = (s) => s.slice(1, -1).replace(/''/g, "'");
        const value = unquote(first);
        const second = strings[1];
        const description = second ? unquote(second) : void 0;
        if (!entry.values.has(value)) entry.values.set(value, description);
      }
      byTable.set(table, entry);
    }
  }
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const LABEL_RE = /^[A-Za-z][A-Za-z0-9 ._&/-]*$/;
  const facts = [];
  const ordered = [...byTable.entries()].sort(
    (a, b) => rank2(a[0]) - rank2(b[0])
  );
  for (const [table, e] of ordered) {
    for (const [v] of e.values) if (UUID_RE.test(v)) e.values.delete(v);
    const labelish = [...e.values.keys()].filter((v) => LABEL_RE.test(v)).length;
    if (e.values.size === 0 || labelish / e.values.size < 0.6) continue;
    facts.push({
      kind: "enum_values",
      key: table,
      payload: {
        table,
        values: [...e.values.entries()].map(([value, description]) => ({
          value,
          ...description ? { description } : {}
        }))
      },
      sourcePath: e.path,
      sourceLine: e.line
    });
    if (facts.length >= cap) break;
  }
  return facts;
}
function lineAt(text, index2) {
  let line = 1;
  for (let i = 0; i < index2 && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

// ../../../src/infrastructure/facts/blank-comments.ts
function blankComments(source) {
  const out = source.split("");
  const n = source.length;
  let prevSignificant = "";
  const blankBlock = (from, i, close) => {
    void from;
    const end = source.indexOf(close, i + 2);
    const stop = end === -1 ? n : end + close.length;
    for (let j = i; j < stop; j++) if (source[j] !== "\n") out[j] = " ";
    return stop;
  };
  for (let i = 0; i < n; ) {
    const ch = source[i];
    const pair = ch + (source[i + 1] ?? "");
    if (pair === "//") {
      let j = i;
      while (j < n && source[j] !== "\n") out[j++] = " ";
      i = j;
      continue;
    }
    if (pair === "/*") {
      i = blankBlock("/*", i, "*/");
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      i++;
      while (i < n) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === ch) {
          i++;
          break;
        }
        i++;
      }
      prevSignificant = ch;
      continue;
    }
    if (ch === "/" && regexAllowedAfter(prevSignificant)) {
      let j = i + 1;
      let inClass = false;
      while (j < n) {
        const c = source[j];
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) {
          j++;
          break;
        } else if (c === "\n") break;
        j++;
      }
      i = j;
      prevSignificant = "/";
      continue;
    }
    if (!/\s/.test(ch)) prevSignificant = ch;
    i++;
  }
  return out.join("");
}
function regexAllowedAfter(prev) {
  return prev === "" || "([{,;:=!&|?+-*%^~<>".includes(prev);
}

// ../../../src/infrastructure/facts/extract-express-routes.ts
var OPEN_RE = /app\.(get|post|put|patch|delete)\(/g;
var DEDICATED = /* @__PURE__ */ new Set(["session", "role", "roles", "authorize"]);
function expressRouteFacts(path, rawSource, cap = 120) {
  const source = blankComments(rawSource);
  const facts = [];
  OPEN_RE.lastIndex = 0;
  let m;
  while ((m = OPEN_RE.exec(source)) !== null && facts.length < cap) {
    const method = m[1];
    const body = balancedBody(source, OPEN_RE.lastIndex - 1);
    if (body === null) continue;
    const routePath = /^\s*['"]([^'"]+)['"]/.exec(body)?.[1];
    if (!routePath) continue;
    const session = /\bsession\(\s*(\w+)/.exec(body)?.[1];
    const roleArgs = /\b(?:roles?|authorize)\(([^)]*)\)/.exec(body)?.[1] ?? "";
    const roles = [
      ...[...roleArgs.matchAll(/\w+\.(\w+)/g)].map((r) => r[1]),
      ...[...roleArgs.matchAll(/['"]([\w-]+)['"]/g)].map((r) => r[1])
    ];
    const calls = topLevelCallNames(body);
    const middleware = calls.filter((c) => !DEDICATED.has(c));
    const handler = /(\w+)\s*,?\s*$/.exec(body.trimEnd())?.[1];
    facts.push({
      kind: "route",
      key: `${method.toUpperCase()} ${routePath}`,
      payload: {
        method: method.toUpperCase(),
        path: routePath,
        ...session ? { session } : {},
        roles,
        ...handler ? { handler } : {},
        middleware
      },
      sourcePath: path,
      sourceLine: lineAt2(source, m.index)
    });
  }
  return facts;
}
function topLevelCallNames(body) {
  const names = [];
  let depth = 0;
  let quote = null;
  let ident = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      ident = "";
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      ident = "";
      continue;
    }
    if (ch === "(") {
      if (depth === 0 && ident.length > 0) names.push(ident);
      depth++;
      ident = "";
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      ident = "";
      continue;
    }
    if (depth === 0 && /[\w$]/.test(ch)) ident += ch;
    else ident = "";
  }
  return [...new Set(names)];
}
function balancedBody(source, openIndex) {
  let depth = 0;
  let quote = null;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    const pair = ch + (source[i + 1] ?? "");
    if (pair === "//") {
      const eol = source.indexOf("\n", i);
      if (eol === -1) return null;
      i = eol;
      continue;
    }
    if (pair === "/*") {
      const end = source.indexOf("*/", i + 2);
      if (end === -1) return null;
      i = end + 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return source.slice(openIndex + 1, i);
    }
  }
  return null;
}
function lineAt2(text, index2) {
  let line = 1;
  for (let i = 0; i < index2 && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

// ../../../src/infrastructure/facts/extract-cron-routines.ts
function cronRoutineFacts(yamlPath, yaml, isRelevant, cap = 30) {
  const entries = [];
  const lines = yaml.split("\n");
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const name = /^-\s+name:\s*(.+)$/.exec(line);
    if (name) {
      current = { name: name[1].trim(), line: i + 1 };
      entries.push(current);
      continue;
    }
    if (!current) continue;
    const webhook = /^\s+webhook:\s*'?([^'\n]+)'?\s*$/.exec(line);
    if (webhook && !current.webhook) current.webhook = webhook[1].trim();
    const schedule = /^\s+schedule:\s*(.+)$/.exec(line);
    if (schedule && !current.schedule)
      current.schedule = schedule[1].replace(/^['"]|['"]$/g, "").trim();
    const comment = /^\s+comment:\s*(.*)$/.exec(line);
    if (comment && current.comment === void 0) {
      if (comment[1] && !/^[>|]/.test(comment[1].trim())) {
        current.comment = comment[1].replace(/^['"]|['"]$/g, "").trim();
      } else {
        const parts = [];
        for (let j = i + 1; j < lines.length; j++) {
          const cont = /^\s{4,}(\S.*)$/.exec(lines[j]);
          if (!cont) break;
          parts.push(cont[1].trim());
        }
        current.comment = parts.join(" ");
      }
    }
  }
  const facts = [];
  for (const e of entries) {
    if (!e.webhook || !e.schedule) continue;
    const webhookPath = e.webhook.replace(/\{\{[^}]+\}\}/g, "");
    if (!isRelevant(webhookPath, e.name)) continue;
    facts.push({
      kind: "routine",
      key: e.name,
      payload: {
        name: e.name,
        schedule: e.schedule,
        webhook: webhookPath,
        ...e.comment ? { comment: e.comment } : {}
      },
      sourcePath: yamlPath,
      sourceLine: e.line
    });
    if (facts.length >= cap) break;
  }
  return facts;
}

// ../../../src/infrastructure/facts/extract-code-facts.ts
var CONST_RE = /^(?:export )?const ([A-Z][A-Z0-9_]*)\s*=\s*(.+?)\s*$/gm;
var FLAG_MEMBER_RE = /\b(?:[A-Z][A-Z0-9_]*_)?FLAGS?\.([A-Z0-9_]+)\b/g;
var FLAG_CALL_RE = /\b(?:useFeatureFlag\w*|isFeatureFlagEnabled\w*|featureFlagEnabled|isFlagEnabled)\(\s*['"]([\w.-]+)['"]/g;
var EVENT_MEMBER_RE = /\b(?:[A-Z][A-Z0-9_]*_)?EVENTS?\.([A-Z0-9_]+)\b/g;
var EVENT_TRACK_RE = /\.(?:track|capture)\(\s*['"]([^'"]+)['"]/g;
var EVENT_CALL_RE = /\b(?:captureEvent|trackEvent|logEvent|emitEvent)\(\s*(?:[^,()'"\n]+,\s*)?['"]([^'"]+)['"]/g;
var EXPERIMENT_CALL_RE = /\b(?:getExperiment|activateExperiment|useExperiment|getVariation|getFeatureVariable|isInExperiment|getExperimentValue)\(\s*['"]([^'"]+)['"]/g;
var EXPERIMENT_AB_RE = /\b(?:useGrowthBookFeatureValue|getExperimentValue|useExperimentVariant|abTest|splitTest)\(\s*['"]([^'"]+)['"]/g;
var EXPERIMENT_LD_RE = /\b(?:variation|useFlags)\(\s*['"]([^'"]*(?:experiment|test|ab[-_]|split|variant|trial)[^'"]*)['"]/gi;
function extractCodeFacts(path, source) {
  const parameters = [];
  const flagSites = [];
  const events = [];
  const scan = blankComments(source);
  CONST_RE.lastIndex = 0;
  let m;
  while ((m = CONST_RE.exec(scan)) !== null) {
    const [, name, rhs] = m;
    const envVar = /(?:\benv|process\.env)\.([A-Z0-9_]+)/.exec(rhs)?.[1];
    const value = literalValue(rhs);
    if (value === null) continue;
    parameters.push({
      kind: "parameter",
      key: name,
      payload: { name, value, ...envVar ? { envVar } : {} },
      sourcePath: path,
      sourceLine: lineAt3(source, m.index)
    });
  }
  const seenFlags = /* @__PURE__ */ new Set();
  for (const re of [FLAG_MEMBER_RE, FLAG_CALL_RE]) {
    re.lastIndex = 0;
    while ((m = re.exec(scan)) !== null) {
      const site = `${m[1]}@${m.index}`;
      if (seenFlags.has(site)) continue;
      seenFlags.add(site);
      flagSites.push({
        flag: m[1],
        path,
        line: lineAt3(source, m.index),
        ...extractFlagContext(source, m.index, path)
      });
    }
  }
  const seen = /* @__PURE__ */ new Set();
  for (const re of [EVENT_MEMBER_RE, EVENT_TRACK_RE, EVENT_CALL_RE]) {
    re.lastIndex = 0;
    while ((m = re.exec(scan)) !== null) {
      const event = m[1];
      if (seen.has(event)) continue;
      seen.add(event);
      const line = lineAt3(source, m.index);
      const context = extractEventContext(source, m.index, path);
      events.push({
        kind: "event",
        key: event,
        payload: {
          event,
          firedFrom: path,
          ...context
        },
        sourcePath: path,
        sourceLine: line
      });
    }
  }
  const experiments = [];
  const seenExperiments = /* @__PURE__ */ new Set();
  for (const re of [EXPERIMENT_CALL_RE, EXPERIMENT_AB_RE, EXPERIMENT_LD_RE]) {
    re.lastIndex = 0;
    while ((m = re.exec(scan)) !== null) {
      const name = m[1];
      if (seenExperiments.has(name)) continue;
      seenExperiments.add(name);
      const eLine = lineAt3(source, m.index);
      const ctx = extractExperimentContext(source, m.index, path);
      experiments.push({
        kind: "experiment",
        key: name,
        payload: {
          experiment: name,
          firedFrom: path,
          ...ctx
        },
        sourcePath: path,
        sourceLine: eLine
      });
    }
  }
  return { parameters, flagSites, events, experiments };
}
function extractEventContext(source, matchIndex, path) {
  const result = {};
  const lineStart = source.lastIndexOf("\n", matchIndex) + 1;
  const lineEnd = source.indexOf("\n", matchIndex);
  const line = source.slice(lineStart, lineEnd === -1 ? void 0 : lineEnd);
  const head = source.slice(0, 2e3).toLowerCase();
  if (/analytics\.track|analytics\.identify|analytics\.page/i.test(line)) {
    result.provider = "segment";
  } else if (/posthog\.capture|posthog\.identify|\$posthog/i.test(line)) {
    result.provider = "posthog";
  } else if (/amplitude\.track|amplitude\.logEvent|amplitude\.getInstance/i.test(line)) {
    result.provider = "amplitude";
  } else if (/mixpanel\.track|mixpanel\.people/i.test(line)) {
    result.provider = "mixpanel";
  } else if (/gtag\(|ga\(.*send|GoogleAnalytics|ReactGA/i.test(line)) {
    result.provider = "ga4";
  } else if (/rudderanalytics|rudder/i.test(line)) {
    result.provider = "rudderstack";
  } else if (head.includes("@segment") || head.includes("analytics-node") || head.includes("analytics/core")) {
    result.provider = "segment";
  } else if (head.includes("posthog")) {
    result.provider = "posthog";
  } else if (head.includes("amplitude")) {
    result.provider = "amplitude";
  } else if (head.includes("mixpanel")) {
    result.provider = "mixpanel";
  }
  const afterMatch = source.slice(matchIndex, Math.min(matchIndex + 500, source.length));
  const propsMatch = afterMatch.match(
    /['"][^'"]+['"]\s*,\s*\{([^}]{1,400})\}/
  );
  if (propsMatch) {
    const propsStr = propsMatch[1];
    const propNames = [
      ...propsStr.matchAll(/(\w+)\s*(?::|,|\})/g)
    ].map((pm) => pm[1]).filter(
      (p) => !["true", "false", "null", "undefined", "const", "let", "var"].includes(p)
    );
    if (propNames.length > 0) {
      result.properties = [...new Set(propNames)].slice(0, 20);
    }
  }
  const before = source.slice(Math.max(0, matchIndex - 800), matchIndex);
  const fnMatch = before.match(
    /(?:(?:async\s+)?function\s+(\w+)|(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(?|(\w+)\s*(?:=|:)\s*(?:async\s*)?\([^)]*\)\s*(?:=>|:))/g
  );
  if (fnMatch) {
    const lastFn = fnMatch[fnMatch.length - 1];
    const name = lastFn.match(/(?:function\s+|(?:const|let)\s+)(\w+)/)?.[1] ?? lastFn.match(/(\w+)\s*(?:=|:)/)?.[1];
    if (name && name.length > 2) {
      result.trigger = name.replace(/^handle|^on/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase();
    }
  }
  const handlerMatch = before.match(
    /on(?:Click|Submit|Change|Load|Error|Success|Failure|Complete|Cancel)\s*[=:]/i
  );
  if (handlerMatch && !result.trigger) {
    result.trigger = handlerMatch[0].replace(/\s*[=:]/, "").replace(/^on/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase();
  }
  const catMatch = afterMatch.match(/category\s*:\s*['"]([^'"]+)['"]/);
  if (catMatch) {
    result.category = catMatch[1];
  } else {
    const pathParts = path.split("/");
    const domainPart = pathParts.find(
      (p) => !["src", "lib", "libs", "app", "apps", "service", "services", "components", "views", "pages"].includes(p) && p.length > 2
    );
    if (domainPart) {
      result.category = domainPart.replace(/[-_]/g, " ");
    }
  }
  const commentBefore = source.slice(
    Math.max(0, matchIndex - 200),
    matchIndex
  );
  const commentMatch = commentBefore.match(
    /(?:\/\/\s*(.{10,100})|\/\*\*?\s*(.{10,100})\s*\*\/)\s*$/
  );
  if (commentMatch) {
    result.description = (commentMatch[1] ?? commentMatch[2]).trim();
  }
  return result;
}
function literalValue(rhs) {
  const unwrapped = rhs.replace(/;$/, "").trim().replace(/^(?:BigInt|Number)\(\s*(.+?)\s*\)$/, "$1");
  const plain = /^-?[\d_]+(?:\.\d+)?$|^'[^']*'$|^"[^"]*"$|^true$|^false$/.exec(
    unwrapped
  );
  if (plain) return plain[0].replace(/^['"]|['"]$/g, "");
  const coalesce = /\?\?\s*('[^']*'|"[^"]*"|-?[\d_]+(?:\.\d+)?)/.exec(rhs);
  if (coalesce) return coalesce[1].replace(/^['"]|['"]$/g, "");
  const wrapped = /\(\s*(?:process\.)?env\.[A-Z0-9_]+\s*,\s*('[^']*'|"[^"]*"|-?[\d_]+(?:\.\d+)?)/.exec(
    rhs
  );
  if (wrapped) return wrapped[1].replace(/^['"]|['"]$/g, "");
  return null;
}
function extractExperimentContext(source, matchIndex, _path) {
  const result = {};
  const head = source.slice(0, 2e3).toLowerCase();
  if (head.includes("optimizely") || head.includes("@optimizely")) {
    result.provider = "optimizely";
  } else if (head.includes("growthbook") || head.includes("@growthbook")) {
    result.provider = "growthbook";
  } else if (head.includes("posthog") && (head.includes("experiment") || head.includes("ab_test"))) {
    result.provider = "posthog";
  } else if (head.includes("statsig")) {
    result.provider = "statsig";
  } else if (head.includes("launchdarkly") || head.includes("ld-client")) {
    result.provider = "launchdarkly";
  } else if (head.includes("split") || head.includes("@splitsoftware")) {
    result.provider = "split";
  } else if (head.includes("vwo") || head.includes("visual-website-optimizer")) {
    result.provider = "vwo";
  } else if (head.includes("unleash") && head.includes("variant")) {
    result.provider = "unleash";
  }
  const after = source.slice(matchIndex, Math.min(matchIndex + 500, source.length));
  const variantArrayMatch = after.match(/variants?\s*[:=]\s*\[([^\]]{1,200})\]/i);
  if (variantArrayMatch) {
    const names = [...variantArrayMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((vm) => vm[1]);
    if (names.length > 0) result.variants = names;
  }
  if (!result.variants) {
    const variantChecks = [...after.matchAll(/===?\s*['"]([^'"]+)['"]/g)].map((vm) => vm[1]).filter((v) => /^[a-z0-9_-]+$/i.test(v) && v.length < 30);
    if (variantChecks.length >= 2) result.variants = [...new Set(variantChecks)];
  }
  const before = source.slice(Math.max(0, matchIndex - 300), matchIndex);
  const commentMatch = before.match(
    /(?:\/\/\s*(.{10,150})|\/\*\*?\s*([\s\S]{10,200}?)\s*\*\/)\s*$/
  );
  if (commentMatch) {
    const text = (commentMatch[1] ?? commentMatch[2]).trim().replace(/\s+/g, " ");
    if (/hypothes|test.*whether|measure|impact|effect/i.test(text)) {
      result.hypothesis = text;
    } else {
      result.trigger = text;
    }
  }
  const metricMatch = after.match(
    /(?:metric|goal|conversion|kpi|objective)\s*[:=]\s*['"]([^'"]+)['"]/i
  );
  if (metricMatch) result.metric = metricMatch[1];
  if (/todo.*clean|remove.*experiment|deprecated|concluded|winner/i.test(before) || /todo.*clean|remove.*experiment|deprecated|concluded|winner/i.test(after.slice(0, 200))) {
    result.status = "concluded";
  } else {
    result.status = "active";
  }
  return result;
}
function extractFlagContext(source, matchIndex, _path) {
  const result = {};
  const head = source.slice(0, 2e3).toLowerCase();
  if (head.includes("launchdarkly") || head.includes("ld-client") || head.includes("ldclient")) {
    result.provider = "launchdarkly";
  } else if (head.includes("unleash") || head.includes("@unleash")) {
    result.provider = "unleash";
  } else if (head.includes("flagsmith")) {
    result.provider = "flagsmith";
  } else if (head.includes("growthbook") || head.includes("@growthbook")) {
    result.provider = "growthbook";
  } else if (head.includes("statsig")) {
    result.provider = "statsig";
  } else if (head.includes("posthog") && head.includes("flag")) {
    result.provider = "posthog";
  } else if (head.includes("process.env") || head.includes("env.")) {
    result.provider = "env";
  }
  const after = source.slice(matchIndex, Math.min(matchIndex + 200, source.length));
  const defaultMatch = after.match(
    /(?:default(?:Value)?|fallback)\s*[:=]\s*(['"]([^'"]*)|true|false|\d+)/i
  );
  if (defaultMatch) {
    result.defaultValue = defaultMatch[2] ?? defaultMatch[1];
  }
  const secondArg = after.match(/\(\s*['"][^'"]+['"]\s*,\s*(true|false|['"][^'"]*['"]|\d+)/);
  if (secondArg && !result.defaultValue) {
    result.defaultValue = secondArg[1].replace(/['"]/g, "");
  }
  const before = source.slice(Math.max(0, matchIndex - 200), matchIndex);
  const comment = before.match(/(?:\/\/\s*(.{10,100})|\/\*\*?\s*(.{10,100})\s*\*\/)\s*$/);
  if (comment) {
    result.description = (comment[1] ?? comment[2]).trim();
  }
  return result;
}
function lineAt3(text, index2) {
  let line = 1;
  for (let i = 0; i < index2 && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

// ../../../src/infrastructure/facts/extract-security-facts.ts
var PATTERNS = [
  // ---- A01: Broken Access Control ----
  {
    id: "no-auth-route",
    pattern: /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)\b/,
    severity: "medium",
    category: "A01:Broken-Access-Control",
    description: "Route handler without visible auth check in the first 20 lines",
    remediation: "Add authentication/authorization check at the start of the handler",
    except: /auth|session|requireUser|requireAdmin|authenticate|authorize|guard|protect|verify/i
  },
  {
    id: "cors-wildcard",
    pattern: /(?:Access-Control-Allow-Origin|cors)\s*[:=]\s*['"]?\*/i,
    severity: "high",
    category: "A01:Broken-Access-Control",
    description: "CORS wildcard (*) allows any origin to make requests",
    remediation: "Restrict CORS to specific trusted origins"
  },
  // ---- A02: Cryptographic Failures ----
  {
    id: "hardcoded-secret",
    pattern: /(?:secret|password|api_?key|token|private_?key)\s*[:=]\s*['"][A-Za-z0-9+/=_-]{16,}['"]/i,
    severity: "critical",
    category: "A02:Cryptographic-Failures",
    description: "Hardcoded secret, API key, or password in source code",
    remediation: "Move to environment variables or a secrets manager",
    except: /example|placeholder|test|mock|fake|dummy|TODO|CHANGE_ME/i
  },
  {
    id: "weak-hash",
    pattern: /\b(?:createHash|digest)\(\s*['"](?:md5|sha1)['"]/i,
    severity: "high",
    category: "A02:Cryptographic-Failures",
    description: "Using MD5 or SHA1 \u2014 cryptographically broken hash algorithms",
    remediation: "Use SHA-256 or bcrypt/scrypt/argon2 for passwords"
  },
  {
    id: "plaintext-password-log",
    pattern: /(?:log|console|logger)\.\w+\(.*(?:password|secret|token|apiKey)/i,
    severity: "high",
    category: "A02:Cryptographic-Failures",
    description: "Logging potentially sensitive data (password, secret, token)",
    remediation: "Redact sensitive fields before logging",
    except: /redact|mask|\*\*\*|\.length|expired|invalid/i
  },
  // ---- A03: Injection ----
  {
    id: "sql-injection",
    pattern: /\$\{.*\}.*(?:SELECT|INSERT|UPDATE|DELETE|WHERE)\b|\bquery\(\s*`[^`]*\$\{/i,
    severity: "critical",
    category: "A03:Injection",
    description: "Template literal in SQL query \u2014 potential SQL injection",
    remediation: "Use parameterized queries or an ORM",
    except: /prisma|sequelize|knex|drizzle|\$queryRaw.*Prisma\.sql/i
  },
  {
    id: "command-injection",
    pattern: /\b(?:exec|execSync|spawn|execFile)\(\s*(?:`[^`]*\$\{|.*\+\s*(?:req\.|input|param|arg))/i,
    severity: "critical",
    category: "A03:Injection",
    description: "User-influenced value in shell command \u2014 command injection risk",
    remediation: "Use execFile with argument arrays, never string interpolation in commands"
  },
  {
    id: "eval-usage",
    pattern: /\beval\(\s*(?!['"])/,
    severity: "high",
    category: "A03:Injection",
    description: "Dynamic eval() \u2014 code injection risk if input is user-influenced",
    remediation: "Replace eval with JSON.parse, Function constructor, or structured alternatives",
    except: /eslint|vitest|jest|test/i
  },
  {
    id: "innerhtml",
    pattern: /\.innerHTML\s*=|dangerouslySetInnerHTML/i,
    severity: "medium",
    category: "A03:Injection",
    description: "Setting innerHTML / dangerouslySetInnerHTML \u2014 XSS risk if content is user-supplied",
    remediation: "Sanitize HTML with DOMPurify or use textContent instead",
    except: /sanitize|DOMPurify|marked|markdown/i
  },
  // ---- A04: Insecure Design ----
  {
    id: "no-rate-limit",
    pattern: /(?:login|signIn|signUp|register|forgot|reset|verify|otp|mfa)\s*(?:Route|Handler|Action|Controller)/i,
    severity: "medium",
    category: "A04:Insecure-Design",
    description: "Auth endpoint without visible rate limiting",
    remediation: "Add rate limiting to auth endpoints (login, signup, password reset, OTP)",
    except: /rateLimit|throttle|limiter|rateLimiter/i
  },
  // ---- A05: Security Misconfiguration ----
  {
    id: "debug-mode",
    pattern: /(?:DEBUG|NODE_ENV)\s*[:=!]=?\s*['"]?(?:true|development|debug)['"]?\s*(?:&&|\?|;|\))/,
    severity: "low",
    category: "A05:Security-Misconfiguration",
    description: "Debug/development mode check that may leak info in production",
    remediation: "Ensure debug features are disabled in production builds"
  },
  {
    id: "error-stack-leak",
    pattern: /(?:res|response)\.(?:json|send|status)\(.*(?:\.stack|\.message|error\.toString)/i,
    severity: "medium",
    category: "A05:Security-Misconfiguration",
    description: "Error stack trace or message exposed in API response",
    remediation: "Return generic error messages to clients; log details server-side",
    except: /production|process\.env\.NODE_ENV/i
  },
  // ---- A07: Auth Failures ----
  {
    id: "jwt-no-verify",
    pattern: /jwt\.decode\(/i,
    severity: "high",
    category: "A07:Auth-Failures",
    description: "jwt.decode() without verification \u2014 accepts any token",
    remediation: "Use jwt.verify() with a secret/public key",
    except: /\.verify\(|after.*verify/i
  },
  {
    id: "session-no-httponly",
    pattern: /(?:cookie|setCookie|set-cookie).*(?:httpOnly|HttpOnly|http_only)\s*[:=]\s*false/i,
    severity: "high",
    category: "A07:Auth-Failures",
    description: "Cookie with httpOnly disabled \u2014 accessible to JavaScript (XSS vector)",
    remediation: "Set httpOnly: true on session and auth cookies"
  },
  {
    id: "no-csrf",
    pattern: /(?:POST|PUT|PATCH|DELETE).*(?:form|submit|action)/i,
    severity: "low",
    category: "A07:Auth-Failures",
    description: "Mutation form without visible CSRF protection",
    remediation: "Use CSRF tokens or SameSite cookies",
    except: /csrf|csrfToken|SameSite|antiForgery|_token|authenticity/i
  },
  // ---- A08: Software and Data Integrity ----
  {
    id: "unsafe-deserialization",
    pattern: /JSON\.parse\(\s*(?:req\.|request\.|body|input|params)/i,
    severity: "low",
    category: "A08:Data-Integrity",
    description: "Parsing user input without schema validation",
    remediation: "Validate parsed data with Zod, Joi, or similar before use",
    except: /\.parse\(|schema|validate|safeParse|zod|joi|yup/i
  },
  // ---- A09: Logging & Monitoring ----
  {
    id: "no-error-handling",
    pattern: /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/,
    severity: "medium",
    category: "A09:Logging-Monitoring",
    description: "Empty catch block \u2014 errors silently swallowed",
    remediation: "Log the error or handle it meaningfully"
  },
  // ---- Sensitive Data Exposure ----
  {
    id: "pii-in-url",
    pattern: /(?:email|ssn|phone|password|token|secret)\s*[:=]\s*.*(?:searchParams|query|params|url)/i,
    severity: "high",
    category: "Sensitive-Data-Exposure",
    description: "Sensitive data (email, SSN, token) passed in URL parameters",
    remediation: "Send sensitive data in request body or headers, never in URLs",
    except: /type.*email|placeholder|label|name\s*=/i
  }
];
function extractSecurityFacts(path, source) {
  if (/\.test\.|\.spec\.|__test__|fixtures|mock|\.stories\.|\.d\.ts$/i.test(path)) {
    return [];
  }
  const facts = [];
  const lines = source.split("\n");
  for (const sp of PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!sp.pattern.test(line)) continue;
      if (sp.except) {
        const context = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 4)).join("\n");
        if (sp.except.test(context)) continue;
      }
      if (sp.id === "no-auth-route") {
        const handlerBlock = lines.slice(i, Math.min(lines.length, i + 20)).join("\n");
        if (sp.except.test(handlerBlock)) continue;
      }
      facts.push({
        kind: "security",
        key: `${sp.id}:${path}:${i + 1}`,
        payload: {
          finding: sp.id,
          severity: sp.severity,
          category: sp.category,
          description: sp.description,
          remediation: sp.remediation,
          evidence: line.trim().slice(0, 200)
        },
        sourcePath: path,
        sourceLine: i + 1
      });
      break;
    }
  }
  return facts;
}

// ../../../src/infrastructure/facts/collect-facts.ts
var MAX_FILE_BYTES = 2e5;
var TEST_PATH = /\.(spec|test)\.|__tests__|__mocks__|test-utils|\/fixtures\//;
var PERSIST_CAP = 500;
function proximityBy(reached) {
  if (!reached || reached.length === 0) return () => 1;
  const depthByPath = new Map(reached.map((r) => [r.path, r.depth]));
  return (path) => {
    const depth = depthByPath.get(path);
    if (depth === void 0) return 1;
    return depth === 0 ? 3 : depth === 1 ? 2 : 1;
  };
}
var SCHEMA_PROBES = [
  { path: "prisma/schema.prisma", parse: parsePrismaModels },
  { path: "db/schema.rb", parse: parseRailsSchema }
];
var CRON_PROBE_DIRS = ["", "metadata", "config"];
var CRON_FILE = /(cron|schedul)[^/]*\.ya?ml$/i;
var SEED_SQL_DIRS = ["migrations", "seeds", "prisma/migrations", "db"];
var StackFactCollector = class {
  async collect(input) {
    const sources = await readSources(input.localPath, input.closureFiles);
    const proximity = proximityBy(input.reached);
    const depthByPath = input.reached && input.reached.length > 0 ? new Map(input.reached.map((r) => [r.path, r.depth])) : null;
    const depthOf = (path) => depthByPath === null ? 0 : depthByPath.get(path) ?? 2;
    const isSeed = (path) => depthOf(path) === 0;
    const isNear = (path) => depthOf(path) <= 1;
    const facts = [];
    const routeFacts = [];
    for (const [path, src] of sources) {
      if (TEST_PATH.test(path)) continue;
      if (!/app\.(get|post|put|patch|delete)\(/.test(src)) continue;
      routeFacts.push(...expressRouteFacts(path, src));
    }
    facts.push(...routeFacts);
    const schemaSources = [];
    for (const probe of SCHEMA_PROBES) {
      const raw = await readOptional(join8(input.localPath, probe.path));
      if (raw) schemaSources.push({ path: probe.path, models: probe.parse(raw) });
    }
    const allModels = schemaSources.flatMap((s) => s.models);
    const hasRailsSchema = schemaSources.some((s) => s.path.endsWith(".rb"));
    const entityTables = /* @__PURE__ */ new Set();
    const entityScores = /* @__PURE__ */ new Map();
    if (allModels.length > 0) {
      const evaluate = (name) => {
        if (name.length < 4) return { score: 0, admitted: false, seedEvidenced: false };
        let s = 0;
        let strong = false;
        let strongSeed = false;
        let seedBare = false;
        const accessor = `.${name}.`;
        const wordRe = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
        const camel = name.split("_").map((w) => w[0] ? w[0].toUpperCase() + w.slice(1) : w).join("").replace(/s$/, "");
        const arRe = hasRailsSchema && camel.length >= 5 ? new RegExp(`class ${camel}\\b\\s*<|\\b${camel}\\.(where|find|create|new)\\b`) : null;
        for (const [path, src] of sources) {
          if (TEST_PATH.test(path)) continue;
          const w = proximity(path);
          if (src.includes(`prisma.${name}.`) || src.includes(`tx${accessor}`)) {
            s += 4 * w;
            if (isNear(path)) strong = true;
            if (isSeed(path)) strongSeed = true;
          } else if (arRe?.test(src)) {
            s += 2 * w;
            if (isNear(path)) strong = true;
            if (isSeed(path)) strongSeed = true;
          } else if (name.length >= 8 && wordRe.test(src)) {
            s += 1 * w;
            if (isSeed(path)) seedBare = true;
          }
        }
        return {
          score: s,
          admitted: strong || seedBare,
          seedEvidenced: strongSeed || seedBare
        };
      };
      const evaluated = /* @__PURE__ */ new Map();
      const evalOf = (name) => {
        let e = evaluated.get(name);
        if (!e) {
          e = evaluate(name);
          evaluated.set(name, e);
        }
        return e;
      };
      const admitted = (name) => evalOf(name).admitted;
      const scoreOf = (f) => Math.max(
        evaluated.get(f.key)?.score ?? 0,
        evaluated.get(f.payload.table)?.score ?? 0
      );
      const entities = schemaSources.flatMap((s) => modelsToEntityFacts(s.models, s.path, admitted, PERSIST_CAP)).sort((a, b) => scoreOf(b) - scoreOf(a)).slice(0, PERSIST_CAP);
      const seedTables = /* @__PURE__ */ new Set();
      for (const e of entities) {
        entityTables.add(e.key);
        entityScores.set(e.key, scoreOf(e));
        const table = e.payload.table;
        if (evaluated.get(e.key)?.seedEvidenced || evaluated.get(table)?.seedEvidenced) {
          seedTables.add(e.key);
          seedTables.add(table);
        }
      }
      facts.push(...entities);
      facts.push(...schemaDefaultParams(schemaSources, seedTables));
    }
    const tokenScores = /* @__PURE__ */ new Map();
    for (const t of entityTables) {
      const head = t.split("_")[0];
      tokenScores.set(head, (tokenScores.get(head) ?? 0) + (entityScores.get(t) ?? 1));
    }
    const dominant = [...tokenScores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (entityTables.size > 0 && allModels.length > 0) {
      const stems = [...entityTables].map((t) => t.replace(/s$/, "")).filter((t) => t.length >= 5);
      const enumTargets = new Set(entityTables);
      for (const m of allModels) {
        const head = m.table.split("_")[0];
        if (head === dominant || stems.some((t) => m.table.startsWith(t))) {
          enumTargets.add(m.table);
        }
      }
      const sql = await readSeedSql(input.localPath, enumTargets);
      const rank2 = (table) => {
        if (table.split("_")[0] === dominant) return 0;
        for (const t of entityTables) if (table.startsWith(t)) return 1;
        return 2;
      };
      facts.push(...seedEnumFacts(sql, enumTargets, PERSIST_CAP, rank2));
    }
    const routePaths = routeFacts.map((r) => r.payload.path);
    const routePrefixes = new Set(
      routePaths.map((p) => "/" + (p.split("/")[1] ?? "")).filter((p) => p !== "/")
    );
    const vocabulary = new Set(
      [...entityTables].flatMap((t) => t.split("_")).filter((w) => w.length >= 4)
    );
    const isRelevant = (webhook, name) => {
      if (routePaths.some((p) => webhook.endsWith(p))) return true;
      if ([...routePrefixes].some((p) => webhook.includes(`${p}/`))) return true;
      const haystack = `${webhook} ${name}`.toLowerCase();
      if (dominant && new RegExp(`\\b${dominant}`, "i").test(haystack)) return true;
      let hits = 0;
      for (const w of vocabulary) {
        if (new RegExp(`\\b${w}`, "i").test(haystack) && ++hits >= 2) return true;
      }
      return false;
    };
    const seenRoutines = /* @__PURE__ */ new Set();
    for (const rel of await probeCronFiles(input.localPath)) {
      const yaml = await readOptional(join8(input.localPath, rel));
      if (!yaml) continue;
      for (const fact of cronRoutineFacts(rel, yaml, isRelevant, PERSIST_CAP)) {
        if (seenRoutines.has(fact.key)) continue;
        seenRoutines.add(fact.key);
        facts.push(fact);
      }
    }
    const flagSites = /* @__PURE__ */ new Map();
    const flagContext = /* @__PURE__ */ new Map();
    const events = /* @__PURE__ */ new Map();
    const parameters = /* @__PURE__ */ new Map();
    for (const [path, src] of sources) {
      if (TEST_PATH.test(path)) continue;
      if (!isSeed(path)) continue;
      const found = extractCodeFacts(path, src);
      for (const p of found.parameters) {
        if (parameters.has(p.key)) continue;
        const payload = p.payload;
        parameters.set(p.key, {
          ...p,
          payload: { ...payload, ...classifyParameter(payload.name, payload.value) }
        });
      }
      for (const f of found.flagSites) {
        const sites = flagSites.get(f.flag) ?? [];
        sites.push({ path: f.path, line: f.line });
        flagSites.set(f.flag, sites);
        if (f.provider || f.description || f.defaultValue) {
          const existing = flagContext.get(f.flag);
          if (!existing) {
            flagContext.set(f.flag, {
              provider: f.provider,
              description: f.description,
              defaultValue: f.defaultValue
            });
          }
        }
      }
      if (/constants\.[tj]sx?$/.test(path)) continue;
      for (const e of found.events) if (!events.has(e.key)) events.set(e.key, e);
    }
    const POLICY_NAME = /_CENTS|_PERCENT|_RATIO|_DAYS|_SECONDS|_HOURS|_THRESHOLD|_LIMIT|FEE|_MIN|MIN_|_MAX|MAX_|_ATTEMPTS|_RETRIES|GRACE/;
    const rankedParams = [...parameters.values()].sort((a, b) => {
      const score = (f) => {
        const p = f.payload;
        return (POLICY_NAME.test(p.name) ? 2 : 0) + (p.envVar ? 1 : 0) + proximity(f.sourcePath);
      };
      return score(b) - score(a);
    });
    facts.push(...rankedParams.slice(0, PERSIST_CAP));
    const rankedFlags = [...flagSites.entries()].map(([flag, sites]) => {
      const ctx = flagContext.get(flag);
      return {
        kind: "flag",
        key: flag,
        payload: {
          flag,
          sites: sites.slice(0, 40),
          ...ctx?.provider ? { provider: ctx.provider } : {},
          ...ctx?.description ? { description: ctx.description } : {},
          ...ctx?.defaultValue ? { defaultValue: ctx.defaultValue } : {}
        },
        sourcePath: sites[0].path,
        sourceLine: sites[0].line
      };
    }).sort((a, b) => proximity(b.sourcePath) - proximity(a.sourcePath));
    facts.push(...rankedFlags.slice(0, PERSIST_CAP));
    const rankedEvents = [...events.values()].sort(
      (a, b) => proximity(b.sourcePath) - proximity(a.sourcePath)
    );
    facts.push(...rankedEvents.slice(0, PERSIST_CAP));
    const experiments = /* @__PURE__ */ new Map();
    for (const [path, src] of sources) {
      if (TEST_PATH.test(path)) continue;
      if (!isSeed(path)) continue;
      const found = extractCodeFacts(path, src);
      for (const e of found.experiments) {
        if (!experiments.has(e.key)) experiments.set(e.key, e);
      }
    }
    const rankedExperiments = [...experiments.values()].sort(
      (a, b) => proximity(b.sourcePath) - proximity(a.sourcePath)
    );
    facts.push(...rankedExperiments.slice(0, PERSIST_CAP));
    const securityFindings = [];
    for (const [path, src] of sources) {
      if (TEST_PATH.test(path)) continue;
      if (!isSeed(path)) continue;
      securityFindings.push(...extractSecurityFacts(path, src));
    }
    const severityRank = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
    const rankedSecurity = securityFindings.sort((a, b) => {
      const sa = severityRank[a.payload.severity] ?? 0;
      const sb = severityRank[b.payload.severity] ?? 0;
      return sb - sa;
    });
    facts.push(...rankedSecurity.slice(0, PERSIST_CAP));
    return ok(facts);
  }
};
var FUNCTION_DEFAULT = /\(|^now$|^uuid$|^cuid$|^autoincrement$|^dbgenerated/i;
function classifyParameter(name, value) {
  const category = /^(true|false)$/i.test(value) ? "toggle" : /fee/i.test(name) ? "fee" : /_threshold|_min\b|^min_|_ratio/i.test(name) ? "threshold" : /_limit|_max\b|^max_|_cap\b|_attempts|_retries/i.test(name) ? "limit" : /_days|_hours|_minutes|_seconds|_ms\b|grace|_interval|_timeout|_ttl|staleness/i.test(
    name
  ) ? "timing" : void 0;
  const unit = /_cents/i.test(name) ? "cents" : /_percent|_pct|_bps/i.test(name) ? "percent" : /_ratio|_rate\b|multiplier/i.test(name) ? "ratio" : /_days/i.test(name) ? "days" : /_hours/i.test(name) ? "hours" : /_seconds|_secs|staleness/i.test(name) ? "seconds" : /_ms\b/i.test(name) ? "ms" : /_attempts|_retries|_count\b/i.test(name) ? "count" : void 0;
  return {
    ...category !== void 0 ? { category } : {},
    ...unit !== void 0 ? { unit } : {}
  };
}
function schemaDefaultParams(schemaSources, tables) {
  const facts = [];
  for (const source of schemaSources) {
    for (const model of source.models) {
      if (!tables.has(model.table) && !tables.has(model.model)) continue;
      for (const column of model.columns) {
        const def = /default ([^,]+)/.exec(column.note ?? "");
        if (!def) continue;
        const value = def[1].trim().replace(/^["']|["']$/g, "");
        if (!value || FUNCTION_DEFAULT.test(value)) continue;
        facts.push({
          kind: "parameter",
          key: column.name,
          payload: {
            name: column.name,
            value,
            ...classifyParameter(column.name, value)
          },
          sourcePath: source.path,
          sourceLine: model.line
        });
      }
    }
  }
  return facts;
}
async function readSources(root, files) {
  const out = /* @__PURE__ */ new Map();
  for (const rel of files) {
    try {
      const abs = join8(root, rel);
      const s = await stat(abs);
      if (s.size > MAX_FILE_BYTES) continue;
      out.set(rel, await readFile(abs, "utf8"));
    } catch {
    }
  }
  return out;
}
async function readOptional(absPath) {
  try {
    return await readFile(absPath, "utf8");
  } catch {
    return null;
  }
}
async function probeCronFiles(root) {
  const found = [];
  for (const dir of CRON_PROBE_DIRS) {
    let entries = [];
    try {
      entries = await readdir2(join8(root, dir));
    } catch {
      continue;
    }
    for (const name of entries) {
      if (CRON_FILE.test(name)) found.push(dir ? `${dir}/${name}` : name);
    }
  }
  return found;
}
async function readSeedSql(root, tables) {
  const tokens = /* @__PURE__ */ new Set();
  for (const t of tables) {
    tokens.add(t);
    const head = t.split("_")[0];
    if (head.length >= 4) tokens.add(head);
  }
  const out = /* @__PURE__ */ new Map();
  for (const dir of SEED_SQL_DIRS) {
    let paths = [];
    try {
      paths = await walkFiles(join8(root, dir), ".sql");
    } catch {
      continue;
    }
    for (const abs of paths) {
      const rel = abs.slice(root.length + 1);
      if (![...tokens].some((t) => rel.includes(t))) continue;
      try {
        const s = await stat(abs);
        if (s.size > MAX_FILE_BYTES) continue;
        out.set(rel, await readFile(abs, "utf8"));
      } catch {
      }
    }
  }
  return out;
}

// ../../../src/usecases/build-guide-blocks.ts
function summarizeFacts(facts) {
  const by = (kind) => facts.filter(
    (f) => f.kind === kind
  );
  const lines = [];
  const entities = by("entity");
  if (entities.length) {
    lines.push(`Tables (${entities.length}):`);
    for (const e of entities.slice(0, 30)) {
      const cols = e.payload.columns;
      if (cols.length > 0) {
        const colStr = cols.slice(0, 20).map((c) => `${c.name}:${c.type}${c.note ? `(${c.note})` : ""}`).join(", ");
        lines.push(`  ${e.key}: ${colStr}${cols.length > 20 ? ` (+${cols.length - 20} more)` : ""}`);
      } else {
        lines.push(`  ${e.key}`);
      }
    }
    if (entities.length > 30) {
      lines.push(`  ... and ${entities.length - 30} more tables`);
    }
  }
  for (const e of by("enum_values").slice(0, 40)) {
    lines.push(
      `${e.key} values: ${e.payload.values.map((v) => v.value).join(" | ")}`
    );
  }
  const routes = by("route");
  if (routes.length) {
    lines.push(`Routes (${routes.length}):`);
    for (const r of routes.slice(0, 60)) {
      const p = r.payload;
      lines.push(
        `  ${p.method} ${p.path} [${p.session ?? "?"}${p.roles.length ? `; ${p.roles.join(",")}` : ""}]`
      );
    }
  }
  const routines = by("routine");
  if (routines.length) {
    lines.push(`Scheduled jobs:`);
    for (const r of routines) {
      const p = r.payload;
      lines.push(`  ${p.name} @ ${p.schedule}${p.comment ? ` \u2014 ${p.comment.slice(0, 100)}` : ""}`);
    }
  }
  const params = by("parameter");
  if (params.length) {
    lines.push(
      `Constants: ${params.slice(0, 40).map((p) => {
        const { name, value, category, unit } = p.payload;
        const tag = category ? ` [${category}${unit ? `, ${unit}` : ""}]` : "";
        return `${name}=${value}${tag}`;
      }).join(", ")}`
    );
  }
  const flags = by("flag");
  if (flags.length) {
    lines.push(
      `Feature flags: ${flags.map((f) => `${f.payload.flag} (${f.payload.sites.length} gates)`).join(", ")}`
    );
  }
  const events = by("event");
  if (events.length) {
    lines.push(`Analytics events (${events.length}):`);
    for (const e of events.slice(0, 40)) {
      const p = e.payload;
      const parts = [p.event];
      if (p.provider) parts.push(`[${p.provider}]`);
      if (p.trigger) parts.push(`trigger: ${p.trigger}`);
      if (p.properties && p.properties.length > 0) {
        parts.push(`props: {${p.properties.slice(0, 8).join(", ")}}`);
      }
      if (p.category) parts.push(`(${p.category})`);
      lines.push(`  ${parts.join(" \xB7 ")}`);
    }
    if (events.length > 40) {
      lines.push(`  ... and ${events.length - 40} more events`);
    }
  }
  const exps = by("experiment");
  if (exps.length) {
    lines.push(`Experiments (${exps.length}):`);
    for (const e of exps.slice(0, 20)) {
      const p = e.payload;
      const parts = [p.experiment];
      if (p.provider) parts.push(`[${p.provider}]`);
      if (p.status) parts.push(`(${p.status})`);
      if (p.variants && p.variants.length > 0) parts.push(`variants: ${p.variants.join(", ")}`);
      if (p.hypothesis) parts.push(`\u2014 ${p.hypothesis.slice(0, 80)}`);
      lines.push(`  ${parts.join(" ")}`);
    }
  }
  const sec = by("security");
  if (sec.length) {
    lines.push(`Security findings (${sec.length}):`);
    for (const s of sec.slice(0, 20)) {
      const p = s.payload;
      lines.push(`  [${p.severity}] ${p.description} (${p.category}) \u2014 ${s.sourcePath}:${s.sourceLine}`);
    }
  }
  return lines.join("\n");
}

// src/scan/facts.ts
async function collectScanFacts(params) {
  const collector = new StackFactCollector();
  const result = await collector.collect({
    localPath: params.repoRoot,
    closureFiles: params.closureFiles,
    reached: params.reached
  });
  const facts = result.ok ? result.value : [];
  const summary = summarizeFacts(facts);
  if (params.runDir) {
    await writeFile(
      join9(params.runDir, "facts.json"),
      JSON.stringify(facts, null, 2)
    );
  }
  return { facts, summary };
}

// src/scan/git.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
var exec = promisify(execFile);
async function git(cwd, args2) {
  try {
    const { stdout } = await exec("git", args2, {
      cwd,
      maxBuffer: 64 * 1024 * 1024
    });
    return stdout;
  } catch {
    return null;
  }
}
async function gitRoot(cwd) {
  const out = await git(cwd, ["rev-parse", "--show-toplevel"]);
  return out ? out.trim() : null;
}
async function gitHead(cwd) {
  const out = await git(cwd, ["rev-parse", "HEAD"]);
  const sha = out?.trim();
  return sha && /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}
async function gitDirty(cwd) {
  const out = await git(cwd, ["status", "--porcelain"]);
  if (out === null) return null;
  return out.trim().length > 0;
}
async function gitListFiles(cwd) {
  const out = await git(cwd, [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard"
  ]);
  if (out === null) return null;
  return out.split("\0").filter((p) => p.length > 0);
}

// src/scan/select.ts
import { readdir as readdir3 } from "node:fs/promises";
import { join as join12, relative as relative2 } from "node:path";

// ../../../src/usecases/prune-guide-files.ts
function pruneGuideFiles(params) {
  const threshold = params.inDegreeThreshold ?? 8;
  const maxShare = params.maxPruneShare ?? 0.4;
  const closure = new Set(params.closureFiles);
  const importers = /* @__PURE__ */ new Map();
  for (const e of params.edges) {
    if (!closure.has(e.from) || !closure.has(e.to) || e.from === e.to) continue;
    const set = importers.get(e.to) ?? /* @__PURE__ */ new Set();
    set.add(e.from);
    importers.set(e.to, set);
  }
  const candidates = params.closureFiles.filter(
    (p) => !params.seedPaths.has(p) && !params.entryPoints.has(p) && !params.claimPaths.has(p) && (importers.get(p)?.size ?? 0) >= threshold
  ).sort(
    (a, b) => (importers.get(b)?.size ?? 0) - (importers.get(a)?.size ?? 0) || a.localeCompare(b)
  );
  const cap = Math.floor(params.closureFiles.length * maxShare);
  const pruned = candidates.slice(0, cap);
  const prunedSet = new Set(pruned);
  return {
    kept: params.closureFiles.filter((p) => !prunedSet.has(p)),
    pruned,
    prunedInDegree: new Map(
      pruned.map((p) => [p, importers.get(p)?.size ?? 0])
    )
  };
}

// ../../../src/domain/spec/reachable-set.ts
var DEFAULT_REACHABILITY_POLICY = {
  genericPrefixes: [],
  maxReverseDepth: 1,
  callerNeighborhoodDepth: 2,
  maxForwardDepth: Number.POSITIVE_INFINITY
};
function index(edges, key) {
  const m = /* @__PURE__ */ new Map();
  for (const e of edges) {
    const k = key(e);
    const list = m.get(k);
    if (list) list.push(e);
    else m.set(k, [e]);
  }
  return m;
}
function walk(starts, adjacency, next, opts) {
  const seen = /* @__PURE__ */ new Map();
  for (const s of starts) seen.set(s, { depth: 0 });
  let frontier = [...starts];
  for (let depth = 0; depth < opts.maxDepth && frontier.length > 0; depth++) {
    const nextFrontier = [];
    for (const current of frontier) {
      if (depth > 0 && opts.stopThrough?.(current)) continue;
      for (const edge of adjacency.get(current) ?? []) {
        const target = next(edge);
        if (seen.has(target)) continue;
        seen.set(target, { depth: depth + 1, via: edge });
        nextFrontier.push(target);
      }
    }
    frontier = nextFrontier;
  }
  return seen;
}
function computeReachableSet(input) {
  const policy = { ...DEFAULT_REACHABILITY_POLICY, ...input.policy };
  const seed = [...new Set(input.seed)];
  const seedSet = new Set(seed);
  const isGeneric = (path) => policy.genericPrefixes.some((p) => path.startsWith(p));
  const forward = index(input.edges, (e) => e.from);
  const reverse = index(input.edges, (e) => e.to);
  const localForward = index(
    input.edges.filter((e) => e.local),
    (e) => e.from
  );
  const imports = walk(seed, forward, (e) => e.to, {
    maxDepth: policy.maxForwardDepth,
    stopThrough: isGeneric
  });
  const callers = walk(seed, reverse, (e) => e.from, {
    maxDepth: policy.maxReverseDepth
  });
  const callerPaths = [...callers.keys()].filter((p) => !seedSet.has(p));
  const neighborhood = walk(callerPaths, localForward, (e) => e.to, {
    maxDepth: policy.callerNeighborhoodDepth
  });
  const files = /* @__PURE__ */ new Map();
  const claim = (path, reason, hit) => {
    if (files.has(path)) return;
    files.set(path, { path, reason, depth: hit.depth, via: hit.via });
  };
  for (const path of seed) claim(path, "seed", { depth: 0 });
  for (const [path, hit] of callers) claim(path, "calls-in", hit);
  for (const [path, hit] of neighborhood) claim(path, "calls-in", hit);
  for (const [path, hit] of imports) claim(path, "imports", hit);
  const all = [...files.values()].sort(
    (a, b) => rank(a.reason) - rank(b.reason) || a.path.localeCompare(b.path)
  );
  return { files: all, frontier: all.filter((f) => f.reason !== "seed") };
}
var rank = (r) => r === "seed" ? 0 : r === "calls-in" ? 1 : 2;

// src/scan/graph.ts
import { readFile as readFile3 } from "node:fs/promises";
import { join as join11 } from "node:path";

// ../../../src/infrastructure/parsing/build-import-graph.ts
import { posix } from "node:path";

// ../../../src/infrastructure/parsing/extract-ts-module-facts.ts
var RE_DECL = /^\s*export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:const|let|var|function\*?|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
var RE_STAR_AS = /export\s*\*\s*as\s+[A-Za-z_$][\w$]*\s*from\s*['"]([^'"]+)['"]/g;
var RE_STAR = /export\s*\*\s*from\s*['"]([^'"]+)['"]/g;
var RE_BRACED = /export\s*(?:type\s+)?\{([^}]*)\}\s*(?:from\s*['"]([^'"]+)['"])?/g;
var RE_IMPORT = /\bimport\s+(?:type\s+)?([^;'"]*?)\s+from\s*['"]([^'"]+)['"]/g;
var RE_IMPORT_BARE = /\bimport\s*['"]([^'"]+)['"]/g;
var RE_IMPORT_DYNAMIC = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
function parseBindings(clause) {
  return clause.split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
    const halves = part.replace(/^type\s+/, "").split(/\s+as\s+/).map((h) => h.trim());
    const source = halves[0] ?? "";
    return { source, exported: halves[1] ?? source };
  }).filter((b) => b.source.length > 0 && b.source !== "type");
}
function parseImportClause(clause) {
  const braced = clause.match(/\{([^}]*)\}/);
  const star = /\*\s+as\s+/.test(clause);
  if (braced) {
    return { symbols: parseBindings(braced[1]).map((b) => b.source), namespace: false };
  }
  return { symbols: [], namespace: star || clause.trim().length > 0 };
}
function extractTsModuleFacts(source) {
  const src = stripComments(source);
  const imports = [];
  const ownExports = /* @__PURE__ */ new Set();
  const starTargets = [];
  const namedReexports = /* @__PURE__ */ new Map();
  const reexportSpecs = [];
  let m;
  RE_DECL.lastIndex = 0;
  while (m = RE_DECL.exec(src)) ownExports.add(m[1]);
  const starAsSpecs = /* @__PURE__ */ new Set();
  RE_STAR_AS.lastIndex = 0;
  while (m = RE_STAR_AS.exec(src)) {
    starAsSpecs.add(m[1]);
    reexportSpecs.push(m[1]);
  }
  RE_STAR.lastIndex = 0;
  while (m = RE_STAR.exec(src)) {
    if (starAsSpecs.has(m[1])) continue;
    starTargets.push(m[1]);
    reexportSpecs.push(m[1]);
  }
  RE_BRACED.lastIndex = 0;
  while (m = RE_BRACED.exec(src)) {
    const bindings = parseBindings(m[1]);
    const spec = m[2];
    if (spec) {
      reexportSpecs.push(spec);
      for (const b of bindings) {
        namedReexports.set(b.exported, { spec, source: b.source });
      }
    } else {
      for (const b of bindings) ownExports.add(b.exported);
    }
  }
  RE_IMPORT.lastIndex = 0;
  while (m = RE_IMPORT.exec(src)) {
    const { symbols, namespace } = parseImportClause(m[1]);
    imports.push({ spec: m[2], symbols, namespace });
  }
  for (const re of [RE_IMPORT_BARE, RE_IMPORT_DYNAMIC]) {
    re.lastIndex = 0;
    while (m = re.exec(src)) {
      imports.push({ spec: m[1], symbols: [], namespace: true });
    }
  }
  return { imports, ownExports, starTargets, namedReexports, reexportSpecs };
}

// ../../../src/infrastructure/parsing/build-import-graph.ts
var RESOLVE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
function buildImportGraph(sources, aliases = /* @__PURE__ */ new Map()) {
  const files = new Set(sources.keys());
  const facts = /* @__PURE__ */ new Map();
  for (const [path, source] of sources) {
    facts.set(path, extractTsModuleFacts(source));
  }
  const asFile = (base) => {
    for (const ext of RESOLVE_EXTS) if (files.has(base + ext)) return base + ext;
    for (const ext of RESOLVE_EXTS) {
      if (files.has(`${base}/index${ext}`)) return `${base}/index${ext}`;
    }
    return files.has(base) ? base : null;
  };
  const matchAlias = (spec) => {
    let best = null;
    for (const alias of aliases.keys()) {
      if (spec !== alias && !spec.startsWith(`${alias}/`)) continue;
      if (!best || alias.length > best.length) best = alias;
    }
    return best;
  };
  const resolve3 = (from, spec) => {
    if (spec.startsWith(".")) {
      const base = posix.normalize(posix.join(posix.dirname(from), spec));
      const path2 = asFile(base);
      return path2 ? { path: path2, local: true } : null;
    }
    const alias = matchAlias(spec);
    if (!alias) return null;
    const target = aliases.get(alias);
    const rest = spec.slice(alias.length);
    if (!rest) {
      const path2 = asFile(target);
      return path2 ? { path: path2, local: false } : null;
    }
    const root = target.replace(/\/index\.[cm]?[jt]sx?$/, "");
    const path = asFile(root + rest) ?? asFile(target);
    return path ? { path, local: false } : null;
  };
  const isBarrel = (path) => {
    if (!/\/index\.[cm]?[jt]sx?$/.test(path)) return false;
    const f = facts.get(path);
    return (f?.starTargets.length ?? 0) > 0 || (f?.namedReexports.size ?? 0) > 0;
  };
  const definerOf = (file, symbol, seen = /* @__PURE__ */ new Set()) => {
    if (seen.has(file)) return null;
    seen.add(file);
    const f = facts.get(file);
    if (!f) return null;
    if (f.ownExports.has(symbol)) return file;
    const named = f.namedReexports.get(symbol);
    if (named) {
      const next = resolve3(file, named.spec);
      if (next) return definerOf(next.path, named.source, seen) ?? next.path;
    }
    for (const star of f.starTargets) {
      const next = resolve3(file, star);
      if (!next) continue;
      const hit = definerOf(next.path, symbol, seen);
      if (hit) return hit;
    }
    return null;
  };
  const edges = [];
  const deduped = /* @__PURE__ */ new Set();
  const push = (from, to, symbol, local) => {
    if (!to || to === from) return;
    const key = `${from}\0${to}\0${symbol}`;
    if (deduped.has(key)) return;
    deduped.add(key);
    edges.push({ from, to, symbol, local });
  };
  let barrelPrecise = 0;
  let barrelFallback = 0;
  let unresolved = 0;
  for (const [from, f] of facts) {
    for (const ref of f.imports) {
      const target = resolve3(from, ref.spec);
      if (!target) {
        unresolved++;
        continue;
      }
      const throughBarrel = isBarrel(target.path);
      if (throughBarrel && ref.symbols.length > 0 && !ref.namespace) {
        for (const symbol of ref.symbols) {
          const definer = definerOf(target.path, symbol);
          if (definer) {
            barrelPrecise++;
            push(from, definer, symbol, target.local);
          } else {
            barrelFallback++;
            push(from, target.path, symbol, target.local);
          }
        }
        continue;
      }
      if (throughBarrel) barrelFallback++;
      push(
        from,
        target.path,
        ref.namespace ? "*" : ref.symbols[0] ?? "*",
        target.local
      );
    }
    for (const spec of f.reexportSpecs) {
      const target = resolve3(from, spec);
      if (!target) {
        unresolved++;
        continue;
      }
      push(from, target.path, "*", target.local);
    }
  }
  return { edges, stats: { barrelPrecise, barrelFallback, unresolved } };
}

// ../../../src/infrastructure/parsing/extract-ts-symbols.ts
var TS_ENTRY_HINTS = [
  /\/api\//i,
  /\/routes?\//i,
  /controller/i,
  /resolver/i,
  /handler/i,
  /\/jobs?\//i,
  /worker/i,
  /\/pages?\//i,
  /middleware/i,
  /\.route\./i
];
var FUNCTION_RE = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/;
var CLASS_RE = /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/;
var ARROW_RE = /^\s*(?:export\s+)?(?:default\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/;
function extractTsSymbols(source, path, moduleKey, isEntryPoint) {
  const symbols = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    let name;
    let kind = "function";
    const cls = CLASS_RE.exec(text);
    if (cls) {
      name = cls[1];
      kind = "class";
    } else {
      const fn = FUNCTION_RE.exec(text) ?? ARROW_RE.exec(text);
      if (fn) {
        name = fn[1];
        kind = "function";
      }
    }
    if (!name) continue;
    symbols.push({
      kind,
      name,
      path,
      line: i + 1,
      moduleKey,
      isEntryPoint
    });
  }
  return symbols;
}

// ../../../src/infrastructure/parsing/tsconfig-paths.ts
import { readFile as readFile2 } from "node:fs/promises";
import { join as join10 } from "node:path";
var CANDIDATES = ["tsconfig.base.json", "tsconfig.json"];
function stripJsonComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
var stripWildcard = (s) => s.replace(/\/\*$/, "").replace(/^\.\//, "");
async function loadPathAliases(localPath) {
  for (const name of CANDIDATES) {
    let raw;
    try {
      raw = await readFile2(join10(localPath, name), "utf8");
    } catch {
      continue;
    }
    let paths;
    try {
      const parsed = JSON.parse(stripJsonComments(raw));
      paths = typeof parsed === "object" && parsed !== null ? parsed.compilerOptions?.paths : void 0;
    } catch {
      continue;
    }
    if (typeof paths !== "object" || paths === null) continue;
    const aliases = /* @__PURE__ */ new Map();
    for (const [key, value] of Object.entries(paths)) {
      const target = Array.isArray(value) ? value[0] : value;
      if (typeof target !== "string") continue;
      aliases.set(stripWildcard(key), stripWildcard(target));
    }
    if (aliases.size > 0) return aliases;
  }
  return /* @__PURE__ */ new Map();
}

// src/scan/graph.ts
var TS_JS_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
var UNKNOWN_LANGUAGE_SHARE = 0.05;
function isTsJs(path) {
  return TS_JS_EXT.some((e) => path.endsWith(e)) && !path.endsWith(".d.ts");
}
function moduleKeyFor(relPath) {
  return relPath.replace(/\.(tsx?|jsx?|mjs|cjs)$/, "");
}
function hashSource(source) {
  return fnv1a64(source);
}
async function contentHashFor(graph, relPath) {
  const cached = graph.sources.get(relPath);
  if (cached !== void 0) return hashSource(cached);
  try {
    return hashSource(await readFile3(join11(graph.repoRoot, relPath), "utf8"));
  } catch {
    return "unreadable";
  }
}
async function buildScanGraph(repoRoot2, allFiles) {
  const tsFiles = allFiles.filter(isTsJs);
  const sources = /* @__PURE__ */ new Map();
  await Promise.all(
    tsFiles.map(async (rel) => {
      try {
        sources.set(rel, await readFile3(join11(repoRoot2, rel), "utf8"));
      } catch {
      }
    })
  );
  const aliases = await loadPathAliases(repoRoot2);
  const graph = buildImportGraph(sources, aliases);
  const entryPoints = /* @__PURE__ */ new Set();
  for (const [rel, source] of sources) {
    const isEntry = TS_ENTRY_HINTS.some((h) => h.test(rel));
    if (!isEntry) continue;
    if (extractTsSymbols(source, rel, moduleKeyFor(rel), true).length > 0) {
      entryPoints.add(rel);
    }
  }
  const share = allFiles.length === 0 ? 0 : tsFiles.length / allFiles.length;
  const language = share < UNKNOWN_LANGUAGE_SHARE ? "unknown" : "typescript";
  return {
    repoRoot: repoRoot2,
    allFiles,
    tsFiles,
    edges: graph.edges,
    entryPoints,
    language,
    sources
  };
}

// src/scan/select.ts
var TEST_FILE = /\.(spec|test)\.[jt]sx?$|__tests__|__mocks__|_spec\.rb$/;
var NOISE_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "tmp",
  ".next",
  ".turbo",
  ".cache",
  "__snapshots__"
]);
var NOISE_BASENAME = [
  /\.test\./i,
  /\.spec\./i,
  /_test\./i,
  /_spec\./i,
  /\.min\./i,
  /\.d\.ts$/i,
  /\.snap$/i,
  /\.map$/i
];
var WALK_SKIP = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "tmp"
]);
function isNoiseSeed(path) {
  const segs = path.split("/");
  if (segs.some((s) => NOISE_DIRS.has(s))) return true;
  const base = segs[segs.length - 1] ?? path;
  return NOISE_BASENAME.some((re) => re.test(base));
}
async function walkAll(root, dir, out) {
  let entries;
  try {
    entries = await readdir3(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".") {
      if (WALK_SKIP.has(e.name)) continue;
    }
    const full = join12(dir, e.name);
    if (e.isDirectory()) {
      if (WALK_SKIP.has(e.name)) continue;
      await walkAll(root, full, out);
    } else if (e.isFile()) {
      out.push(relative2(root, full));
    }
  }
}
async function listRepoFiles(repoRoot2) {
  const tracked = await gitListFiles(repoRoot2);
  if (tracked && tracked.length > 0) return tracked;
  const out = [];
  await walkAll(repoRoot2, repoRoot2, out);
  return out;
}
var MAX_CLOSURE_FILES = 300;
var AUTO_FORWARD_DEPTH = 2;
async function selectGuideFiles(params) {
  const { repoRoot: repoRoot2, globs, maxForwardDepth } = params;
  const allFiles = params.allFiles ?? await listRepoFiles(repoRoot2);
  const graph = await buildScanGraph(repoRoot2, allFiles);
  const seed = allFiles.filter(
    (f) => !isNoiseSeed(f) && globs.some((g) => matchesGlob(f, g))
  );
  let closurePaths;
  let reached;
  let prunedSet = /* @__PURE__ */ new Set();
  let autoDepthCap = null;
  const closureUnavailable = graph.language === "unknown";
  if (closureUnavailable) {
    closurePaths = seed.filter((p) => !TEST_FILE.test(p));
    reached = closurePaths.map((p) => ({ path: p, reason: "seed", depth: 0 }));
  } else {
    const walk2 = (depth) => computeReachableSet({
      seed,
      edges: graph.edges,
      policy: depth != null ? { maxForwardDepth: depth } : void 0
    });
    let reachable = walk2(maxForwardDepth);
    if (maxForwardDepth == null && reachable.files.length > MAX_CLOSURE_FILES) {
      const capped = walk2(AUTO_FORWARD_DEPTH);
      autoDepthCap = {
        maxForwardDepth: AUTO_FORWARD_DEPTH,
        before: reachable.files.length,
        after: capped.files.length
      };
      reachable = capped;
    }
    reached = [...reachable.files];
    closurePaths = reachable.files.map((f) => f.path).filter((p) => !TEST_FILE.test(p));
    const prune = pruneGuideFiles({
      closureFiles: closurePaths,
      seedPaths: new Set(seed),
      claimPaths: /* @__PURE__ */ new Set(),
      entryPoints: graph.entryPoints,
      edges: graph.edges
    });
    prunedSet = new Set(prune.pruned);
  }
  const seedSet = new Set(seed);
  const depthByPath = new Map(reached.map((r) => [r.path, r.depth]));
  const files = await buildSelectedFiles(
    graph,
    closurePaths,
    seedSet,
    graph.entryPoints,
    prunedSet,
    depthByPath
  );
  return {
    language: graph.language,
    closureUnavailable,
    files,
    seed,
    pruned: [...prunedSet],
    reached,
    autoDepthCap,
    counts: {
      allFiles: allFiles.length,
      seed: seed.length,
      closure: closurePaths.length,
      pruned: prunedSet.size
    }
  };
}
async function buildSelectedFiles(graph, paths, seedSet, entryPoints, prunedSet, depthByPath) {
  return Promise.all(
    paths.map(async (path) => ({
      path,
      contentHash: await contentHashFor(graph, path),
      seed: seedSet.has(path),
      entryPoint: entryPoints.has(path),
      pruned: prunedSet.has(path),
      depth: depthByPath.get(path) ?? (seedSet.has(path) ? 0 : 1)
    }))
  );
}

// src/setup.ts
function msg(e) {
  return e instanceof Error ? e.message : String(e);
}
var DEFAULT_SERVER_URL = "https://www.gokanon.com";
function resolveServerUrl(raw) {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return DEFAULT_SERVER_URL;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return normalizeUrl(withScheme);
}
async function setupBegin(serverUrl, deps) {
  const url = resolveServerUrl(serverUrl);
  const r = await deviceStart(url);
  if (!r.ok) {
    if (r.status === 0) {
      return {
        ok: false,
        error: r.error,
        guidance: `cannot reach ${url} \u2014 check for a typo, http vs https, that the server is running, and any VPN`
      };
    }
    if (r.status === 404) {
      return {
        ok: false,
        error: r.error,
        guidance: "this server doesn't expose device sign-in (/api/device/start not found) \u2014 the Kanon instance is too old or the URL is wrong"
      };
    }
    return { ok: false, error: r.error, guidance: r.guidance };
  }
  if (!r.userCode || !r.deviceCode || !r.verifyUrl) {
    return {
      ok: false,
      error: "unexpected response from /api/device/start",
      guidance: "this server doesn't expose device sign-in \u2014 the Kanon instance is too old or the URL is wrong"
    };
  }
  const startedMs = deps.now();
  writePending(deps.env, {
    version: 1,
    serverUrl: url,
    deviceCode: r.deviceCode,
    userCode: r.userCode,
    verifyUrl: r.verifyUrl,
    expiresAt: new Date(startedMs + r.expiresInSeconds * 1e3).toISOString(),
    pollIntervalSeconds: r.pollIntervalSeconds,
    createdAt: new Date(startedMs).toISOString()
  });
  return {
    ok: true,
    verifyUrl: r.verifyUrl,
    userCode: r.userCode,
    expiresInSeconds: r.expiresInSeconds,
    pollIntervalSeconds: r.pollIntervalSeconds
  };
}
function secondsLeft(expiresAt, now) {
  const left = Math.round((Date.parse(expiresAt) - now) / 1e3);
  return Number.isFinite(left) && left > 0 ? left : 0;
}
async function setupPoll({ maxWaitSeconds = 20 }, deps) {
  const budgetMs = Math.max(0, Math.min(25, maxWaitSeconds)) * 1e3;
  const deadline = deps.now() + budgetMs;
  const pending = readPending(deps.env);
  if (!pending) {
    return {
      status: "no_pending",
      guidance: "no sign-in is in progress \u2014 run kanon_setup_begin (or /kanon:setup) first"
    };
  }
  for (; ; ) {
    const r = await devicePoll(pending.serverUrl, pending.deviceCode);
    if (!r.ok) {
      return {
        status: "error",
        error: r.error,
        guidance: r.guidance ?? "lost contact with the server mid sign-in \u2014 check connectivity and re-run to resume"
      };
    }
    if (r.status === "approved") {
      try {
        const credentialsPath2 = writeCredential(deps.env, pending.serverUrl, {
          token: r.token,
          workspaceSlug: r.workspace?.slug ?? null,
          workspaceName: r.workspace?.name ?? null,
          tokenName: r.tokenName,
          createdAt: new Date(deps.now()).toISOString()
        });
        clearPending(deps.env);
        return {
          status: "approved",
          workspace: r.workspace,
          tokenName: r.tokenName,
          credentialsPath: credentialsPath2
        };
      } catch (e) {
        return {
          status: "error",
          error: `signed in, but could not save the credential: ${msg(e)}`,
          guidance: "the token is issued exactly once and is now spent \u2014 run /kanon:setup again to restart sign-in. Check permissions on ~/.kanon."
        };
      }
    }
    if (r.status === "denied") {
      clearPending(deps.env);
      return {
        status: "denied",
        guidance: "the sign-in was denied in the browser \u2014 run /kanon:setup again to retry with a fresh code"
      };
    }
    if (r.status === "expired") {
      clearPending(deps.env);
      return {
        status: "expired",
        guidance: "the code expired before it was approved \u2014 run /kanon:setup again for a fresh code"
      };
    }
    if (deps.now() >= deadline) {
      return {
        status: "pending",
        secondsLeft: secondsLeft(pending.expiresAt, deps.now()),
        verifyUrl: pending.verifyUrl,
        userCode: pending.userCode
      };
    }
    const waitSeconds = r.retryAfter ?? pending.pollIntervalSeconds;
    await deps.sleep(Math.max(0, waitSeconds) * 1e3);
  }
}
function configView(detailed) {
  return {
    url: detailed.url.value,
    urlSource: detailed.url.source,
    tokenSource: detailed.token.source,
    repoSlug: detailed.repoSlug.value,
    repoSlugSource: detailed.repoSlug.source
  };
}
async function whoamiDetailed(deps) {
  const cwd = process.cwd();
  const cfg = resolveConfig(deps.env, cwd);
  const config2 = configView(resolveConfigDetailed(deps.env, cwd));
  if (!cfg.url) {
    return {
      ok: false,
      error: "no server URL \u2014 run /kanon:setup",
      config: config2
    };
  }
  if (!cfg.token) {
    return {
      ok: false,
      error: "not signed in \u2014 run /kanon:setup",
      config: config2
    };
  }
  const r = await whoami({ url: cfg.url, token: cfg.token });
  if (!r.ok) {
    return {
      ok: false,
      error: r.guidance ? `${r.error} \u2014 ${r.guidance}` : r.error,
      config: config2
    };
  }
  return {
    ok: true,
    kind: r.kind,
    workspace: r.workspace,
    tokenName: r.tokenName,
    config: config2
  };
}

// src/validate.ts
import { readFileSync as readFileSync7 } from "node:fs";
import { join as join13 } from "node:path";
function bundleStats(bundle, bytes) {
  const b = bundle ?? {};
  const domains = b.proposal?.domains ?? [];
  return {
    screens: b.screenGraph?.screens?.length ?? 0,
    transitions: b.screenGraph?.transitions?.length ?? 0,
    domains: domains.length,
    features: domains.reduce((n, d) => n + (d.features?.length ?? 0), 0),
    bytes
  };
}
function loadSchema2(pluginRoot) {
  return JSON.parse(
    readFileSync7(join13(pluginRoot, "schemas", "bundle.schema.json"), "utf8")
  );
}
function validateBundle(bundle, schema, bytes) {
  const validator = new Validator(
    // The Validator type wants a Schema union; the emitted file is one.
    schema,
    "2020-12",
    false
  );
  const result = validator.validate(bundle);
  const errors = result.errors.slice(0, 10).map((e) => ({
    instanceLocation: e.instanceLocation,
    keyword: e.keyword,
    error: e.error
  }));
  const stats = bundleStats(bundle, bytes);
  const summary = result.valid ? `valid bundle: ${stats.domains} domains, ${stats.features} features, ${stats.screens} screens, ${stats.transitions} transitions` : `INVALID bundle: ${result.errors.length} schema violations (first ${errors.length} shown)`;
  return { valid: result.valid, errors, summary, stats };
}
function validateBundleFile(path, pluginRoot) {
  const raw = readFileSync7(path, "utf8");
  let bundle;
  try {
    bundle = JSON.parse(raw);
  } catch (e) {
    return {
      valid: false,
      errors: [
        {
          instanceLocation: "#",
          keyword: "parse",
          error: `not valid JSON: ${e instanceof Error ? e.message : String(e)}`
        }
      ],
      summary: "INVALID bundle: file is not valid JSON",
      stats: { screens: 0, transitions: 0, domains: 0, features: 0, bytes: raw.length }
    };
  }
  const report = validateBundle(bundle, loadSchema2(pluginRoot), raw.length);
  return { ...report, bundle };
}

// src/cli.ts
var config = resolveConfig();
var [, , command, ...args] = process.argv;
var setupDeps = {
  env: process.env,
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms))
};
function fail(message) {
  console.error(message);
  process.exit(1);
}
async function repoRoot() {
  return await gitRoot(process.cwd()) ?? process.cwd();
}
function apiConfigOrFail() {
  if (!config.url) fail("no server URL \u2014 run /kanon:setup or set KANON_URL");
  if (!config.token) fail("not signed in \u2014 run /kanon:setup or set KANON_API_TOKEN");
  return { url: config.url, token: config.token };
}
switch (command) {
  case "validate": {
    const path = args[0] ?? fail("usage: cli.js validate <bundle.json>");
    const { bundle: _bundle, ...report } = validateBundleFile(
      resolve2(path),
      config.pluginRoot
    );
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.valid ? 0 : 1);
    break;
  }
  case "assemble": {
    const runDir = args[0] ?? fail("usage: cli.js assemble <runDir> [repoSlug] [targetUrl]");
    const result = assembleBundle({
      runDir: resolve2(runDir),
      repoSlug: args[1] ?? config.repoSlug,
      targetUrl: args[2],
      pluginVersion: pluginVersion(config.pluginRoot)
    });
    console.log(JSON.stringify(result.stats, null, 2));
    console.log(result.bundlePath);
    break;
  }
  case "setup-begin": {
    const serverUrl = args[0] ?? fail("usage: cli.js setup-begin <serverUrl>");
    const r = await setupBegin(serverUrl, setupDeps);
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
    break;
  }
  case "setup-poll": {
    const maxWaitSeconds = args[0] !== void 0 ? Number(args[0]) : void 0;
    const r = await setupPoll(
      { maxWaitSeconds: Number.isFinite(maxWaitSeconds) ? maxWaitSeconds : void 0 },
      setupDeps
    );
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.status === "approved" || r.status === "pending" ? 0 : 1);
    break;
  }
  case "whoami": {
    const r = await whoamiDetailed(setupDeps);
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
    break;
  }
  case "select-files": {
    const runDir = args[0] ?? fail("usage: cli.js select-files <runDir> <glob> [glob...]");
    const globs = args.slice(1);
    if (globs.length === 0) fail("select-files needs at least one glob");
    const dir = resolve2(runDir);
    mkdirSync3(dir, { recursive: true });
    const r = await selectGuideFiles({ repoRoot: await repoRoot(), globs });
    const filesJson = {
      language: r.language,
      closureUnavailable: r.closureUnavailable,
      files: r.files,
      pruned: r.pruned
    };
    writeFileSync4(join14(dir, "files.json"), JSON.stringify(filesJson, null, 2));
    console.log(
      JSON.stringify(
        { wrote: join14(dir, "files.json"), language: r.language, counts: r.counts },
        null,
        2
      )
    );
    break;
  }
  case "collect-facts": {
    const runDir = args[0] ?? fail("usage: cli.js collect-facts <runDir>");
    const dir = resolve2(runDir);
    const filesPath = join14(dir, "files.json");
    if (!existsSync5(filesPath)) fail("no files.json \u2014 run select-files first");
    const filesJson = FilesJsonSchema.parse(JSON.parse(readFileSync8(filesPath, "utf8")));
    const { facts } = await collectScanFacts({
      repoRoot: await repoRoot(),
      closureFiles: filesJson.files.map((f) => f.path),
      reached: filesJson.files.map((f) => ({
        path: f.path,
        reason: f.seed ? "seed" : "imports",
        // Real closure depth when the run dir carries it; older run dirs
        // degrade to seed/transitive — unknown depth must not read as "near"
        // (see index.ts: near grants strong-evidence entity admission).
        depth: f.depth ?? (f.seed ? 0 : 2)
      })),
      runDir: dir
    });
    console.log(JSON.stringify({ wrote: join14(dir, "facts.json"), factCount: facts.length }, null, 2));
    break;
  }
  case "assemble-guide": {
    const schemaMode = args[0] === "schema";
    const runDir = schemaMode ? "" : args[0] ?? fail(
      "usage: cli.js assemble-guide <runDir> <check> [aspectKey]  |  cli.js assemble-guide schema [artifact]"
    );
    const check = schemaMode ? "schema" : args[1] ?? fail("assemble-guide needs a check mode");
    const aspectKey = schemaMode || check === "freshness" ? void 0 : args[2];
    const storedInputHash = !schemaMode && check === "freshness" ? args[2] : void 0;
    const artifact = schemaMode ? args[1] : void 0;
    let commitSha;
    let dirty;
    if (check === "full") {
      const root = await repoRoot();
      commitSha = await gitHead(root) ?? void 0;
      dirty = await gitDirty(root) ?? void 0;
    }
    const report = assembleGuide({
      runDir: runDir ? resolve2(runDir) : "",
      check,
      aspectKey,
      storedInputHash,
      artifact,
      pluginRoot: config.pluginRoot,
      pluginVersion: pluginVersion(config.pluginRoot),
      commitSha,
      dirty
    });
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
    break;
  }
  case "push-guide": {
    const path = args[0] ?? fail("usage: cli.js push-guide <guide-bundle.json> [repoSlug]");
    const bundlePath = resolve2(path);
    if (!existsSync5(bundlePath)) fail(`no guide bundle at ${bundlePath}`);
    const bundle = JSON.parse(readFileSync8(bundlePath, "utf8"));
    const slug = args[1] ?? bundle.meta?.repoSlug ?? config.repoSlug;
    if (!slug) fail("no repoSlug \u2014 pass one or set it in the bundle/config");
    const r = await pushGuide(apiConfigOrFail(), bundle, slug);
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
    break;
  }
  case "push-tests": {
    const root = await repoRoot();
    const shardDir = resolveShardDir(process.env, root);
    const raws = readShards(shardDir);
    if (raws.length === 0) {
      fail(
        `no coverage shards in ${shardDir} \u2014 run your suite with the kanon setup file and Istanbul coverage (--coverage) first`
      );
    }
    const slug = args[0] ?? config.repoSlug;
    if (!slug) {
      fail(
        "no repoSlug \u2014 pass one or set KANON_REPO_SLUG / .kanon/config.json"
      );
    }
    const payload = assemblePayload({
      repoSlug: slug,
      capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
      raws
    });
    const check = validateCoverage(payload, config.pluginRoot);
    if (!check.valid) {
      console.error(
        JSON.stringify(
          { error: "coverage payload failed schema validation", issues: check.errors },
          null,
          2
        )
      );
      process.exit(1);
    }
    const r = await pushTests(apiConfigOrFail(), payload, slug);
    console.log(JSON.stringify(r, null, 2));
    if (r.ok) clearShards(shardDir);
    process.exit(r.ok ? 0 : 1);
    break;
  }
  case "coverage-merge": {
    const out = args[0] ?? fail("usage: cli.js coverage-merge <out.json> [repoSlug]");
    const root = await repoRoot();
    const shardDir = resolveShardDir(process.env, root);
    const raws = readShards(shardDir);
    const slug = args[1] ?? config.repoSlug ?? "unknown";
    const payload = assemblePayload({
      repoSlug: slug,
      capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
      raws
    });
    writeFileSync4(resolve2(out), `${JSON.stringify(payload, null, 2)}
`);
    console.log(
      JSON.stringify({ wrote: resolve2(out), tests: payload.tests.length }, null, 2)
    );
    break;
  }
  default:
    fail(
      "usage: cli.js <validate|assemble|setup-begin|setup-poll|whoami|select-files|collect-facts|assemble-guide|push-guide|push-tests|coverage-merge> \u2026"
    );
}
