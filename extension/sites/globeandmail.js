// The Globe and Mail (docs/outlet-coverage.md, batch 1).
// - Sends the whole article, in article#content-gate (paragraphs p.c-article-body__text), and
//   marks paid articles in its JSON-LD (isAccessibleForFree "False", hasPart .l-article; free
//   ones say "True"). No length given.
// - The wall runs on Zephr (script#tgam-zephr). It wasn't showing in the user's Chrome, so the
//   check is the general signs on a paid article: text cut short, locked scrolling, or the end
//   of the text hidden.
// - With 150 words or more on the page the wall just comes off; with less, archive.today fills in
//   (2 of 2 samples archived; article#content-gate survives archiving).
(function (root) {
  'use strict';

  const adapter = root.NYTFix?.adapter || require('../src/adapter.js');
  const BODY = 'article#content-gate';

  const site = adapter.defineSite({
    id: 'globeandmail',
    name: 'The Globe and Mail',
    shortName: 'The Globe and Mail',
    hosts: ['www.theglobeandmail.com'],
    // Articles: /canada/article-carney-wraps-up-negotiations-on-trade-deal-with-philippines/.
    isArticle: path => /\/article-[a-z0-9-]+\/?$/.test(path),
    live: {
      body: BODY,
      wall: {
        services: ['zephr'],
        detect: adapter.walledArticle({ body: BODY }),
        type: adapter.textOnPage(BODY, { minWords: 150 }),
      },
    },
    snapshot: { body: [BODY, ...adapter.SNAPSHOT_BODY] },
  });

  if (typeof module === 'object' && module.exports) module.exports = site;
})(globalThis);
