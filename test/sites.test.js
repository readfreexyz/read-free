const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const nyt = require('../extension/sites/nyt.js');
const ft = require('../extension/sites/ft.js');
const extract = require('../extension/src/extract.js');
const paywall = require('../extension/src/paywall.js');
const { LOREM, parse, ftSnapshotHtml, ftLivePageHtml } = require('./fixtures.js');

// Every adapter has the same shape.
for (const site of [nyt, ft]) {
  test(`${site.id}: has what the core needs`, () => {
    assert.equal(typeof site.name, 'string');
    assert.equal(typeof site.shortName, 'string');
    assert.ok(site.hosts.length > 0);
    for (const fn of ['isArticle', 'isLive', 'normalizeUrl']) assert.equal(typeof site[fn], 'function', fn);
    assert.ok(Array.isArray(site.snapshot.body) || typeof site.snapshot.body === 'function');
    assert.equal(globalThis.NYTFix.sites[site.id], site, 'registers itself');
  });
}

// NYT

test('nyt: articles are dated .html pages; live blogs are /live/', () => {
  assert.equal(nyt.isArticle('/2026/11/14/world/europe/student-protests.html'), true);
  assert.equal(nyt.isArticle('/2026/11/13/us/politics/some-story.html'), true);
  for (const path of ['/', '/section/world', '/live/2026/11/14/world/updates', '/interactive/2026/11/14/us/map.html', '/games/wordle/index.html']) {
    assert.equal(nyt.isArticle(path), false, path);
  }
  assert.equal(nyt.isLive('/live/2026/11/13/us/ground-stop-nationwide-flights-faa'), true);
  assert.equal(nyt.isLive('/live/'), false);
  assert.equal(nyt.isLive('/2026/11/14/world/europe/student-protests.html'), false);
});

test('nyt: normalizeUrl drops query and fragment and forces www', () => {
  assert.equal(
    nyt.normalizeUrl('https://nytimes.com/2026/11/14/world/europe/x.html?smid=nytcore-ios-share&unlocked=1#comments'),
    'https://www.nytimes.com/2026/11/14/world/europe/x.html',
  );
});

// FT

const FT_ARTICLE = 'https://www.ft.com/content/4aba8386-35cc-463b-a79c-a0c85c362c89';
const FT_SNAPSHOT = `https://archive.ph/20261114120000/${FT_ARTICLE}`;

test('ft: articles are /content/<uuid>', () => {
  assert.equal(ft.isArticle('/content/4aba8386-35cc-463b-a79c-a0c85c362c89'), true);
  for (const path of ['/', '/world', '/content/not-a-uuid', '/content/4aba8386-35cc-463b-a79c-a0c85c362c89/extra']) {
    assert.equal(ft.isArticle(path), false, path);
  }
  assert.equal(ft.isLive('/content/4aba8386-35cc-463b-a79c-a0c85c362c89'), false);
});

test('ft: normalizeUrl drops query and fragment', () => {
  assert.equal(ft.normalizeUrl(`${FT_ARTICLE}?accessToken=abc&sharetype=gift#comments`), FT_ARTICLE);
});

test("ft: the barrier page counts as a paywall; a subscriber's page has no wall", () => {
  const barrier = parse(ftLivePageHtml());
  assert.equal(paywall.wallInPage(barrier, ft), true, 'no inert needed on FT');
  assert.equal(paywall.wallType(barrier, ft), 'paywall');
  const subscriber = parse(ftLivePageHtml({ barrier: false }));
  assert.equal(paywall.isActive(subscriber, ft), false);
  assert.equal(paywall.wallType(subscriber, ft), null);
});

test('ft: extracts the body from #article-body, with links and the photo', () => {
  const article = extract.extractArticle(parse(ftSnapshotHtml({ paragraphs: 8 })), ft, { baseUrl: FT_SNAPSHOT });
  assert.equal(article.paragraphs, 8);
  assert.deepEqual(article.blocks.map(b => b.type), [...Array(4).fill('paragraph'), 'figure', ...Array(4).fill('paragraph')]);
  const [first] = article.blocks;
  assert.equal(first.text, `FT paragraph 1. ${LOREM} See a related report.`);
  assert.deepEqual(first.inlines.find(r => r.href), { text: 'a related report', href: 'https://www.ft.com/content/11111111-2222-3333-4444-555555555555' });
  assert.deepEqual(article.blocks[4], {
    type: 'figure',
    src: 'https://images.ft.com/v3/image/raw/photo.jpg',
    alt: 'An FT photo',
    caption: 'An FT photo caption. Photographer/Agency',
  });
});

test('ft: leaves out the standfirst, the Recommended box and label, and reader comments', () => {
  const texts = extract.extractArticle(parse(ftSnapshotHtml()), ft, { baseUrl: FT_SNAPSHOT }).blocks
    .filter(b => b.type !== 'figure').map(b => b.text).join('\n');
  assert.doesNotMatch(texts, /standfirst/);
  assert.doesNotMatch(texts, /Recommended|recommended FT story/);
  assert.doesNotMatch(texts, /reader comment/);
});

test("ft: an NYT-shaped snapshot isn't mistaken for an FT article, and vice versa", () => {
  assert.equal(extract.extractArticle(parse(ftSnapshotHtml()), nyt, { baseUrl: FT_SNAPSHOT }), null);
});

// The Atlantic

const atlantic = require('../extension/sites/atlantic.js');
const newyorker = require('../extension/sites/newyorker.js');
const { atlanticSnapshotHtml, atlanticLivePageHtml, newyorkerSnapshotHtml, newyorkerLivePageHtml } = require('./fixtures.js');

for (const site of [atlantic, newyorker]) {
  test(`${site.id}: has what the core needs`, () => {
    for (const fn of ['isArticle', 'isLive', 'normalizeUrl']) assert.equal(typeof site[fn], 'function', fn);
    assert.equal(typeof site.live.wall.detect, 'function');
    assert.equal(globalThis.NYTFix.sites[site.id], site);
  });
}

test('atlantic: article URLs, old and new', () => {
  assert.equal(atlantic.isArticle('/politics/2026/11/tomb-unknown-soldier-guards-meaning/689437/'), true);
  assert.equal(atlantic.isArticle('/politics/archive/2016/05/some-slug/482700/'), true);
  for (const path of ['/', '/politics/', '/newsletters/', '/magazine/2026/12/']) assert.equal(atlantic.isArticle(path), false, path);
  assert.equal(atlantic.normalizeUrl('https://www.theatlantic.com/politics/2026/11/slug/689437/?utm_source=feed#x'), 'https://www.theatlantic.com/politics/2026/11/slug/689437/');
});

test('atlantic: snapshot body without the header, author bio or "related story" links', () => {
  const article = extract.extractArticle(parse(atlanticSnapshotHtml({ paragraphs: 10 })), atlantic, { baseUrl: 'https://archive.ph/20261114/x' });
  assert.equal(article.paragraphs, 10);
  assert.deepEqual(article.blocks.map(b => b.type), [...Array(5).fill('paragraph'), 'figure', ...Array(5).fill('paragraph')]);
  assert.equal(article.blocks[5].src, 'https://cdn.theatlantic.com/photo.jpg');
  const texts = article.blocks.map(b => b.text || '').join('\n');
  assert.doesNotMatch(texts, /standfirst|author bio|related Atlantic story/);
});

test('atlantic: the wall is a cut body on an article marked paywalled', () => {
  assert.equal(paywall.wallType(parse(atlanticLivePageHtml({ cut: true })), atlantic), 'paywall');
  assert.equal(paywall.isActive(parse(atlanticLivePageHtml({ cut: false })), atlantic), false, 'a full body is no wall');
  assert.equal(paywall.isActive(parse(atlanticLivePageHtml({ cut: true, marked: false })), atlantic), false, 'a short free article is no wall');
});

// The New Yorker

test('newyorker: article URLs', () => {
  for (const path of ['/news/the-lede/some-story', '/culture/critics-notebook/some-story', '/magazine/2026/11/23/some-story']) {
    assert.equal(newyorker.isArticle(path), true, path);
  }
  for (const path of ['/', '/news', '/news/the-lede', '/magazine/2026/11/23']) assert.equal(newyorker.isArticle(path), false, path);
});

test('newyorker: snapshot body without the header, share buttons or video player', () => {
  const article = extract.extractArticle(parse(newyorkerSnapshotHtml({ paragraphs: 10 })), newyorker, { baseUrl: 'https://archive.ph/20261114/x' });
  assert.equal(article.paragraphs, 10);
  const texts = article.blocks.map(b => b.text || '').join('\n');
  assert.doesNotMatch(texts, /\bdek\b|Share options|video transcript/);
  assert.equal(article.blocks.find(b => b.type === 'figure').src, 'https://media.newyorker.com/photo.jpg');
});

test('newyorker: a filled paywall modal is a wall; with the text still on the page, lifting is enough', () => {
  assert.equal(paywall.wallType(parse(newyorkerLivePageHtml({ wall: true })), newyorker), 'login');
  assert.equal(paywall.wallType(parse(newyorkerLivePageHtml({ wall: true, paywallParagraphs: false })), newyorker), 'paywall');
  assert.equal(paywall.isActive(parse(newyorkerLivePageHtml({ wall: false })), newyorker), false, 'the empty modal on every page is no wall');
});

// Sharper photos (snapshots keep only the one size the page loaded when it was captured)

test('hiresImage: NYT swaps a named crop for -superJumbo', () => {
  const hires = nyt.snapshot.hiresImage;
  assert.equal(hires('https://static01.nyt.com/images/2026/11/11/multimedia/x-articleLarge.jpg?quality=75&auto=webp'),
    'https://static01.nyt.com/images/2026/11/11/multimedia/x-superJumbo.jpg?quality=75&auto=webp');
  assert.equal(hires('https://static01.nyt.com/images/2026/11/11/multimedia/x-mediumThreeByTwo440.jpg'), 'https://static01.nyt.com/images/2026/11/11/multimedia/x-superJumbo.jpg');
  assert.equal(hires('https://static01.nyt.com/images/2026/11/11/multimedia/x-superJumbo.jpg'), null, 'already the largest');
  assert.equal(hires('https://static01.nyt.com/images/photo.jpg'), null, 'no named crop');
  assert.equal(hires('https://example.com/x-articleLarge.jpg'), null, "not NYT's image server");
});

test("hiresImage: FT doubles the image service's width", () => {
  const hires = ft.snapshot.hiresImage;
  assert.equal(hires('https://www.ft.com/__origami/service/image/v2/images/raw/x?source=next-article&fit=scale-down&width=490&dpr=1'),
    'https://www.ft.com/__origami/service/image/v2/images/raw/x?source=next-article&fit=scale-down&width=980&dpr=1');
  assert.equal(hires('https://images.ft.com/v3/image/raw/x?dpr=1'), 'https://images.ft.com/v3/image/raw/x?dpr=2');
  assert.equal(hires('https://images.ft.com/v3/image/raw/photo.jpg'), null, 'nothing to change');
  assert.equal(hires('https://example.com/x.jpg?width=490'), null, "not FT's image service");
});

test("hiresImage: The New Yorker asks Condé Nast's image server for 2,560 px", () => {
  const hires = newyorker.snapshot.hiresImage;
  assert.equal(hires('https://media.newyorker.com/photos/abc/master/w_1280,c_limit/x.jpg'), 'https://media.newyorker.com/photos/abc/master/w_2560,c_limit/x.jpg');
  assert.equal(hires('https://media.newyorker.com/photos/abc/master/w_2560,c_limit/x.jpg'), null);
  assert.equal(hires('https://media.newyorker.com/photos/abc/master/pass/x.jpg'), null);
});

test("hiresImage: The Atlantic has none (its resize URLs are signed)", () => {
  assert.equal(atlantic.snapshot.hiresImage, undefined);
});

// Batch 1: sites that send the whole article (docs/outlet-coverage.md)

const cnn = require('../extension/sites/cnn.js');
const latimes = require('../extension/sites/latimes.js');
const newsweek = require('../extension/sites/newsweek.js');
const globeandmail = require('../extension/sites/globeandmail.js');
const thestar = require('../extension/sites/thestar.js');
const { latimesLivePageHtml, thestarLivePageHtml, newsweekLivePageHtml, cnnLivePageHtml, globeLivePageHtml } = require('./fixtures.js');
const pageAt = (html, url) => new JSDOM(html, { url }).window.document;

for (const site of [cnn, latimes, newsweek, globeandmail, thestar]) {
  test(`${site.id}: built with defineSite, registered, with a wall check`, () => {
    for (const fn of ['isArticle', 'isLive', 'normalizeUrl']) assert.equal(typeof site[fn], 'function', fn);
    assert.equal(typeof site.live.wall.detect, 'function');
    assert.equal(typeof site.live.wall.type, 'function');
    assert.equal(site.live.wall.unlockScroll, true);
    assert.equal(globalThis.NYTFix.sites[site.id], site);
  });
}

test('batch 1: article URLs, and what is not one', () => {
  const cases = [
    [cnn, ['/2026/11/13/us/new-orleans-tanker-crash', '/2016/05/01/politics/some-story/index.html'], ['/', '/us', '/2026/11/13/us/video/some-clip', '/us/live-news/some-blog']],
    [latimes, ['/politics/story/2026-11-13/what-caused-it', '/entertainment-arts/movies/story/2026-11-14/a-review', '/california/newsletter/2026-11-14/police-union'], ['/', '/politics', '/politics/story', '/newsletters']],
    [newsweek, ['/judge-blocks-ice-from-searching-immigration-lawyers-phone-12715119'], ['/', '/topic/politics', '/about-us']],
    [globeandmail, ['/canada/article-carney-wraps-up-negotiations-on-trade-deal-with-philippines/'], ['/', '/canada/', '/opinion/']],
    [thestar, ['/news/world/some-slug/article_99aff827-65aa-5a36-aedf-1cec7cf5038b.html'], ['/', '/news/world/', '/news/world/some-slug.html']],
  ];
  for (const [site, yes, no] of cases) {
    for (const path of yes) assert.equal(site.isArticle(path), true, `${site.id} ${path}`);
    for (const path of no) assert.equal(site.isArticle(path), false, `${site.id} ${path}`);
  }
  assert.equal(cnn.normalizeUrl('https://edition.cnn.com/2026/11/13/us/story?iid=x'), 'https://www.cnn.com/2026/11/13/us/story');
});

test('latimes: the metering popup is the wall; the whole text is on the page, so it just comes off', () => {
  const url = 'https://www.latimes.com/politics/story/2026-11-13/x';
  for (const layout of ['plain', 'gated', 'longform']) {
    assert.equal(paywall.wallType(pageAt(latimesLivePageHtml({ layout }), url), latimes), 'lift', layout);
  }
  assert.equal(paywall.isActive(pageAt(latimesLivePageHtml({ metered: false }), url), latimes), false);
  assert.equal(paywall.wallType(pageAt(latimesLivePageHtml({ metered: false, layout: 'gated' }), url), latimes), 'lift', 'hidden subscriber text is a wall, popup or not');
});

test('latimes: the body is the blocks holding paragraphs, not the bulleted summary', () => {
  const doc = pageAt(latimesLivePageHtml({ layout: 'longform' }), 'https://www.latimes.com/business/story/2026-11-14/x');
  const bodies = [...doc.querySelectorAll(latimes.live.body)];
  assert.equal(bodies.length, 1);
  assert.ok(bodies[0].classList.contains('subscriber-content'));
});

test('thestar: hidden .subscriber-only blocks are the wall; shown ones (a subscriber) are not', () => {
  assert.equal(paywall.wallType(pageAt(thestarLivePageHtml({ locked: true }), 'https://www.thestar.com/x/article_99aff827-65aa-5a36-aedf-1cec7cf5038b.html'), thestar), 'lift');
  assert.equal(paywall.isActive(pageAt(thestarLivePageHtml({ locked: false }), 'https://www.thestar.com/x/article_99aff827-65aa-5a36-aedf-1cec7cf5038b.html'), thestar), false);
});

test("cnn: Piano's hidden modal is no wall; shown, it is; text cut short of the JSON-LD is one too", () => {
  const url = 'https://www.cnn.com/2026/11/13/us/x';
  assert.equal(paywall.isActive(pageAt(cnnLivePageHtml(), url), cnn), false, 'every CNN article is flagged paywalled; that alone is no wall');
  assert.equal(paywall.wallType(pageAt(cnnLivePageHtml({ pianoModal: true }), url), cnn), 'lift');
  assert.equal(paywall.wallType(pageAt(cnnLivePageHtml({ onPage: 3 }), url), cnn), 'paywall', 'cut: archive.today');
});

test('newsweek: no wall without a sign of one; Piano\'s modal over the whole text comes off', () => {
  const url = 'https://www.newsweek.com/some-story-12715119';
  assert.equal(paywall.isActive(pageAt(newsweekLivePageHtml(), url), newsweek), false);
  assert.equal(paywall.wallType(pageAt(newsweekLivePageHtml({ pianoModal: true }), url), newsweek), 'lift');
  assert.equal(paywall.wallType(pageAt(newsweekLivePageHtml({ paragraphs: 2 }), url), newsweek), 'paywall', 'cut short: archive.today');
});

test('globeandmail: a paid article with its end hidden or scrolling locked is walled; a free one never', () => {
  const url = 'https://www.theglobeandmail.com/canada/article-x/';
  assert.equal(paywall.isActive(pageAt(globeLivePageHtml(), url), globeandmail), false);
  assert.equal(paywall.wallType(pageAt(globeLivePageHtml({ hideTail: true }), url), globeandmail), 'lift');
  assert.equal(paywall.wallType(pageAt(globeLivePageHtml({ lock: true }), url), globeandmail), 'lift');
  assert.equal(paywall.isActive(pageAt(globeLivePageHtml({ paid: false, lock: true }), url), globeandmail), false);
});

// Batch 2: sites that cut the text (docs/outlet-coverage.md)

const [theage, smh] = require('../extension/sites/nine.js');
const wsj = require('../extension/sites/wsj.js');
const spiegel = require('../extension/sites/spiegel.js');
const lemonde = require('../extension/sites/lemonde.js');
const {
  nineLivePageHtml, nineSnapshotHtml, wsjLivePageHtml, wsjSnapshotHtml,
  spiegelLivePageHtml, spiegelSnapshotHtml, lemondeLivePageHtml, lemondeSnapshotHtml,
} = require('./fixtures.js');
const extractWith = (html, site) => extract.extractArticle(parse(html), site, { baseUrl: 'https://archive.ph/20261114/x' });

for (const site of [theage, smh, wsj, spiegel, lemonde]) {
  test(`${site.id}: registered, with a wall check that sends cut text to archive.today`, () => {
    assert.equal(globalThis.NYTFix.sites[site.id], site);
    assert.equal(typeof site.live.wall.detect, 'function');
  });
}

test('batch 2: article URLs, and what is not one', () => {
  const cases = [
    [theage, ['/national/victoria/the-bikie-boss-20261114-p61d87.html'], ['/', '/national/victoria', '/national/victoria/the-bikie-boss.html']],
    [wsj, ['/us-news/faa-temporarily-halts-flights-across-u-s-b9b06e59', '/politics/elections/slug-8172c7e9', '/articles/some-older-story-11605000000'], ['/', '/us-news', '/news/latest-headlines']],
    [spiegel, ['/politik/slug-a-64982c32-c954-4d6b-a066-01e7d6b7141e', '/politik/old-slug-a-1234567.html'], ['/', '/politik/', '/politik/slug']],
    [lemonde, ['/en/politics/article/2026/11/14/slug_6780688_5.html', '/politique/article/2026/11/14/slug_6780700_823448.html'], ['/', '/en/politics/', '/en/live/2026/11/14/slug_1_2.html']],
  ];
  for (const [site, yes, no] of cases) {
    for (const path of yes) assert.equal(site.isArticle(path), true, `${site.id} ${path}`);
    for (const path of no) assert.equal(site.isArticle(path), false, `${site.id} ${path}`);
  }
  assert.equal(smh.normalizeUrl('https://www.smh.com.au/x-20261114-p61e3z.html?ref=rss'), 'https://www.smh.com.au/x-20261114-p61e3z.html');
  assert.equal(theage.shortName, 'The Age');
});

const at = (html, url) => new JSDOM(html, { url }).window.document;

test('nine: the active Piano prompt or a cut body is the wall; a full article without either is not', () => {
  const url = 'https://www.theage.com.au/national/x-20261114-p61d87.html';
  assert.equal(paywall.wallType(at(nineLivePageHtml(), url), theage), 'paywall');
  assert.equal(paywall.isActive(at(nineLivePageHtml({ prompt: false }), url), theage), true, 'cut, no prompt yet');
  assert.equal(paywall.isActive(at(nineLivePageHtml({ cut: false, prompt: false }), url), theage), false);
});

test("nine: the body is the div of unclassed paragraphs, in every layout; the header, standfirst, share buttons and footer are not", () => {
  const url = 'https://www.smh.com.au/sport/cricket/x-20261114-p61e5d.html';
  for (const layout of ['narrow', 'wide', 'opinion']) {
    const doc = at(nineLivePageHtml({ layout }), url);
    assert.deepEqual([...doc.querySelectorAll(theage.live.body)].map(el => el.className), ['sc-c502'], layout);
    assert.equal(paywall.wallType(doc, theage), 'paywall', layout);
  }
  const full = at(nineLivePageHtml({ cut: false, prompt: false, layout: 'opinion' }), url);
  assert.equal(paywall.isActive(full, theage), false, 'the standfirst and bio do not count as cut text');
});

test("nine: the snapshot body without the share labels or the tiles after it", () => {
  const article = extractWith(nineSnapshotHtml({ paragraphs: 12 }), theage);
  assert.equal(article.paragraphs, 12);
  assert.ok(article.blocks.every(b => b.type === 'paragraph' && /^Nine paragraph/.test(b.text)));
});

test("wsj: Piano's snippet overlay is the wall; the snapshot drops the byline bits and comments", () => {
  const url = 'https://www.wsj.com/us-news/x-b9b06e59';
  assert.equal(paywall.wallType(at(wsjLivePageHtml(), url), wsj), 'paywall');
  assert.equal(paywall.isActive(at(wsjLivePageHtml({ snippet: false, paragraphs: 30 }), url), wsj), false, 'a subscriber');
  const article = extractWith(wsjSnapshotHtml({ paragraphs: 12 }), wsj);
  assert.ok(article.blocks.every(b => /^WSJ paragraph/.test(b.text) || b.text === 'Jane Doe' || b.text === 'John Roe'), 'no "By", "and", dateline or comments');
  assert.equal(article.blocks.filter(b => /^WSJ paragraph/.test(b.text)).length, 12);
});

test('spiegel: the offer block in the body is the wall; free articles are not walled', () => {
  const url = 'https://www.spiegel.de/stil/x-a-766e3d45-154b-4fa0-a588-dd01be87331e';
  assert.equal(paywall.wallType(at(spiegelLivePageHtml({ plus: true }), url), spiegel), 'paywall');
  assert.equal(paywall.isActive(at(spiegelLivePageHtml({ plus: false }), url), spiegel), false);
  assert.equal(extractWith(spiegelSnapshotHtml({ paragraphs: 10 }), spiegel).paragraphs, 10);
});

test('lemonde: walled when the reserved part named in the JSON-LD is missing; "Read more" lines dropped', () => {
  const url = 'https://www.lemonde.fr/en/politics/article/2026/11/14/x_6780688_5.html';
  assert.equal(paywall.wallType(at(lemondeLivePageHtml({ cut: true }), url), lemonde), 'paywall');
  assert.equal(paywall.isActive(at(lemondeLivePageHtml({ cut: false }), url), lemonde), false, 'a subscriber gets the reserved part');
  assert.equal(paywall.isActive(at(lemondeLivePageHtml({ paid: false, cut: true }), url), lemonde), false, 'a free article');
  const article = extractWith(lemondeSnapshotHtml({ paragraphs: 12 }), lemonde);
  assert.equal(article.paragraphs, 12);
  assert.ok(article.blocks.every(b => /^Le Monde/.test(b.text)));
});

test("wsj: Piano's offer panel at the bottom is a wall too, and it's hidden with the rest of Piano's", () => {
  const url = 'https://www.wsj.com/business/x-6c4b043e';
  const doc = at(wsjLivePageHtml({ snippet: false, panel: true, paragraphs: 30 }), url);
  assert.equal(paywall.wallType(doc, wsj), 'paywall', 'the panel alone, over a long-enough body');
  const render = require('../extension/src/render.js');
  render.liftWall(doc, wsj);
  for (const id of ['cx-candybar', 'cx-scrim', 'cx-sign-in-reminder']) assert.ok(doc.getElementById(id).hasAttribute('data-nytfix-hidden'), id);
  assert.equal(doc.getElementById('cx-customer-nav-subscribe-btn').hasAttribute('data-nytfix-hidden'), false, "the menu's subscribe button stays");
});

test('lemonde: long reads (article#Longform, the text in section.article__content) are walled and swapped the same way', () => {
  const url = 'https://www.lemonde.fr/en/m-le-mag/article/2026/11/14/x_6780490_117.html';
  const doc = at(lemondeLivePageHtml({ longform: true }), url);
  assert.equal(paywall.wallType(doc, lemonde), 'paywall');
  const bodies = [...doc.querySelectorAll(lemonde.live.body)];
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].tagName, 'SECTION');
  assert.equal(paywall.isActive(at(lemondeLivePageHtml({ longform: true, cut: false }), url), lemonde), false);
});

// Batch 3 (docs/outlet-coverage.md)

const nationalpost = require('../extension/sites/nationalpost.js');
const corriere = require('../extension/sites/corriere.js');
const spectator = require('../extension/sites/spectator.js');
const { nationalpostLivePageHtml, nationalpostSnapshotHtml, corriereLivePageHtml, spectatorLivePageHtml } = require('./fixtures.js');

test('batch 3: article URLs, and what is not one', () => {
  const cases = [
    [nationalpost, ['/news/defence/canada-military-exercises-arctic/', '/opinion/np-view-carneys-expanded-immigration-plan/'], ['/', '/news/', '/news/canada/', '/author/jane-doe-smith/', '/category/news/world-news/']],
    [corriere, ['/esteri/26_novembre_14/italia-germania-gcap-caccia-8e63fa3b-6c0d-49ae-827c-f09199dc9xlk.shtml', '/salute/tempo-della-salute/26_novembre_14/pressione-alta-b20267dd-c3a5-4907-9e54-c77a72e5bxlk.shtml', '/notizie/cronaca/26_novembre_15/io-madre-di-3-figli-40e77b89-3f4d-4477-88d6-f80b085adxlk.shtml'], ['/', '/esteri/', '/esteri/26_novembre_14/', '/notizie/cronaca/']],
    [spectator, ['/article/will-nigel-farage-go-down-with-donald-trump/'], ['/', '/magazine/', '/writer/someone/']],
  ];
  for (const [site, yes, no] of cases) {
    for (const path of yes) assert.equal(site.isArticle(path), true, `${site.id} ${path}`);
    for (const path of no) assert.equal(site.isArticle(path), false, `${site.id} ${path}`);
  }
  assert.equal(spectator.normalizeUrl('https://www.spectator.co.uk/article/x-y/?edition=uk'), 'https://spectator.com/article/x-y/');
  assert.equal(nationalpost.normalizeUrl('https://www.nationalpost.com/news/a-b-c/?utm=x'), 'https://nationalpost.com/news/a-b-c/');
  assert.equal(corriere.normalizeUrl('https://milano.corriere.it/notizie/cronaca/x.shtml?refresh_ce'), 'https://milano.corriere.it/notizie/cronaca/x.shtml', 'the edition kept');
  assert.ok(corriere.hosts.includes('*.corriere.it'));
});

test('nationalpost: a trimmed body is a paywall (archive.today); a whole one is no wall', () => {
  const url = 'https://nationalpost.com/news/defence/canada-military-exercises-arctic/';
  assert.equal(paywall.wallType(pageAt(nationalpostLivePageHtml(), url), nationalpost), 'paywall');
  assert.equal(paywall.isActive(pageAt(nationalpostLivePageHtml({ trimmed: false }), url), nationalpost), false);
});

test('nationalpost: the snapshot without the video player in the middle or the ad line', () => {
  const article = extractWith(nationalpostSnapshotHtml({ paragraphs: 12 }), nationalpost);
  assert.equal(article.paragraphs, 12);
  assert.ok(article.blocks.every(b => /^NP (more )?paragraph/.test(b.text)), article.blocks.map(b => b.text.slice(0, 30)).join(' | '));
});

test("corriere: the whole article on the page, so no wall until Piano's modal shows, and then it just comes off", () => {
  const url = 'https://www.corriere.it/esteri/26_novembre_14/x-8e63fa3b-6c0d-49ae-827c-f09199dc9xlk.shtml';
  assert.equal(paywall.isActive(pageAt(corriereLivePageHtml(), url), corriere), false, 'flagged paywalled, but all there');
  assert.equal(paywall.isActive(pageAt(corriereLivePageHtml({ consent: true }), url), corriere), false, "the consent wall's pinned <body> is no paywall");
  assert.equal(paywall.wallType(pageAt(corriereLivePageHtml({ pianoModal: true }), url), corriere), 'lift');
  assert.equal(paywall.wallType(pageAt(corriereLivePageHtml({ onPage: 2 }), url), corriere), 'paywall', 'cut short of the JSON-LD: archive.today');
  assert.equal(pageAt(corriereLivePageHtml(), url).querySelectorAll(corriere.live.body).length, 6, 'the text blocks, not the photo or summary');
  const held = pageAt(corriereLivePageHtml(), url);
  held.documentElement.setAttribute('data-nytfix-held', 'pno_abc_test:init');
  assert.equal(paywall.wallType(held, corriere), 'lift', 'its wall event held back: the text all there');
});

test('spectator: the paid part hidden is a wall that just comes off; missing, archive.today fills in', () => {
  const url = 'https://spectator.com/article/x-y/';
  assert.equal(paywall.isActive(pageAt(spectatorLivePageHtml(), url), spectator), false);
  assert.equal(paywall.wallType(pageAt(spectatorLivePageHtml({ paid: 'hidden' }), url), spectator), 'lift');
  assert.equal(paywall.isActive(pageAt(spectatorLivePageHtml({ lock: true }), url), spectator), false, 'a consent dialog locking scrolling is no wall');
  assert.equal(paywall.wallType(pageAt(spectatorLivePageHtml({ paid: 'missing' }), url), spectator), 'paywall');
  assert.equal(paywall.wallType(pageAt(spectatorLivePageHtml({ clip: true }), url), spectator), 'lift', 'the magazine wall: the body clipped, the text all in it');
});

// Batch 4 (docs/outlet-coverage.md)

const reuters = require('../extension/sites/reuters.js');
const lalibre = require('../extension/sites/lalibre.js');
const { reutersLivePageHtml, lalibreLivePageHtml, lalibrePianoOffer } = require('./fixtures.js');

test('batch 4: article URLs, and what is not one', () => {
  const cases = [
    [reuters, ['/world/us/battle-young-male-voters-intensifies-2026-11-15/', '/business/musk-says-nvidia-will-lose-critical-deals-2026-11-14/', '/legal/government/binance-targets-2026-11-14/'], ['/', '/world/', '/world/us/', '/markets/companies/AAPL.O/']],
    [lalibre, ['/economie/entreprises-startup/2026/11/14/meta-ecope-dune-tres-lourde-amende-NZWTWPRU3JHINEJZR6Y4RT4E6I/'], ['/', '/economie/', '/economie/2026/11/14/']],
  ];
  for (const [site, yes, no] of cases) {
    for (const path of yes) assert.equal(site.isArticle(path), true, `${site.id} ${path}`);
    for (const path of no) assert.equal(site.isArticle(path), false, `${site.id} ${path}`);
  }
});

test("reuters: the paywall modal over the whole article just comes off; no modal, no wall (short bulletins included)", () => {
  const url = 'https://www.reuters.com/world/us/x-2026-11-15/';
  assert.equal(paywall.wallType(pageAt(reutersLivePageHtml({ modal: true }), url), reuters), 'lift');
  assert.equal(paywall.wallType(pageAt(reutersLivePageHtml({ modal: true, restricted: true }), url), reuters), 'lift');
  // The user's saved page: the modal gone, the layout still cropped.
  assert.equal(paywall.wallType(pageAt(reutersLivePageHtml({ restricted: true }), url), reuters), 'lift');
  assert.equal(paywall.isActive(pageAt(reutersLivePageHtml(), url), reuters), false);
  assert.equal(paywall.isActive(pageAt(reutersLivePageHtml({ paragraphs: 2 }), url), reuters), false, 'a 2-paragraph bulletin is not cut');
});

test('lalibre: the hidden rest of a paid article is the wall; free articles and subscribers are left alone', () => {
  const url = 'https://www.lalibre.be/economie/2026/11/14/x-NZWTWPRU3JHINEJZR6Y4RT4E6I/';
  assert.equal(paywall.wallType(pageAt(lalibreLivePageHtml(), url), lalibre), 'lift');
  // Most paid articles are "PAYING" (19 of 21 on the front page), the rest "MEMBER".
  assert.equal(paywall.wallType(pageAt(lalibreLivePageHtml({ type: 'PAYING' }), url), lalibre), 'lift');
  assert.equal(paywall.isActive(pageAt(lalibreLivePageHtml({ type: 'FREE' }), url), lalibre), false);
  assert.equal(paywall.isActive(pageAt(lalibreLivePageHtml({ subscriber: true }), url), lalibre), false);
  const wiped = pageAt(lalibreLivePageHtml(), url);
  lalibrePianoOffer(wiped);
  assert.equal(paywall.wallType(wiped, lalibre), 'paywall', 'wiped before the extension started: archive.today');
});

const dailymail = require('../extension/sites/dailymail.js');
const usatoday = require('../extension/sites/usatoday.js');
const { dailymailLivePageHtml, usatodayLivePageHtml } = require('./fixtures.js');

test('batch 5: article URLs, and what is not one', () => {
  const cases = [
    [dailymail, ['/health/article-16292777/banish-midlife-wrinkles-red-light-expert-guide-led-mask.html', '/lifestyle/fitness-wellbeing/article-16294119/memory-lapse-fall-dementia-condition-vitamin-fix.html', '/tvshowbiz/article-16293149/David-Walliams-ex-Lara-Stone-teenage-fan-mansion-KATIE-HIND.html'], ['/', '/home/index.html', '/mailplus/index.html', '/health/index.html']],
    [usatoday, ['/story/news/politics/elections/2026/11/15/demomatic-women-veterans-congress/92676928007/', '/story/sports/ncaaf/2026/11/15/college-football-flop-10-missouri-lincoln-riley-usc-michigan/92784026007/'], ['/', '/news/', '/sports/ncaaf/', '/story/news/']],
  ];
  for (const [site, yes, no] of cases) {
    for (const path of yes) assert.equal(site.isArticle(path), true, `${site.id} ${path}`);
    for (const path of no) assert.equal(site.isArticle(path), false, `${site.id} ${path}`);
  }
});

test('dailymail: a Mail+ article hidden by the site\'s CSS is a wall that comes off; free and processed pages are left alone', () => {
  const url = 'https://www.dailymail.com/health/article-16292777/x.html';
  assert.equal(paywall.wallType(pageAt(dailymailLivePageHtml(), url), dailymail), 'lift');
  assert.equal(paywall.isActive(pageAt(dailymailLivePageHtml({ plus: false }), url), dailymail), false);
  assert.equal(paywall.isActive(pageAt(dailymailLivePageHtml({ subscriber: true }), url), dailymail), false);
});

test('usatoday: a free story is no wall (the ad-blocker popup is handled by notices.js)', () => {
  const url = 'https://www.usatoday.com/story/news/politics/2026/11/15/x/92676928007/';
  assert.equal(paywall.isActive(pageAt(usatodayLivePageHtml(), url), usatoday), false);
});
