// The Spectator (docs/outlet-coverage.md, batch 3). spectator.co.uk now redirects to
// spectator.com, one site for both editions (?edition=uk / us).
// - Sends the whole article to everyone: div.entry-content holds the free part in
//   span.non-paywalled-content and the rest in span.paywalled-content, the selector its JSON-LD
//   names (isAccessibleForFree: false). Together they match the JSON-LD's wordCount (1,051 of
//   1,051 and 811 of 838 words in two samples).
// - The wall is Piano's (the site's Zephr markers are left over). Magazine articles ("for
//   subscribers only") get it at once: .entry-content is clipped to max-height: 650px with
//   overflow hidden, the rest of the text still in it, under a white fade (.reggradient, 300px)
//   and above Piano's offer box (.below-article-paywall, 586px). Others are metered (none in five
//   articles in a fresh profile). The wall check takes the general signs: the body clipped, or
//   the paid part hidden or cut short of the JSON-LD's length. With the text
//   there, the clip comes off, the paid part shows, and the fade and Piano's boxes are hidden.
//   If it's gone, archive.today fills in.
(function (root) {
  'use strict';

  const adapter = root.NYTFix?.adapter || require('../src/adapter.js');
  const BODY = '.entry-content';

  const site = adapter.defineSite({
    id: 'spectator',
    name: 'The Spectator',
    shortName: 'The Spectator',
    hosts: ['spectator.com', 'www.spectator.com', 'www.spectator.co.uk', 'spectator.co.uk'],
    // Articles: /article/will-nigel-farage-go-down-with-donald-trump/.
    isArticle: path => /^\/article\/[a-z0-9-]+\/?$/.test(path),
    live: {
      body: BODY,
      wall: {
        services: ['piano'],
        // Locked scrolling isn't counted: the wall doesn't lock it, and Sourcepoint's consent
        // dialog can.
        detect: adapter.anyOf(adapter.anyShown('.tp-modal'), adapter.walledArticle({ body: BODY, locked: false })),
        reveal: ['.entry-content', '.entry-content .paywalled-content'],
        hide: ['.entry-content .reggradient', '.below-article-paywall'],
        type: adapter.textOnPage(BODY),
      },
    },
  });

  if (typeof module === 'object' && module.exports) module.exports = site;
})(globalThis);
