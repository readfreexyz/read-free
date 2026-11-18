// Corriere della Sera (docs/outlet-coverage.md, batch 3).
// - Sends the whole article to everyone, subscriber-only ("premium") articles included: the text
//   is in div.content blocks (ids like m72800-72799-72801) in #content-to-read, and the JSON-LD's
//   articleBody and wordCount match it (650 of 650, 498 of 496, 812 of 793 words in three
//   premium samples, fetched with no cookies). It marks them paywalled ("False").
// - The local editions (milano.corriere.it, roma.…) are the same platform, under
//   /notizie/<section>/.
// - The wall: Piano decides, then fires 'pno_abc_test:init', and Corriere's AbcTestPaywall either
//   deletes every block after the first (an inline wall, #pno_wall_inline) or locks scrolling
//   under Piano's modal (tp-scroll-prevented); other readers get Piano's full-page modal. Seen by
//   the user on milano.corriere.it, shortly after load. page/corriere.js holds that event back
//   (and the ad-blocker popup's), so the text stays; the content script then hides Piano's modal
//   and inline wall and unlocks scrolling. The wall check also takes the general signs (text cut
//   short of the JSON-LD's length, clipped or hidden). If the text was deleted anyway,
//   archive.today fills in.
// - Private windows get another wall (Corriere tells Piano privateBrowser: true; seen in the
//   user's incognito window, reproduced by setting that flag): once the cookie wall is answered,
//   Piano's full-page .tp-modal.wall-modal goes up over a near-opaque backdrop, and a few
//   seconds in the page is emptied, all at once: the header's top bar and section menu
//   (#l-header > div > .container), the article (#content-to-read, section.body-article, the
//   main div.container), the right-hand column (.aside-right) and the footer's content
//   (#l-footer > div > .container). Lifting the modal left a white page. live.keep names those
//   parts, and anything removed that is or holds one is put back as it goes. Corriere's own
//   widgets (comments, tags) redraw themselves and are left alone.
// - The cookie-consent wall (pay or accept) is a separate choice and is left alone, as is the
//   "reading on another device" notice (.modal-access). The consent wall pins <body>
//   (position: fixed), so locked scrolling isn't taken as a sign of the paywall here.
(function (root) {
  'use strict';

  const adapter = root.NYTFix?.adapter || require('../src/adapter.js');
  const BODY = '#content-to-read > .content[id^="m"]';

  const site = adapter.defineSite({
    id: 'corriere',
    name: 'Corriere della Sera',
    shortName: 'Corriere',
    hosts: ['www.corriere.it', '*.corriere.it'],
    // Keep the edition: milano.corriere.it's articles are archived under that host.
    normalizeUrl: href => {
      const url = new URL(href);
      return `https://${url.hostname}${url.pathname}`;
    },
    // Articles: /esteri/26_novembre_14/slug-8e63fa3b-6c0d-49ae-827c-f09199dc9xlk.shtml (the id's
    // last part ends in letters); /notizie/cronaca/26_novembre_15/slug-….shtml on the editions.
    isArticle: path => /\/\d{2}_[a-z]+_\d{1,2}\/[a-z0-9-]+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-z]{12}\.shtml$/.test(path),
    live: {
      body: BODY,
      keep: [
        '#l-header > div > .container', // the top bar (logo, sign-in) and the section menu
        '#l-main > .wrapper > .container', // headline and article
        '#content-to-read',
        '.aside-right', // the right-hand column
        '#l-footer > div > .container',
      ].join(', '),
      wall: {
        services: ['piano'],
        detect: adapter.anyOf(adapter.wallHeld, adapter.anyShown('.tp-modal'), adapter.walledArticle({ body: BODY, locked: false })),
        hide: ['#pno_wall_inline', '.manona-wrapper'],
        type: adapter.textOnPage(BODY),
      },
    },
  });

  if (typeof module === 'object' && module.exports) module.exports = site;
})(globalThis);
