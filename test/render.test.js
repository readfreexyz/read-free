const test = require('node:test');
const assert = require('node:assert/strict');
const render = require('../extension/src/render.js');
const nyt = require('../extension/sites/nyt.js');
const { parse, livePageHtml } = require('./fixtures.js');

const SNAPSHOT_URL = 'https://archive.ph/20261114050535/https://www.nytimes.com/2026/11/14/world/x.html';
const blocks = [
  { type: 'paragraph', text: 'Snapshot paragraph one.' },
  { type: 'heading', text: 'A subheading' },
  { type: 'paragraph', text: 'Snapshot paragraph two.' },
];
const applyTo = (doc, extra = {}) =>
  render.apply(doc, nyt, { blocks, snapshotUrl: SNAPSHOT_URL, snapshotTime: Date.UTC(2026, 10, 14, 5, 5, 35), ...extra });
const html = doc => doc.documentElement.classList;

test('liveStats counts article paragraphs but not captions', () => {
  const stats = render.liveStats(parse(livePageHtml({ paragraphs: 3 })), nyt);
  assert.equal(stats.paragraphs, 3);
  assert.ok(stats.chars > 300);
});

// Lifting the wall

test('liftWall takes the wall off: scrim hidden, inert and aria-hidden removed, text left alone', () => {
  const doc = parse(livePageHtml({ wall: 'paywall' }));
  const main = doc.getElementById('site-content');
  const scrim = doc.querySelector('.css-hgm7bf');
  render.liftWall(doc, nyt);
  assert.equal(main.hasAttribute('inert'), false);
  assert.equal(main.hasAttribute('aria-hidden'), false);
  const hiddenInContainer = doc.querySelectorAll('[data-testid="vi-gateway-container"] > [data-nytfix-hidden]');
  assert.deepEqual([...hiddenInContainer], [scrim], 'masthead, main and the display:contents wrappers stay visible');
  assert.ok(html(doc).contains('nytfix-active'));
  assert.equal(doc.querySelector('.nytfix-body'), null, 'no text swapped in');
  assert.equal(render.liveStats(doc, nyt).paragraphs, 3);
});

test('undoing the lift puts the wall back exactly, and asks content.css to show it', () => {
  const doc = parse(livePageHtml({ wall: 'login' }));
  const before = doc.body.innerHTML;
  render.liftWall(doc, nyt)();
  assert.equal(doc.body.innerHTML, before);
  assert.ok(!html(doc).contains('nytfix-active'));
  assert.ok(html(doc).contains('nytfix-off'));
});

test('lifting again clears nytfix-off', () => {
  const doc = parse(livePageHtml());
  render.liftWall(doc, nyt)();
  render.liftWall(doc, nyt);
  assert.ok(!html(doc).contains('nytfix-off'));
});

test('undo without putting the wall back (in-page navigation) leaves the page usable', () => {
  const doc = parse(livePageHtml({ wall: 'paywall' }));
  render.liftWall(doc, nyt)({ putBackPaywall: false });
  const main = doc.getElementById('site-content');
  assert.equal(main.hasAttribute('inert'), false);
  assert.equal(main.hasAttribute('aria-hidden'), false);
  assert.equal(doc.querySelector('[data-nytfix-hidden]'), null, 'nothing of ours stays hidden');
  assert.ok(!html(doc).contains('nytfix-off'));
});

test('keeps the wall lifted when NYT re-applies it, and stops after undo', async () => {
  const doc = parse(livePageHtml({ wall: 'paywall' }));
  const undo = render.liftWall(doc, nyt);
  const main = doc.getElementById('site-content');
  const container = doc.querySelector('[data-testid="vi-gateway-container"]');
  const tick = () => new Promise(r => setTimeout(r, 0));

  main.setAttribute('inert', '');
  const lateScrim = doc.createElement('div');
  lateScrim.style.position = 'fixed';
  container.append(lateScrim);
  await tick();
  assert.equal(main.hasAttribute('inert'), false);
  assert.ok(lateScrim.hasAttribute('data-nytfix-hidden'));

  undo();
  assert.ok(main.hasAttribute('inert'));
  assert.equal(lateScrim.hasAttribute('data-nytfix-hidden'), false);
  main.removeAttribute('inert');
  main.setAttribute('inert', '');
  await tick();
  assert.ok(main.hasAttribute('inert'), 'observers are disconnected after undo');
});

test('lifting a page with no wall changes nothing of NYT\'s', () => {
  const doc = parse(livePageHtml({ wall: null }));
  render.liftWall(doc, nyt);
  assert.equal(doc.querySelectorAll('[data-nytfix-hidden]').length, 0);
  assert.equal(doc.querySelectorAll('[inert], [aria-hidden]').length, 0);
});

test('showWall asks content.css to show NYT\'s wall as it is', () => {
  const doc = parse(livePageHtml());
  render.showWall(doc);
  assert.ok(html(doc).contains('nytfix-off'));
  assert.ok(doc.getElementById('site-content').hasAttribute('inert'));
});

// Swapping the text

test('apply hides the original nodes and inserts the snapshot text in NYT wrappers', () => {
  const doc = parse(livePageHtml());
  const section = render.liveArticleBody(doc, nyt);
  const originalCount = section.children.length;
  applyTo(doc);

  assert.equal(section.querySelectorAll(':scope > [data-nytfix-hidden]').length, originalCount);
  const body = section.querySelector(':scope > .nytfix-body');
  assert.ok(body, 'snapshot body is inside the section');
  assert.ok(body.classList.contains('StoryBodyCompanionColumn'), 'outer NYT wrapper is reused');
  assert.equal(body.getAttribute('data-nytfix-hidden'), null);
  const ps = body.querySelectorAll('div.css-53u6y8 > p.css-12m5bll.evys1bk0');
  assert.deepEqual([...ps].map(p => p.textContent), ['Snapshot paragraph one.', 'Snapshot paragraph two.']);
  assert.equal(body.querySelector('h2').textContent, 'A subheading');
});

test('apply only swaps the text: lifting the wall is liftWall\'s job', () => {
  const doc = parse(livePageHtml({ wall: 'paywall' }));
  applyTo(doc);
  assert.ok(doc.getElementById('site-content').hasAttribute('inert'));
  assert.equal(doc.querySelector('.css-hgm7bf').hasAttribute('data-nytfix-hidden'), false);
});

test('apply shows a banner above the article with the snapshot link and a restore button', () => {
  const doc = parse(livePageHtml());
  applyTo(doc);
  const banner = doc.getElementById('nytfix-banner');
  assert.equal(banner.nextElementSibling, render.liveArticleBody(doc, nyt));
  assert.equal(banner.dataset.kind, 'done');
  assert.match(banner.textContent, /archive\.today snapshot of /);
  assert.equal(banner.querySelector('a').href, SNAPSHOT_URL);
  assert.equal(banner.querySelector('button').textContent, "Show NYT's version");
});

test('the function apply returns takes the swap out again exactly', () => {
  const doc = parse(livePageHtml());
  const before = doc.body.innerHTML;
  applyTo(doc)();
  assert.equal(doc.body.innerHTML, before);
});

test("the banner's restore button hands off to onRestore", () => {
  const doc = parse(livePageHtml());
  let called = 0;
  const removeSwap = applyTo(doc, { onRestore: () => { called++; removeSwap(); } });
  doc.getElementById('nytfix-banner').querySelector('button').click();
  assert.equal(called, 1);
  assert.equal(doc.querySelector('.nytfix-body'), null);
  assert.equal(doc.querySelector('[data-nytfix-hidden]'), null);
});

const OTHER_ARTICLE = 'https://www.nytimes.com/2026/01/01/world/other.html';

test("links and emphasis are rebuilt as real elements, using NYT's own link class", () => {
  const doc = parse(livePageHtml());
  const nytLink = doc.createElement('a');
  nytLink.className = 'css-yywogo';
  nytLink.href = 'https://www.nytimes.com/';
  doc.querySelector('.css-53u6y8 p').append(nytLink);
  applyTo(doc, {
    blocks: [{
      type: 'paragraph',
      text: 'See the report and more.',
      inlines: [{ text: 'See ' }, { text: 'the report', href: OTHER_ARTICLE }, { text: ' and ' }, { text: 'more', em: true }, { text: '.' }],
    }],
  });
  const p = doc.querySelector('.nytfix-body p');
  assert.equal(p.textContent, 'See the report and more.');
  const a = p.querySelector('a');
  assert.equal(a.href, OTHER_ARTICLE);
  assert.equal(a.className, 'css-yywogo');
  assert.equal(a.textContent, 'the report');
  assert.equal(p.querySelector('em').textContent, 'more');
});

test('a link that runs across emphasis stays one link', () => {
  const doc = parse(livePageHtml());
  applyTo(doc, {
    blocks: [{ type: 'paragraph', text: 'Read the whole story.', inlines: [{ text: 'Read ' }, { text: 'the ', href: OTHER_ARTICLE }, { text: 'whole', href: OTHER_ARTICLE, em: true }, { text: ' story', href: OTHER_ARTICLE }, { text: '.' }] }],
  });
  const links = doc.querySelectorAll('.nytfix-body a');
  assert.equal(links.length, 1);
  assert.equal(links[0].textContent, 'the whole story');
  assert.equal(links[0].querySelector('em').textContent, 'whole');
});

test('photos become figures with a lazy-loading image and their caption', () => {
  const doc = parse(livePageHtml());
  applyTo(doc, { blocks: [{ type: 'figure', src: 'https://static01.nyt.com/images/photo.jpg', alt: 'A photo', caption: 'A caption. Photographer' }] });
  const figure = doc.querySelector('.nytfix-body figure.nytfix-figure');
  const img = figure.querySelector('img');
  assert.equal(img.src, 'https://static01.nyt.com/images/photo.jpg');
  assert.equal(img.alt, 'A photo');
  assert.equal(img.getAttribute('loading'), 'lazy');
  assert.equal(img.hasAttribute('srcset'), false, 'no sharper copy known');
  assert.equal(figure.querySelector('figcaption').textContent, 'A caption. Photographer');
});

test('a sharper copy of a photo goes in srcset for 2x screens, and is dropped if it fails to load', () => {
  const doc = parse(livePageHtml());
  const src = 'https://static01.nyt.com/images/photo-articleLarge.jpg';
  const hires = 'https://static01.nyt.com/images/photo-superJumbo.jpg';
  applyTo(doc, { blocks: [{ type: 'figure', src, hires, alt: '', caption: '' }] });
  const img = doc.querySelector('.nytfix-body img');
  assert.equal(img.getAttribute('srcset'), `${src} 1x, ${hires} 2x`);
  assert.equal(img.src, src);
  img.dispatchEvent(new doc.defaultView.Event('error'));
  assert.equal(img.hasAttribute('srcset'), false);
  assert.equal(img.src, src);
});

test('an unsafe sharper copy is ignored; the photo keeps its own address', () => {
  const doc = parse(livePageHtml());
  applyTo(doc, { blocks: [
    { type: 'figure', src: 'https://static01.nyt.com/a.jpg', hires: 'http://insecure.example/a.jpg', alt: '', caption: '' },
    { type: 'figure', src: 'https://static01.nyt.com/b.jpg', hires: 'https://static01.nyt.com/b.jpg 3x, https://evil.example/x.jpg', alt: '', caption: '' },
  ] });
  for (const img of doc.querySelectorAll('.nytfix-body img')) assert.equal(img.hasAttribute('srcset'), false, img.src);
});

test('unsafe links and image addresses are dropped; the text stays', () => {
  const doc = parse(livePageHtml());
  applyTo(doc, {
    blocks: [
      { type: 'paragraph', text: 'Click me now.', inlines: [{ text: 'Click ' }, { text: 'me', href: 'javascript:alert(1)' }, { text: ' now.' }] },
      { type: 'figure', src: 'javascript:alert(1)', alt: '', caption: 'x' },
      { type: 'figure', src: 'http://insecure.example/photo.jpg', alt: '', caption: 'y' },
    ],
  });
  const body = doc.querySelector('.nytfix-body');
  assert.equal(body.querySelector('a'), null);
  assert.equal(body.querySelector('figure'), null);
  assert.equal(body.querySelector('p').textContent, 'Click me now.');
});

test('snapshot text is inserted as text, never as HTML', () => {
  const doc = parse(livePageHtml());
  render.apply(doc, nyt, {
    blocks: [{ type: 'paragraph', text: '<img src=x onerror="alert(1)"> hello' }],
    snapshotUrl: SNAPSHOT_URL,
    snapshotTime: Date.now(),
  });
  const body = doc.querySelector('.nytfix-body');
  assert.equal(body.querySelector('img'), null);
  assert.match(body.textContent, /<img src=x/);
});

test('without an articleBody section, uses the fallback container in article#story', () => {
  const doc = parse(livePageHtml({ section: false }));
  applyTo(doc);
  const body = doc.querySelector('article#story > .nytfix-body.nytfix-fallback');
  assert.ok(body);
  assert.equal(body.querySelectorAll('p').length, 2);
  assert.ok(doc.getElementById('nytfix-banner'));
});

// The loading placeholder where NYT's text ends

const upsell = doc => doc.querySelector('.css-upsell');
const placeholderBox = doc => doc.querySelector('.nytfix-loading');

test("NYT's subscription line is found inside or after the article body, and isn't counted as text", () => {
  for (const where of ['inside', 'after']) {
    const doc = parse(livePageHtml({ upsell: where }));
    assert.deepEqual(render.upsellLines(doc, nyt), [upsell(doc)], where);
    assert.equal(render.liveStats(doc, nyt).paragraphs, 3, where);
  }
  assert.deepEqual(render.upsellLines(parse(livePageHtml()), nyt), []);
});

test("the loading placeholder takes the place of NYT's subscription line", () => {
  const doc = parse(livePageHtml({ upsell: 'inside' }));
  render.showLoadingPlaceholder(doc, nyt);
  const box = placeholderBox(doc);
  assert.equal(box.parentElement.nextElementSibling, upsell(doc));
  assert.ok(upsell(doc).hasAttribute('data-nytfix-hidden'));
  assert.equal(box.getAttribute('role'), 'status');
  assert.match(box.textContent, /Loading the rest of this article from archive\.today/);
  assert.ok(box.querySelector('.nytfix-spinner'));
});

test('without a subscription line, the placeholder goes right after the last paragraph', () => {
  const doc = parse(livePageHtml());
  render.showLoadingPlaceholder(doc, nyt);
  assert.equal(placeholderBox(doc).parentElement.previousElementSibling.textContent.startsWith('Live paragraph 3.'), true);
});

test("the placeholder sits in a row with the site's paragraph class, so it lines up with the text column", () => {
  const doc = parse(livePageHtml({ paragraphs: 3 }));
  render.showLoadingPlaceholder(doc, nyt);
  const row = placeholderBox(doc).parentElement;
  assert.equal(row.tagName, 'DIV', 'not a <p>, so never counted as article text');
  assert.deepEqual([...row.classList], ['css-12m5bll', 'evys1bk0', 'nytfix-loading-row']);
  assert.equal(render.liveStats(doc, nyt).paragraphs, 3);
});

test('a finished placeholder can offer a button', () => {
  const doc = parse(livePageHtml());
  let clicks = 0;
  render.showLoadingPlaceholder(doc, nyt).finish('error', "Couldn't load the rest of this article.", { action: { text: 'Try again', onClick: () => clicks++ } });
  const button = placeholderBox(doc).querySelector('button');
  assert.equal(button.textContent, 'Try again');
  assert.equal(button.type, 'button');
  button.click();
  assert.equal(clicks, 1);
});

test("finishing turns the placeholder into a note and brings NYT's line back", () => {
  const doc = parse(livePageHtml({ upsell: 'inside' }));
  const placeholder = render.showLoadingPlaceholder(doc, nyt);
  placeholder.finish('error', "Couldn't load the rest of this article.");
  const box = placeholderBox(doc);
  assert.equal(box.dataset.kind, 'error');
  assert.equal(box.getAttribute('role'), 'alert');
  assert.equal(box.textContent, "Couldn't load the rest of this article.");
  assert.equal(box.querySelector('.nytfix-spinner'), null);
  assert.equal(upsell(doc).hasAttribute('data-nytfix-hidden'), false);
});

test('removing the placeholder leaves the page exactly as it was', () => {
  const doc = parse(livePageHtml({ upsell: 'inside' }));
  const before = doc.body.innerHTML;
  render.showLoadingPlaceholder(doc, nyt).remove();
  assert.equal(doc.body.innerHTML, before);
});

test("the swap hides NYT's subscription line even when it sits after the article body", () => {
  const doc = parse(livePageHtml({ upsell: 'after' }));
  const removeSwap = applyTo(doc);
  assert.ok(upsell(doc).hasAttribute('data-nytfix-hidden'));
  removeSwap();
  assert.equal(upsell(doc).hasAttribute('data-nytfix-hidden'), false);
});

// FT: no article on the page, so the article is inserted after the barrier page (its headline)

const ft = require('../extension/sites/ft.js');
const { ftLivePageHtml } = require('./fixtures.js');
const ftBlocks = [1, 2, 3, 4].map(n => ({ type: 'paragraph', text: `FT placeholder paragraph ${n}.` }));

test("FT: the loading box goes right after the barrier page, which keeps FT's headline", () => {
  const doc = parse(ftLivePageHtml());
  render.showLoadingPlaceholder(doc, ft);
  const box = doc.getElementById('barrier-page').nextElementSibling;
  assert.ok(box.classList.contains('nytfix-loading'));
  assert.match(box.textContent, /^Loading this article from archive\.today/);
});

test('FT: the archived article goes after the barrier page, with the banner between them', () => {
  const doc = parse(ftLivePageHtml());
  const before = doc.body.innerHTML;
  const removeSwap = render.apply(doc, ft, { blocks: ftBlocks, snapshotUrl: SNAPSHOT_URL, snapshotTime: Date.UTC(2026, 10, 14, 12) });
  const banner = doc.getElementById('barrier-page').nextElementSibling;
  assert.equal(banner.id, 'nytfix-banner');
  assert.match(banner.textContent, /Show FT's version/);
  const body = banner.nextElementSibling;
  assert.ok(body.classList.contains('nytfix-body') && body.classList.contains('nytfix-fallback'));
  assert.equal(body.querySelectorAll('p').length, 4);
  removeSwap();
  assert.equal(doc.body.innerHTML, before);
});

test("FT: lifting changes nothing of FT's; undo asks ft.css to show the barrier page again", () => {
  const doc = parse(ftLivePageHtml());
  const before = doc.body.innerHTML;
  const undo = render.liftWall(doc, ft);
  assert.equal(doc.body.innerHTML, before);
  undo();
  assert.ok(html(doc).contains('nytfix-off'));
});

// Keeping the reader's paragraph in place across the swap

// A fake layout, since jsdom has none: paragraphs, photos and the banner stack up from `start`
// px down the page (100, 400 and 60 px tall), anything hidden takes no space, and
// scroller.scrollTop moves everything up.
function fakeLayout(doc, { start = 300 } = {}) {
  const scroller = { scrollTop: 0 };
  Object.defineProperty(doc, 'scrollingElement', { configurable: true, value: scroller });
  const HEIGHT = { P: 100, FIGURE: 400, DIV: 60 };
  const laidOut = () => [...doc.querySelectorAll('p, figure, #nytfix-banner')]
    .filter(el => !el.closest('[data-nytfix-hidden]') && !(el.tagName === 'P' && el.closest('figure')));
  doc.defaultView.Element.prototype.getBoundingClientRect = function () {
    let top = start - scroller.scrollTop;
    for (const el of laidOut()) {
      const height = HEIGHT[el.tagName];
      if (el === this) return { top, bottom: top + height, height, width: 600 };
      top += height;
    }
    return { top: 0, bottom: 0, height: 0, width: 0 };
  };
  return scroller;
}
const topOf = el => el.getBoundingClientRect().top;
const livePs = doc => [...render.liveArticleBody(doc, nyt).querySelectorAll('.css-53u6y8 > p')];
const swappedPs = doc => [...doc.querySelectorAll('.nytfix-body p')];
// The archived article: the paragraphs NYT showed, then the rest NYT cut.
const fullArticle = (doc, { before = [], more = 5 } = {}) => [
  ...before.map(text => ({ type: 'paragraph', text })),
  ...livePs(doc).map(p => ({ type: 'paragraph', text: p.textContent.trim() })),
  ...Array.from({ length: more }, (_, i) => ({ type: 'paragraph', text: `The rest of the article, part ${i + 1}.` })),
];

test('the paragraph being read stays put when the photo above it goes and the banner arrives', () => {
  const doc = parse(livePageHtml({ leadFigure: true }));
  const scroller = fakeLayout(doc);
  scroller.scrollTop = 750; // 400 px photo, then paragraph 1 half off the top, paragraph 2 at 50 px
  assert.equal(topOf(livePs(doc)[1]), 50);
  applyTo(doc, { blocks: fullArticle(doc) });
  assert.equal(topOf(swappedPs(doc)[1]), 50, 'paragraph 2 is exactly where it was');
  assert.equal(scroller.scrollTop, 410);
});

test("the paragraph is found by its words when the archived text doesn't line up by position", () => {
  const doc = parse(livePageHtml());
  const scroller = fakeLayout(doc);
  scroller.scrollTop = 400; // paragraph 2 at the top of the screen
  applyTo(doc, { blocks: fullArticle(doc, { before: ['A paragraph added at the top in an update.'] }) });
  assert.equal(topOf(swappedPs(doc)[2]), 0, "live paragraph 2 is the archive's third");
});

test('past the end of the cut-off text, the rest of the article continues right below it', () => {
  const doc = parse(livePageHtml());
  const scroller = fakeLayout(doc);
  scroller.scrollTop = 700; // all three of NYT's paragraphs scrolled past
  applyTo(doc, { blocks: fullArticle(doc) });
  const ps = swappedPs(doc);
  assert.equal(topOf(ps[2]), -200, 'the last paragraph NYT showed is where it was');
  assert.equal(topOf(ps[4]), 0, 'and the new text carries on into view');
});

test('a reader above the article text is not scrolled', () => {
  const doc = parse(livePageHtml());
  const scroller = fakeLayout(doc, { start: 900 }); // article starts below the 768 px window
  applyTo(doc, { blocks: fullArticle(doc) });
  assert.equal(scroller.scrollTop, 0);
});

// Keeping the reader's place when a wall comes off

// jsdom has no layout or scrolling, so fake both: the page content's top edge sits `offset` px
// down the page and moves up as the fake scroller scrolls.
function fakeScrolling(doc, { offset = 120 } = {}) {
  const scroller = { scrollTop: 0 };
  doc.getElementById('site-content').getBoundingClientRect = () => ({ top: offset - scroller.scrollTop });
  Object.defineProperty(doc, 'scrollingElement', { configurable: true, value: scroller });
  return scroller;
}

test('scrollAnchorTo scrolls until the content is back where it was', () => {
  const doc = parse(livePageHtml());
  const scroller = fakeScrolling(doc);
  const result = render.scrollAnchorTo(doc, nyt, 120 - 2000);
  assert.equal(scroller.scrollTop, 2000);
  assert.deepEqual(result, { target: -1880, before: 120, after: -1880, via: 'document' });
});

test('scrollAnchorTo falls back to the window when the first scroller does not move the page', () => {
  const doc = parse(livePageHtml());
  let windowScroll = 0;
  doc.getElementById('site-content').getBoundingClientRect = () => ({ top: 120 - windowScroll });
  const dud = { get scrollTop() { return 0; }, set scrollTop(v) {} };
  Object.defineProperty(doc, 'scrollingElement', { configurable: true, value: dud });
  doc.defaultView.scrollBy = ({ top }) => { windowScroll += top; };
  const result = render.scrollAnchorTo(doc, nyt, 120 - 1000);
  assert.equal(windowScroll, 1000);
  assert.equal(result.via, 'window');
});

test('scrollAnchorTo does nothing when already in place or given no position', () => {
  const doc = parse(livePageHtml());
  const scroller = fakeScrolling(doc);
  assert.equal(render.scrollAnchorTo(doc, nyt, 120).via, 'none');
  assert.equal(render.scrollAnchorTo(doc, nyt, null).via, 'none');
  assert.equal(scroller.scrollTop, 0);
});

// Banner and time helpers

test('showBanner replaces any previous banner', () => {
  const doc = parse(livePageHtml());
  render.showBanner(doc, nyt, { kind: 'loading', message: 'one' });
  render.showBanner(doc, nyt, { kind: 'error', message: 'two', links: [{ text: 'x', href: 'https://archive.ph/' }] });
  const banners = doc.querySelectorAll('#nytfix-banner');
  assert.equal(banners.length, 1);
  assert.equal(banners[0].dataset.kind, 'error');
  assert.equal(banners[0].getAttribute('role'), 'alert');
});

test('relativeTime picks minutes, hours or days', () => {
  const now = Date.UTC(2026, 10, 14, 12, 0, 0);
  assert.equal(render.relativeTime(now - 5 * 60000, now), '5 minutes ago');
  assert.equal(render.relativeTime(now - 3 * 3600000, now), '3 hours ago');
  assert.equal(render.relativeTime(now - 4 * 86400000, now), '4 days ago');
});

test('describeTime includes a relative age', () => {
  const now = Date.UTC(2026, 10, 14, 8, 5, 35);
  assert.match(render.describeTime(Date.UTC(2026, 10, 14, 5, 5, 35), now), /\(3 hours ago\)$/);
  assert.match(render.describeTime(now - 5 * 60000, now), /\(5 minutes ago\)$/);
});

// A body in several chunks (The New Yorker)

test('a body split into chunks counts every chunk, and the swap hides them all', () => {
  const newyorker = require('../extension/sites/newyorker.js');
  const { newyorkerLivePageHtml } = require('./fixtures.js');
  const doc = parse(newyorkerLivePageHtml());
  assert.equal(render.liveStats(doc, newyorker).paragraphs, 6);
  const before = doc.body.innerHTML;
  const removeSwap = render.apply(doc, newyorker, { blocks, snapshotUrl: SNAPSHOT_URL, snapshotTime: Date.now() });
  const chunks = doc.querySelectorAll('.body__inner-container');
  assert.equal(chunks[0].querySelectorAll('.nytfix-body').length, 1, 'the new text goes in the first chunk');
  assert.ok([...chunks[1].querySelectorAll('p')].every(p => p.closest('[data-nytfix-hidden]')), 'the second chunk is hidden');
  assert.equal(doc.querySelectorAll('.nytfix-body').length, 1);
  removeSwap();
  assert.equal(doc.body.innerHTML, before);
});

test("paragraphs inside the wall don't count, and a page with none takes the adapter's text template", () => {
  const spiegel = require('../extension/sites/spiegel.js');
  const { spiegelLivePageHtml } = require('./fixtures.js');
  const doc = parse(spiegelLivePageHtml({ plus: true }));
  assert.deepEqual(render.liveStats(doc, spiegel), { paragraphs: 0, chars: 0 }, "the offer block's line isn't article text");
  render.apply(doc, spiegel, { blocks, snapshotUrl: SNAPSHOT_URL, snapshotTime: Date.UTC(2026, 10, 14) });
  const p = doc.querySelector('.nytfix-body p');
  assert.ok(p.parentElement.classList.contains('RichText'), 'in the RichText wrapper');
  assert.equal(p.parentElement.parentElement.getAttribute('data-area'), 'text');
});

test("archived paragraphs inherit the body's styling when the site's paragraphs are unclassed and unwrapped", () => {
  const [theage] = require('../extension/sites/nine.js');
  const { nineLivePageHtml } = require('./fixtures.js');
  const doc = parse(nineLivePageHtml());
  render.apply(doc, theage, { blocks, snapshotUrl: SNAPSHOT_URL, snapshotTime: Date.UTC(2026, 10, 14) });
  const body = doc.querySelector('.nytfix-body');
  assert.equal(body.classList.contains('nytfix-fallback'), false);
  assert.equal(body.parentElement.className, 'sc-c502', 'inside the body block');
});

test('swapIntact: true after apply; false once the site redraws its paragraphs or drops the archived text', () => {
  const [theage] = require('../extension/sites/nine.js');
  const { nineLivePageHtml } = require('./fixtures.js');
  const doc = parse(nineLivePageHtml());
  render.apply(doc, theage, { blocks, snapshotUrl: SNAPSHOT_URL, snapshotTime: Date.UTC(2026, 10, 14) });
  assert.equal(render.swapIntact(doc, theage), true);
  const body = doc.querySelector('.sc-c502');
  body.insertAdjacentHTML('afterbegin', '<p>A paragraph the site drew again, long enough to count as one.</p>');
  assert.equal(render.swapIntact(doc, theage), false, 'its own paragraph is showing again');
  body.firstElementChild.remove();
  assert.equal(render.swapIntact(doc, theage), true);
  doc.querySelector('.nytfix-body').remove();
  assert.equal(render.swapIntact(doc, theage), false, 'the archived text is gone');
});

test("the site's CSS for its cut text stops applying to the archived text (WSJ: paragraphs after the second hidden, a fade over the end)", () => {
  const wsj = require('../extension/sites/wsj.js');
  const { wsjLivePageHtml } = require('./fixtures.js');
  const fs = require('fs');
  const path = require('path');
  const doc = parse(wsjLivePageHtml());
  const style = doc.createElement('style');
  style.textContent = `.ef4qpkp0 p:nth-of-type(n + 3) { display: none; }\n${fs.readFileSync(path.join(__dirname, '../extension/content.css'), 'utf8')}`;
  doc.head.append(style);
  const many = Array.from({ length: 6 }, (_, i) => ({ type: 'paragraph', text: `Archived paragraph ${i + 1}.` }));
  const undo = render.apply(doc, wsj, { blocks: many, snapshotUrl: SNAPSHOT_URL, snapshotTime: Date.UTC(2026, 10, 14) });
  const section = doc.querySelector('.ef4qpkp0');
  assert.ok(section.hasAttribute('data-nytfix-swapped'));
  const shown = [...section.querySelectorAll('.nytfix-body p')].map(p => doc.defaultView.getComputedStyle(p).display);
  assert.deepEqual(shown, Array(6).fill('block'));
  undo();
  assert.equal(section.hasAttribute('data-nytfix-swapped'), false);
});

test("National Post's body, invisible until its paywall script decides, shows once it holds archived text", () => {
  const nationalpost = require('../extension/sites/nationalpost.js');
  const { nationalpostLivePageHtml } = require('./fixtures.js');
  const fs = require('fs');
  const path = require('path');
  const doc = parse(nationalpostLivePageHtml({ resolved: false }));
  const style = doc.createElement('style');
  style.textContent = `html:not(.naviga-paywall-resolved) .article-content__content-group { visibility: hidden; }\n${fs.readFileSync(path.join(__dirname, '../extension/content.css'), 'utf8')}`;
  doc.head.append(style);
  render.apply(doc, nationalpost, { blocks, snapshotUrl: SNAPSHOT_URL, snapshotTime: Date.UTC(2026, 10, 14) });
  const p = doc.querySelector('.nytfix-body p');
  assert.equal(doc.defaultView.getComputedStyle(p).visibility, 'visible');
});

// Putting back what a wall deletes (site.live.keep)

// Corriere's private-browsing wall: the article, then the section around it, then the container
// around that, removed in one go.
// The header's top bar and menu, the right-hand column and the footer's content go too.
const corriereWipe = doc => {
  doc.getElementById('content-to-read').remove();
  doc.querySelector('.aside-right').remove();
  doc.querySelector('section.body-article').remove();
  for (const el of doc.querySelectorAll('#l-header > div > .container, #l-main > .wrapper > .container, #l-footer > div > .container')) el.remove();
};
const corriere = () => require('../extension/sites/corriere.js');

test('keepOnPage puts back an article removed in pieces, nested removals included, before anyone looks', async () => {
  const { corriereLivePageHtml } = require('./fixtures.js');
  const doc = parse(corriereLivePageHtml());
  const before = doc.body.innerHTML;
  const putBack = [];
  const stop = render.keepOnPage(doc, corriere().live.keep, nodes => putBack.push(...nodes.map(n => n.tagName)));
  corriereWipe(doc);
  await new Promise(r => setTimeout(r, 0)); // the MutationObserver round
  assert.equal(doc.body.innerHTML, before, 'exactly as it was: header, article, column and footer');
  assert.deepEqual(putBack, ['DIV', 'DIV', 'SECTION', 'DIV', 'DIV', 'DIV', 'DIV']);
  stop();
  corriereWipe(doc);
  await new Promise(r => setTimeout(r, 0));
  assert.equal(doc.getElementById('content-to-read'), null, 'stopped');
});

test("keepOnPage leaves the site's other changes alone: removals that don't hold the article, and moves", async () => {
  const { corriereLivePageHtml } = require('./fixtures.js');
  const doc = parse(corriereLivePageHtml());
  const stop = render.keepOnPage(doc, corriere().live.keep);
  try {
    doc.getElementById('pno-in-article-abbonato').remove(); // a slot in the article, not the article
    doc.querySelector('.bck-media-image').replaceWith(doc.createElement('iframe')); // a player taking a placeholder's place
    const summary = doc.querySelector('.summary-art');
    doc.querySelector('main h1').after(summary); // moved, still on the page
    await new Promise(r => setTimeout(r, 0));
    assert.equal(doc.getElementById('pno-in-article-abbonato'), null);
    assert.equal(doc.querySelector('.bck-media-image'), null);
    assert.equal(summary.previousElementSibling, doc.querySelector('main h1'));
  } finally {
    stop();
  }
});

test('keepOnPage puts a run back in order, removed from the last one back (NRC), from the front, or all at once', async () => {
  const page = () => parse(`<!doctype html><html><body><main><div class="vorm__article-content">${[0, 1, 2, 3, 4, 5].map(i => `<p>Paragraph ${i}.</p>`).join('')}<div class="banner"></div></div></main></body></html>`);
  const cuts = {
    'from the last one back': kids => { for (let j = kids.length - 1; j >= 1; j--) kids[j].remove(); },
    'from the front': kids => { while (kids.length > 1) kids[1].remove(); },
    'all at once': (kids, body) => { body.innerHTML = ''; },
    'every other one, then the rest': kids => { [...kids].filter((_, i) => i % 2).forEach(k => k.remove()); [...kids].slice(1).forEach(k => k.remove()); },
  };
  for (const [name, cut] of Object.entries(cuts)) {
    const doc = page();
    const body = doc.querySelector('.vorm__article-content');
    const before = body.innerHTML;
    const stop = render.keepOnPage(doc, '.vorm__article-content > *');
    cut(body.children, body);
    await new Promise(r => setTimeout(r, 0));
    assert.equal(body.innerHTML, before, name);
    stop();
  }
});

test("keepOnPage: once it has given up on a part, removing what held it later isn't undone", async () => {
  const doc = parse('<!doctype html><html><body><main><section id="s"><div id="a"><p>Kept.</p></div></section><aside id="t">Other.</aside></main></body></html>');
  const putBack = [];
  const stop = render.keepOnPage(doc, '#a', nodes => putBack.push(...nodes.map(n => n.id)), { maxPutBacks: 1 });
  try {
    doc.getElementById('a').remove();
    await new Promise(r => setTimeout(r, 0));
    doc.getElementById('a').remove(); // twice: given up
    await new Promise(r => setTimeout(r, 0));
    doc.getElementById('s').remove(); // later, on its own
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(putBack, ['a']);
    assert.equal(doc.getElementById('s'), null);
  } finally {
    stop();
  }
});

test('keepOnPage gives up on a node the site keeps removing, so the two never loop', async () => {
  const { corriereLivePageHtml } = require('./fixtures.js');
  const doc = parse(corriereLivePageHtml());
  const putBack = [];
  const stop = render.keepOnPage(doc, '#content-to-read', nodes => putBack.push(nodes.length), { maxPutBacks: 3 });
  try {
    for (let i = 0; i < 5; i++) {
      doc.getElementById('content-to-read')?.remove();
      await new Promise(r => setTimeout(r, 0));
    }
    assert.equal(putBack.length, 3);
    assert.equal(doc.getElementById('content-to-read'), null, 'left removed after 3 tries');
  } finally {
    stop();
  }
});

test("liftWall: wall.classes are added (again, if the site takes them off) and removed on undo", async () => {
  const dailymail = require('../extension/sites/dailymail.js');
  const { dailymailLivePageHtml } = require('./fixtures.js');
  const { JSDOM } = require('jsdom');
  const { window } = new JSDOM(dailymailLivePageHtml(), { url: 'https://www.dailymail.com/health/article-16292777/x.html' });
  const doc = window.document;
  const undo = render.liftWall(doc, dailymail);
  assert.ok(doc.body.classList.contains('is-paywall-processed'));
  doc.body.classList.remove('is-paywall-processed'); // the site's script puts its state back
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(doc.body.classList.contains('is-paywall-processed'), 'added again');
  undo();
  assert.equal(doc.body.classList.contains('is-paywall-processed'), false);
  assert.ok(doc.body.classList.contains('is-paywalled-article'), "the site's own classes are left as they were");
});
