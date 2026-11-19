#!/usr/bin/env node
// Runs the site health checks (extension/health/checks.js) from the command line: for each
// supported site, its homepage, then sample articles, fetched signed out like a first-time
// reader. Prints one line per check: pass, fail, or skip (couldn't check: a bot check, a refusal,
// a page drawn by script). Records structure and counts only, never article text.
//
//   node tools/site-health.mjs [--only id,id] [--samples 2] [--json out.json]
//
// It says it's a script (Node's own user agent), never a browser. Some outlets refuse that (NYT,
// FT, The Atlantic, WSJ and Reuters, as of November 2026), so expect skips there: look at those
// in a browser. Exit code 1 if any check failed.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const only = opt('only') ? opt('only').split(',') : null;
const perSite = Number(opt('samples') || 3);
const jsonOut = opt('json');
const MAX_TRIES = 6;

// The adapters register themselves in globalThis.NYTFix.sites.
require(path.join(root, 'extension/src/adapter.js'));
for (const f of fs.readdirSync(path.join(root, 'extension/sites')).filter(f => f.endsWith('.js'))) require(path.join(root, 'extension/sites', f));
const health = require(path.join(root, 'extension/health/checks.js'));
const specs = require(path.join(root, 'extension/health/specs.js'));
const sites = globalThis.NYTFix.sites;

// No user-agent of its own: Node's ("node") says it's a script, as it is. Never a browser's.
const HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};

async function get(url, { parse = true } = {}) {
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(25000) });
    const text = await res.text();
    if (!parse) return { ok: true, status: res.status, url: res.url, text };
    const doc = new JSDOM(text, { url: res.url, virtualConsole: new VirtualConsole() }).window.document;
    return { ok: true, status: res.status, url: res.url, html: text, doc };
  } catch (e) {
    return { ok: false, error: e.cause?.code || e.name || e.message };
  }
}

async function checkSite(id, spec) {
  const site = sites[id];
  if (!site) return { results: [{ check: 'adapter', status: 'fail', detail: `no adapter named ${id}` }], samples: [] };
  const home = await get(spec.home);
  const { results, samples } = health.checkHome(site, home);
  // Up to perSite usable samples; a sample that can't be loaded (404, refused) is passed over,
  // up to MAX_TRIES in all.
  const perSample = [];
  let tried = 0, lastProblem = null;
  for (const url of samples) {
    if (perSample.length >= perSite || tried >= MAX_TRIES) break;
    tried++;
    const page = await get(url);
    const problem = health.unusable(page);
    if (problem) { lastProblem = `${problem} (${url})`; continue; }
    const sampleResults = health.checkArticle(site, spec, page);
    for (const { marker, url: src } of health.markerScripts(spec, page)) {
      const script = src ? await get(src, { parse: false }) : null;
      sampleResults.push(...health.checkScript(marker, script));
    }
    perSample.push({ sample: url, results: sampleResults });
  }
  if (samples.length && !perSample.length) results.push({ check: 'article page', status: 'skip', detail: `no sample could be loaded; last: ${lastProblem}` });
  results.push(...health.combine(perSample));
  return { results, samples: perSample.map(s => s.sample) };
}

const report = {};
let failed = false;
for (const [id, spec] of Object.entries(specs)) {
  if (only && !only.includes(id)) continue;
  const { results, samples } = await checkSite(id, spec);
  const state = health.overall(results);
  if (state === 'fail') failed = true;
  report[id] = { state, samples, results };
  console.log(`${state.toUpperCase().padEnd(4)} ${id}${samples.length ? `  (${samples.length} sample${samples.length > 1 ? 's' : ''})` : ''}`);
  for (const r of results) console.log(`     ${r.status.padEnd(4)} ${r.check}: ${r.detail}`);
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ at: new Date().toISOString(), report }, null, 2));
process.exitCode = failed ? 1 : 0;
