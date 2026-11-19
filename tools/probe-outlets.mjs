#!/usr/bin/env node
// Looks at news outlets' article pages the way a first-time, signed-out reader gets them, to see
// which have a paywall or login wall and how it works. Records structure and counts only, never
// article text.
//
//   node tools/probe-outlets.mjs <outlets.csv> <out.json> [--per-site 3] [--only domain,domain]
//
// The CSV needs "outlet" and "url" columns (a homepage, optionally with a section path such as
// https://www.abc.net.au/news). Sample articles come from Bing News RSS (site:<domain>), newest
// first. For each article it records:
// - the HTTP status, and whether a bot check answered instead of the page
// - the page's JSON-LD: article type, isAccessibleForFree, hasPart selectors, wordCount, and
//   the length of articleBody when the page includes it
// - the biggest cluster of <p> paragraphs (characters, paragraph count, where it sits) and
//   [itemprop="articleBody"]
// - mentions of paywall services (Piano, Zephr, Poool, …) and of paywall / login-wall markup
//
// A first-time reader is under every meter, so a metered site sends the whole article here too.
// What separates it from a free site is the JSON-LD flag and the paywall service.
// It says it's a script (Node's own user agent). Some outlets refuse that (NYT, FT, The
// Atlantic, WSJ and Reuters, as of November 2026): their bot check is recorded, and they're
// looked at in a browser instead.
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');

// No user-agent of its own: Node's ("node") says it's a script, as it is. Never a browser's:
// sites that refuse scripts are left unchecked here and looked at in a browser instead.
const HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};
const SKIP_PATH = /\/(video|videos|live|live-news|liveblog|podcasts?|gallery|galleries|photos?|tag|tags|topics?|author|authors|newsletters?|games?|crossword|puzzles?|interactive)(\/|$)/i;

// Paywall and login-wall services, matched against the raw HTML (script addresses, config).
const VENDORS = {
  piano: /tinypass\.com|piano\.io|\btp\.experience\b|cxense\.com/i,
  zephr: /zephr/i,
  poool: /poool/i,
  laterpay: /laterpay/i,
  pelcro: /pelcro/i,
  sophi: /sophi\.io|\bsophi\b/i,
  evolok: /evolok/i,
  arcSubs: /arc-?subs|arcxp\.com\/.*subs|ArcP\b/i,
  datawrkz: /datawrkz/i,
  pigeon: /pigeon(?:paywall)?\.js|\bpigeon\b.*paywall/i,
  // Paywalls built in-house still tend to say so in markup or config.
  paywallWord: /paywall/i,
  regwall: /reg-?wall|registration[-_ ]?wall|login[-_ ]?wall|sign-?in[-_ ]?wall/i,
};
const BOT_CHECK = /captcha|datadome|perimeterx|px-captcha|just a moment\.\.\.|cf-chl|attention required|access denied|are you a robot|incapsula|akamai.*denied/i;

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  if (head[0]) head[0] = head[0].replace(/^\uFEFF/, ''); // a byte-order mark
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, { timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: ctrl.signal });
    const body = await res.text();
    return { status: res.status, url: res.url, body };
  } catch (e) {
    return { status: 0, url, body: '', error: e.name === 'AbortError' ? `timed out after ${timeoutMs / 1000} s` : [e.message, e.cause && (e.cause.code || e.cause.message)].filter(Boolean).join(': ') };
  } finally {
    clearTimeout(timer);
  }
}

// Article addresses on this outlet from Bing News RSS, newest first.
async function sampleArticles(home, perSite) {
  const u = new URL(home);
  const domain = u.hostname.replace(/^www\./, '');
  const section = u.pathname.replace(/\/$/, '');
  const rss = await get(`https://www.bing.com/news/search?q=${encodeURIComponent(`site:${domain}`)}&format=rss`);
  const links = [...rss.body.matchAll(/<link>([^<]+)<\/link>/g)].map(m => m[1].replace(/&amp;/g, '&'));
  const out = [];
  for (const link of links) {
    let target;
    try {
      const l = new URL(link);
      target = new URL(l.searchParams.get('url') || link);
    } catch { continue; }
    const host = target.hostname.replace(/^www\./, '');
    if (host !== domain && !host.endsWith(`.${domain}`)) continue;
    if (section && !target.pathname.startsWith(section)) continue;
    if (target.pathname.length < 15 || SKIP_PATH.test(target.pathname)) continue;
    target.hash = '';
    const clean = target.href;
    if (!out.includes(clean)) out.push(clean);
    if (out.length >= perSite) break;
  }
  return { domain, section, rssStatus: rss.status, found: out };
}

const len = s => s.replace(/\s+/g, ' ').trim().length;

// Where an element sits: a short path of tags with id, itemprop, name, role and a few classes.
function describe(el, depth = 4) {
  const parts = [];
  for (let n = el; n && n.tagName && n.tagName !== 'BODY' && parts.length < depth; n = n.parentElement) {
    let p = n.tagName.toLowerCase();
    if (n.id) p += `#${n.id.slice(0, 40)}`;
    for (const attr of ['itemprop', 'name', 'role', 'data-testid']) {
      const v = n.getAttribute(attr);
      if (v) p += `[${attr}=${v.slice(0, 30)}]`;
    }
    const classes = [...n.classList].slice(0, 2).map(c => c.slice(0, 30));
    if (classes.length) p += `.${classes.join('.')}`;
    parts.unshift(p);
  }
  return parts.join(' > ');
}

function jsonLd(doc) {
  const items = [];
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent);
      for (const item of [].concat(data).flatMap(i => (i && i['@graph']) || [i])) if (item) items.push(item);
    } catch { /* not JSON */ }
  }
  const articles = items.filter(i => /Article|BlogPosting|Report/i.test([].concat(i['@type']).join(' ')));
  const a = articles[0];
  if (!a) return { types: [...new Set(items.map(i => [].concat(i['@type']).join(',')))].slice(0, 6) };
  const parts = [].concat(a.hasPart || []).filter(Boolean);
  return {
    type: [].concat(a['@type']).join(','),
    free: a.isAccessibleForFree === undefined ? null : String(a.isAccessibleForFree),
    hasPart: parts.map(p => `${p.isAccessibleForFree}:${p.cssSelector}`).slice(0, 3),
    wordCount: a.wordCount ?? null,
    articleBodyChars: typeof a.articleBody === 'string' ? len(a.articleBody) : null,
  };
}

function analyze(html, url) {
  const virtualConsole = new VirtualConsole(); // keep jsdom's CSS parse errors quiet
  const { window } = new JSDOM(html, { url, virtualConsole });
  const doc = window.document;
  // Biggest cluster of paragraphs that share a parent.
  const byParent = new Map();
  for (const p of doc.querySelectorAll('p')) {
    const chars = len(p.textContent);
    if (chars < 40) continue;
    const parent = p.parentElement;
    const entry = byParent.get(parent) || { chars: 0, paras: 0 };
    entry.chars += chars;
    entry.paras += 1;
    byParent.set(parent, entry);
  }
  let best = null;
  for (const [parent, entry] of byParent) if (!best || entry.chars > best.chars) best = { parent, ...entry };
  const allParaChars = [...byParent.values()].reduce((n, e) => n + e.chars, 0);
  const body = [...doc.querySelectorAll('[itemprop="articleBody"]')];
  const vendors = Object.entries(VENDORS).filter(([, re]) => re.test(html)).map(([name]) => name);
  const result = {
    title: doc.title ? doc.title.length : 0, // length only
    ld: jsonLd(doc),
    cluster: best ? { chars: best.chars, paras: best.paras, at: describe(best.parent) } : null,
    paraCharsAll: allParaChars,
    itempropBody: body.length ? { count: body.length, chars: body.reduce((n, el) => n + len(el.textContent), 0), at: describe(body[0], 3) } : null,
    vendors,
    paywallMarkup: doc.querySelectorAll('[class*="paywall" i], [id*="paywall" i], [class*="regwall" i], [data-paywall], [class*="piano" i], [id*="piano" i], [class*="tp-modal"], [class*="meter" i][class*="wall" i]').length,
    article: doc.querySelectorAll('article').length,
  };
  window.close();
  return result;
}

async function probeArticle(url) {
  const res = await get(url);
  const out = { url, status: res.status, finalUrl: res.url !== url ? res.url : undefined, bytes: res.body.length };
  if (res.error) return { ...out, error: res.error };
  if (res.status >= 400 || (res.body.length < 50000 && BOT_CHECK.test(res.body))) {
    out.blocked = BOT_CHECK.test(res.body) ? 'bot check' : `HTTP ${res.status}`;
    if (res.body.length < 5000) return out;
  }
  try {
    return { ...out, ...analyze(res.body, res.url || url) };
  } catch (e) {
    return { ...out, error: `parse: ${e.message}` };
  }
}

async function main() {
  const [csvPath, outPath, ...rest] = process.argv.slice(2);
  if (!csvPath || !outPath) {
    console.error('usage: node tools/probe-outlets.mjs <outlets.csv> <out.json> [--per-site 3] [--only domain,domain] [--skip domain,domain]');
    process.exit(2);
  }
  const opt = name => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : null; };
  const perSite = Number(opt('--per-site') || 3);
  const only = (opt('--only') || '').split(',').filter(Boolean);
  const skip = (opt('--skip') || '').split(',').filter(Boolean);
  const domainOf = home => new URL(home).hostname.replace(/^www\./, '');
  const outlets = parseCsv(fs.readFileSync(csvPath, 'utf8'))
    .filter(r => r.url)
    .filter(r => !only.length || only.includes(domainOf(r.url)))
    .filter(r => !skip.includes(domainOf(r.url)));

  const results = [];
  const queue = [...outlets];
  async function worker() {
    for (let outlet = queue.shift(); outlet; outlet = queue.shift()) {
      const sample = await sampleArticles(outlet.url, perSite);
      const articles = [];
      for (const url of sample.found) {
        articles.push(await probeArticle(url));
        await sleep(1000); // one page at a time per outlet
      }
      const row = { outlet: outlet.outlet, home: outlet.url, ...sample, articles };
      results.push(row);
      const a = articles.map(x => x.error ? 'ERR' : x.blocked ? 'BLOCK' : `${x.ld?.free ?? '-'}/${x.cluster?.chars ?? 0}`).join(' ');
      console.error(`${outlet.outlet.padEnd(32)} ${String(sample.found.length)} sample(s)  ${a}`);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  results.sort((a, b) => a.outlet.localeCompare(b.outlet));
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.error(`wrote ${results.length} outlets to ${outPath}`);
}

main();
