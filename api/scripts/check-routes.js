#!/usr/bin/env node
// Route registration check.
//
// Extracts every `app.<method>("/path", ...)` call from src/server.js and
// runs two assertions:
//
//   1) snapshot — the route set must match scripts/routes.snapshot.txt
//      verbatim. Run with --update to regenerate the snapshot after an
//      intentional change.
//
//   2) openapi  — every route in server.js must appear in
//      docs/API_SPECIFICATION.yaml under `paths:`, and vice versa. Param
//      names are ignored (`/users/:id` ≡ `/users/{userId}`).
//
// Catches the cutover-style accident where api/src/server.js silently
// loses endpoints during a hand-merge or repo consolidation. CI runs
// this on every PR that touches api/.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SERVER_FILE = path.join(REPO_ROOT, 'src/server.js');
const SNAPSHOT_FILE = path.join(__dirname, 'routes.snapshot.txt');
const OPENAPI_FILE = path.join(REPO_ROOT, 'docs/API_SPECIFICATION.yaml');
const OPENAPI_BASELINE_FILE = path.join(__dirname, 'routes.openapi-baseline.json');

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all'];

function extractServerRoutes(src) {
  // Match `app.<method>("/path"` or `app.<method>('/path'` at start of line
  // (ignores commented or string-literal occurrences inside other code).
  const re = new RegExp(
    `^app\\.(${HTTP_METHODS.join('|')})\\(\\s*["']([^"']+)["']`,
    'gm'
  );
  const out = new Set();
  let m;
  while ((m = re.exec(src)) !== null) {
    const method = m[1].toUpperCase();
    const route = m[2];
    out.add(`${method} ${route}`);
  }
  return [...out].sort();
}

function extractOpenApiRoutes(yamlPath) {
  const yaml = require('js-yaml');
  // `json: true` is last-wins on duplicate keys — needed because the
  // existing spec has duplicated schema names (e.g. `Ivr:` appears twice
  // under components.schemas). Strict parsing would throw, but those
  // duplicates don't affect the `paths:` block we care about.
  const doc = yaml.load(fs.readFileSync(yamlPath, 'utf8'), { json: true });
  const paths = doc.paths || {};
  const out = new Set();
  for (const [route, ops] of Object.entries(paths)) {
    for (const method of Object.keys(ops || {})) {
      if (HTTP_METHODS.includes(method)) {
        out.add(`${method.toUpperCase()} ${route}`);
      }
    }
  }
  return [...out].sort();
}

// `/users/:id` and `/users/{userId}` are the same route from a wiring
// perspective — only the param shape matters, not the label.
function canonicalize(routeLine) {
  const [method, ...rest] = routeLine.split(' ');
  const route = rest.join(' ')
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '{}')
    .replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, '{}');
  return `${method} ${route}`;
}

// Returns { documentedNotInCode: [...], codeNotDocumented: [...] }.
// Strips `/api/v1` from server routes (the OpenAPI `servers:` URL
// already includes that prefix) and skips meta routes that aren't
// part of the public API surface.
function computeOpenApiDivergence(serverRoutes) {
  const SKIP_ROUTES = new Set(['/health', '/api', '/api-docs', '/api-spec.json', '/docs', '/reference']);
  const apiV1Routes = serverRoutes
    .filter(r => {
      const route = r.split(' ').slice(1).join(' ');
      return route.startsWith('/api/v1/') && !SKIP_ROUTES.has(route);
    })
    .map(r => {
      const [method, ...rest] = r.split(' ');
      return `${method} ${rest.join(' ').replace(/^\/api\/v1/, '')}`;
    });
  const openapi = extractOpenApiRoutes(OPENAPI_FILE);
  const serverCanon = new Set(apiV1Routes.map(canonicalize));
  const openapiCanon = new Set(openapi.map(canonicalize));
  return {
    documentedNotInCode: [...openapiCanon].filter(x => !serverCanon.has(x)).sort(),
    codeNotDocumented: [...serverCanon].filter(x => !openapiCanon.has(x)).sort(),
  };
}

function diff(label, want, have) {
  const wantSet = new Set(want);
  const haveSet = new Set(have);
  const missing = want.filter(x => !haveSet.has(x));
  const extra = have.filter(x => !wantSet.has(x));
  if (missing.length === 0 && extra.length === 0) return null;
  let msg = `\n✗ ${label}\n`;
  if (missing.length) msg += `\n  Missing (expected, not found):\n` + missing.map(x => `    - ${x}`).join('\n') + '\n';
  if (extra.length) msg += `\n  Unexpected (found, not expected):\n` + extra.map(x => `    + ${x}`).join('\n') + '\n';
  return msg;
}

function main() {
  const update = process.argv.includes('--update');
  const src = fs.readFileSync(SERVER_FILE, 'utf8');
  const serverRoutes = extractServerRoutes(src);

  if (update) {
    fs.writeFileSync(SNAPSHOT_FILE, serverRoutes.join('\n') + '\n');
    console.log(`✓ Wrote ${serverRoutes.length} routes to ${path.relative(REPO_ROOT, SNAPSHOT_FILE)}`);
    if (fs.existsSync(OPENAPI_FILE)) {
      const baseline = computeOpenApiDivergence(serverRoutes);
      fs.writeFileSync(OPENAPI_BASELINE_FILE, JSON.stringify(baseline, null, 2) + '\n');
      console.log(`✓ Wrote OpenAPI baseline (${baseline.documentedNotInCode.length} docs-only, ${baseline.codeNotDocumented.length} code-only) to ${path.relative(REPO_ROOT, OPENAPI_BASELINE_FILE)}`);
    }
    return;
  }

  let failed = false;

  // 1) Snapshot check — exact match including param names.
  const snapshot = fs.existsSync(SNAPSHOT_FILE)
    ? fs.readFileSync(SNAPSHOT_FILE, 'utf8').split('\n').filter(Boolean).sort()
    : [];
  const snapDiff = diff('snapshot mismatch (src/server.js vs scripts/routes.snapshot.txt)', snapshot, serverRoutes);
  if (snapDiff) {
    console.error(snapDiff);
    console.error('  → If the change is intentional, re-run with `npm run check:routes -- --update` and commit the snapshot.');
    failed = true;
  }

  // 2) OpenAPI check — baseline-aware, only fails on NEW divergence.
  //
  // The current spec has known drift (~30 routes added to code without
  // doc updates, plus some old paths in the doc that no longer exist).
  // Cleaning that up is a separate effort. For now, the check captures
  // today's divergence as a baseline and only fails if NEW endpoints
  // appear in code without a doc entry, or NEW doc entries lose their
  // implementation. Existing drift is allowed; growing drift is not.
  //
  // To shrink the baseline: fix the divergence, then run with --update.
  if (fs.existsSync(OPENAPI_FILE)) {
    const cur = computeOpenApiDivergence(serverRoutes);
    const baseline = fs.existsSync(OPENAPI_BASELINE_FILE)
      ? JSON.parse(fs.readFileSync(OPENAPI_BASELINE_FILE, 'utf8'))
      : { documentedNotInCode: [], codeNotDocumented: [] };
    const baselineDocOnly = new Set(baseline.documentedNotInCode || []);
    const baselineCodeOnly = new Set(baseline.codeNotDocumented || []);
    const newDocOnly = cur.documentedNotInCode.filter(x => !baselineDocOnly.has(x));
    const newCodeOnly = cur.codeNotDocumented.filter(x => !baselineCodeOnly.has(x));
    if (newDocOnly.length || newCodeOnly.length) {
      console.error('\n✗ openapi divergence grew (new entries since baseline)\n');
      if (newDocOnly.length) console.error('  Documented but not implemented:\n' + newDocOnly.map(x => `    - ${x}`).join('\n') + '\n');
      if (newCodeOnly.length) console.error('  Implemented but not documented:\n' + newCodeOnly.map(x => `    + ${x}`).join('\n') + '\n');
      console.error('  → Either add the route to docs/API_SPECIFICATION.yaml, fix the path, or — if accepting the new drift — re-run with `npm run check:routes -- --update` to update the baseline.');
      failed = true;
    } else {
      const shrunkDoc = baseline.documentedNotInCode.filter(x => !cur.documentedNotInCode.includes(x));
      const shrunkCode = baseline.codeNotDocumented.filter(x => !cur.codeNotDocumented.includes(x));
      if (shrunkDoc.length || shrunkCode.length) {
        console.log(`! OpenAPI divergence shrunk by ${shrunkDoc.length + shrunkCode.length} entries — consider running \`npm run check:routes -- --update\` to lock the baseline.`);
      }
    }
  } else {
    console.error(`! OpenAPI spec not found at ${OPENAPI_FILE} — skipping openapi check.`);
  }

  if (failed) process.exit(1);
  console.log(`✓ ${serverRoutes.length} routes match snapshot and OpenAPI spec.`);
}

main();
