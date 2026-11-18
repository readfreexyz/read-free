// The Wall Street Journal (docs/outlet-coverage.md, batch 2). Seen in the user's Chrome:
// - The page sends a few paragraphs (4, two of them hidden) in a section under
//   article div.crawler; every article is flagged paywalled (hasPart .paywall).
// - The wall is Piano's: the snippet overlay right after them (ids starting cx-snippet, in a
//   wrapper div) and the offer panel fixed at the bottom of the screen (#cx-candybar, with
//   #cx-scrim and #cx-sign-in-reminder). Every cx- element but the menu's subscribe button is
//   hidden.
// - archive.today has them (2 of 2 in the survey; captures sometimes come back empty, and the
//   newest lookup can time out). The text is under div#__next, found automatically; reader
//   comments sit apart (#comments_sector). The byline's "By" / "and" and the dateline are
//   dropped.
(function (root) {
  'use strict';

  const adapter = root.NYTFix?.adapter || require('../src/adapter.js');
  const BODY = 'article .crawler > section:has(> p)';
  const SNIPPET = '[id^="cx-snippet"]';
  // Piano's offer panel: a fixed panel at the bottom (#cx-candybar, its iframe 515 px tall in the
  // user's Chrome), a scrim and a sign-in reminder beside it.
  const PANEL = '#cx-candybar';
  const PIANO = '[id^="cx-"]:not(#cx-customer-nav-subscribe-btn)';

  const site = adapter.defineSite({
    id: 'wsj',
    name: 'The Wall Street Journal',
    shortName: 'WSJ',
    hosts: ['www.wsj.com'],
    // Articles: /us-news/slug-b9b06e59, /politics/elections/slug-8172c7e9, /articles/slug-12345678.
    isArticle: path => /^\/(articles\/[a-z0-9-]+|[a-z-]+(\/[a-z-]+)*\/[a-z0-9-]+-[0-9a-f]{8})$/.test(path),
    live: {
      body: BODY,
      wall: {
        services: ['piano'],
        detect: adapter.anyOf(adapter.anyShown([PANEL, SNIPPET]), adapter.cutBody({ body: BODY, maxWords: 200 })),
        hide: [`div:has(> ${SNIPPET})`, PIANO],
        type: () => 'paywall',
      },
    },
    snapshot: {
      skip: '#comments_sector',
      junk: /^(by|and|(updated )?[a-z]{3}\.? \d{1,2}, \d{4}( \d{1,2}:\d{2} [ap]m e[sd]?t)?)$/i,
    },
  });

  if (typeof module === 'object' && module.exports) module.exports = site;
})(globalThis);
