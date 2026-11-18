// The Age and the Sydney Morning Herald, on Nine's shared platform (docs/outlet-coverage.md,
// batch 2). Seen in a fresh browser profile and the user's Chrome:
// - The page sends only the first paragraphs (2 seen, about 75 words), in a div of unclassed
//   <p>s inside main#content .article (the article container, also classed .paywall, the
//   selector the JSON-LD names; every article is flagged paywalled). Class names are hashed.
// - Where that div sits depends on the layout. In a narrow window it's a child of .article; in
//   a wide one it's a level down, in a column next to an ad rail, with the article footer
//   (Save / Gift / Share, the author's bio, the comments prompt, "Most viewed") after it in the
//   same column. Opinion pieces put the standfirst (a classed <p>) in a div of its own under the
//   headline. The body is told apart by its unclassed <p>s; the header, the share buttons, the
//   footer (all marked with data-testid) and Piano's slots are left out.
// - The wall is Piano's: slots by id ending in -piano-id (#paywall-prompt-wrapper-piano-id,
//   marked .paywall-prompt-piano-active while up, #hard-reg-wall-piano-id, #meter-prompt-piano-id,
//   the "subscribe to comment" prompt #comments-cta-piano-id and others), with scrolling locked
//   by an inline overflow: hidden on <body>.
// - The cut happens in the browser: Piano fires a `pianoContentWall` event and Nine's React
//   code cuts the body to 2 blocks. page/nine.js, in the page's own world, holds that event
//   back, so the whole article stays and the wall only needs lifting (Piano's subscribe box
//   still shows). Should the cut happen anyway (the guard missing it, or after the reader asked
//   for the site's version), the rest comes from archive.today as before.
// - archive.today has them (3 of 4 samples). The text is under main#content, found
//   automatically; the "most viewed" and "from our partners" sections after it are skipped, as
//   are its share labels.
(function (root) {
  'use strict';

  const adapter = root.NYTFix?.adapter || require('../src/adapter.js');
  // Piano's slots, except the header's subscribe button.
  const PROMPTS = '[id$="-piano-id"]:not([id^="homepage-header"])';
  const BODY = 'main#content .article div:has(> p:not([class])):not(.nytfix-body, header *, [data-testid] *, [id$="-piano-id"], [id$="-piano-id"] *)';
  // Cut to the first blocks: about 75 words were seen.
  const cut = adapter.cutBody({ body: BODY, maxWords: 150 });

  const shared = {
    // Articles: /national/victoria/slug-20261114-p61d87.html.
    isArticle: path => /-\d{8}-p[0-9a-z]{5}\.html$/.test(path),
    live: {
      body: BODY,
      wall: {
        services: ['piano'],
        detect: adapter.anyOf(
          adapter.wallHeld,
          doc => Boolean(doc.querySelector('.paywall-prompt-piano-active')),
          cut,
        ),
        hide: PROMPTS,
        // The article was never cut (page/nine.js held the cut back): lift. Cut: archive.today.
        type: doc => (cut(doc) ? 'paywall' : 'lift'),
      },
    },
    snapshot: {
      skip: 'section',
      junk: /^(no gift articles left|license this article|gift this article|more:|save|share)$/i,
    },
  };

  const sites = [
    adapter.defineSite({ id: 'theage', name: 'The Age', shortName: 'The Age', hosts: ['www.theage.com.au'], ...shared }),
    adapter.defineSite({ id: 'smh', name: 'The Sydney Morning Herald', shortName: 'The Herald', hosts: ['www.smh.com.au'], ...shared }),
  ];

  if (typeof module === 'object' && module.exports) module.exports = sites;
})(globalThis);
