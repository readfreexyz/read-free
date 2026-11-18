// Der Spiegel (docs/outlet-coverage.md, batch 2). Seen in a fresh browser profile:
// - A Spiegel+ article sends none of its text. Its body, div[data-area="body"], holds only
//   the offer block, [data-area="paywall"]; the JSON-LD flags it paywalled (free articles say
//   true).
// - Free articles' paragraphs have no class; they sit in div.RichText inside
//   div[data-area="text"] blocks. With none on a Spiegel+ page, the archived text gets that
//   wrapper from live.textTemplate.
// - archive.today has them (2 of 2), the text found automatically (10 paragraphs from the
//   Spiegel+ sample).
(function (root) {
  'use strict';

  const adapter = root.NYTFix?.adapter || require('../src/adapter.js');
  const BODY = 'main [data-area="body"]';
  const OFFER = '[data-area="body"] [data-area="paywall"]';

  const site = adapter.defineSite({
    id: 'spiegel',
    name: 'Der Spiegel',
    shortName: 'Spiegel',
    hosts: ['www.spiegel.de'],
    // Articles: /politik/slug-a-64982c32-c954-4d6b-a066-01e7d6b7141e (older: …-a-1234567.html).
    isArticle: path => /-a-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+(\.html)?)$/.test(path),
    live: {
      body: BODY,
      textTemplate: '<div data-area="text"><div class="RichText lg:w-8/12 md:w-10/12 lg:mx-auto md:mx-auto lg:px-24 md:px-24 sm:px-16 break-words word-wrap"><p></p></div></div>',
      wall: {
        detect: adapter.anyShown(OFFER),
        hide: OFFER,
        type: () => 'paywall',
      },
    },
  });

  if (typeof module === 'object' && module.exports) module.exports = site;
})(globalThis);
