// Newsweek (docs/outlet-coverage.md, batch 1).
// - Sends the whole article to everyone, in article.<hash>_articleBody (class names carry a
//   build hash, so the selector matches on the end), paragraphs p.<hash>_blockParagraph. The
//   JSON-LD marks every article paywalled (hasPart .meteredContent) but gives no length.
// - The meter runs on Piano (#piano_inline and other Piano slots in the page). The wall wasn't
//   showing in the user's Chrome, so the check is Piano's modal plus the general signs: text cut
//   short, locked scrolling, or the end of the text hidden.
// - With 150 words or more on the page the wall just comes off; with less, archive.today fills in
//   (1 of 2 samples archived, no body marker: found automatically).
(function (root) {
  'use strict';

  const adapter = root.NYTFix?.adapter || require('../src/adapter.js');
  const BODY = 'article[class*="_articleBody"]';

  const site = adapter.defineSite({
    id: 'newsweek',
    name: 'Newsweek',
    shortName: 'Newsweek',
    hosts: ['www.newsweek.com'],
    // Articles: /judge-blocks-ice-from-searching-immigration-lawyers-phone-12715119.
    isArticle: path => /^\/[a-z0-9-]+-\d{5,}$/.test(path),
    live: {
      body: BODY,
      wall: {
        services: ['piano'],
        detect: adapter.anyOf(adapter.anyShown('.tp-modal'), adapter.walledArticle({ body: BODY })),
        type: adapter.textOnPage(BODY, { minWords: 150 }),
      },
    },
    snapshot: { skip: '[role="dialog"]' },
  });

  if (typeof module === 'object' && module.exports) module.exports = site;
})(globalThis);
