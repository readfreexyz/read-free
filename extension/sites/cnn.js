// CNN (docs/outlet-coverage.md, batch 1).
// - Sends the whole article to everyone, in [itemprop="articleBody"].article__content, and the
//   JSON-LD gives its articleBody and wordCount (785 and 782 words in one sample). It marks
//   every article paywalled (isAccessibleForFree: false), so that flag alone means nothing.
// - Its meter and sign-in wall run on Piano: a .tp-modal sits on the page, hidden, until it's
//   needed. Not yet seen in action (the user's profile wasn't past the meter), so the wall
//   check also takes the general signs: text cut short of the JSON-LD's length, locked
//   scrolling, or the end of the text hidden.
// - With the text all there, the wall just comes off. If CNN ever cuts it, archive.today fills
//   in (2 of 2 samples archived, the body under [itemprop="articleBody"]).
// - us.cnn.com and edition.cnn.com are the same site as www (the same articles at the same paths).
//   cnnespanol.cnn.com is CNN en Español, on the same platform: two articles of each read on
//   2026-11-24 had the same body, JSON-LD and whole text. cnn.com alone redirects to www.
(function (root) {
  'use strict';

  const adapter = root.NYTFix?.adapter || require('../src/adapter.js');
  const BODY = '.article__content[itemprop="articleBody"]';

  const site = adapter.defineSite({
    id: 'cnn',
    name: 'CNN',
    shortName: 'CNN',
    hosts: ['www.cnn.com', 'edition.cnn.com', 'us.cnn.com', 'cnnespanol.cnn.com'],
    // CNN en Español has its own articles; the rest are archived under www.
    normalizeUrl: href => {
      const { hostname, pathname } = new URL(href);
      return `https://${hostname === 'cnnespanol.cnn.com' ? hostname : 'www.cnn.com'}${pathname}`;
    },
    // Articles: /2026/11/13/us/new-orleans-tanker-crash (older ones end in /index.html).
    isArticle: path => /^\/\d{4}\/\d{2}\/\d{2}\/[a-z-]+\/[a-z0-9-]+(\/index\.html)?\/?$/.test(path),
    live: {
      body: BODY,
      wall: {
        services: ['piano'],
        detect: adapter.anyOf(adapter.anyShown('.tp-modal'), adapter.walledArticle({ body: BODY })),
        type: adapter.textOnPage(BODY),
      },
    },
  });

  if (typeof module === 'object' && module.exports) module.exports = site;
})(globalThis);
