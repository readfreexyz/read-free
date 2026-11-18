// Batch 6 (docs/outlet-coverage.md): ABC (Spain), El Mundo, NRC, The Independent. The fixtures
// are shaped like what was observed on 2026-11-16; only ABC's wall was seen, so the other three
// are tested on the general signs alone.
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const paywall = require('../extension/src/paywall.js');
const render = require('../extension/src/render.js');
const abces = require('../extension/sites/abces.js');
const elmundo = require('../extension/sites/elmundo.js');
const nrc = require('../extension/sites/nrc.js');
const independent = require('../extension/sites/independent.js');
const { paras, bodyText, ldScript, abcLivePageHtml, abcDeny, nrcLivePageHtml } = require('./fixtures-batch6.js');

const pageAt = (html, url) => new JSDOM(html, { url }).window.document;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function elmundoLivePageHtml({ onPage = 10, total = 10, consent = false, modal = false, clip = false } = {}) {
  return `<!doctype html><html><head>${ldScript({ isAccessibleForFree: false, articleBody: bodyText(total) })}</head>
<body${consent ? ' class="didomi-popup-open" style="overflow: hidden"' : ''}><main><article class="ue-c-article"><h1>Titular</h1>
<div class="ue-l-article__body"><div class="ue-c-article__body"${clip ? ' style="max-height: 400px; overflow: hidden"' : ''}>${paras(onPage, 'ue-c-article__paragraph').join('')}</div></div></article></main>
<div class="tp-container-inner"></div>${modal ? '<div class="tp-modal" style="position: fixed"><div class="tp-iframe-wrapper"><iframe></iframe></div></div><div class="tp-backdrop"></div>' : ''}</body></html>`;
}

function independentLivePageHtml({ paragraphs = 10, marked = true, hideFrom = null } = {}) {
  const ps = paras(paragraphs).map((p, i) => (hideFrom !== null && i >= hideFrom ? p.replace('<p>', '<p style="display: none">') : p));
  return `<!doctype html><html><head>${ldScript(marked ? { isAccessibleForFree: false } : {})}</head>
<body><div class="main-wrapper"><div class="article-premium"><article><h1>Headline</h1><div id="main">${ps.join('')}</div></article></div></div></body></html>`;
}

test('batch 6: article URLs, and what is not one', () => {
  const cases = [
    [abces, ['/espana/moncloa-guarda-grabacion-abogado-pp-reventar-campana-20261113010127-nt.html', '/summum/estilo/relojes/exquisito-reloj-bolsillo-20261115000029-nt.html'], ['/', '/espana/', '/contacto/aviso-legal.html']],
    [elmundo, ['/espana/2026/11/15/6af990c1e9cf4a301c8b4585.html', '/deportes/futbol/uefa-nations-league/2026/11/15/6af990c1e9cf4a301c8b4585.html'], ['/', '/espana.html', '/espana/2026/11/15/']],
    [nrc, ['/nieuws/2026/11/15/de-warme-band-tussen-de-vs-en-israel-staat-zwaar-onder-druk-a4941362'], ['/', '/nieuws/', '/nieuws/2026/11/15/', '/index/buitenland/']],
    [independent, ['/life-style/russell-brand-consent-prison-david-walliams-b3084543.html', '/travel/europe/spain/andalucia-jaen-guide-things-to-do-culture-b3082824.html'], ['/', '/independentpremium', '/news/uk', '/author/someone']],
  ];
  for (const [site, yes, no] of cases) {
    for (const path of yes) assert.equal(site.isArticle(path), true, `${site.id} ${path}`);
    for (const path of no) assert.equal(site.isArticle(path), false, `${site.id} ${path}`);
    assert.equal(globalThis.NYTFix.sites[site.id], site, 'registers itself');
  }
  assert.equal(independent.normalizeUrl('https://www.the-independent.com/news/x-y-b1234567.html?utm=x'), 'https://www.independent.co.uk/news/x-y-b1234567.html', 'the canonical host');
});

test('abc: the hidden paid part is a wall that just comes off; shown, no wall; deleted, archive.today', () => {
  const url = 'https://www.abc.es/espana/x-y-20261113010127-nt.html';
  assert.equal(paywall.wallType(pageAt(abcLivePageHtml(), url), abces), 'lift', 'as sent: div.paywall hidden, all the text in it');
  assert.equal(paywall.isActive(pageAt(abcLivePageHtml({ state: 'allowed' }), url), abces), false);
  assert.equal(paywall.isActive(pageAt(abcLivePageHtml({ state: 'allowed', consent: true }), url), abces), false, "the consent popup's locked <body> is no paywall");
  assert.equal(paywall.wallType(pageAt(abcLivePageHtml({ state: 'denied' }), url), abces), 'paywall', 'deleted before the extension started');
});

test("abc: the page's own script deletes the paid part; it's put back, shown, and the placeholders hidden", async () => {
  const url = 'https://www.abc.es/espana/x-y-20261113010127-nt.html';
  const doc = pageAt(abcLivePageHtml(), url);
  const putBack = [];
  const stop = render.keepOnPage(doc, abces.live.keep, nodes => putBack.push(...nodes));
  const undo = render.liftPaywall(doc, abces);
  abcDeny(doc);
  await tick();
  await tick();
  const paid = doc.querySelector('.v-d--1 div.paywall');
  assert.ok(paid, 'div.paywall is back');
  assert.equal(paid.previousElementSibling.className, 'v-d-p', 'where it was, after the first paragraph');
  assert.equal(paid.querySelectorAll('p').length, 11);
  assert.ok(doc.querySelector('.v-d--1 > p > span.paywall'), 'and the rest of the first paragraph');
  assert.deepEqual(putBack.map(n => n.className).sort(), ['paywall', 'paywall']);
  assert.ok(paid.hasAttribute('data-nytfix-reveal'), 'shown');
  assert.equal(doc.defaultView.getComputedStyle(paid).display, 'block');
  for (const el of [doc.querySelector('.c-text'), doc.querySelector('ev-engagement')]) assert.ok(el.hasAttribute('data-nytfix-hidden'), el.tagName);
  assert.equal(paywall.isActive(doc, abces), false, 'whole and showing: no wall left');
  stop();
  if (typeof undo === 'function') undo();
});

test("el mundo: whole and marked paywalled is no wall, nor is the consent popup's lock; Piano's modal comes off; a cut page goes to archive.today", () => {
  const url = 'https://www.elmundo.es/espana/2026/11/15/6af990c1e9cf4a301c8b4585.html';
  assert.equal(paywall.isActive(pageAt(elmundoLivePageHtml(), url), elmundo), false);
  assert.equal(paywall.isActive(pageAt(elmundoLivePageHtml({ consent: true }), url), elmundo), false, 'an empty .tp-container-inner and a locked <body>');
  assert.equal(paywall.wallType(pageAt(elmundoLivePageHtml({ modal: true }), url), elmundo), 'lift');
  assert.equal(paywall.wallType(pageAt(elmundoLivePageHtml({ clip: true }), url), elmundo), 'lift', 'clipped, the text all in it');
  assert.equal(paywall.wallType(pageAt(elmundoLivePageHtml({ onPage: 2 }), url), elmundo), 'paywall');
});

test('nrc: the dormant block is no wall; the hard wall over a cut page goes to archive.today, over a whole one it comes off', () => {
  const url = 'https://www.nrc.nl/nieuws/2026/11/15/x-y-a4941362';
  assert.equal(paywall.isActive(pageAt(nrcLivePageHtml(), url), nrc), false);
  assert.equal(paywall.wallType(pageAt(nrcLivePageHtml({ paragraphs: 1, hard: true }), url), nrc), 'paywall', 'as seen: one paragraph left');
  assert.equal(paywall.wallType(pageAt(nrcLivePageHtml({ hard: true }), url), nrc), 'lift', 'the text still there');
  assert.equal(paywall.wallType(pageAt(nrcLivePageHtml({ hideFrom: 3 }), url), nrc), 'lift');
  assert.equal(paywall.isActive(pageAt(nrcLivePageHtml({ paragraphs: 3 }), url), nrc), false, 'a short article with no wall: the length alone is no sign');
  assert.equal(paywall.isActive(pageAt(nrcLivePageHtml({ paragraphs: 3 }).replace('<html>', '<html style="overflow: hidden">'), url), nrc), false, 'nor locked scrolling');
  assert.equal(paywall.wallType(pageAt(nrcLivePageHtml({ paragraphs: 3, hard: true }), url), nrc), 'paywall', 'short under the hard wall, nothing put back: cut, or no way to tell');
  const kept = pageAt(nrcLivePageHtml({ paragraphs: 3, hard: true }), url);
  kept.documentElement.setAttribute('data-nytfix-kept', '');
  assert.equal(paywall.wallType(kept, nrc), 'lift', 'short, but the extension put the cut back: whole');
  const doc = pageAt(nrcLivePageHtml({ hard: true }), url);
  const undo = render.liftPaywall(doc, nrc);
  assert.ok(doc.querySelector('.paywall--hard').hasAttribute('data-nytfix-hidden'));
  const html = doc.defaultView.getComputedStyle(doc.documentElement);
  assert.deepEqual([html.position, html.overflowY], ['static', 'visible'], 'scrolling unlocked: <html> unpinned too');
  if (typeof undo === 'function') undo();
});

test('the independent: only articles marked paywalled are checked; whole is no wall; hidden text comes off', () => {
  const url = 'https://www.the-independent.com/life-style/x-y-b3084543.html';
  assert.equal(paywall.isActive(pageAt(independentLivePageHtml(), url), independent), false, '.article-premium is the wrapper, not a wall');
  assert.equal(paywall.isActive(pageAt(independentLivePageHtml({ marked: false, paragraphs: 2 }), url), independent), false, 'a short free article');
  assert.equal(paywall.wallType(pageAt(independentLivePageHtml({ hideFrom: 4 }), url), independent), 'lift');
  assert.equal(paywall.wallType(pageAt(independentLivePageHtml({ paragraphs: 3 }), url), independent), 'paywall');
});
