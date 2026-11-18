const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const adapter = require('../extension/src/adapter.js');
const { LOREM } = require('./fixtures.js');

const URL_ = 'https://news.example.com/2026/11/14/story';
const words = n => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
// A page with JSON-LD `ld` (an object, or a raw string) and a body of `paragraphs` texts.
function page({ ld = null, paragraphs = [], url = URL_ } = {}) {
  const script = ld === null ? '' : `<script type="application/ld+json">${typeof ld === 'string' ? ld : JSON.stringify(ld)}</script>`;
  const ps = paragraphs.map(t => `<p>${t}</p>`).join('');
  return new JSDOM(`<!doctype html><html><head>${script}</head><body><main><div class="story-body">${ps}</div></main></body></html>`, { url }).window.document;
}

test('articleLd reads the article entry, in a @graph too, with "False" or false', () => {
  const doc = page({
    ld: {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', isAccessibleForFree: true },
        {
          '@type': ['NewsArticle'],
          isAccessibleForFree: 'False',
          hasPart: [
            { '@type': 'WebPageElement', isAccessibleForFree: 'False', cssSelector: '.paywall' },
            { '@type': 'WebPageElement', isAccessibleForFree: true, cssSelector: '.teaser' },
          ],
          wordCount: '812',
        },
      ],
    },
  });
  assert.deepEqual(adapter.articleLd(doc), { paywalled: true, parts: ['.paywall'], wordCount: 812, bodyWords: null });
  assert.equal(adapter.markedPaywalled(doc), true);
});

test('articleLd: the length from articleBody, nothing for a page without an article, and bad JSON skipped', () => {
  const doc = page({ ld: { '@type': 'NewsArticle', isAccessibleForFree: true, articleBody: `  ${words(120)}  ` } });
  assert.deepEqual(adapter.articleLd(doc), { paywalled: false, parts: [], wordCount: null, bodyWords: 120 });
  assert.equal(adapter.articleLd(page({ ld: { '@type': 'Organization' } })), null);
  assert.equal(adapter.articleLd(page({ ld: '{not json' })), null);
  assert.equal(adapter.markedPaywalled(page()), false);
});

test('articleLd is read once per page, and again after in-page navigation', () => {
  const doc = page({ ld: { '@type': 'NewsArticle', isAccessibleForFree: false } });
  assert.equal(adapter.markedPaywalled(doc), true);
  doc.querySelector('script').textContent = JSON.stringify({ '@type': 'NewsArticle', isAccessibleForFree: true });
  assert.equal(adapter.markedPaywalled(doc), true, 'cached for this page');
  doc.defaultView.history.pushState({}, '', '/2026/11/15/another-story');
  assert.equal(adapter.markedPaywalled(doc), false);
});

test('bodyWords counts paragraph words in every match, hidden ones too; null without a body', () => {
  const doc = page({ paragraphs: [words(10), words(5)] });
  doc.querySelector('p').style.display = 'none';
  assert.equal(adapter.bodyWords(doc, '.story-body'), 15);
  assert.equal(adapter.bodyWords(doc, '.missing'), null);
});

test('wholeTextOnPage compares the body with the length the JSON-LD gives', () => {
  const ld = { '@type': 'NewsArticle', wordCount: 100 };
  assert.equal(adapter.wholeTextOnPage(page({ ld, paragraphs: [words(95)] }), '.story-body'), true);
  assert.equal(adapter.wholeTextOnPage(page({ ld, paragraphs: [words(40)] }), '.story-body'), false);
  assert.equal(adapter.wholeTextOnPage(page({ ld: { '@type': 'NewsArticle' }, paragraphs: [words(40)] }), '.story-body'), null, 'no length given');
  assert.equal(adapter.wholeTextOnPage(page({ ld, paragraphs: [words(95)] }), '.missing'), null, 'no body');
});

test('cutBody: marked paywalled and short', () => {
  const detect = adapter.cutBody({ body: '.story-body', maxWords: 50 });
  assert.equal(detect(page({ ld: { '@type': 'NewsArticle', isAccessibleForFree: false }, paragraphs: [words(30)] })), true);
  assert.equal(detect(page({ ld: { '@type': 'NewsArticle', isAccessibleForFree: false }, paragraphs: [words(80)] })), false, 'long enough');
  assert.equal(detect(page({ ld: { '@type': 'NewsArticle', isAccessibleForFree: true }, paragraphs: [words(30)] })), false, 'not marked');
  const noBody = adapter.cutBody({ body: '.not-rendered-yet', maxWords: 50 });
  assert.equal(noBody(page({ ld: { '@type': 'NewsArticle', isAccessibleForFree: false } })), false, 'no body yet');
});

test('textOnPage: lift when the whole text is there, archive.today otherwise or when unsure', () => {
  const type = adapter.textOnPage('.story-body');
  assert.equal(type(page({ ld: { '@type': 'NewsArticle', wordCount: 100 }, paragraphs: [words(60), words(40)] })), 'lift');
  assert.equal(type(page({ ld: { '@type': 'NewsArticle', wordCount: 100 }, paragraphs: [words(30)] })), 'paywall');
  assert.equal(type(page({ paragraphs: [words(500)] })), 'paywall', 'no length given');
  const withFloor = adapter.textOnPage('.story-body', { minWords: 400 });
  assert.equal(withFloor(page({ paragraphs: [words(500)] })), 'lift');
  assert.equal(withFloor(page({ paragraphs: [words(100)] })), 'paywall');
});

test('anyShown: a matching element with content', () => {
  const doc = page();
  const detect = adapter.anyShown(['.tp-modal', '.gate']);
  assert.equal(detect(doc), false);
  doc.body.insertAdjacentHTML('beforeend', '<div class="tp-modal"></div>');
  assert.equal(detect(doc), false, 'empty');
  doc.querySelector('.tp-modal').innerHTML = '<iframe></iframe>';
  assert.equal(detect(doc), true);
});

test('selectorsFor merges a wall\'s own selectors with its paywall services\'', () => {
  assert.deepEqual(adapter.selectorsFor({ hide: '.gate', services: ['piano', 'unknown'] }, 'hide'), ['.gate', '.tp-modal', '.tp-backdrop']);
  assert.deepEqual(adapter.selectorsFor({ services: ['zephr'] }, 'hide'), ['[data-zephr-outcome-label]']);
  assert.deepEqual(adapter.selectorsFor(null, 'hide'), []);
});

test('defineSite fills in defaults and registers the adapter', () => {
  const site = adapter.defineSite({
    id: 'example',
    name: 'Example News',
    shortName: 'Example',
    hosts: ['news.example.com', 'example.com'],
    isArticle: path => path.startsWith('/2026/'),
    live: { body: '.story-body', wall: { services: ['piano'], type: adapter.textOnPage('.story-body') } },
    snapshot: { junk: /^related$/i },
  });
  assert.equal(globalThis.NYTFix.sites.example, site);
  assert.equal(site.isLive('/live/x'), false);
  assert.equal(site.normalizeUrl('http://example.com/2026/11/14/story?utm=1#top'), 'https://news.example.com/2026/11/14/story');
  assert.equal(site.live.main, 'main');
  assert.equal(site.live.wall.unlockScroll, true);
  assert.match(site.live.wall.liftedMessage, /Example's wall/);
  assert.deepEqual(site.snapshot.body, adapter.SNAPSHOT_BODY);
  assert.deepEqual(site.snapshot.junk, /^related$/i);

  // The wall check comes from the paywall service.
  const doc = page({ paragraphs: [LOREM] });
  assert.equal(site.live.wall.detect(doc), false);
  doc.body.insertAdjacentHTML('beforeend', '<div class="tp-modal"><p>Subscribe</p></div>');
  assert.equal(site.live.wall.detect(doc), true);
});

test('defineSite keeps a wall check the adapter brings', () => {
  const detect = () => true;
  const own = adapter.defineSite({ id: 'example2', name: 'Example 2', hosts: ['two.example.com'], isArticle: () => true, live: { body: 'article', wall: { detect, services: ['piano'] } } });
  assert.equal(own.live.wall.detect, detect);
  const popup = adapter.defineSite({ id: 'example3', name: 'Example 3', hosts: ['three.example.com'], isArticle: () => true, live: { body: 'article', wall: { popup: '#gate', services: ['piano'] } } });
  assert.equal(popup.live.wall.detect, undefined, 'the popup is the check');
});

test('anyShown skips elements that are on the page but not drawn', () => {
  const doc = page();
  doc.body.insertAdjacentHTML('beforeend', '<div class="tp-modal" style="display:none"><iframe></iframe></div>');
  assert.equal(adapter.anyShown('.tp-modal')(doc), false);
  doc.querySelector('.tp-modal').style.display = '';
  assert.equal(adapter.anyShown('.tp-modal')(doc), true);
});

test('scrollLocked: overflow-y hidden on <html> or <body>, or a pinned <body>; overflow-x alone is not', () => {
  const doc = page();
  assert.equal(adapter.scrollLocked(doc), false);
  doc.documentElement.style.overflowX = 'hidden';
  assert.equal(adapter.scrollLocked(doc), false);
  doc.body.style.overflow = 'hidden';
  assert.equal(adapter.scrollLocked(doc), true);
  doc.body.style.overflow = '';
  doc.body.style.position = 'fixed';
  assert.equal(adapter.scrollLocked(doc), true);
});

test('tailHidden: the last paragraphs on the page but not drawn', () => {
  const doc = page({ paragraphs: [LOREM, LOREM, LOREM, LOREM] });
  assert.equal(adapter.tailHidden(doc, '.story-body'), false);
  doc.querySelectorAll('p')[3].style.display = 'none';
  assert.equal(adapter.tailHidden(doc, '.story-body'), true);
});

test('walledArticle: only on an article marked paywalled, with a sign of a wall', () => {
  const detect = adapter.walledArticle({ body: '.story-body', minWords: 50 });
  const ld = { '@type': 'NewsArticle', isAccessibleForFree: false };
  assert.equal(detect(page({ ld, paragraphs: [words(80)] })), false, 'whole and readable');
  assert.equal(detect(page({ ld, paragraphs: [words(30)] })), true, 'short');
  assert.equal(detect(page({ ld: { ...ld, wordCount: 200 }, paragraphs: [words(80)] })), true, 'short of the JSON-LD length');
  assert.equal(detect(page({ ld: { ...ld, wordCount: 30 }, paragraphs: [words(30)] })), false, 'a short article, all there');
  const locked = page({ ld, paragraphs: [words(80)] });
  locked.body.style.overflow = 'hidden';
  assert.equal(detect(locked), true, 'scrolling locked');
  const free = page({ ld: { '@type': 'NewsArticle', isAccessibleForFree: true }, paragraphs: [words(30)] });
  assert.equal(detect(free), false, 'not marked');
  assert.equal(adapter.anyOf(() => false, () => true)(free), true);
});
