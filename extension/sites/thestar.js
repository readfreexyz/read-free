// Toronto Star, on the BLOX (TownNews) platform (docs/outlet-coverage.md, batch 1). From the pages
// it sends:
// - The article body is #article-body[itemprop="articleBody"]. Its first paragraphs sit in
//   .subscriber-preview blocks, and all the rest in .subscriber-only blocks with
//   style="display: none", for every reader. The site's own script shows them to subscribers.
// - So the wall is up while .subscriber-only blocks are hidden, and taking it off means showing
//   them, plus hiding BLOX's offers popup (#access-offers-modal) and Bootstrap's backdrop, and
//   unlocking scrolling.
// - Not checked in a browser: Chrome wouldn't let the extension tools into the page. archive.today
//   had neither sample, so there's no fallback when the blocks are missing.
(function (root) {
  'use strict';

  const adapter = root.NYTFix?.adapter || require('../src/adapter.js');
  const LOCKED = '#article-body .subscriber-only';

  const site = adapter.defineSite({
    id: 'thestar',
    name: 'Toronto Star',
    shortName: 'The Star',
    hosts: ['www.thestar.com'],
    // Articles: /news/world/…/slug/article_99aff827-65aa-5a36-aedf-1cec7cf5038b.html.
    isArticle: path => /\/article_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.html$/.test(path),
    live: {
      body: '#article-body',
      wall: {
        detect: doc => [...doc.querySelectorAll(LOCKED)].some(el => !adapter.visible(el)),
        reveal: LOCKED,
        hide: ['#access-offers-modal', '.modal-backdrop'],
        type: doc => (doc.querySelector(LOCKED) ? 'lift' : 'paywall'),
      },
    },
  });

  if (typeof module === 'object' && module.exports) module.exports = site;
})(globalThis);
