// The New Yorker, on Condé Nast's shared platform (docs/multi-site-investigation.md).
// - Snapshots: main#main-content > article holds the header (skipped) and the body in div > div
//   > div, with share buttons (role="button") and a video player region among the paragraphs.
// - Live page: the body comes in several div.body__inner-container chunks with ads between
//   them. The full text is in the page the server sends, wall or no wall: paragraphs past the
//   free part carry class "paywall".
// - The wall, seen 2026-11-24, signed out, on a first visit: 5 to 7 s after the page starts, Condé
//   Nast's subscription engine (script#journey) puts an offer in the article
//   ([data-testid=BodyWrapper] > .journey-unit__container: a subscription offer or a newsletter
//   sign-up, class names ending in hashes) and deletes everything after the first paragraph
//   (45 paragraphs down to 1), again and again if it's put back. aside.paywall-modal stays empty.
//   page/newyorker.js refuses those deletions and says so (adapter.wallHeld), and the offer is
//   hidden. JSON-LD is no help in telling a walled page: it says isAccessibleForFree: true, but
//   it carries the whole text (articleBody), which tells a cut page from a whole one.
// - The modal (aside.paywall-modal, two on the page, one for private windows) hasn't been seen
//   filled; newyorker.css hides it and shows any hidden .paywall paragraphs.
// - If the text is cut all the same, archive.today fills in.
(function (root) {
  'use strict';

  const adapter = root.NYTFix?.adapter || require('../src/adapter.js');
  const BODY = 'div[data-testid="BodyWrapper"] .body__inner-container';
  const OFFER = 'div[data-testid="BodyWrapper"] > .journey-unit__container';
  const filled = (doc, selector) => [...doc.querySelectorAll(selector)].some(el => el.textContent.trim().length > 0);

  const site = {
    id: 'newyorker',
    name: 'The New Yorker',
    shortName: 'The New Yorker',
    hosts: ['www.newyorker.com'],

    // Articles: /news/the-lede/slug, /culture/critics-notebook/slug, /magazine/2026/11/23/slug.
    isArticle: path => /^\/(magazine\/\d{4}\/\d{2}\/\d{2}|[a-z-]+\/[a-z-]+)\/[a-z0-9-]+$/.test(path),
    isLive: () => false,
    normalizeUrl: href => `https://www.newyorker.com${new URL(href).pathname}`,

    live: {
      body: BODY,
      story: 'main#main-content article',
      main: 'main#main-content',
      upsellLink: null,
      wall: {
        popup: 'aside.paywall-modal',
        // The guard held back the cut; or an offer is up in an article cut short; or the modal,
        // in every page but empty, is filled. An offer alone is no wall: a newsletter sign-up can
        // sit in an article that's whole.
        detect: doc => adapter.wallHeld(doc) || filled(doc, 'aside.paywall-modal') ||
          (filled(doc, OFFER) && adapter.wholeTextOnPage(doc, BODY) === false),
        // The paragraphs past the free part are still on the page: lifting is enough.
        type: doc => (adapter.wallHeld(doc) || doc.querySelector('.body__inner-container .paywall') ? 'lift' : 'paywall'),
        hide: [OFFER],
        liftedMessage: 'Removed the paywall. The whole article was already on the page.',
        inert: null,
        container: null,
      },
    },

    snapshot: {
      body: ['main#main-content > article'],
      skip: '[aria-label="Video Player"]',
      junk: null,
      // Condé Nast's image server takes the width in the path: …/w_1280,c_limit/… in the
      // snapshots checked. Asking for 2,560 gets the largest it has (2,048 px seen).
      hiresImage: src => {
        if (!/^https:\/\/media\.newyorker\.com\//.test(src)) return null;
        const match = /\/w_(\d+),c_limit\//.exec(src);
        if (!match || Number(match[1]) >= 2560) return null;
        return src.replace(match[0], '/w_2560,c_limit/');
      },
    },
  };

  root.NYTFix = root.NYTFix || {};
  root.NYTFix.sites = Object.assign(root.NYTFix.sites || {}, { [site.id]: site });
  if (typeof module === 'object' && module.exports) module.exports = site;
})(globalThis);
