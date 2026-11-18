// Reuters (docs/outlet-coverage.md, batch 4). Seen in the user's Chrome (scripted requests get
// DataDome's 401):
// - Sends the whole article: every paragraph (div[data-testid^="paragraph-"]) is in
//   [data-testid="ArticleBody"], and the Arc page data (the fusion-metadata script) carries the
//   same text and its word count (a 1,053-word story: 1,048 words in 26 blocks, all 25
//   paragraphs drawn). Short bulletins are just short (38 and 47 words in two samples).
// - The wall is a metered modal: [data-testid="Modal"] holding a paywall-modal-module dialog
//   ("subscribe", "sign in"), with scrolling locked on <html> and <body>. Class names carry
//   build hashes, so only the stable part is matched. The JSON-LD's hasPart names a hashed
//   class too.
// - Nothing clips the article body itself (no max-height, overflow visible, the hashed paywall
//   class and over-6-para included), but the layout around it is cropped (below). The stylesheet
//   also has an inline wall (article-wall-module__paywall), not seen on screen; it's treated the
//   same.
// - So the modal just comes off and scrolling unlocks; nothing is fetched. archive.today had
//   neither survey sample, so there's no fallback to offer anyway.
// - The wall also crops the page: the layout's container and content container get a
//   "restricted" class (regular-article-layout-module__restricted, and the same for the live-page
//   and single-column layouts), which caps them at max-height: 150vh with overflow hidden, and
//   hides the footer container. Seen in the user's Chrome (a saved copy of the page): with the
//   modal off, the second half of the article was cut off and the page wouldn't scroll past it,
//   though all 17 paragraphs (455 words, the page data's word_count) were there. The modal had
//   gone from the page by then; the class stayed. So the class counts as the wall too, and the
//   restricted containers are revealed (cap and clipping off, the footer shown).
(function (root) {
  'use strict';

  const adapter = root.NYTFix?.adapter || require('../src/adapter.js');
  const MODAL = '[data-testid="Modal"]:has([class*="paywall-modal-module"])';
  // An inline wall its stylesheet has (article-wall-module__paywall), not seen on screen.
  const INLINE_WALL = '[class*="article-wall-module__paywall"]';
  // The layouts the wall crops (the video players' "restricted" classes are left alone).
  const RESTRICTED = '[class*="layout-module__restricted"]';

  const site = adapter.defineSite({
    id: 'reuters',
    name: 'Reuters',
    shortName: 'Reuters',
    hosts: ['www.reuters.com'],
    // Articles: /world/us/some-slug-2026-11-15/, /business/some-slug-2026-11-14/.
    isArticle: path => /^\/[a-z-]+(\/[a-z-]+)*\/[a-z0-9-]+-\d{4}-\d{2}-\d{2}\/?$/.test(path),
    live: {
      body: '[data-testid="ArticleBody"]',
      wall: {
        detect: adapter.anyShown([MODAL, INLINE_WALL, RESTRICTED]),
        reveal: [RESTRICTED],
        hide: [MODAL, INLINE_WALL],
        type: () => 'lift',
      },
    },
  });

  if (typeof module === 'object' && module.exports) module.exports = site;
})(globalThis);
