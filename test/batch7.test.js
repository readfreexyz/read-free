// Batch 7 (docs/outlet-coverage.md): Haaretz, The Jerusalem Post, Ynet. The fixtures are shaped
// like what was observed on 2026-11-24 and 25.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const paywall = require('../extension/src/paywall.js');
const render = require('../extension/src/render.js');
const extract = require('../extension/src/extract.js');
const haaretz = require('../extension/sites/haaretz.js');
const jpost = require('../extension/sites/jpost.js');
const ynet = require('../extension/sites/ynet.js');
const { text, bodyText, ldScript } = require('./fixtures-batch6.js');

const pageAt = (html, url) => new JSDOM(html, { url }).window.document;
const ID = '000001a2-087a-da36-afe6-6b7af8bf0000';
const HAARETZ_URL = `https://www.haaretz.com/israel-news/2026-11-23/ty-article/.premium/some-slug/${ID}`;

const OFFER = '<div class="x12ds5z6"><div aria-hidden="true"></div><div><h4>Keep reading</h4><p>Subscribe</p><a href="https://promotion.haaretz.com/offers?x=1"><span>Offers</span></a><p data-testid="rich-text">Subscriber? <a href="https://login.haaretz.com/?x=1"><b>Log in</b></a></p></div></div>';
const SPINNER = '<div class="xwib8y2"><div data-testid="logo-loading-indicator">Loading...</div></div>';
// end: what comes after the paragraphs; middle: after the first. The JSON-LD gives the first
// paragraph alone, on cut articles and whole ones.
function haaretzHtml({ paragraphs = 1, end = '', middle = '' } = {}) {
  const ps = Array.from({ length: paragraphs }, (_, i) => `<p data-testid="rich-text" class="x13faqbe">${text(i)}</p>${i === 0 ? middle : ''}`);
  return `<!doctype html><html lang="en" dir="ltr"><head>${ldScript({ isAccessibleForFree: 'false', hasPart: { '@type': 'WebPageElement', isAccessibleForFree: 'false', cssSelector: '.article-body-wrapper' }, articleBody: text(0) })}</head>
<body><main class="article-page"><h1 data-testid="article-title">Headline</h1><section><section data-testid="article-body-wrapper" class="article-body-wrapper" style="display: contents"><div></div><div></div>${ps.join('')}${end}</section></section><section id="comments-section"><p>Subscribe to comment</p></section></main></body></html>`;
}

test('batch 7: article URLs, and what is not one', () => {
  const cases = [
    [haaretz, [
      `/israel-news/2026-11-23/ty-article/.premium/some-slug/${ID}`, `/opinion/editorial/2026-11-24/ty-article-opinion/some-slug/${ID}`,
      `/israel-news/haaretz-today/2026-11-23/ty-article/.highlight/some-slug/${ID}`, `/news/magazine/2026-11-23/ty-article-magazine/.premium/${ID}`, `/news/politics/2026-11-24/ty-article/${ID}`,
    ], ['/', '/israel-news', '/opinion', `/ty-WRITER/${ID}`, '/israel-news/2026-11-23/', `/israel-news/israel-politics/2026-09-24/ty-article-live/.premium/some-slug/${ID}`]],
    [jpost, ['/jerusalem-report/article-915129', '/israel-news/politics-and-diplomacy/article-915951', '/J-Spot/Introducing-Jpost-Premium-Plus-our-new-online-subscription-service-565988'], ['/', '/premium', '/israel-news', '/jerusalem-report/', '/israel-news/2026']],
    [ynet, ['/news/article/yokra14963006', '/article/h1oypwysn', '/sport/israelibasketball/article/bywuirmy7x'], ['/', '/plus', '/news', '/news/category/185']],
  ];
  for (const [site, yes, no] of cases) {
    for (const path of yes) assert.equal(site.isArticle(path), true, `${site.id} ${path}`);
    for (const path of no) assert.equal(site.isArticle(path), false, `${site.id} ${path}`);
    assert.equal(globalThis.NYTFix.sites[site.id], site, 'registers itself');
  }
  assert.equal(haaretz.isLive(`/israel-news/israel-politics/2026-09-24/ty-article-live/.premium/some-slug/${ID}`), true);
  assert.equal(haaretz.isLive(`/israel-news/2026-11-23/ty-article/.premium/some-slug/${ID}`), false);
  assert.equal(haaretz.normalizeUrl(`${HAARETZ_URL}?utm=x#y`), HAARETZ_URL);
  assert.equal(haaretz.normalizeUrl(`https://www.haaretz.co.il/news/politics/2026-11-24/ty-article/${ID}?x=1`), `https://www.haaretz.co.il/news/politics/2026-11-24/ty-article/${ID}`, "the Hebrew edition's articles stay its own");
});

test('haaretz: the offer after a teaser is the wall; a whole article, with an offer or not, has none', () => {
  const at = options => pageAt(haaretzHtml(options), HAARETZ_URL);
  assert.equal(paywall.wallType(at({ end: OFFER }), haaretz), 'paywall', 'as seen: one paragraph, then the offer');
  assert.equal(paywall.wallType(at({ paragraphs: 0, end: OFFER }), haaretz), 'paywall', 'no paragraph at all');
  assert.equal(paywall.isActive(at({ paragraphs: 14 }), haaretz), false, 'an article that comes whole (marked paywalled all the same)');
  assert.equal(paywall.isActive(at({ paragraphs: 14, end: OFFER }), haaretz), false, 'an offer after a whole article');
  assert.equal(paywall.isActive(at({ paragraphs: 2, middle: OFFER }), haaretz), false, 'an offer between paragraphs');
  const doc = at({ end: OFFER });
  const undo = render.liftPaywall(doc, haaretz);
  assert.ok(doc.querySelector('[data-nytfix-hidden] a[href^="https://promotion."]'), 'the offer is hidden');
  undo();
  assert.equal(doc.querySelector('[data-nytfix-hidden]'), null);
});

test("haaretz: a spinner that stays is the wall; one that goes isn't", t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const doc = pageAt(haaretzHtml({ end: SPINNER }), HAARETZ_URL);
  assert.equal(paywall.isActive(doc, haaretz), false, 'the body may still be on its way');
  t.mock.timers.tick(7900);
  assert.equal(paywall.isActive(doc, haaretz), false);
  t.mock.timers.tick(200);
  assert.equal(paywall.wallType(doc, haaretz), 'paywall', "8 s: it isn't coming");

  const subscriber = pageAt(haaretzHtml({ end: SPINNER }), HAARETZ_URL);
  assert.equal(paywall.isActive(subscriber, haaretz), false);
  const body = subscriber.querySelector(haaretz.live.body);
  body.innerHTML = pageAt(haaretzHtml({ paragraphs: 14 }), HAARETZ_URL).querySelector(haaretz.live.body).innerHTML;
  t.mock.timers.tick(20_000);
  assert.equal(paywall.isActive(subscriber, haaretz), false, 'the article came');
  assert.equal(paywall.isActive(pageAt(haaretzHtml({ paragraphs: 14, end: SPINNER }), HAARETZ_URL), haaretz), false, 'a whole article with one after it');
});

// A snapshot: no classes, <div>s for <p>s, the paragraphs in one section with no id or role, the
// teaser cards and the comments with ids.
function haaretzSnapshot({ paragraphs, end = null }) {
  const ends = { offer: '<div><div><h4>Keep reading</h4><div>Subscribe</div></div></div>', spinner: '<div><div>Loading...</div></div>' };
  const ps = Array.from({ length: paragraphs }, (_, i) => `<div style="grid-column: main-start / main-end">${text(i)}</div><div></div>`);
  const cards = Array.from({ length: 8 }, (_, i) => `<article id="000001a1-fa32-d9ff-a7b5-fbbe0f4700${i}0"><a href="https://archive.ph/o/x/https://www.haaretz.com/${i}"><div>Another story's long headline, number ${i}, that goes on for a while</div></a></article>`).join('');
  return `<!doctype html><html><body><div id="CONTENT"><div><div><div>Ticker of other headlines that is rather long, longer than forty characters</div><div>Another ticker headline that is longer than forty characters as well</div>
<main><div><header><h1>Headline</h1><div>${text(90)}</div></header><section><section><section><div></div><div></div>${ps.join('')}${end ? ends[end] : ''}</section></section>
<section id="comments-section">${Array.from({ length: 6 }, (_, i) => `<div>${text(50 + i)}</div>`).join('')}</section><section>${cards}</section></section></div></main></div></div></div></body></html>`;
}

test("haaretz: a snapshot's paragraphs, not its tickers, cards or comments; a copy of the cut page gives nothing", () => {
  const at = options => extract.extractArticle(pageAt(haaretzSnapshot(options), `https://archive.ph/20261123213950/${HAARETZ_URL}`), haaretz, { articleUrl: HAARETZ_URL });
  const whole = at({ paragraphs: 12 });
  assert.deepEqual(whole.blocks.map(b => b.text), Array.from({ length: 12 }, (_, i) => text(i)));
  assert.equal(extract.isComplete(whole, text(0).length, { paywalled: true }), true);
  for (const end of ['offer', 'spinner']) assert.equal(at({ paragraphs: 1, end }), null, end);
});

// The rest in a hidden section.section-paywall, a Subscribe button before it.
function jpostHtml({ premium = true, hidden = true, rest = 10, total = 12 } = {}) {
  const section = (from, n) => `<section itemprop="articleBody">${Array.from({ length: n }, (_, i) => `<section class="article-paragraph-wrap"><p>${text(from + i)}</p></section>`).join('')}</section>`;
  const restHtml = premium ? `<a class="btn btn-primary" href="/subscribe">Subscribe</a><section class="section-paywall${hidden ? ' hidden' : ''}">${section(2, rest)}</section>` : '';
  return `<!doctype html><html><head><style>.hidden { display: none }</style>${ldScript({ isAccessibleForFree: !premium, articleBody: bodyText(total) })}</head>
<body><main><article><h1>Headline</h1><article class="article-body article-body-width"><section class="article-info">By someone</section>${section(0, premium ? 2 : total)}${restHtml}</article></article></main><a class="btn btn-primary" href="/x">Elsewhere</a></body></html>`;
}

test('jpost: the hidden rest is shown and the Subscribe button goes; free articles and subscribers have no wall', () => {
  const url = 'https://www.jpost.com/jerusalem-report/article-915129';
  const doc = pageAt(jpostHtml(), url);
  assert.equal(paywall.wallType(doc, jpost), 'lift');
  const undo = render.liftPaywall(doc, jpost);
  assert.ok(doc.querySelector('.section-paywall').hasAttribute('data-nytfix-reveal'));
  assert.equal([...doc.querySelectorAll('[data-nytfix-hidden]')].map(el => el.textContent).join(), 'Subscribe', 'that button alone');
  undo();
  assert.equal(doc.querySelector('[data-nytfix-hidden], [data-nytfix-reveal]'), null);
  assert.equal(paywall.isActive(pageAt(jpostHtml({ premium: false }), url), jpost), false, 'free');
  assert.equal(paywall.isActive(pageAt(jpostHtml({ hidden: false }), url), jpost), false, 'a subscriber: shown');
  assert.equal(paywall.wallType(pageAt(jpostHtml({ rest: 0 }), url), jpost), 'paywall', 'not sent any more: archive.today');
});

function ynetHtml({ paragraphs = 10, total = 10, wall = true, held = false, paid = true } = {}) {
  const ps = Array.from({ length: paragraphs }, (_, i) => `<div class="text_editor_paragraph rtl"><span data-text="true">${text(i)}</span></div>`);
  const box = wall ? '<span><span><div class="paywall-wrapper"><div class="ArticlePremiumCutter" id="ynet_premium_blocked">Subscribe</div></div></span></span>' : '';
  return `<!doctype html><html dir="rtl"${held ? ' data-nytfix-held="cut"' : ''}><head>${ldScript({ isAccessibleForFree: !paid, wordCount: String(bodyText(total).split(' ').length), articleBody: bodyText(total) })}</head>
<body><main><div class="article-body"><div id="ArticleBodyComponent"><div class="public-DraftEditor-content"><div data-contents="true">${ps.join('')}${box}</div></div></div></div></main></body></html>`;
}

test('ynet: the wall over a whole article comes off; cut all the same, archive.today; none on a free one', () => {
  const url = 'https://www.ynet.co.il/news/article/yokra14963170';
  const doc = pageAt(ynetHtml({ held: true }), url);
  assert.equal(paywall.wallType(doc, ynet), 'lift');
  const undo = render.liftPaywall(doc, ynet);
  assert.ok(doc.querySelector('.paywall-wrapper[data-nytfix-hidden]'));
  undo();
  assert.equal(paywall.wallType(pageAt(ynetHtml({ paragraphs: 4, held: true }), url), ynet), 'lift', 'held, so never cut: the rest is in lists and quotes');
  assert.equal(paywall.wallType(pageAt(ynetHtml(), url), ynet), 'lift', 'not held, but all there');
  assert.equal(paywall.wallType(pageAt(ynetHtml({ paragraphs: 0 }), url), ynet), 'paywall', 'the guard missed it: the wall alone');
  assert.equal(paywall.isActive(pageAt(ynetHtml({ wall: false, paid: false }), url), ynet), false);
  assert.equal(paywall.isActive(pageAt(ynetHtml({ wall: false }), url), ynet), false, 'a subscriber: no wall');
});

test("Read Free's own boxes are in English, so left to right on right-to-left pages too", () => {
  const read = file => fs.readFileSync(path.join(__dirname, '../extension', file), 'utf8');
  assert.match(read('content.css'), /\.nytfix-banner, \.nytfix-loading \{ direction: ltr; \}/);
  assert.match(read('src/status.js'), /:host \{ all: initial; direction: ltr; \}/, "all: initial leaves direction as the page's");
});
