// USA Today (docs/outlet-coverage.md, batch 5).
// - Articles are free and whole: the JSON-LD marks them free (isAccessibleForFree true), and
//   div.gnt_ar_b holds every paragraph (34 and 1,309 words, 48 and 1,216 words in two samples).
//   No paywall was seen.
// - What does show is Admiral's ad-blocker popup ("It looks like you're using an adblocker"): a
//   fixed box straight under <body>, with random class names, scrolling locked on <html>.
//   notices.js hides it and unlocks scrolling, as on every supported site; this adapter is
//   what makes USA Today one.
// - If a story is ever marked paywalled and shows a sign of a wall, the general checks apply:
//   the cover comes off if the text is there, else archive.today fills in.
(function (root) {
  'use strict';

  const adapter = root.NYTFix?.adapter || require('../src/adapter.js');
  const BODY = '.gnt_ar_b';

  const site = adapter.defineSite({
    id: 'usatoday',
    name: 'USA Today',
    shortName: 'USA Today',
    hosts: ['www.usatoday.com'],
    // Articles: /story/news/politics/elections/2026/11/15/some-slug/92676928007/.
    isArticle: path => /^\/story\/[a-z0-9/-]+\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+\/\d+\/?$/.test(path),
    live: {
      body: BODY,
      wall: {
        detect: adapter.walledArticle({ body: BODY, locked: false }),
        type: adapter.textOnPage(BODY, { minWords: 250 }),
      },
    },
  });

  if (typeof module === 'object' && module.exports) module.exports = site;
})(globalThis);
