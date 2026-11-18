// NRC (docs/outlet-coverage.md, "Batch 6"). Its own paywall, metered (the count is kept in
// localStorage, under "demeter"). Seen in the built-in browser, signed out, 2026-11-16.
// - The server sends the whole article to everyone, wall or no wall: the paragraphs are direct
//   children of div.vorm__article-content.googlebot-article-content, the selector its JSON-LD
//   names (isAccessibleForFree: false on every article). The first article read was whole and
//   showing: 30 paragraphs, 1,501 words. The JSON-LD gives no length.
// - The wall came up on the second article. The page as fetched still held 29 paragraphs and
//   11,358 characters (with the reader's cookies or without), but the page as drawn kept one
//   paragraph of 391 characters: the site's script cut the rest. <body> gets has-paywall,
//   <html> disable-overflow-fixed (scrolling locked), and <div class="paywall paywall--hard">
//   (a .paywall__mask and a .paywall__container, position: fixed) sits under <body>.
// - On an article without the wall the same place holds a dormant block,
//   <div class="paywall hidden paywall--inline">; it's no sign of a wall.
// - The cut is NRC's own script (main.js, paywall/Paywall.js): once Zephr and Sophi have decided
//   (four or five requests in a row, starting after the page is parsed; on 2026-11-16 the page
//   was parsed at 1.8 s and the last answer came at 4.8 s), Paywall.show() locks scrolling, marks
//   <body>, shows the block as the hard wall, and clipArticleContent() removes every child of the
//   article after the first paragraph, from the last one back. That's seconds after this script
//   starts, so the paragraphs are kept (live.keep): each one goes straight back as it's removed,
//   and the wall then comes off a whole article. If the cut ever comes first, the page is cut and
//   archive.today fills in (it had a same-day copy of the walled article).
// - Some articles are short (a 117-word "docu hit", two paragraphs), and the JSON-LD gives no
//   length, so a word count can't tell a short article from a cut one. The sign of the wall is
//   the hard wall (show() draws it in the same call as the cut), or the end of the text hidden or
//   clipped; never the length alone, and not locked scrolling (the consent popup can lock it too).
//   Under the hard wall, the text is whole if the extension put the cut back (adapter.cutKept),
//   however short; otherwise it's whole at 150 words, and below that archive.today fills in.
(function (root) {
  'use strict';

  const adapter = root.NYTFix?.adapter || require('../src/adapter.js');
  const BODY = '.vorm__article-content';
  const WALL = 'body > .paywall--hard';
  const textOnPage = adapter.textOnPage(BODY, { minWords: 150 });

  const site = adapter.defineSite({
    id: 'nrc',
    name: 'NRC',
    shortName: 'NRC',
    hosts: ['www.nrc.nl'],
    // Articles: /nieuws/2026/11/15/de-warme-band-tussen-de-vs-en-israel-…-a4941362.
    isArticle: path => /^\/nieuws\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+-a\d+\/?$/.test(path),
    live: {
      body: BODY,
      keep: `${BODY} > *`,
      wall: {
        detect: adapter.anyOf(adapter.anyShown([WALL]), adapter.walledArticle({ body: BODY, minWords: 0, locked: false })),
        hide: [WALL],
        type: doc => (adapter.cutKept(doc) ? 'lift' : textOnPage(doc)),
      },
    },
  });

  if (typeof module === 'object' && module.exports) module.exports = site;
})(globalThis);
