// El Mundo (docs/outlet-coverage.md, "Batch 6"). Piano. THE WALL HASN'T BEEN SEEN.
// - Sends the whole article to a signed-out reader, premium-marked articles included: the
//   paragraphs (p.ue-c-article__paragraph) are in div.ue-c-article__body, and the JSON-LD's
//   articleBody matches them (6,956 of 6,779 characters and 2,505 of 2,471 in two premium
//   articles; 4,362 of 4,450 in a third, drawn, all nine paragraphs showing). It marks every
//   article paywalled.
// - In the built-in browser (2026-11-16) the cookie-consent popup (Didomi: accept or subscribe)
//   was up, with <body> scrolling locked, and no wall behind it; Piano's slot
//   (.tp-container-inner) was empty. What Piano does once consent is answered wasn't seen.
// - So this goes on the general signs only: Piano's modal showing, or the text clipped, hidden
//   at its end, or cut short of the JSON-LD's length. Locked scrolling isn't a sign (the consent
//   popup locks it). With the text there, Piano's modal is hidden; if it was cut, archive.today
//   fills in. No selectors for markup that wasn't seen.
(function (root) {
  'use strict';

  const adapter = root.NYTFix?.adapter || require('../src/adapter.js');
  const BODY = '.ue-c-article__body';

  const site = adapter.defineSite({
    id: 'elmundo',
    name: 'El Mundo',
    shortName: 'El Mundo',
    hosts: ['www.elmundo.es'],
    // Articles: /espana/2026/11/15/6af990c1e9cf4a301c8b4585.html (a date, then a 24-digit hex id).
    isArticle: path => /\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f]{24}\.html$/.test(path),
    live: {
      body: BODY,
      wall: {
        services: ['piano'],
        detect: adapter.anyOf(adapter.anyShown('.tp-modal'), adapter.walledArticle({ body: BODY, locked: false })),
        type: adapter.textOnPage(BODY),
      },
    },
  });

  if (typeof module === 'object' && module.exports) module.exports = site;
})(globalThis);
