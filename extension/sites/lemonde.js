// Le Monde (docs/outlet-coverage.md, batch 2), in French and English (/en/). Seen in a fresh
// browser profile:
// - A subscriber article sends its first paragraphs (4, p.article__paragraph) in
//   article.article__content. The JSON-LD names the rest .article__reserved-content, which isn't
//   on the page at all; the offer block is section.paywall.js-paywall.
// - So the wall is up when the article is flagged paywalled and the reserved part is missing.
// - archive.today has them (1 of 2), the text found automatically. "Read more" labels are
//   dropped (the linked titles after them are, as link-only lines, everywhere).
// - The cookie-consent wall (.gdpr-lmd-wall) is the reader's choice and is left alone.
(function (root) {
  'use strict';

  const adapter = root.NYTFix?.adapter || require('../src/adapter.js');
  // article.article__content on regular articles, section.article__content inside
  // article#Longform on long reads (M le mag).
  const BODY = '.article__content:has(> p)';
  const RESERVED = '.article__reserved-content';

  const site = adapter.defineSite({
    id: 'lemonde',
    name: 'Le Monde',
    shortName: 'Le Monde',
    hosts: ['www.lemonde.fr'],
    // Articles: /en/politics/article/2026/11/14/slug_6780688_5.html, /politique/article/…
    isArticle: path => /\/article\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+_\d+_\d+\.html$/.test(path),
    live: {
      body: BODY,
      wall: {
        detect: doc => {
          const ld = adapter.articleLd(doc);
          return Boolean(ld && ld.paywalled && ld.parts.includes(RESERVED) && doc.querySelector(BODY) && !doc.querySelector(RESERVED));
        },
        hide: 'section.js-paywall',
        type: () => 'paywall',
      },
    },
    snapshot: {
      junk: /^(read more|lire aussi|lire plus tard|à lire aussi|subscribers only|réservé à nos abonnés)$/i,
    },
  });

  if (typeof module === 'object' && module.exports) module.exports = site;
})(globalThis);
