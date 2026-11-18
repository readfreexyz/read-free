// National Post, on Postmedia's WordPress platform (docs/outlet-coverage.md, batch 3).
// - The server trims paywalled articles: one paragraph (about 30 words) in the article body,
//   .article-content__content-group, then an empty div.pmd-paywall-trimmed-marker. The JSON-LD
//   flags them (isAccessibleForFree: false, hasPart .article-content__content-group) and gives
//   the full length (891 and 1,587 words in two samples). Nothing else on the page holds the
//   rest, so there's nothing to stop: the rest comes from archive.today.
// - Until its paywall script (Naviga Engage) decides, CSS keeps the body invisible
//   (html:not(.naviga-paywall-resolved)); content.css shows a body holding archived text anyway.
//   A metered-out reader may get .pmd-paywall-redirect-overlay, which locks scrolling.
// - Its ad-blocker notice (Admiral: a full-screen fixed box with random class names, scrolling
//   locked) is hidden by notices.js, as on every supported site.
// - archive.today: one sample had a single snapshot, 37 paragraphs with subheadings and
//   captioned photos, found automatically. A video player sat in the middle (pm-jw-player: its
//   controls' labels and "Next Up" list); it's skipped.
// - Automated browsers get TollBit's 402 page (tollbit.nationalpost.com) instead of articles.
(function (root) {
  'use strict';

  const adapter = root.NYTFix?.adapter || require('../src/adapter.js');
  const BODY = '.article-content__content-group';
  const TRIMMED = '.pmd-paywall-trimmed-marker';

  const site = adapter.defineSite({
    id: 'nationalpost',
    name: 'National Post',
    shortName: 'National Post',
    hosts: ['nationalpost.com', 'www.nationalpost.com'],
    // Articles: /news/defence/canada-military-exercises-arctic/, /opinion/np-view-some-title/.
    // Section pages (/news/canada/) have no hyphenated slug; author and tag pages are left out.
    isArticle: path => /^\/[a-z0-9-]+\/(?:[a-z0-9-]+\/)*[a-z0-9]+(?:-[a-z0-9]+){2,}\/?$/.test(path) && !/^\/(author|category|tag|page)\//.test(path),
    live: {
      body: BODY,
      wall: {
        detect: adapter.anyOf(doc => Boolean(doc.querySelector(TRIMMED)), adapter.cutBody({ body: BODY, maxWords: 150 })),
        hide: [TRIMMED, '.pmd-paywall-redirect-overlay'],
        type: () => 'paywall',
      },
    },
    snapshot: {
      skip: 'pm-jw-player',
      junk: /^(this advertisement has not loaded yet, but your article continues below\.?|article content|share this article in your social network)$/i,
    },
  });

  if (typeof module === 'object' && module.exports) module.exports = site;
})(globalThis);
