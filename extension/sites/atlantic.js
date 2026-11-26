// The Atlantic (docs/multi-site-investigation.md).
// - Snapshots: main#main-content > article holds a header (skipped), the body in div > section,
//   and the author bio in address#article-writer-0. Inline "related story" links sit in
//   div#injected-recirculation-…. Photos keep NYT-style original addresses.
// - Live page: the body is section[data-event-module="article body"], paragraphs
//   p.ArticleParagraph_root__…. For a reader past the meter, Zephr (The Atlantic's paywall
//   service) cuts the body to a few paragraphs (4 paragraphs / 341 words seen, against 17–31
//   paragraphs in full snapshots) and renders its gate into [data-zephr-outcome-label] slots at
//   the end of the body, which atlantic.css hides. The gate itself couldn't be observed (ad
//   blockers stop Zephr), so the wall is detected from the cut instead: the page's JSON-LD marks
//   the article paywalled (isAccessibleForFree: false, the same for every reader) and the body
//   holds only a few hundred words.
(function (root) {
  'use strict';

  const adapter = root.NYTFix?.adapter || require('../src/adapter.js');
  const BODY = 'section[data-event-module="article body"]';
  // Below this many words, a paywalled article's body has been cut. Full articles in the samples
  // ran 8.5k–15k characters (roughly 1,400–2,500 words); the cut one had 341.
  const CUT_WORDS = 600;

  // A photo's address, if it is one of The Atlantic's own resized copies (…/thumbor/<signature>/
  // [0x0:1920x1280/]750x500/media/…). Unresized, it's the photographer's file: too heavy.
  const PHOTO = /^https:\/\/cdn\.theatlantic\.com\/thumbor\/[^\s,]+$/;
  const isPhoto = url => PHOTO.test(url || '') && /\/\d+x\d+\//.test(url);
  // A srcset as [{ url, w?, x? }]: "a.jpg, b.jpg 2x" or "a.jpg 655w, b.jpg 750w".
  const sources = srcSet => String(srcSet || '').split(/,\s+/).map(entry => {
    const [url, descriptor = ''] = entry.trim().split(/\s+/);
    const n = parseFloat(descriptor);
    return { url, w: /w$/.test(descriptor) ? n : null, x: /x$/.test(descriptor) ? n : descriptor ? null : 1 };
  }).filter(s => isPhoto(s.url));
  // About the body's width (665 px), and twice that for sharp screens.
  const COLUMN = 665;
  const textOf = (doc, html) => new doc.defaultView.DOMParser().parseFromString(String(html || ''), 'text/html').body.textContent.replace(/\s+/g, ' ').trim();
  // One of the article's photos as a figure block, or null. Seen (the user's Chrome, 2026-11-26):
  // without a crop, url is a resized copy and srcSet "url, url2x 2x"; with one, crop.url is a
  // resized copy and crop.srcSet lists widths ("… 655w, … 750w, … 1310w"), while the photo's own
  // url is then the unresized upload (up to 1,920 px and more: never used).
  // shared: a group's own caption and credit, for its last photo: descriptions first, credits last.
  function photo(doc, image, shared = {}) {
    const crop = image?.crop;
    const list = sources(crop ? crop.srcSet : image?.srcSet);
    let src = null;
    let hires = null;
    if (list.some(s => s.w)) {
      const byWidth = list.filter(s => s.w).sort((a, b) => a.w - b.w);
      const atLeast = min => byWidth.find(s => s.w >= min) || byWidth[byWidth.length - 1];
      src = atLeast(COLUMN).url;
      hires = atLeast(COLUMN * 2).url;
    } else {
      src = list.find(s => s.x === 1)?.url || null;
      hires = list.find(s => s.x === 2)?.url || null;
    }
    const own = crop ? crop.url : image?.url;
    if (!src && isPhoto(own)) src = own;
    if (!src) return null;
    const caption = [image.captionText, shared.captionText, image.attributionText, shared.attributionText].map(html => textOf(doc, html)).filter(Boolean).join(' ');
    const figure = { type: 'figure', src, alt: textOf(doc, image.altText), caption };
    if (hires && hires !== src) figure.hires = hires;
    return figure;
  }

  // The whole article, from the data the page is sent (#__NEXT_DATA__): one of pageProps.urqlState's
  // answers holds article.content. In the user's Chrome, 2026-11-25, past the meter: 19 paragraphs,
  // 1,456 words, with 298 showing; and 19, 1,325 words, with 3 paragraphs showing. Seen there:
  // ArticleParagraphContent { innerHtml }, ArticleRelatedContentLink (not the article's). Others are
  // handled from their names. There's no word count to check it against: it has to be this page's
  // article, and more of it than the page shows (content.js).
  // A magazine feature (2026-11-26): 110 paragraphs in 10 sections, each section's first one with
  // subtype DROPCAP (the article's first too); an empty ArticleLegacyHtml HR before the closing
  // note; photos as ArticleInlineImage, ArticleWellInlineImage, ArticleFullBleedInlineImage and
  // ArticleOverflowImageGroup { images, captionText, attributionText }.
  function articleFromPage(doc) {
    let article = null;
    try {
      const state = JSON.parse(doc.getElementById('__NEXT_DATA__').textContent).props.pageProps.urqlState;
      for (const { data } of Object.values(state)) {
        const found = typeof data === 'string' && data.includes('"content"') ? JSON.parse(data).article : null;
        if (Array.isArray(found?.content)) article = found;
      }
    } catch {
      return null;
    }
    if (!article) return null;
    const base = 'https://www.theatlantic.com';
    const pathOf = href => { try { return new URL(href, base).pathname.replace(/\/$/, ''); } catch { return null; } };
    if (pathOf(article.url) !== (doc.location?.pathname || '').replace(/\/$/, '')) return null;
    const blocks = [];
    let left = 0;
    const paragraph = (html, prefix = '') => {
      const inlines = adapter.runsFromHtml(doc, html, base);
      const list = prefix && inlines.length ? [{ text: prefix }, ...inlines] : inlines;
      const text = list.map(run => run.text).join('').replace(/\s+/g, ' ').trim();
      return text ? { text, inlines: list } : null;
    };
    let sections = 0;
    // A break between sections: never first, never two in a row.
    const sectionBreak = () => {
      if (blocks.length && blocks[blocks.length - 1].type !== 'break') blocks.push({ type: 'break' });
    };
    for (const part of article.content) {
      const type = part?.__typename || '';
      const html = typeof part?.innerHtml === 'string' ? part.innerHtml : '';
      if (/Paragraph/.test(type)) {
        const p = paragraph(html);
        if (!p) continue;
        if (part.subtype === 'DROPCAP' && sections++ > 0) sectionBreak();
        blocks.push({ type: 'paragraph', ...p });
      } else if (type === 'ArticleLegacyHtml' && /^hr$/i.test(part.tagName || '')) {
        sectionBreak();
      } else if (Array.isArray(part?.images) && /Image/.test(type)) {
        // The group's caption goes under its last photo shown.
        const made = part.images.map(image => photo(doc, image));
        const last = made.findLastIndex(Boolean);
        if (last >= 0) made[last] = photo(doc, part.images[last], part);
        const figures = made.filter(Boolean);
        left += part.images.length - figures.length;
        blocks.push(...figures);
      } else if (/Image$/.test(type)) {
        const figure = photo(doc, part);
        if (figure) blocks.push(figure);
        else left++;
      } else if (/Heading|Subhead/.test(type)) {
        const h = paragraph(html);
        if (h) blocks.push({ type: 'heading', text: h.text });
      } else if (/List(Content)?$/.test(type) && html) {
        for (const item of new doc.defaultView.DOMParser().parseFromString(html, 'text/html').querySelectorAll('li')) {
          const p = paragraph(item.innerHTML, '\u2022 ');
          if (p) blocks.push({ type: 'paragraph', ...p });
        }
      } else if (/Blockquote/.test(type) && html) {
        const p = paragraph(html);
        if (p) blocks.push({ type: 'paragraph', ...p });
      } else if (/Image|Photo|Gallery|Video|Embed|Audio|Interactive|Chart/.test(type)) left++;
      // Else not the article's: related links, pull quotes, newsletter boxes
    }
    while (blocks[blocks.length - 1]?.type === 'break') blocks.pop();
    const paragraphs = blocks.filter(b => b.type === 'paragraph');
    if (paragraphs.length < 3) return null;
    return { blocks, paragraphs: paragraphs.length, chars: paragraphs.reduce((n, b) => n + b.text.length, 0), left, leftAs: ['photo or graphic', 'photos or graphics'] };
  }

  const site = {
    id: 'atlantic',
    name: 'The Atlantic',
    shortName: 'The Atlantic',
    hosts: ['www.theatlantic.com'],

    // Articles: /politics/2026/11/slug/689437/ (older ones: /politics/archive/2016/05/slug/482700/).
    isArticle: path => /^\/[a-z-]+\/(archive\/)?\d{4}\/\d{2}\/[a-z0-9-]+\/\d+\/?$/.test(path),
    isLive: () => false,
    normalizeUrl: href => `https://www.theatlantic.com${new URL(href).pathname}`,

    live: {
      body: BODY,
      story: 'main#main-content > article',
      main: 'main#main-content',
      upsellLink: null,
      fromPage: articleFromPage, // the whole text, if the page was sent it
      wall: {
        // The JSON-LD marks the article paywalled, and the body is cut short (shared check).
        detect: adapter.cutBody({ body: BODY, maxWords: CUT_WORDS }),
        type: () => 'paywall',
        popup: null,
        inert: null,
        container: null,
      },
    },

    snapshot: {
      body: ['main#main-content > article'],
      skip: 'address, [id^="injected-recirculation"]',
      junk: null,
      // No hiresImage: photos come from a thumbor server whose resize URLs are signed
      // (cdn.theatlantic.com/thumbor/<signature>/…/976x549/media/…), so other sizes can't be
      // asked for. The unresized upload under /media/ loads, but it's the photographer's file
      // (2,000–5,500 px wide), too heavy to pull in for every photo.
    },
  };

  root.NYTFix = root.NYTFix || {};
  root.NYTFix.sites = Object.assign(root.NYTFix.sites || {}, { [site.id]: site });
  if (typeof module === 'object' && module.exports) module.exports = site;
})(globalThis);
