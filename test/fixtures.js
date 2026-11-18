// Synthetic pages shaped like the real ones described in docs/phase0-findings.md.
// Placeholder text only; no real article content.
const { JSDOM } = require('jsdom');

const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';

const parse = html => new JSDOM(html).window.document;

// archive.today turns each <p> into a <div> with inline styles, three levels below the section.
function snapshotParagraph(i) {
  return `<div style="margin:0"><div style="max-width:600px"><div style="font-family:nyt-imperial, georgia;font-size:20px;line-height:30px;margin-bottom:15px">
    Paragraph ${i}.   ${LOREM} With an <a href="https://archive.ph/o/Z279f/https://www.nytimes.com/2026/01/01/world/other.html" style="color:#326891">inline link</a> and <em>emphasis</em>.
  </div></div></div>`;
}

// Things that sit inside the real article body but are not article prose.
const SNAPSHOT_EXTRAS = `
  <div><div style="font-size:12px">SKIP ADVERTISEMENT</div><div style="font-size:12px">Advertisement</div></div>
  <div><figure aria-label="media" role="group" style="margin:0"><div><img src="/Z279f/abc.avif" currentsourceurl="https://static01.nyt.com/images/2026/11/11/multimedia/photo.jpg" alt="A photo"></div>
    <figcaption style="font-size:15px"><span style="color:#5a5a5a">A photo caption that is long enough to look like a sentence of prose.</span></figcaption></figure></div>
  <div><div><a href="https://archive.ph/o/Z279f/https://www.nytimes.com/2026/11/12/travel/other.html"><div><img src="/Z279f/def.webp"></div>
    <div style="font-family:nyt-cheltenham-small;font-size:14px;font-weight:700">A recommended story card with a fairly long headline</div></a></div></div>
  <div><div><h2 style="font-size:20px">A subheading</h2></div></div>`;

function snapshotHtml({ paragraphs = 12, extras = true, section = true } = {}) {
  const paras = Array.from({ length: paragraphs }, (_, i) => snapshotParagraph(i + 1));
  const half = Math.ceil(paragraphs / 2);
  const body = `<div></div>${paras.slice(0, half).join('')}${extras ? SNAPSHOT_EXTRAS : ''}${paras.slice(half).join('')}`;
  return `<!doctype html><html><head><title>Snapshot</title></head><body>
<div style="display:none" itemscope itemtype="http://schema.org/ImageObject"></div>
<center>
  <div id="HEADER"><table><tr><td>archive.today webpage capture
    <time itemprop="pubdate" datetime="2026-11-14T05:05:35Z">14 Nov 2026 05:05:35 UTC</time></td></tr></table></div>
  <div id="CONTENT"><div class="html1"><div class="body"><div id="app"><div><div><main id="site-content"><div>
    <article id="story">
      <header><h1 style="font-size:40px">Headline</h1><div>Supported by</div></header>
      ${section ? `<section name="articleBody" style="width:100%">${body}</section>` : body}
    </article>
  </div></main></div></div></div></div></div></div>
</center></body></html>`;
}

// An FT snapshot, shaped like the three sampled (docs/multi-site-investigation.md): the body in
// article#site-content[role=main] > div > article#article-body, the standfirst outside it, a
// "Recommended" box in an <aside>, and reader comments in a separate <main>.
function ftSnapshotHtml({ paragraphs = 8 } = {}) {
  const para = i => `<div style="font-family:metric">FT paragraph ${i}. ${LOREM} See <a href="https://archive.ph/o/AbCdE/https://www.ft.com/content/11111111-2222-3333-4444-555555555555">a related report</a>.</div>`;
  const paras = Array.from({ length: paragraphs }, (_, i) => para(i + 1));
  const half = Math.ceil(paragraphs / 2);
  return `<!doctype html><html><head><title>Snapshot</title></head><body><center>
  <div id="HEADER">archive.today webpage capture</div>
  <div id="CONTENT"><div class="html1"><div class="body"><div>
    <article id="site-content" role="main"><div>
      <div><h1>Headline</h1><div>A standfirst that is long enough to look like a sentence of article prose, but sits outside the body.</div></div>
      <article id="article-body">
        ${paras.slice(0, half).join('')}
        <figure><img src="/AbCdE/ft.jpg" currentsourceurl="https://images.ft.com/v3/image/raw/photo.jpg" alt="An FT photo">
          <figcaption><span>An FT photo caption.</span><span>Photographer/Agency</span></figcaption></figure>
        <aside><div>Recommended</div><a href="https://archive.ph/o/AbCdE/https://www.ft.com/content/66666666-7777-8888-9999-000000000000"><div>A recommended FT story with a fairly long headline here</div></a></aside>
        <div>Recommended</div>
        ${paras.slice(half).join('')}
      </article>
    </div></article>
    <main aria-label="Comments Embed"><section id="tabPane-COMMENTS"><div role="article">A reader comment that is long enough to look like prose, which should never be extracted.</div></section></main>
  </div></div></div></div>
</center></body></html>`;
}

// FT's live page, from the user's diagnostic. For a non-subscriber (barrier: true) there's no
// article: main#site-content holds a #barrier-page with the headline and subscription offers
// (placeholder wording here). For a subscriber, the article itself.
function ftLivePageHtml({ barrier = true } = {}) {
  const content = barrier
    ? `<div id="barrier-page"><div class="o-grid-container"><div class="o3-typography-wrapper"><div class="o-grid-row"><div>
         <section class="css-1k8i55w"><h1 class="o3-type-headline-md">An FT headline</h1></section>
         <section class="css-offers"><h2>Subscribe to keep reading</h2><a href="https://www.ft.com/products">See the offers</a></section>
       </div></div></div></div></div>`
    : '<article><h1>An FT headline</h1><div id="article-body"><p>A subscriber sees the article itself.</p></div></article>';
  return `<!doctype html><html><head></head><body><div class="n-layout">
  <header id="site-navigation"><a data-trackable="Subscribe" href="https://www.ft.com/products">Subscribe</a></header>
  <div class="n-layout__row n-layout__row--content"><div><main id="site-content">${content}</main></div></div>
  <footer><a href="https://www.ft.com/products">Individual Subscriptions</a></footer>
</div></body></html>`;
}

// The Atlantic's snapshot (three samples): main#main-content > article with a header (headline,
// standfirst, lead photo), the body in div > section with an inline "related story" link in
// div#injected-recirculation-…, and the author bio in address#article-writer-0.
function atlanticSnapshotHtml({ paragraphs = 10 } = {}) {
  const paras = Array.from({ length: paragraphs }, (_, i) => `<div><div style="font-family:serif">Atlantic paragraph ${i + 1}. ${LOREM} With <a href="https://archive.ph/o/AbCdE/https://www.theatlantic.com/ideas/2026/11/other/689000/">a link</a>.</div></div>`);
  const half = Math.ceil(paragraphs / 2);
  return `<!doctype html><html><head><title>Snapshot</title></head><body><center>
  <div id="HEADER">archive.today webpage capture</div>
  <div id="CONTENT"><div class="html1"><div class="body"><div id="__next"><div>
    <main id="main-content"><article>
      <header><div><div><h1>Headline</h1><div>A standfirst that is long enough to look like a sentence of article prose.</div></div></div>
        <figure><img src="/AbCdE/lead.jpg" currentsourceurl="https://cdn.theatlantic.com/lead.jpg" alt="Lead photo"></figure></header>
      <div><section>
        ${paras.slice(0, half).join('')}
        <div id="injected-recirculation-link-0"><div>Read: A related Atlantic story headline</div></div>
        <figure><img src="/AbCdE/photo.jpg" currentsourceurl="https://cdn.theatlantic.com/photo.jpg" alt="A photo"><figcaption><span>A caption.</span></figcaption></figure>
        ${paras.slice(half).join('')}
      </section></div>
      <address id="article-writer-0"><div>An author bio that is long enough to look like a sentence of prose text.</div></address>
    </article></main>
  </div></div></div></div></div>
</center></body></html>`;
}

// The Atlantic's live page, from the probe: the body in section[data-event-module="article body"]
// with p.ArticleParagraph_root__… paragraphs and Zephr's (empty) gate slots at the end. cut: the
// body cut to 4 paragraphs, as for a reader past the meter. marked: the JSON-LD marks the article
// paywalled.
function atlanticLivePageHtml({ cut = true, marked = true } = {}) {
  const ps = Array.from({ length: cut ? 4 : 40 }, (_, i) => `<p class="ArticleParagraph_root__4mszW">Live Atlantic paragraph ${i + 1}. ${LOREM}</p>`).join('');
  const ld = { '@context': 'https://schema.org', '@type': 'NewsArticle', isAccessibleForFree: !marked, ...(marked ? { hasPart: [{ '@type': 'WebPageElement', isAccessibleForFree: false, cssSelector: '.article-content-body' }] } : {}) };
  return `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body><div id="__next"><div>
  <main id="main-content"><article class="article-content-body"><header><h1>Headline</h1></header><div>
    <section data-event-module="article body" data-flatplan-body="true" class="ArticleBody_root__2gF81">${ps}
      <div data-zephr-sdk-feature-slug="article" data-zephr-outcome-label="TEST"></div>
      <div id="article-end"></div>
    </section>
  </div></article></main>
</div></div></body></html>`;
}

// The New Yorker's snapshot (two samples): main#main-content > article with the header in
// div > div > header and the body in div > div > div, among share buttons and a video player.
function newyorkerSnapshotHtml({ paragraphs = 10 } = {}) {
  const paras = Array.from({ length: paragraphs }, (_, i) => `<div style="font-family:serif">New Yorker paragraph ${i + 1}. ${LOREM}</div>`);
  const half = Math.ceil(paragraphs / 2);
  return `<!doctype html><html><head><title>Snapshot</title></head><body><center>
  <div id="HEADER">archive.today webpage capture</div>
  <div id="CONTENT"><div class="html1"><div class="body"><div id="app-root"><div><div>
    <main id="main-content"><article>
      <div><div><header><h1>Headline</h1><div>A dek that is long enough to look like a sentence of article prose text.</div></header></div></div>
      <div><div><div>
        ${paras.slice(0, half).join('')}
        <div role="button"><div>Share options for this story, long enough to look like a sentence.</div></div>
        <div role="region" aria-label="Video Player"><div>A video transcript line that is long enough to look like prose.</div></div>
        <figure><img src="/AbCdE/p.jpg" currentsourceurl="https://media.newyorker.com/photo.jpg" alt="A photo"><figcaption><span>A caption.</span></figcaption></figure>
        ${paras.slice(half).join('')}
      </div></div></div>
    </article></main>
  </div></div></div></div></div></div>
</center></body></html>`;
}

// The New Yorker's live page, from the probe: the body in several div.body__inner-container
// chunks with an ad between them; paragraphs past the free part have class "paywall"; an
// aside.paywall-modal is filled when the meter runs out (wall). paywallParagraphs: false for a
// page where those paragraphs aren't there.
function newyorkerLivePageHtml({ wall = true, paywallParagraphs = true } = {}) {
  const chunk = (from, n, cls) => `<div data-journey-hook="grid-wrapper" class="grid"><div class="grid--item">
    <div data-journey-hook="client-content" data-testid="BodyWrapper" class="body"><div class="body__inner-container">
      ${Array.from({ length: n }, (_, i) => `<p class="${cls}">New Yorker paragraph ${from + i}. ${LOREM}</p>`).join('')}
    </div></div></div></div>`;
  return `<!doctype html><html><head></head><body>
  <main id="main-content"><article><header><h1>Headline</h1></header>
    <div data-testid="ArticlePageChunks">
      ${chunk(1, 3, 'body')}
      <div class="ad">Advertisement</div>
      ${paywallParagraphs ? chunk(4, 3, 'paywall') : ''}
    </div>
  </article></main>
  <aside class="paywall-modal">${wall ? '<div><h2>Subscribe to keep reading</h2><a href="https://www.newyorker.com/subscribe">See the offers</a></div>' : ''}</aside>
</body></html>`;
}

// The live NYT page, structured like the real one: real <p> tags with hashed classes inside
// companion-column wrappers, and the masthead and main#site-content inside the page container.
// wall is what NYT has up (incognito diagnostics): 'paywall', 'login' (the "free to read, log
// in" wall), or null. A wall fills the popup, adds an absolutely positioned gradient scrim, and
// makes main#site-content inert + aria-hidden. With no wall the popup is there but empty.
const WALL_TEXT = {
  paywall: '<p>Subscribe to keep reading.</p>',
  login: '<p id="gateway-exit-advisory">To leave without signing in, use your browser\'s Back button.</p><p>See subscription options</p>',
};
const SCRIM = '<div class="css-hgm7bf" style="position:absolute;pointer-events:none;background:linear-gradient(rgba(18,18,18,0),rgba(18,18,18,.65) 342px)"></div>';
// leadFigure: a photo at the top of the article body, above the first paragraph.
// upsell: NYT's subscription line under the cut-off text, 'inside' the article body or 'after' it.
const UPSELL = '<p class="css-upsell"><a href="https://www.nytimes.com/subscription?campaignId=TEST">Subscribe</a> to keep reading this article.</p>';
function livePageHtml({ paragraphs = 3, section = true, wall = 'paywall', leadFigure = false, upsell = null } = {}) {
  const ps = Array.from({ length: paragraphs }, (_, i) => `<p class="css-12m5bll evys1bk0">Live paragraph ${i + 1}. ${LOREM}</p>`).join('');
  const body = `
    ${leadFigure ? '<div class="css-79elbk"><figure><img src="https://static01.nyt.com/images/lead.jpg" alt=""><figcaption><p class="css-caption">A lead photo caption</p></figcaption></figure></div>' : ''}
    <div class="css-s99gbd StoryBodyCompanionColumn" data-testid="companionColumn-0"><div class="css-53u6y8">${ps}${upsell === 'inside' ? UPSELL : ''}</div></div>
    <div class="css-1u3p7j1"><figure><figcaption><p class="css-caption">A caption paragraph</p></figcaption></figure></div>`;
  const blocked = wall ? ' inert aria-hidden="true"' : '';
  return `<!doctype html><html><head></head><body><div id="app"><div>
  <div data-testid="vi-gateway-container" class="vi-gateway-container css-mcm29f">
    <div><header class="masthead"><a href="/">The Masthead</a></header></div>
    <main id="site-content"${blocked}><div>
      <article id="story"><header><h1>Headline</h1></header>
        ${section ? `<section name="articleBody">${body}</section>` : ''}
        ${upsell === 'after' ? UPSELL : ''}
      </article>
      <aside class="related"><a href="/2026/11/12/world/related.html">A related article</a></aside>
    </div></main>
    <div style="display:contents"><div id="gateway-content" data-testid="gateway-content" class="css-1aa2f1p">${wall ? WALL_TEXT[wall] : ''}</div></div>
    <div style="display:contents"></div>
    ${wall ? SCRIM : ''}
  </div>
</div></div></body></html>`;
}

// Puts a wall up on a page built with wall: null, the way NYT does a moment after load.
function raiseWall(doc, wall) {
  doc.getElementById('gateway-content').innerHTML = WALL_TEXT[wall];
  doc.querySelector('[data-testid="vi-gateway-container"]').insertAdjacentHTML('beforeend', SCRIM);
  const main = doc.getElementById('site-content');
  main.setAttribute('aria-hidden', 'true');
  main.setAttribute('inert', '');
}

// Shape of the real timemap returned for the Phase 0 test article.
const TIMEMAP = `<https://www.nytimes.com/2026/11/14/world/europe/test-article.html>; rel="original",
<http://archive.md/timegate/https://www.nytimes.com/2026/11/14/world/europe/test-article.html>; rel="timegate",
<http://archive.md/20261114050535/https://www.nytimes.com/2026/11/14/world/europe/test-article.html>; rel="first last memento"; datetime="Sat, 14 Nov 2026 05:05:35 GMT",
<http://archive.md/timemap/https://www.nytimes.com/2026/11/14/world/europe/test-article.html>; rel="self"; type="application/link-format"; from="Sat, 14 Nov 2026 05:05:35 GMT"; until="Sat, 14 Nov 2026 05:05:35 GMT"`;

// A timemap listing snapshots of articleUrl taken at the given times (epoch ms), in the real
// format: memento URLs on http://archive.md with a 14-digit timestamp.
const stamp = ms => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14);
const mementoUrl = (articleUrl, ms, host = 'http://archive.md') => `${host}/${stamp(ms)}/${articleUrl}`;
function timemapFor(articleUrl, times) {
  return [
    `<${articleUrl}>; rel="original"`,
    ...times.map(ms => `<${mementoUrl(articleUrl, ms)}>; rel="memento"; datetime="${new Date(ms).toUTCString()}"`),
  ].join(',\n');
}

// In-memory stand-in for chrome.storage.local (promise-based get/set/remove).
// A site built with adapter.defineSite (see GENERIC_ADAPTER in content.test.js): the article in
// .story-body, a Piano modal over it, and scrolling locked on <body>.
// whole: the page sent the whole article, with the part past the free paragraphs hidden in
// .locked (display: none); otherwise it has only the free paragraphs. The JSON-LD gives the full
// article's length either way.
function genericLivePageHtml({ whole = true, free = 3, total = 12, modal = true } = {}) {
  const para = i => `<p class="para">Live paragraph ${i}. ${LOREM}</p>`;
  const visible = Array.from({ length: free }, (_, i) => para(i + 1)).join('');
  const rest = Array.from({ length: total - free }, (_, i) => para(free + i + 1)).join('');
  const words = Array.from({ length: total }, (_, i) => `Live paragraph ${i + 1}. ${LOREM}`).join(' ').split(/\s+/).length;
  const ld = { '@context': 'https://schema.org', '@type': 'NewsArticle', isAccessibleForFree: false, wordCount: words };
  return `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head>
<body style="overflow: hidden"><header><nav><a href="/">Example News</a></nav></header>
  <main><article><h1>Headline</h1><div class="story-body">${visible}${whole ? `<div class="locked" style="display: none">${rest}</div>` : ''}</div></article></main>
  ${modal ? '<div class="tp-backdrop"></div><div class="tp-modal"><div>Subscribe to keep reading</div></div>' : ''}
</body></html>`;
}

// A snapshot of that site: no itemprop, just ids, with the body several levels under a broad
// one (div#__next), next to navigation, a related-stories aside and a footer.
function genericSnapshotHtml({ paragraphs = 12 } = {}) {
  const paras = Array.from({ length: paragraphs }, (_, i) => `<div style="font-family:serif">Example paragraph ${i + 1}. ${LOREM}</div>`).join('');
  return `<!doctype html><html><head><title>Snapshot</title></head><body><center>
  <div id="HEADER">archive.today webpage capture</div>
  <div id="CONTENT"><div class="html1"><div class="body"><div id="__next">
    <header><nav><div>Home, World, Politics, Business, Opinion, Culture, Science and more sections</div></nav></header>
    <main><article><h1>Headline</h1><div><div>${paras}</div></div>
      <aside><div>Related: another story with a headline long enough to look like a paragraph.</div></aside>
    </article></main>
    <div role="region"><div>Comment one, which is long enough to look like a paragraph of prose.</div><div>Comment two, which is also long enough to look like a paragraph.</div></div>
    <footer><div>Copyright Example News. All rights reserved, and a long footer line too.</div></footer>
  </div></div></div></div>
</center></body></html>`;
}

// Batch 1 live pages, shaped like the ones observed (docs/outlet-coverage.md), with filler text.
const ldScript = ld => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'NewsArticle', ...ld })}</script>`;
const fillerParas = (n, cls = '') => Array.from({ length: n }, (_, i) => `<p${cls ? ` class="${cls}"` : ''}>Paragraph ${i + 1}. ${LOREM}</p>`);
const fillerWords = n => Array.from({ length: n }, (_, i) => `Paragraph ${i + 1}. ${LOREM}`).join(' ').split(/\s+/).length;

// LA Times past the meter: the metering popup up, scrolling locked, and the text sent in full.
// layout 'plain': every paragraph visible in one block (a metered story).
// layout 'gated': a few preview paragraphs, the rest in a hidden .subscriber-content block.
// layout 'longform': a bulleted summary block first, then every paragraph in a hidden
// .subscriber-content block nested in another block, with a photo.
function latimesLivePageHtml({ metered = true, layout = 'plain', paragraphs = 12, preview = 3 } = {}) {
  const paras = fillerParas(paragraphs);
  const ld = ldScript({ isAccessibleForFree: false, hasPart: { '@type': 'WebPageElement', isAccessibleForFree: false, cssSelector: '.paywall' }, articleBody: Array.from({ length: paragraphs }, (_, i) => `Paragraph ${i + 1}. ${LOREM}`).join(' ') });
  const rich = inner => `<div class="ct-rich-text-children clearfix">${inner}</div>`;
  const locked = inner => `<div class="ct-rich-text-children clearfix subscriber-content hidden">${inner}</div>`;
  const body = {
    plain: rich(paras.join('')),
    gated: rich(paras.slice(0, preview).join('')) + locked(paras.slice(preview).join('')),
    longform: rich('<ul><li>Key point one.</li><li>Key point two.</li></ul>') + rich(locked(`<figure class="figure"><picture><img class="image" src="https://ca-times.brightspotcdn.com/photo.jpg" alt="" loading="lazy"></picture></figure>${paras.join('')}`)),
  }[layout];
  return `<!doctype html><html class="page article-page"><head>${ld}<style>.hidden { display: none !important; } .subscriber-content { display: none; } body.met-panel-open { overflow: hidden !important; }</style></head>
<body class="page-body${metered ? ' met-panel-open' : ''}"${metered ? ' style="overflow: hidden"' : ''}><div class="page-wrapper"><div class="page-content paywall"><main class="page-main">
  <article class="story"><h1>Headline</h1>${body}</article>
</main></div></div>
${metered ? '<modality-custom-element id="modality-1" name="metering-modal" role="dialog"><div>Offer</div></modality-custom-element>' : ''}
</body></html>`;
}

// Toronto Star: the preview paragraphs, then the rest in .subscriber-only blocks hidden inline.
function thestarLivePageHtml({ locked = true, preview = 2, paragraphs = 10 } = {}) {
  const paras = fillerParas(paragraphs);
  const blocks = paras.map((p, i) => (i < preview
    ? `<div class="subscriber-preview">${p}</div>`
    : `<div class="subscriber-only"${locked ? ' style="display:none"' : ''}>${p}</div>`)).join('');
  return `<!doctype html><html lang="en"><head>${ldScript({ isAccessibleForFree: false })}</head>
<body class="fixed-scroll-nav app-editorial blox-asset"><article class="asset article-default"><div class="row"><div id="asset-content" class="tsArticle"><div class="asset-body">
  <div id="article-body" itemprop="articleBody" class="asset-content subscriber-premium">${blocks}</div>
</div></div></div></article>
<div id="access-offers-modal" class="access-offers-wrapper access-modal"><div class="modal fade"><div class="modal-dialog">Offers</div></div></div>
</body></html>`;
}

// Newsweek: the whole article (hashed CSS-module classes), Piano's slots, no length in the JSON-LD.
function newsweekLivePageHtml({ paragraphs = 12, pianoModal = false } = {}) {
  return `<!doctype html><html class="guest"><head>${ldScript({ isAccessibleForFree: false, hasPart: { '@type': 'WebPageElement', isAccessibleForFree: false, cssSelector: '.meteredContent' } })}</head>
<body><div class="client-wrapper"><section class="_3pGWOq_container"><main class="_3pGWOq_main"><article class="_3pGWOq_content"><div>
  <article class="Oah6EG_articleBody">${fillerParas(paragraphs, '_0ovlkG_blockParagraph').join('')}<div id="piano_inline"></div></article>
</div></article></main></section><div class="meteredContent"></div></div>
<div class="tp-modal"${pianoModal ? '' : ' style="display:none"'}><div class="tp-iframe-wrapper"><iframe></iframe></div></div>
</body></html>`;
}

// CNN: the whole article, the JSON-LD with its length, Piano's modal on the page but hidden.
function cnnLivePageHtml({ paragraphs = 12, onPage = paragraphs, pianoModal = false } = {}) {
  return `<!doctype html><html><head>${ldScript({ isAccessibleForFree: false, wordCount: fillerWords(paragraphs) })}</head>
<body><section class="body"><main class="article__main"><div class="article__content-container">
  <div itemprop="articleBody" class="article__content">${fillerParas(onPage, 'paragraph-elevate').join('')}</div>
</div></main></section>
<div class="tp-modal"${pianoModal ? '' : ' style="display:none"'}><div role="dialog" class="tp-iframe-wrapper"><iframe></iframe></div></div>
</body></html>`;
}

// The Globe and Mail: the whole article in article#content-gate; paid ones marked "False".
function globeLivePageHtml({ paid = true, paragraphs = 12, hideTail = false, lock = false } = {}) {
  const paras = fillerParas(paragraphs, 'c-article-body__text');
  const body = paras.map((p, i) => (hideTail && i >= paragraphs - 3 ? p.replace('<p ', '<p style="display:none" ') : p)).join('');
  return `<!doctype html><html><head>${ldScript({ isAccessibleForFree: paid ? 'False' : 'True', ...(paid ? { hasPart: [{ '@type': 'WebPageElement', isAccessibleForFree: 'False', cssSelector: '.l-article' }] } : {}) })}</head>
<body${lock ? ' style="overflow: hidden"' : ''}><div id="fusion-app"><main id="main-content"><article id="content-gate" class="l-article">${body}</article></main></div></body></html>`;
}

// Batch 2: sites that cut the text, shaped like what was observed (filler text throughout).
const snapshotFrame = inner => `<!doctype html><html><head><title>Snapshot</title></head><body><center>
  <div id="HEADER">archive.today webpage capture</div><div id="CONTENT"><div class="html1"><div class="body">${inner}</div></div></div>
</center></body></html>`;
const snapDivs = (n, label) => Array.from({ length: n }, (_, i) => `<div style="font-family:serif">${label} paragraph ${i + 1}. ${LOREM}</div>`).join('');

// The Age / SMH (Nine): the first paragraphs, unclassed, in a div inside main#content .article;
// Piano's slots. layout 'narrow': the body div right under .article (a narrow window). 'wide':
// a level down, in a column with an ad rail before it and the article footer (share buttons,
// the author's bio, the comments prompt, "Most viewed") after it. 'opinion': wide, plus the
// standfirst (a classed <p>) and the share buttons in a div of their own under the headline.
function nineLivePageHtml({ cut = true, prompt = true, layout = 'narrow' } = {}) {
  const body = `<div class="sc-c502">${fillerParas(cut ? 2 : 14).join('')}</div>`;
  const actions = '<div data-testid="article-actions"><div class="sc-f9e3"><div class="sc-ba6d"><p class="sc-8a52">Save</p><p>Gift this article</p></div></div></div>';
  const footer = `<div class="sc-5e57-2"><div data-testid="article-footer"><div id="eoa-sentinel"></div>${actions}
      <div class="sc-21b7"><p class="sc-21b7-1">The author writes about this and that for the paper, and can be reached by email.</p></div>
      <div id="comments-cta-piano-id" class="noPrint comments-cta-piano-id"><iframe></iframe></div></div>
    <section data-testid="most-viewed-in-sport-strap"><header><h2>Most viewed</h2></header></section></div>`;
  const standfirst = layout === 'opinion' ? `<div class="sc-6112-13"><p class="sc-6112-15">A standfirst long enough to read like a paragraph of the article itself.</p>${actions}</div>` : '';
  const column = layout === 'narrow'
    ? `${body}<div class="sc-5e57-4"><div id="app-inline-prompt-piano-id"></div></div><div id="hard-reg-wall-piano-id"></div>`
    : `<div class="sc-5e57-1"><div data-testid="ad-slider-track"><div class="container"></div></div>${body}
      <div class="sc-5e57-4"><div id="app-inline-prompt-piano-id"></div></div><div id="hard-reg-wall-piano-id"></div>${footer}</div>`;
  return `<!doctype html><html><head>${ldScript({ isAccessibleForFree: false, hasPart: { '@type': 'WebPageElement', isAccessibleForFree: false, cssSelector: '.paywall' } })}</head>
<body${prompt ? ' style="overflow: hidden"' : ''}><div id="app"><main id="content"><div class="sc-3f16 article paywall">
  <header><h1>Headline</h1><div data-testid="article-actions"><div role="tooltip"><p>Share this article with a friend or two today.</p></div></div></header>
  ${standfirst}
  <div id="meter-prompt-piano-id"></div>
  ${column}
  ${prompt ? '<div id="paywall-prompt-wrapper-piano-id" class="paywall-prompt-piano-active"><div id="paywall-prompt-piano-id"><p>Subscribe to keep reading this story, from just a few dollars.</p></div></div>' : ''}
</div></main></div></body></html>`;
}
function nineSnapshotHtml({ paragraphs = 12 } = {}) {
  return snapshotFrame(`<div id="app"><main id="content"><div>
    <header><h1>Headline</h1></header>
    <div>${snapDivs(paragraphs, 'Nine')}<div>No gift articles left</div><div>License this article</div></div>
    <aside><h2>Related</h2><div>${LOREM}</div></aside>
    <section><header><h2>Most Viewed in National</h2></header><section><div><div><figure><img src="https://static.ffx.io/tile.jpg"></figure><h3><a href="https://archive.ph/o/x/https://www.theage.com.au/national/other-20261114-p61aaa.html">Another story with a headline long enough to count</a></h3><div>${LOREM}</div></div></div></section></section>
  </div></main></div>`);
}

// WSJ: a few paragraphs in a section under article .crawler, then Piano's snippet overlay.
function wsjLivePageHtml({ snippet = true, paragraphs = 4, panel = false } = {}) {
  return `<!doctype html><html><head>${ldScript({ isAccessibleForFree: false, hasPart: { '@type': 'WebPageElement', isAccessibleForFree: false, cssSelector: '.paywall' } })}</head>
<body><div id="__next"><main><div class="article-container"><article><div class="crawler">
  <section class="ef4qpkp0">${fillerParas(paragraphs, 'css-1qg6i2u').join('')}</section>
  ${snippet ? '<div class="css-1vlbiim-Container"><p id="cx-snippet-overlay-sign-in-text">Already a subscriber? Sign in to keep reading.</p><button>Subscribe</button></div>' : ''}
</div></article></div></main></div>
<a id="cx-customer-nav-subscribe-btn" href="/subscribe">Subscribe</a>
${panel ? '<div id="cx-candybar" data-testid="PianoFixedBottomPlaceholdercx-candybar" style="position: fixed"><iframe></iframe></div><div id="cx-scrim"></div><div id="cx-sign-in-reminder"></div>' : ''}
</body></html>`;
}
function wsjSnapshotHtml({ paragraphs = 12 } = {}) {
  return snapshotFrame(`<div id="__next"><main><div><article><div>
    <div><div>By</div><div>Jane Doe</div><div>and</div><div>John Roe</div><div>Nov. 13, 2026 3:07 pm ET</div></div>
    <section>${snapDivs(paragraphs, 'WSJ')}</section>
  </div></article></div></main>
  <div id="comments_sector" role="region"><div>A reader comment that is long enough to look like a paragraph of prose.</div><div>Another reader comment that is long enough to look like a paragraph too.</div><div>A third reader comment, also long enough to look like a paragraph of prose.</div></div></div>`);
}

// Der Spiegel: a Spiegel+ page keeps only the offer block in its body; free pages have text blocks.
function spiegelLivePageHtml({ plus = true } = {}) {
  const text = n => `<div data-area="text"><div class="RichText lg:w-8/12 md:w-10/12">${fillerParas(n).join('')}</div></div>`;
  return `<!doctype html><html><head>${ldScript({ isAccessibleForFree: !plus })}</head>
<body><main id="Inhalt"><article><header><h2>Headline</h2></header><div data-area="body">
  ${plus ? '<div data-area="paywall"><fieldset><p class="mt-16 font-sansUI">Read the whole article with Spiegel+, the first month for one euro.</p><button>Subscribe</button></fieldset></div>' : text(3) + text(5)}
</div></article></main></body></html>`;
}
function spiegelSnapshotHtml({ paragraphs = 10 } = {}) {
  return snapshotFrame(`<main id="Inhalt"><article><header><h2>Headline</h2></header><div><section><div><div>${snapDivs(paragraphs, 'Spiegel')}</div></div></section></div></article></main>`);
}

// Le Monde: the first paragraphs in article.article__content; the reserved part missing when cut.
function lemondeLivePageHtml({ cut = true, paid = true, longform = false } = {}) {
  const ld = paid ? { isAccessibleForFree: false, hasPart: { '@type': 'WebPageElement', isAccessibleForFree: false, cssSelector: '.article__reserved-content' } } : { isAccessibleForFree: true };
  const paras = `${fillerParas(4, longform ? 'article__paragraph article__paragraph--lf' : 'article__paragraph').join('')}
  ${cut ? '' : `<div class="article__reserved-content">${fillerParas(10, 'article__paragraph').join('')}</div>`}`;
  const offer = cut && paid ? `<section class="paywall js-paywall${longform ? ' paywall--longform' : ''}"><p>Subscribers only: the rest of this article is reserved.</p></section>` : '';
  // Long reads (M le mag): article#Longform, the text in section.article__content.
  const article = longform
    ? `<article id="Longform" class="article article--longform"><section class="article__heading"><p class="article__desc">A standfirst long enough to look like a paragraph of prose here.</p></section><section class="article__content">${paras}</section>${offer}</article>`
    : `<section id="habillagepub" class="article"><section class="article__wrapper"><article class="article__content">${paras}</article>${offer}</section></section>`;
  return `<!doctype html><html><head>${ldScript(ld)}</head><body><main>${article}</main></body></html>`;
}
function lemondeSnapshotHtml({ paragraphs = 12 } = {}) {
  const read = '<div>Read more</div><div><a href="https://archive.ph/o/x/https://www.lemonde.fr/en/article/2026/11/14/other_6780000_4.html">Another article on the same subject</a></div>';
  return snapshotFrame(`<main><section id="habillagepub"><section><section><div>${snapDivs(paragraphs / 2, 'Le Monde')}${read}${snapDivs(paragraphs / 2, 'Le Monde more')}</div></section></section></section></main>`);
}

// Batch 3 (docs/outlet-coverage.md), shaped like what was observed.

// National Post: the server trims the body to one paragraph and leaves a marker; the JSON-LD
// gives the full length.
function nationalpostLivePageHtml({ trimmed = true, resolved = true } = {}) {
  const ld = { isAccessibleForFree: false, hasPart: { '@type': 'WebPageElement', isAccessibleForFree: false, cssSelector: '.article-content__content-group' }, wordCount: 1587 };
  return `<!doctype html><html class="naviga-state--anonymous${resolved ? ' naviga-paywall-resolved' : ''}"><head>${ldScript(ld)}</head>
<body><div id="page"><main id="primary"><article class="entry-content"><pm-article-three-column class="article-three-column section"><div class="article-three-column__content">
  <div class="article-three-column__body article-content__content-group">${fillerParas(trimmed ? 1 : 20, 'wp-block-paragraph').join('')}${trimmed ? '<div class="pmd-paywall-trimmed-marker"></div>' : ''}</div>
</div></pm-article-three-column></article></main></div></body></html>`;
}
// Its snapshot: the text in a role=region div, a video player (controls' labels, "Next Up")
// in the middle, and the ad line between paragraphs.
function nationalpostSnapshotHtml({ paragraphs = 12 } = {}) {
  return snapshotFrame(`<div id="page"><main id="primary"><article role="article"><section><div role="region">${snapDivs(paragraphs / 2, 'NP')}
    <div>This advertisement has not loaded yet, but your article continues below.</div>
    <pm-jw-player><div id="jwp-placement-1"><div><div id="jwExperienceDiv_x" aria-label="Video Player - A video about something" role="application"><div><div>More Videos</div><div>Play/PauseSPACE</div><div>Seek Forward→</div></div></div>
      <div><div>Next Up</div><div>The title of another video, long enough to look like a sentence of text.</div></div></div></div></pm-jw-player>
    ${snapDivs(paragraphs / 2, 'NP more')}</div></section></article></main></div>`);
}

// Corriere: the whole article in div.content blocks in #content-to-read (onPage of blocks).
// consent: the cookie-consent wall up, <body> pinned.
function corriereLivePageHtml({ blocks = 6, onPage = blocks, pianoModal = false, consent = false } = {}) {
  const content = Array.from({ length: onPage }, (_, i) => `<div id="m728${i}0-1-2" class="content"><p class="chapter-paragraph">Paragraph ${i + 1}. ${LOREM}</p></div>`).join('');
  return `<!doctype html><html><head>${ldScript({ isAccessibleForFree: 'False', hasPart: { '@type': 'WebPageElement', isAccessibleForFree: 'False' }, wordCount: fillerWords(blocks) })}</head>
<body${consent ? ' style="position: fixed; top: 0"' : ''}><header id="l-header"><div class="header header--topbar"><div class="container"><a class="logo">Corriere della Sera</a><a>Accedi</a></div></div>
  <div class="bck-header"><div class="container is-pd-t-0"><nav class="menu__nav"><a>Cronaca</a><a>Politica</a></nav></div></div></header>
<main id="l-main"><div class="wrapper has-wall"><div class="container"><section class="body-article"><h1 class="title-art">Headline</h1><div class="columns is-custom-2"><div id="content-to-read" class="column is-8">
  <p class="summary-art">A summary line long enough to read like a sentence of the article.</p>
  <div id="m72784-1-2" class="bck-media-image"><img src="https://images2.corriereobjects.it/x.jpg"></div>${content}
  <div id="pno-in-article-abbonato" class="chapter"></div>
</div><aside class="column is-4"><div class="aside-right"><h3>I più letti</h3></div></aside></div></section></div></div></main>
<footer id="l-footer"><div class="bck-footer"><div class="container"><p>Copyright and company details, long enough to read like a line.</p></div></div></footer>
<div data-overlay="" class="modal-overlay is-access is-hidden"><div class="modal-access"><p>Reading on another device: a notice long enough to look like a paragraph.</p></div></div>
${pianoModal ? '<div class="tp-modal"><iframe></iframe></div><div class="tp-backdrop"></div>' : ''}</body></html>`;
}

// Corriere's homepage with its ad-blocker popup (rcs_anti-adblocker), in Italian.
function corriereHomeHtml() {
  return `<!doctype html><html><head></head><body style="overflow: hidden"><main><section><h2>Una notizia in prima pagina</h2></section></main>
<div class="rcs-anti-adblocker"><div class="rcs-anti-adblocker__box" style="position: fixed"><h3>Per continuare a leggere non usare il blocco della pubblicità con Corriere</h3>
<p>Corriere della Sera lavora costantemente per fornire un servizio di qualità.</p><button>Permetti la pubblicità</button><button>Abbonati a Corriere</button></div></div></body></html>`;
}

// The Spectator: the free part and the paid part (hidden, or missing) in div.entry-content.
// clip: the magazine wall, the body cut off at 650px with the rest still in it.
function spectatorLivePageHtml({ paid = 'shown', lock = false, clip = false } = {}) {
  const ps = fillerParas(8, 'wp-block-paragraph');
  const paidPart = paid === 'missing' ? '' : `<span class="paywalled-content"${paid === 'hidden' ? ' style="display: none"' : ''}>${ps.slice(3).join('')}</span>`;
  return `<!doctype html><html><head>${ldScript({ isAccessibleForFree: false, hasPart: { '@type': 'WebPageElement', isAccessibleForFree: false, cssSelector: '.paywalled-content' }, wordCount: fillerWords(8) })}</head>
<body${lock ? ' style="overflow: hidden"' : ''}><main id="js-site-content"><article class="entry post"><div class="entry-content__wrapper container">
  <div class="entry-content article-inline-paywall"${clip ? ' style="max-height: 650px; overflow-y: hidden; position: relative"' : ''}><div class="reggradient" style="position: absolute"></div><span class="non-paywalled-content">${ps.slice(0, 3).join('')}</span><div id="customer-io-slot"></div>${paidPart}</div>
</div><div class="below-article-paywall"><iframe></iframe></div></article></main></body></html>`;
}

// Batch 4 (docs/outlet-coverage.md), shaped like what was observed.

// Reuters: every paragraph a div[data-testid^=paragraph-] in ArticleBody; the metered modal.
function reutersLivePageHtml({ modal = false, paragraphs = 12, restricted = false } = {}) {
  const ps = Array.from({ length: paragraphs }, (_, i) => `<div data-testid="paragraph-${i}" class="text-module__text__0GDob">Paragraph ${i + 1}. ${LOREM}</div>`).join('');
  // The wall's crop, as in Reuters' stylesheet: the layout capped at 150vh, the footer hidden.
  const crop = '.regular-article-layout-module__container__qlWZP.regular-article-layout-module__restricted__d0vIv, .regular-article-layout-module__content-container__vBc5-.regular-article-layout-module__restricted__d0vIv { max-height: 150vh; overflow: hidden; } .regular-article-layout-module__footer-container__7D010.regular-article-layout-module__restricted__d0vIv { display: none; } .regular-article-layout-module__content-container__vBc5- { display: grid; }';
  const r = restricted ? ' regular-article-layout-module__restricted__d0vIv' : '';
  return `<!doctype html><html${modal ? ' style="overflow: hidden"' : ''}><head>${ldScript({ isAccessibleForFree: false, hasPart: { '@type': 'WebPageElement', isAccessibleForFree: false, cssSelector: '.paywall-B064F03B' } })}<style>${crop}</style></head>
<body${modal ? ' style="overflow: hidden"' : ''}><div id="fusion-app"><div data-testid="RegularArticleLayout" class="regular-article-layout-module__container__qlWZP${r}">
<div data-testid="MainContent" class="regular-article-layout-module__content-container__vBc5- paywall-B064F03B${r}"><main><article data-testid="Article"><h1>Headline</h1>
  <div data-testid="ArticleBody" class="article-body-module__wrapper__kL0a8"><div class="article-body-module__content__bnXL1">${ps}</div></div></article></main></div>
<div class="regular-article-layout-module__footer-container__7D010${r}"><footer><a href="/about">About Reuters</a></footer></div></div></div>
${modal ? '<div><div data-testid="Modal" class="modal-module__underlay__vg6AX" style="position: fixed; inset: 0"><span></span><div role="dialog" class="modal-module__container__Sn2HW paywall-modal-module__paywall-modal-container__hWiZS"><div class="modal-module__body__mvKR6"><p>Subscribe to keep reading, or sign in.</p></div></div><span></span></div></div>' : ''}
</body></html>`;
}

// La Libre: the free paragraphs in #story-preview-<type>, the rest hidden in
// #story-content-<type> inside Piano's slot. type FREE: nothing hidden. subscriber: shown.
function lalibreLivePageHtml({ type = 'MEMBER', subscriber = false } = {}) {
  const free = type === 'FREE';
  const ps = fillerParas(10);
  const hidden = !free && !subscriber;
  return `<!doctype html><html><head>${ldScript({ isAccessibleForFree: free ? 'True' : 'False', ...(free ? {} : { hasPart: { '@type': 'WebPageElement', isAccessibleForFree: 'False', cssSelector: '.js-paywall-target' } }) })}
<style>.ap-StoryPiano-contentElement.is-hidden { height: 0; opacity: 0; overflow: hidden; } .ap-StoryPiano-restrictedContent.has-paywall { min-height: 500px; }
.ap-StoryPiano-content.is-preview { position: relative; } .ap-StoryPiano-content.is-preview::before { content: ''; position: absolute; inset: 0; background-image: linear-gradient(rgba(255, 255, 255, 0) 50%, rgba(255, 255, 255, 0.96)); }</style></head>
<body><main><article class="ap-Story ap-StoryPiano"><h1>Titre</h1><div id="article-text" class="ap-Story-content">
  <div id="story-preview-${type}" class="ap-StoryPiano-content${free ? '' : ' is-preview'}">${ps.slice(0, 2).join('')}</div>
  <div id="piano-paywall-${type}"${free ? '' : ' class="ap-StoryPiano-restrictedContent has-paywall"'}><div id="story-content-${type}" class="ap-StoryPiano-contentElement${hidden ? ' is-hidden' : ''}">${ps.slice(2).join('')}</div></div>
  ${free ? '' : '<div class="ux-PaywallPianoFallback is-offlineShow" style="display: none"><p>Abonnez-vous pour lire la suite de cet article.</p></div>'}
</div></article></main></body></html>`;
}
// Piano filling its slot with an offer, which wipes the text out of it.
const lalibrePianoOffer = doc => {
  const slot = doc.querySelector('.ap-StoryPiano-restrictedContent');
  slot.innerHTML = '<div class="tp-container-inner"><iframe id="offer-0-x"></iframe></div>';
};

function memoryArea(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(keys) {
      if (keys === null) return structuredClone(data);
      const list = [].concat(keys);
      return structuredClone(Object.fromEntries(list.filter(k => k in data).map(k => [k, data[k]])));
    },
    async set(items) { Object.assign(data, structuredClone(items)); },
    async remove(keys) { for (const k of [].concat(keys)) delete data[k]; },
    async getKeys() { return Object.keys(data); },
  };
}

// Daily Mail: a Mail+ article (plus) with the whole text in div[itemprop=articleBody], hidden by
// the site's own rules (copied from its stylesheet) while <body> is is-paywalled-article and not
// yet is-paywall-processed, the body capped at 20px inline, and the Mail+ box after it. The
// third paragraph has three links in it: the rule hides any third child, links included.
// subscriber: the site has marked the page processed. plus: false, a free article. inline:
// Zephr's inline paywall instead of the Mail+ box: the body capped and marked
// data-is-inline-paywall-mounted, and a div.noskim right after it holding the Mail+ banner, its
// white fade pulled up over the last lines.
function dailymailLivePageHtml({ plus = true, subscriber = false, inline = false } = {}) {
  const ps = fillerParas(20, 'mol-para-with-font');
  ps[2] = '<p class="mol-para-with-font">Linked: <a href="/a">one</a>, <a href="/b">two</a> and <a href="/c" id="third-link">three</a>.</p>';
  const bodyClasses = ['mol-desktop', ...(plus ? ['is-paywalled-article'] : []), ...(subscriber ? ['is-paywall-processed'] : [])].join(' ');
  const rules = 'body.is-paywalled-article:not(.is-paywall-processed):not(.is-deepdive-paywall):not(.is-shorthand-paywall).mol-desktop div[itemprop="articleBody"] :nth-child(n+3):not(iframe) { display: none; }';
  const cap = plus && !subscriber ? ` style="max-height: ${inline ? 240 : 20}px; overflow: hidden;"${inline ? ' data-is-inline-paywall-mounted="true"' : ''}` : '';
  return `<!doctype html><html><head>${ldScript({ isAccessibleForFree: !plus })}<style>${rules}</style></head>
<body class="${bodyClasses}"><div id="page-container"><div id="js-article-text" class="article-text wide heading-tag-switch"><h1>Headline</h1>
  <div itemprop="articleBody"${cap}>${ps.join('')}<div class="artSplitter mol-img-group"><img src="/photo.jpg" alt=""></div></div>
  ${plus && !subscriber && inline ? '<div class="noskim"><div class="fade" style="height: 60px; margin-top: -60px; position: relative; background: linear-gradient(rgba(255, 255, 255, 0), #fff)"></div><div class="banner"><h3>Subscribe to continue reading</h3><a href="/subscribe">Subscribe</a></div></div>' : ''}
  ${plus && !subscriber ? '<div class="home related-replace-paywall"><div class="mol-fe-related-replace">Subscribe to Mail+ to keep reading.</div></div>' : ''}
  ${plus && !subscriber ? '<template><div class="zephr-paywall" data-mol-fe-paywall-outcome=""></div><div id="mol-fe-zephr-outcome-wrapper"></div></template>' : ''}
</div></div></body></html>`;
}

// USA Today: a free story (JSON-LD free) in div.gnt_ar_b, under Admiral's ad-blocker popup: a
// fixed box straight under <body>, with random class names, scrolling locked on <html>.
function usatodayLivePageHtml({ admiral = true } = {}) {
  return `<!doctype html><html${admiral ? ' style="padding-right: 15px; overflow: hidden;"' : ''}><head>${ldScript({ isAccessibleForFree: true })}</head>
<body><header>USA TODAY</header><main><article><h1>Headline</h1><div class="gnt_ar_b">${fillerParas(12, 'gnt_ar_b_p').join('')}</div></article></main>
${admiral ? '<div class="fEy1Z2XT" style="position: fixed; inset: 0; z-index: 2147483647; background: rgba(0, 0, 0, 0.6)"><div><h2>It looks like you\'re using an adblocker.</h2><p>Please support us by turning off your adblocker.</p><button>Disable my Adblocker</button><button>Subscribe Now</button></div></div>' : ''}
</body></html>`;
}

module.exports = {
  atlanticSnapshotHtml, atlanticLivePageHtml, newyorkerSnapshotHtml, newyorkerLivePageHtml, genericLivePageHtml, genericSnapshotHtml,
  latimesLivePageHtml, thestarLivePageHtml, newsweekLivePageHtml, cnnLivePageHtml, globeLivePageHtml,
  nineLivePageHtml, nineSnapshotHtml, wsjLivePageHtml, wsjSnapshotHtml, spiegelLivePageHtml, spiegelSnapshotHtml, lemondeLivePageHtml, lemondeSnapshotHtml,
  nationalpostLivePageHtml, nationalpostSnapshotHtml, corriereLivePageHtml, corriereHomeHtml, spectatorLivePageHtml,
  reutersLivePageHtml, lalibreLivePageHtml, lalibrePianoOffer, dailymailLivePageHtml, usatodayLivePageHtml,
  LOREM, parse, snapshotHtml, ftSnapshotHtml, ftLivePageHtml, livePageHtml, raiseWall, TIMEMAP, timemapFor, mementoUrl, memoryArea };
