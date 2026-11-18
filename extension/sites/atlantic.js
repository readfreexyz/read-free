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
