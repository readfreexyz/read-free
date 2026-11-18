// ABC (Spain, www.abc.es; docs/outlet-coverage.md, "Batch 6"). Vocento's platform, Evolok's
// paywall. Seen in the built-in browser, signed out, 2026-11-16.
// - Sends the whole article to everyone, subscriber-only ones included: after the first
//   paragraph (p.v-d-p, which ends in span.paywall, shown, and span.c-text, an ellipsis), the
//   rest is in div.paywall, with the `hidden` attribute (19 paragraphs and 13k characters in
//   one premium article, matching the JSON-LD's articleBody, which marks it paywalled with
//   cssSelector ".paywall").
// - The cut is an inline script on the page. Everything for subscribers carries one random
//   attribute (data-0f4d396afa946b14d21 on that page) and everything for the rest another
//   (data-ffdb2e6afa946b14d2f). Once Evolok answers ('rtim:ev-auth-ready', about 0.7 s after the
//   page was parsed), ALLOW_ACCESS unhides the first kind and removes the second; anything else
//   removes the first kind (div.paywall and span.paywall are deleted) and unhides the second:
//   the ellipsis and an empty <div> holding <ev-engagement>, Evolok's offer.
// - So the text is kept (live.keep): deleted, it's put straight back. The wall check takes the
//   general signs (the end of the text hidden, or cut short of the JSON-LD's length), the lift
//   shows div.paywall and hides the ellipsis and the offer. If the deletion came before this
//   script started, the page is cut and archive.today fills in.
// - A metered article that the reader may read has its div.paywall hidden too until Evolok
//   answers, so for that moment it reads as a wall. It's lifted at once (the reader never waits
//   on Evolok), but nothing is said until the page has decided (live.wall.decision): the paid
//   part deleted (and put back) is a wall; the ellipsis removed means the reader may read, and
//   the lift is taken back, silently; no answer in 6 s means the text would have stayed hidden,
//   which is a wall too. The random attributes aren't used: they're unknown before the page
//   loads, and a wrong guess would leave the text hidden.
// - The cookie-consent popup (Didomi, drawn by Evolok's .evolok-popup-container, with a decline
//   button) locks <body> scrolling, so locked scrolling isn't taken as a sign of the paywall.
//   It's a separate choice and is left alone.
// - Not checked: the regional editions (sevilla.abc.es and others).
(function (root) {
  'use strict';

  const adapter = root.NYTFix?.adapter || require('../src/adapter.js');
  const BODY = '.v-d--1';
  const PAID = ['.v-d--1 div.paywall', '.v-d--1 span.paywall'];
  const ELLIPSIS = '.v-d--1 > p > .c-text'; // for readers without access; removed for the rest

  const site = adapter.defineSite({
    id: 'abces',
    name: 'ABC (Spain)',
    shortName: 'ABC',
    hosts: ['www.abc.es'],
    // Articles: /espana/moncloa-guarda-grabacion-…-20261113010127-nt.html (a 14-digit time).
    isArticle: path => /-\d{14}-nts?\.html$/.test(path),
    live: {
      body: BODY,
      keep: PAID.join(', '),
      wall: {
        detect: adapter.walledArticle({ body: BODY, locked: false }),
        reveal: [PAID[0]], // span.paywall is never hidden, only deleted
        hide: [ELLIPSIS, '.v-d--1 ev-engagement'],
        type: adapter.textOnPage(BODY),
        decision: {
          pending: doc => Boolean(doc.querySelector(PAID[0]) && doc.querySelector(ELLIPSIS)),
          allowed: doc => Boolean(doc.querySelector(PAID[0])) && !doc.querySelector(ELLIPSIS),
          waitMs: 6000,
        },
      },
    },
  });

  if (typeof module === 'object' && module.exports) module.exports = site;
})(globalThis);
