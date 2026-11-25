// The Jerusalem Post (docs/outlet-coverage.md, "Batch 7"). Seen in the built-in browser and in
// pages fetched signed out, 2026-11-24 and 25.
// - Most of it is free (5 of 5 samples). Premium articles (The Jerusalem Report's, 3 of 3) are
//   sent whole: the first paragraphs in section[itemprop="articleBody"], and the rest in a second
//   one, inside section.section-paywall, which carries the class `hidden` (display: none). A
//   Subscribe button (a.btn-primary) sits between the two. It was still so 15 s in, with the
//   cookie popup's optional cookies declined; nothing else is drawn and scrolling isn't locked.
// - The JSON-LD marks premium articles paywalled and gives the whole articleBody (5,149 characters
//   where the paragraphs had 5,470).
// - So the rest is shown and the button hidden; nothing is fetched. If it's ever not there,
//   archive.today fills in.
(function (root) {
  'use strict';

  const adapter = root.NYTFix?.adapter || require('../src/adapter.js');
  const BODY = '[itemprop="articleBody"]';
  const REST = '.article-body > .section-paywall';

  const site = adapter.defineSite({
    id: 'jpost',
    name: 'The Jerusalem Post',
    shortName: 'The Jerusalem Post',
    hosts: ['www.jpost.com'],
    // Articles: /jerusalem-report/article-915129, /israel-news/article-915950; older ones end in
    // a slug and a number (/j-spot/introducing-…-service-565988).
    isArticle: path => /^\/[^/]+(\/[^/]+)*\/[a-z0-9-]*[a-z]-\d{5,7}\/?$/i.test(path),
    live: {
      body: BODY,
      wall: {
        detect: doc => adapter.markedPaywalled(doc) && [...doc.querySelectorAll(REST)].some(el => !adapter.visible(el)),
        reveal: REST,
        hide: 'a.btn-primary:has(+ .section-paywall)',
        type: adapter.textOnPage(BODY),
      },
    },
  });

  if (typeof module === 'object' && module.exports) module.exports = site;
})(globalThis);
