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

  // The whole article, from the data the page is sent (#__NEXT_DATA__): one of pageProps.urqlState's
  // answers holds article.content. In the user's Chrome, 2026-11-25, past the meter: 19 paragraphs,
  // 1,456 words, with 298 showing; and 19, 1,325 words, with 3 paragraphs showing. Seen there:
  // ArticleParagraphContent { innerHtml }, ArticleRelatedContentLink (not the article's). Others are
  // handled from their names. There's no word count to check it against: it has to be this page's
  // article, and more of it than the page shows (content.js).
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
    for (const part of article.content) {
      const type = part?.__typename || '';
      const html = typeof part?.innerHtml === 'string' ? part.innerHtml : '';
      if (/Paragraph/.test(type)) {
        const p = paragraph(html);
        if (p) blocks.push({ type: 'paragraph', ...p });
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
