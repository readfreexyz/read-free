// Financial Times (docs/multi-site-investigation.md).
// - Snapshots: archive.today has FT articles quickly and completely, with the body in
//   article#article-body.
// - Live page, for non-subscribers: not the article with a wall over it, but a whole "barrier
//   page" (title "Subscribe to read"): main#site-content > div#barrier-page, holding the
//   headline (an h1) and subscription offers. No article body, no inert, no overlay, no
//   scroll lock. So the archived article is inserted rather than swapped in: ft.css trims the
//   barrier page to its headline before first paint, and the text goes right after it.
(function (root) {
  'use strict';

  const site = {
    id: 'ft',
    name: 'Financial Times',
    shortName: 'FT',
    hosts: ['www.ft.com'],

    // Articles: /content/<uuid>.
    isArticle: path => /^\/content\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(path),
    isLive: () => false,
    normalizeUrl: href => `https://www.ft.com${new URL(href).pathname}`,

    live: {
      body: null,                    // the barrier page has no article to swap out
      insertAfter: '#barrier-page',  // so the archived article goes right after it (its headline)
      story: 'main#site-content',
      main: 'main#site-content',
      upsellLink: null,              // the offers are part of the barrier page, hidden by ft.css
      wall: {
        popup: '#barrier-page',      // present (with content) only for non-subscribers
        inert: null,                 // FT doesn't make anything inert
        container: null,             // no scrim to hide
        login: null,                 // FT's barrier is always treated as a paywall
      },
    },

    snapshot: {
      // Three samples: article#site-content[role=main] > div > article#article-body. The
      // "Recommended" box sits in an <aside> inside it (skipped), comments in a separate <main>.
      body: ['#article-body'],
      junk: /^(recommended|follow the topics in this article)$/i,
      // FT's image service resizes on request: ?width=490 in the snapshots checked. Twice that
      // loads fine.
      hiresImage: src => {
        let url;
        try { url = new URL(src); } catch { return null; }
        if (!/(^|\.)ft\.com$/.test(url.hostname)) return null;
        const width = Number(url.searchParams.get('width'));
        if (width > 0) url.searchParams.set('width', String(Math.min(width * 2, 2048)));
        else if (url.searchParams.has('dpr')) url.searchParams.set('dpr', '2');
        else return null;
        return url.href;
      },
    },
  };

  root.NYTFix = root.NYTFix || {};
  root.NYTFix.sites = Object.assign(root.NYTFix.sites || {}, { [site.id]: site });
  if (typeof module === 'object' && module.exports) module.exports = site;
})(globalThis);
