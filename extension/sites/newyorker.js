// The New Yorker, on Condé Nast's shared platform (docs/multi-site-investigation.md).
// - Snapshots: main#main-content > article holds the header (skipped) and the body in div > div
//   > div, with share buttons (role="button") and a video player region among the paragraphs.
// - Live page: the body comes in several div.body__inner-container chunks with ads between
//   them. The full text is on the page: paragraphs past the free part carry class "paywall",
//   and an aside.paywall-modal pops up when the meter runs out. Seen only inactive so far (the
//   modal empty and 0×0, full text present), so: newyorker.css hides the modal and shows any
//   hidden .paywall paragraphs, and when those paragraphs are on the page that's all it takes,
//   like NYT's login wall. If they're ever missing, archive.today fills in.
(function (root) {
  'use strict';

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
      body: 'div[data-testid="BodyWrapper"] .body__inner-container',
      story: 'main#main-content article',
      main: 'main#main-content',
      upsellLink: null,
      wall: {
        popup: 'aside.paywall-modal',
        // The modal is in every page, empty, until the meter runs out.
        detect: doc => [...doc.querySelectorAll('aside.paywall-modal')].some(modal => modal.textContent.trim().length > 0),
        // The paragraphs past the free part are still on the page: lifting is enough.
        type: doc => (doc.querySelector('.body__inner-container .paywall') ? 'login' : 'paywall'),
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
