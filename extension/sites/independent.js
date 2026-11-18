// The Independent (docs/outlet-coverage.md, "Batch 6"). THE WALL HASN'T BEEN SEEN.
// - www.independent.co.uk redirects American readers to www.the-independent.com; the canonical
//   link stays on independent.co.uk, so that's the address looked up on archive.today.
// - Sends the whole article to a signed-out reader, Independent Premium articles included: the
//   paragraphs are direct children of div#main (29 paragraphs and 14,000 characters in one
//   premium article, the same in the page as fetched and as drawn, 27 of them showing, the
//   other two inside hidden widgets; 31 paragraphs and 8.9k in another). From the US, in the
//   built-in browser (2026-11-16), no wall came up on it, and scrolling wasn't locked. The
//   JSON-LD marks some premium articles paywalled, others not at all, and gives no length.
// - .article-premium is the page's wrapper on premium articles, not a wall.
// - So this goes on the general signs only, and only on articles marked paywalled: the text
//   clipped, hidden at its end, or under 150 words, or scrolling locked. With the text there
//   the wall comes off; without it, archive.today fills in. No selectors for markup that
//   wasn't seen (the page's scripts mention a registration wall).
(function (root) {
  'use strict';

  const adapter = root.NYTFix?.adapter || require('../src/adapter.js');
  const BODY = '#main';

  const site = adapter.defineSite({
    id: 'independent',
    name: 'The Independent',
    shortName: 'The Independent',
    hosts: ['www.independent.co.uk', 'www.the-independent.com'],
    // Articles: /life-style/russell-brand-consent-prison-david-walliams-b3084543.html.
    isArticle: path => /\/[a-z0-9-]+-b\d{6,}\.html$/.test(path),
    live: {
      body: BODY,
      wall: {
        detect: adapter.walledArticle({ body: BODY, minWords: 150 }),
        type: adapter.textOnPage(BODY, { minWords: 150 }),
      },
    },
  });

  if (typeof module === 'object' && module.exports) module.exports = site;
})(globalThis);
