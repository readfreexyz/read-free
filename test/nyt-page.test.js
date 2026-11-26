// NYT's own text, from the data it sends with the page (sites/nyt.js, articleFromPage).
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const nyt = require('../extension/sites/nyt.js');
const { livePageHtml, withData, nytData, inline, block } = require('./fixtures.js');

const PATH = '/2026/11/14/world/europe/test-article.html';
const read = (options, path = PATH) => nyt.live.fromPage(new JSDOM(withData(livePageHtml({ marks: 'parts', upsell: 'inside' }), options), { url: `https://www.nytimes.com${path}` }).window.document);

test('every paragraph, in order, and nothing of the header, the ad slots or related links', () => {
  const article = read({ blocks: [{ __typename: 'RelatedLinksBlock', related: [{ __typename: 'Article', headline: 'Other' }] }, { __typename: 'RuleBlock' }, block('PullquoteBlock', block('ParagraphBlock', inline('Said twice.')))] });
  assert.equal(article.paragraphs, 14);
  assert.deepEqual(article.blocks.map(b => b.type), Array(14).fill('paragraph'));
  assert.match(article.blocks[0].text, /^Page paragraph 1\. /);
  assert.match(article.blocks[13].text, /^Page paragraph 14\. /);
  assert.equal(article.left, 0);
  assert.equal(article.chars, article.blocks.reduce((n, b) => n + b.text.length, 0));
});

test('links, emphasis, headings, lists, quotes, notes and photos; what cannot come along is counted', () => {
  const image = (name, extra = {}) => ({ __typename: 'Image', altText: ` ${name} alt `, credit: 'A Photographer', caption: { __typename: 'TextOnlyDocumentBlock', text: 'A caption.', content: [] }, crops: [{ renditions: [{ name: 'superJumbo', width: 2048, url: `https://static01.nyt.com/${name}-superJumbo.jpg` }, { name: 'articleLarge', width: 600, url: `https://static01.nyt.com/${name}-articleLarge.jpg` }] }], ...extra });
  const article = read({ blocks: [
    block('Heading2Block', inline('A '), inline('heading')),
    block('ParagraphBlock', inline('See '), inline('this', { __typename: 'LinkFormat', url: 'https://example.com/a?b=1' }), inline(', '), inline('that', { __typename: 'LinkFormat', url: '/2026/11/01/us/x.html' }, { __typename: 'ItalicFormat', type: null }), { __typename: 'LineBreakInline' }, inline('  bold ', { __typename: 'BoldFormat', type: null })),
    block('ParagraphBlock', inline('bad', { __typename: 'LinkFormat', url: 'javascript:alert(1)' })),
    { __typename: 'ListBlock', style: 'UNORDERED', content: [block('ListItemBlock', block('ParagraphBlock', inline('one'))), block('ListItemBlock', block('ParagraphBlock', inline('two')))] },
    { __typename: 'ListBlock', style: 'ORDERED', content: [block('ListItemBlock', block('ParagraphBlock', inline('first'))), block('ListItemBlock', block('ParagraphBlock', inline('second')))] },
    block('BlockquoteBlock', block('ParagraphBlock', inline('Quoted.'))),
    block('DetailBlock', inline('A note.')),
    { __typename: 'ImageBlock', media: image('one') },
    { __typename: 'ImageBlock', media: image('elsewhere', { crops: [{ renditions: [{ name: 'articleLarge', url: 'https://evil.example/x.jpg' }] }] }) },
    { __typename: 'DiptychBlock', imageOne: image('left'), imageTwo: image('right') },
    { __typename: 'InteractiveBlock', media: { __typename: 'EmbeddedInteractive' } },
    { __typename: 'VideoBlock', media: {} },
    { __typename: 'SomethingNew', content: [] },
    block('ParagraphBlock', inline('   ')),
  ] });
  const extra = article.blocks.slice(14);
  assert.deepEqual(extra.map(b => b.type), ['heading', 'paragraph', 'paragraph', 'paragraph', 'paragraph', 'paragraph', 'paragraph', 'paragraph', 'paragraph', 'figure', 'figure', 'figure']);
  assert.equal(extra[0].text, 'A heading');
  assert.equal(extra[1].text, 'See this, that bold');
  assert.deepEqual(extra[1].inlines, [{ text: 'See ' }, { text: 'this', href: 'https://example.com/a?b=1' }, { text: ', ' }, { text: 'that', href: 'https://www.nytimes.com/2026/11/01/us/x.html', em: true }, { text: ' ' }, { text: 'bold', strong: true }]);
  assert.deepEqual(extra[2].inlines, [{ text: 'bad' }], 'not a web address');
  assert.deepEqual(extra.slice(3, 9).map(b => b.text), ['• one', '• two', '1. first', '2. second', 'Quoted.', 'A note.']);
  assert.deepEqual(extra[9], { type: 'figure', src: 'https://static01.nyt.com/one-articleLarge.jpg', alt: 'one alt', caption: 'A caption. A Photographer', hires: 'https://static01.nyt.com/one-superJumbo.jpg' });
  assert.equal(article.left, 2);
});

test('a JavaScript object, not JSON: undefined outside strings only', () => {
  const article = read({ blocks: [block('ParagraphBlock', inline('It was undefined, "undefined" and \\undefined.'))] });
  assert.equal(article.blocks.at(-1).text, 'It was undefined, "undefined" and \\undefined.');
});

test("not the whole article, not this one, or not there: null, and archive.today it is", () => {
  assert.equal(read({ path: '/2026/11/14/world/europe/another.html' }), null, 'data for the article the page was first loaded with');
  assert.equal(read({ wordCount: 5000 }), null, "short of NYT's own count");
  assert.equal(read({ wordCount: 0 }), null, 'no count to go by');
  assert.equal(read({ paragraphs: 2 }), null, 'too little to be an article');
  assert.equal(read({ article: { sprinkledBody: null } }), null);
  assert.equal(read({ article: { url: undefined } }), null);
  const words = read().blocks.map(b => b.text).join(' ').split(/\s+/).length;
  assert.ok(read({ wordCount: words - 8 }), "words a little over NYT's count are fine");
  assert.ok(read({ wordCount: Math.floor(words / 0.96) }), 'or a little under');
  assert.equal(read({ wordCount: Math.ceil(words / 0.93) }), null);
  const doc = html => new JSDOM(html, { url: `https://www.nytimes.com${PATH}` }).window.document;
  assert.equal(nyt.live.fromPage(doc(livePageHtml())), null);
  for (const broken of ['<script>window.__preloadedData = {"loaderData": ;</script>', '<script>window.__preloadedData = </script>', nytData().replace(/\};<\/script>$/, '</script>')]) {
    assert.equal(nyt.live.fromPage(doc(livePageHtml().replace('</body>', `${broken}</body>`))), null, broken.slice(0, 50));
  }
});

test('NYT Cooking has none of this', () => {
  assert.equal(nyt.siteFor ? nyt.siteFor('cooking.nytimes.com').live.fromPage : undefined, undefined);
});

// The Atlantic's, from #__NEXT_DATA__ (sites/atlantic.js)
const atlantic = require('../extension/sites/atlantic.js');
const { atlanticLivePageHtml } = require('./fixtures.js');
const readAtlantic = data => atlantic.live.fromPage(new JSDOM(atlanticLivePageHtml({ data }), { url: 'https://www.theatlantic.com/health/2026/11/some-article/689523/' }).window.document);
const part = (type, innerHtml) => ({ __typename: type, innerHtml });

test('Atlantic: headings, lists and quotes; web links and emphasis only; related links left out', () => {
  const article = readAtlantic({ parts: [
    part('ArticleHeading', 'A <em>heading</em>'),
    part('ArticleParagraphContent', '<a href="javascript:alert(1)">bad</a> <a href="/x">good</a> <strong>bold</strong><script>pwned()</script><style>p{}</style>'),
    part('ArticleListContent', '<ul><li>one</li><li>two</li></ul>'),
    part('ArticleBlockquoteContent', 'Quoted.'),
    part('ArticleVideoContent', ''),
    part('ArticlePullquote', 'Said twice.'),
  ] });
  assert.equal(article.paragraphs, 23);
  assert.deepEqual(article.blocks.slice(19).map(b => [b.type, b.text]), [['heading', 'A heading'], ['paragraph', 'bad good bold'], ['paragraph', '• one'], ['paragraph', '• two'], ['paragraph', 'Quoted.']]);
  assert.deepEqual(article.blocks[20].inlines, [{ text: 'bad ' }, { text: 'good', href: 'https://www.theatlantic.com/x' }, { text: ' ' }, { text: 'bold', strong: true }]);
  assert.equal(article.left, 1);
});

// Photos as the user's Chrome showed them (2026-11-26), with made-up signatures and captions.
const thumb = size => `https://cdn.theatlantic.com/thumbor/SiGnAtUrE0123456789abcd=/${size}media/img/posts/2026/11/photo/original.jpg`;
const sized = { __typename: 'ArticleInlineImage', url: thumb('928x522/'), srcSet: `${thumb('928x522/')}, ${thumb('1856x1044/')} 2x`, altText: 'A <em>made-up</em> photo', captionText: '', attributionText: 'Photograph by <em>Someone</em> for The Atlantic', crop: null };
const cropped = (cap = '') => ({ __typename: 'ArticleInlineImage', url: thumb('0x0:1920x1280/'), srcSet: thumb('0x0:1920x1280/'), altText: '', captionText: cap, attributionText: 'Agency', crop: { url: thumb('0x0:1920x1280/655x437/'), srcSet: [655, 750, 850, 928, 1310].map(w => `${thumb(`0x0:1920x1280/${w}x${Math.round(w * 2 / 3)}/`)} ${w}w`).join(', ') } });
const drop = text => ({ __typename: 'ArticleParagraphContent', subtype: 'DROPCAP', innerHtml: text });

test('Atlantic: photos come along as resized copies, sharper ones for 2x screens, with their credits', () => {
  const article = readAtlantic({ count: 4, parts: [
    sized,
    { __typename: 'ArticleWellInlineImage', ...cropped('A caption.') },
    { __typename: 'ArticleOverflowImageGroup', captionText: 'The group\'s caption.', attributionText: '', images: [cropped(), cropped(), { ...cropped(), crop: null }] },
    { __typename: 'ArticleFullBleedInlineImage', ...cropped(), url: 'https://evil.example/thumbor/x/750x500/a.jpg', crop: { url: 'https://evil.example/thumbor/x/750x500/a.jpg', srcSet: 'https://evil.example/thumbor/x/750x500/a.jpg 750w' } },
  ] });
  const figures = article.blocks.filter(b => b.type === 'figure');
  assert.equal(figures.length, 4);
  assert.deepEqual(figures[0], { type: 'figure', src: thumb('928x522/'), hires: thumb('1856x1044/'), alt: 'A made-up photo', caption: 'Photograph by Someone for The Atlantic' });
  assert.equal(figures[1].src, thumb('0x0:1920x1280/750x500/'), 'the first width at least the column\'s');
  assert.equal(figures[1].hires, thumb('0x0:1920x1280/1310x873/'), 'the widest, short of twice that');
  assert.equal(figures[1].caption, 'A caption. Agency');
  assert.deepEqual(figures.slice(2).map(f => f.caption), ['Agency', 'The group\'s caption. Agency'], 'the group\'s caption under its last photo shown, before the credit');
  assert.equal(article.left, 2, 'an unresized upload and another host are left out, and counted');
  assert.ok(figures.every(f => f.src.startsWith('https://cdn.theatlantic.com/thumbor/')));
});

test('Atlantic: a break between sections, never before the first or two in a row; the closing rule too', () => {
  const article = readAtlantic({ count: 0, parts: [
    { __typename: 'ArticleParagraphContent', innerHtml: 'This article was in a newsletter.' },
    drop('The article starts.'),
    { __typename: 'ArticleParagraphContent', innerHtml: 'More of the first section.' },
    drop('The second section.'),
    sized,
    drop('The third section.'),
    { __typename: 'ArticleLegacyHtml', tagName: 'HR', innerHtml: '' },
    drop('The fourth section, after a rule of its own.'),
    { __typename: 'ArticleLegacyHtml', tagName: 'HR', innerHtml: '' },
    { __typename: 'ArticleLegacyHtml', tagName: 'DIV', innerHtml: '<div>Something else</div>' },
    { __typename: 'ArticleParagraphContent', innerHtml: 'A closing note.' },
    { __typename: 'ArticleLegacyHtml', tagName: 'HR', innerHtml: '' },
  ] });
  assert.deepEqual(article.blocks.map(b => b.type === 'paragraph' ? b.text : b.type), [
    'This article was in a newsletter.', 'The article starts.', 'More of the first section.', 'break',
    'The second section.', 'figure', 'break', 'The third section.', 'break', 'The fourth section, after a rule of its own.',
    'break', 'A closing note.',
  ]);
  assert.equal(article.paragraphs, 7);
});

test('Atlantic: too little, for another article, or not there: null', () => {
  assert.equal(readAtlantic({ count: 2, text: 'Long enough to be more than the page shows. '.repeat(80) }), null, 'two paragraphs are no article');
  assert.equal(readAtlantic({ path: '/health/2026/11/another/1/' }), null);
  assert.equal(readAtlantic(null), null);
});
