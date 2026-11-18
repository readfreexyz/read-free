const test = require('node:test');
const assert = require('node:assert/strict');
const extract = require('../extension/src/extract.js');
const nyt = require('../extension/sites/nyt.js');
const { LOREM, parse, snapshotHtml } = require('./fixtures.js');

const SNAPSHOT = 'https://archive.ph/20261114050535/https://www.nytimes.com/2026/11/14/world/europe/test-article.html';
const extractFrom = (html, baseUrl = SNAPSHOT) => extract.extractArticle(parse(html), nyt, { baseUrl });
// A snapshot page whose article body is just `inner`.
const bodyOf = inner => `<html><body><div id="CONTENT"><section name="articleBody">${inner}</section></div></body></html>`;

test('finds the article body inside #CONTENT', () => {
  const body = extract.findArticleBody(parse(snapshotHtml()), nyt);
  assert.equal(body.tagName, 'SECTION');
  assert.equal(body.getAttribute('name'), 'articleBody');
});

test('extracts every paragraph, the photo and the subheading, in order', () => {
  const article = extractFrom(snapshotHtml({ paragraphs: 12 }));
  assert.equal(article.paragraphs, 12);
  assert.deepEqual(article.blocks.map(b => b.type), [
    ...Array(6).fill('paragraph'), 'figure', 'heading', ...Array(6).fill('paragraph'),
  ]);
  assert.equal(article.blocks[7].text, 'A subheading');
  assert.match(article.blocks[0].text, /^Paragraph 1\./);
  assert.match(article.blocks[13].text, /^Paragraph 12\./);
});

test('skips ad labels and recommended-story cards; captions stay with their photo', () => {
  const blocks = extractFrom(snapshotHtml()).blocks;
  const texts = blocks.filter(b => b.type !== 'figure').map(b => b.text).join('\n');
  assert.doesNotMatch(texts, /advertisement/i);
  assert.doesNotMatch(texts, /caption/i);
  assert.doesNotMatch(texts, /recommended story/i);
  assert.doesNotMatch(texts, /Supported by|Headline/);
  assert.match(blocks.find(b => b.type === 'figure').caption, /^A photo caption/);
});

test('keeps links, unwrapped to their original address, and emphasis, as runs of text', () => {
  const [first] = extractFrom(snapshotHtml()).blocks;
  assert.deepEqual(first.inlines, [
    { text: `Paragraph 1. ${LOREM} With an ` },
    { text: 'inline link', href: 'https://www.nytimes.com/2026/01/01/world/other.html' },
    { text: ' and ' },
    { text: 'emphasis', em: true },
    { text: '.' },
  ]);
  assert.equal(first.inlines.map(r => r.text).join(''), first.text, 'the runs add up to the text');
  assert.doesNotMatch(first.text, /\s{2,}/);
});

test("photos come through with NYT's original address, alt text and caption", () => {
  const figures = extractFrom(snapshotHtml()).blocks.filter(b => b.type === 'figure');
  assert.deepEqual(figures, [{
    type: 'figure',
    src: 'https://static01.nyt.com/images/2026/11/11/multimedia/photo.jpg',
    alt: 'A photo',
    caption: 'A photo caption that is long enough to look like a sentence of prose.',
  }]);
});

test("without NYT's address, a photo uses archive.today's copy, resolved against the snapshot", () => {
  const article = extractFrom(bodyOf(`
    <figure><img src="/Z279f/abc.webp" alt=""><figcaption><span>Caption.</span><span>Photographer</span></figcaption></figure>
    <div>One paragraph of placeholder text.</div>`));
  assert.deepEqual(article.blocks[0], { type: 'figure', src: 'https://archive.ph/Z279f/abc.webp', alt: '', caption: 'Caption. Photographer' });
});

test("a photo with no usable image is skipped, and so is one inside a card's link", () => {
  const article = extractFrom(bodyOf(`
    <figure><img src="data:image/png;base64,AAAA"><figcaption>No image</figcaption></figure>
    <a href="https://archive.ph/o/Z279f/https://www.nytimes.com/x.html"><figure><img currentsourceurl="https://static01.nyt.com/x.jpg"></figure></a>
    <div>One paragraph of placeholder text.</div>`));
  assert.deepEqual(article.blocks.map(b => b.type), ['paragraph']);
});

test("a linked thumbnail inside a figure is another story's card, not a photo of this one", () => {
  // The Atlantic's mid-article "related" lists: section > ul > li > div > figure > a > picture > img.
  const article = extractFrom(bodyOf(`
    <div>One paragraph of placeholder text.</div>
    <section><ul><li><div><figure><a href="https://archive.ph/o/Z279f/https://www.nytimes.com/x.html"><picture><img currentsourceurl="https://static01.nyt.com/x-thumbLarge.jpg"></picture></a></figure>
      <div><a href="https://archive.ph/o/Z279f/https://www.nytimes.com/x.html">A related headline</a></div></div></li></ul></section>
    <figure><img currentsourceurl="https://static01.nyt.com/y.jpg" alt="A real photo"></figure>`));
  assert.deepEqual(article.blocks.map(b => b.type), ['paragraph', 'figure']);
  assert.equal(article.blocks[1].alt, 'A real photo');
});

test("a sharper copy comes from the site adapter's hiresImage, https only", () => {
  const photo = src => bodyOf(`<figure><img currentsourceurl="${src}" alt=""></figure><div>One paragraph of placeholder text.</div>`);
  const [nytFigure] = extractFrom(photo('https://static01.nyt.com/images/2026/11/11/multimedia/x-articleLarge.jpg?quality=75&auto=webp')).blocks;
  assert.equal(nytFigure.hires, 'https://static01.nyt.com/images/2026/11/11/multimedia/x-superJumbo.jpg?quality=75&auto=webp');
  const [plain] = extractFrom(photo('https://static01.nyt.com/images/photo.jpg')).blocks;
  assert.equal('hires' in plain, false, 'no named size to swap, so no sharper copy');
  const site = { ...nyt, snapshot: { ...nyt.snapshot, hiresImage: () => 'http://insecure.example/x.jpg' } };
  const [insecure] = extract.extractArticle(parse(photo('https://static01.nyt.com/x-articleLarge.jpg')), site, { baseUrl: SNAPSHOT }).blocks;
  assert.equal('hires' in insecure, false);
});

test('links that are not http(s) keep their text but lose the link', () => {
  const [p] = extractFrom(bodyOf('<div>Click <a href="javascript:alert(1)">here</a> now.</div>')).blocks;
  assert.deepEqual(p.inlines, [{ text: 'Click here now.' }]);
});

test('archive.today styles emphasis as spans; those count as emphasis too', () => {
  const [p] = extractFrom(bodyOf('<div>An <span style="font-style: italic">italic</span> and a <span style="font-weight: 700">bold</span> word.</div>')).blocks;
  assert.deepEqual(p.inlines, [
    { text: 'An ' }, { text: 'italic', em: true }, { text: ' and a ' }, { text: 'bold', strong: true }, { text: ' word.' },
  ]);
});

test('originalUrl unwraps archive.today links and refuses anything but http(s)', () => {
  assert.equal(extract.originalUrl('https://archive.ph/o/Z279f/https://www.nytimes.com/x.html?a=1#b'), 'https://www.nytimes.com/x.html?a=1#b');
  assert.equal(extract.originalUrl('/o/Z279f/https://europa.eu/x', SNAPSHOT), 'https://europa.eu/x');
  assert.equal(extract.originalUrl('https://archive.ph/AbCdE'), 'https://archive.ph/AbCdE');
  assert.equal(extract.originalUrl('javascript:alert(1)', SNAPSHOT), null);
  assert.equal(extract.originalUrl('mailto:someone@example.com', SNAPSHOT), null);
  assert.equal(extract.originalUrl('', SNAPSHOT), null);
});

test('chars counts paragraph text only', () => {
  const article = extractFrom(snapshotHtml({ paragraphs: 4 }));
  const sum =article.blocks.filter(b => b.type === 'paragraph').reduce((n, b) => n + b.text.length, 0);
  assert.equal(article.chars, sum);
});

test('falls back to article#story when the articleBody section is missing', () => {
  const article = extractFrom(snapshotHtml({ paragraphs: 5, section: false }));
  assert.equal(article.paragraphs, 5);
});

test('isComplete needs enough paragraphs, and on a paywalled page 1.5x its text', () => {
  const article = (paragraphs, chars) => ({ blocks: [], paragraphs, chars });
  assert.equal(extract.isComplete(null, 1000, { paywalled: true }), false);
  assert.equal(extract.isComplete(article(2, 9000), 1000, { paywalled: true }), false);
  // A snapshot captured behind the paywall: barely longer than the paywalled page.
  assert.equal(extract.isComplete(article(12, 1900), 1600, { paywalled: true }), false);
  assert.equal(extract.isComplete(article(33, 7471), 1600, { paywalled: true }), true);
  // Without a paywall any real article will do; the caller compares lengths itself.
  assert.equal(extract.isComplete(article(12, 1900), 7471, { paywalled: false }), true);
});

test('returns null when the snapshot has no article at all', () => {
  assert.equal(extract.extractArticle(parse('<html><body><div id="CONTENT"><p>Not an article</p></div></body></html>'), nyt), null);
});

// Finding the body without a known marker ('auto')

const contentOf = inner => parse(`<html><body><div id="CONTENT">${inner}</div></body></html>`).getElementById('CONTENT');
const para = (n, label = 'Paragraph') => Array.from({ length: n }, (_, i) => `<div>${label} ${i + 1}. ${LOREM}</div>`).join('');

test('guessBody narrows a broad marker down to the block holding the paragraphs', () => {
  const content = contentOf(`<div id="__next"><header><div>${LOREM}</div></header><main><article><div class="x"><div id="here">${para(6)}</div></div></article></main></div>`);
  assert.equal(extract.guessBody(content).id, 'here');
});

test('guessBody picks the marked block with the most text, not comments or asides', () => {
  const content = contentOf(`<main id="content"><div>${para(5)}</div><aside>${para(4, 'Related')}</aside></main><div role="region">${para(3, 'Comment')}</div><nav>${para(8, 'Menu')}</nav>`);
  const body = extract.guessBody(content);
  assert.equal(body.parentElement.id, 'content', 'narrowed into main#content, toward its paragraphs');
  assert.match(body.textContent, /^Paragraph 1\./);
});

test('guessBody gives up below the minimum paragraph count', () => {
  assert.equal(extract.guessBody(contentOf(`<main id="content">${para(2)}</main>`)), null);
});

test("'auto' only runs when the selectors before it find nothing", () => {
  const site = { ...nyt, snapshot: { ...nyt.snapshot, body: ['[itemprop="articleBody"]', 'auto'] } };
  const marked = parse(`<html><body><div id="CONTENT"><div itemprop="articleBody">${para(3)}</div><main id="other">${para(9, 'Other')}</main></div></body></html>`);
  assert.equal(extract.findArticleBody(marked, site).getAttribute('itemprop'), 'articleBody');
  const unmarked = parse(`<html><body><div id="CONTENT"><main id="other">${para(9, 'Other')}</main></div></body></html>`);
  assert.equal(extract.findArticleBody(unmarked, site).id, 'other');
});

test('drops link-only lines and headings (pointers to other stories) and video player labels', () => {
  const html = bodyOf(`<div>${LOREM} With <a href="https://archive.ph/o/x/https://www.nytimes.com/a.html">a link</a> in it.</div>
    <div><a href="https://archive.ph/o/x/https://www.nytimes.com/b.html">Another story entirely</a></div>
    <h3><a href="https://archive.ph/o/x/https://www.nytimes.com/c.html">A headline tile</a></h3>
    <div aria-label="Video Player"><div>Video Player is loading.</div><div>${LOREM}</div></div>
    <div>Current Time 0:00</div><div>Duration 0:00</div><div>${LOREM}</div><div>${LOREM}</div>`);
  const article = extractFrom(html);
  assert.equal(article.blocks.length, 3);
  assert.ok(article.blocks.every(b => b.type === 'paragraph' && b.text.startsWith(LOREM.slice(0, 20))));
});
