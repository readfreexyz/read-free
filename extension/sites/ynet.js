// Ynet (docs/outlet-coverage.md, "Batch 7"), the Hebrew site (ynet.co.il). Its English one
// (ynetnews.com) is free: 3 of 3 samples. Seen in the built-in browser, signed out, 2026-11-25.
// - ynet+ articles are sent whole: the paragraphs (div.text_editor_paragraph, no <p>) are in
//   #ArticleBodyComponent [data-contents="true"] (a Draft.js editor), 21 in one, 10,542 characters,
//   and the JSON-LD has them all (marked paywalled, wordCount 1,668).
// - Once the site has decided the reader isn't a subscriber (a request, after React starts), it
//   draws the wall (div.paywall-wrapper > #ynet_premium_blocked) in the paragraph where the free
//   part ends, and cutArticlePremiumContent() empties the container (innerHTML = "") and puts
//   the wall's own paragraph back alone. The drawn page kept 780 characters, the wall's included.
// - page/ynet.js, in the page's own world, keeps that container from being emptied, so the text
//   stays and the wall only needs hiding. If the cut happens anyway, archive.today fills in.
(function (root) {
  'use strict';

  const adapter = root.NYTFix?.adapter || require('../src/adapter.js');
  const BODY = '#ArticleBodyComponent';
  const BLOCK = `${BODY} [data-contents="true"] > *`; // paragraphs, headings, lists, quotes, figures
  const WALL = `${BODY} .paywall-wrapper`;
  const shown = adapter.anyShown(WALL);

  // Without the guard, is the text there? Against the JSON-LD's wordCount. The paragraphs aren't
  // <p>s (so not adapter.textOnPage), and much of some pieces is in lists: the container's blocks,
  // which held at least 99% of the JSON-LD's words in 5 of 5 (its paragraphs 57 to 99%).
  function whole(doc) {
    const words = [...doc.querySelectorAll(BLOCK)].reduce((n, el) => n + el.textContent.trim().split(/\s+/).filter(Boolean).length, 0);
    const ld = adapter.articleLd(doc);
    const expected = ld && (ld.wordCount || ld.bodyWords);
    return expected ? words >= expected * 0.75 : words >= 150;
  }

  const site = adapter.defineSite({
    id: 'ynet',
    name: 'Ynet',
    shortName: 'Ynet',
    hosts: ['www.ynet.co.il'],
    // Articles: /news/article/yokra14963006, /article/h1oypwysn.
    isArticle: path => /^(\/[a-z0-9-]+)*\/article\/[a-z0-9]+\/?$/i.test(path),
    live: {
      body: BODY,
      story: '.article-body, main',
      textTemplate: '<div class="text_editor_paragraph rtl"><p></p></div>',
      wall: {
        detect: adapter.anyOf(adapter.wallHeld, shown),
        hide: WALL,
        // Held: never cut, however the words add up.
        type: doc => (adapter.wallHeld(doc) || whole(doc) ? 'lift' : 'paywall'),
      },
    },
  });

  if (typeof module === 'object' && module.exports) module.exports = site;
})(globalThis);
