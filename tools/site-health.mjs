#!/usr/bin/env node
// Runs the site health checks (extension/health/checks.js) from the command line: for each
// supported site, its homepage, then sample articles, fetched signed out like a first-time
// reader. Prints one line per check: pass, fail, or skip (couldn't check: a bot check, a refusal,
// a page drawn by script). Records structure and counts only, never article text.
//
//   node tools/site-health.mjs [--only id,id] [--samples 2] [--json out.json] [--state state.json]
//
// It says it's a script (Node's own user agent), never a browser. Some outlets refuse that (NYT,
// FT, The Atlantic, WSJ and Reuters, as of November 2026), so expect skips there: look at those
// in a browser.
// For the sites that swap the text in from archive.today, it also runs the extension's extractor
// on archive.today's newest snapshot of a sample article (samples from the homepage, or the
// site's feed when the homepage refuses), a few seconds apart. A CAPTCHA or a missing snapshot
// is a skip; nothing is done to get past either.
// A site that fails is checked once more, a minute later, before it counts as failed.
// --state keeps, run to run, which sites answered and since when they haven't (checks.track), for
// the daily check (.github/workflows/site-health.yml): it then exits 1 when a site failed, or
// when one that used to answer hasn't for a week; a site that has never answered is only listed.
// Without --state, exit code 1 if any check failed. On GitHub, a summary goes to the run's page
// ($GITHUB_STEP_SUMMARY): counts and selectors only, like everything it prints.
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
const stateFile = opt('state');
const MAX_TRIES = 6;
const ARCHIVE_TRIES = 3;       // samples asked of archive.today, at most, per site
const ARCHIVE_GAP_MS = 4000;   // between archive.today requests
const RETRY_AFTER_MS = 60000;  // before a failed site is checked again
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const archive = require(path.join(root, 'extension/src/archive.js'));

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

async function get(url, { parse = true, timeoutMs = 25000 } = {}) {
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
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

// archive.today's newest snapshot of a sample, through the extractor ('swap' sites only).
async function checkArchive(id, spec, samples) {
  const site = sites[id];
  let pool = samples;
  if (!pool.length && spec.feed) {
    const feed = await get(spec.feed, { parse: false });
    pool = feed.ok && feed.status === 200 ? health.feedSamples(site, feed.text) : [];
  }
  if (!pool.length) return [{ check: 'archive snapshot', status: 'skip', detail: 'no sample article (homepage and feed gave none)' }];
  let last = null;
  for (const url of pool.slice(0, ARCHIVE_TRIES)) {
    await sleep(ARCHIVE_GAP_MS);
    const page = await get(archive.newestUrl(url), { timeoutMs: 60000 });
    last = health.checkSnapshot(site, page, url);
    if (last.status !== 'skip') return [{ ...last, detail: `${last.detail} (${url})` }];
    if (/captcha|rate-limited/.test(last.detail)) break; // asking again would only meet it again
  }
  return [last];
}

async function checkOnce(id, spec) {
  const { results, samples } = await checkSite(id, spec);
  if (spec.method === 'swap') results.push(...await checkArchive(id, spec, samples));
  return { results, samples };
}

const report = {};
let failed = false;
for (const [id, spec] of Object.entries(specs)) {
  if (only && !only.includes(id)) continue;
  let { results, samples } = await checkOnce(id, spec);
  let state = health.overall(results);
  if (state === 'fail') {
    // A bad minute on the site's side shouldn't count: once more, a minute later
    console.log(`(${id} failed; checking again in ${RETRY_AFTER_MS / 1000} s)`);
    await sleep(RETRY_AFTER_MS);
    ({ results, samples } = await checkOnce(id, spec));
    state = health.overall(results);
  }
  if (state === 'fail') failed = true;
  report[id] = { state, samples, results };
  console.log(`${state.toUpperCase().padEnd(4)} ${id}${samples.length ? `  (${samples.length} sample${samples.length > 1 ? 's' : ''})` : ''}`);
  for (const r of results) console.log(`     ${r.status.padEnd(4)} ${r.check}: ${r.detail}`);
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ at: new Date().toISOString(), report }, null, 2));

let alerts = null;
if (stateFile) {
  let previous = {};
  try { previous = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* the first run */ }
  const today = new Date().toISOString().slice(0, 10);
  const tracked = health.track(previous, report, today);
  fs.writeFileSync(stateFile, JSON.stringify(tracked.state, null, 2));
  alerts = tracked.alerts;
  console.log(`\nKept from the last run: ${previous.at ? `${Object.keys(previous.sites || {}).length} sites, as of ${previous.at}` : 'nothing (the first run)'}`);
  for (const a of tracked.alerts) console.log(`ALERT ${a.id}: ${a.why}`);
  for (const b of tracked.blind) console.log(`quiet ${b.id}: not checked since ${b.since} (an alert after ${health.BLIND_DAYS} days)`);
  if (tracked.never.length) console.log(`never answered this checker: ${tracked.never.join(', ')}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const counts = state => Object.values(report).filter(r => r.state === state).length;
    const lines = [
      `## Site health, ${today}`,
      '',
      `${counts('pass')} passed, ${counts('fail')} failed, ${counts('skip')} couldn't be checked.`,
      '',
      ...(tracked.alerts.length ? ['### Needs a look', '', ...tracked.alerts.map(a => `- **${a.id}**: ${a.why}${report[a.id]?.state === 'fail' ? `: ${report[a.id].results.filter(r => r.status === 'fail').map(r => `${r.check}: ${r.detail}`).join('; ')}` : ''}`), ''] : []),
      ...(tracked.blind.length ? ['### Not checked lately', '', ...tracked.blind.map(b => `- ${b.id}, since ${b.since}`), ''] : []),
      ...(tracked.never.length ? [`Never answered this checker: ${tracked.never.join(', ')}.`, ''] : []),
    ];
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  }
}
process.exitCode = (alerts ? alerts.length > 0 : failed) ? 1 : 0;
