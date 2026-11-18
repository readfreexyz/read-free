// The New York Times. What the core needs to know about the site, from Phase 0 and the incognito
// diagnostics (docs/phase0-findings.md). The wall-hiding CSS that has to apply before first paint
// is in nyt.css.
(function (root) {
  'use strict';

  const LOGIN_WORDING = /without signing in|free to read/i;
  // The text is cut: the article body ends in NYT's "Subscribe to The Times to read as many
  // articles as you like." line (a short paragraph linking to /subscription). A login wall leaves
  // the whole story; the print-edition note under the article links to a subscription page too,
  // but sits outside the body.
  const cutOff = doc => [...doc.querySelectorAll('section[name="articleBody"] a[href*="/subscription"]')]
    .some(a => { const line = a.closest('p, div'); return Boolean(line) && line.textContent.trim().length < 200; });

  const site = {
    id: 'nyt',
    name: 'The New York Times',
    shortName: 'NYT',
    hosts: ['www.nytimes.com'],

    // Articles: /2026/11/14/world/europe/slug.html. Live blogs: /live/2026/11/13/us/slug.
    isArticle: path => /^\/\d{4}\/\d{2}\/\d{2}\/.+\.html$/.test(path),
    isLive: path => /^\/live\/\d{4}\/\d{2}\/\d{2}\//.test(path),
    // Drop the query string and fragment (?smid=…, #comments) and force the www host, because
    // archive.today looks snapshots up by exact URL.
    normalizeUrl: href => `https://www.nytimes.com${new URL(href).pathname}`,

    live: {
      body: 'section[name="articleBody"]', // the article body: swapped out, and its classes reused
      story: 'article#story',             // fallback home for the banner and text
      main: 'main#site-content',          // the page content: scroll anchor, scope for the upsell line
      upsellLink: 'a[href*="/subscription"]', // "Subscribe to The Times…" line under cut-off text
      wall: {
        popup: '#gateway-content',        // filled while a wall is up (hidden by nyt.css)
        inert: '#site-content[inert], main[inert]', // NYT makes the page inert under a wall
        container: '[data-testid="vi-gateway-container"]', // its positioned children are scrims
        login: LOGIN_WORDING, // the login wall's popup wording
        // 'login' only when the popup says so and the text isn't cut. Since Nov 2026 the paywall's
        // popup carries the "To leave without signing in, use your browser's Back button" note
        // too (#gateway-exit-advisory), so the wording alone called cut articles login walls:
        // the wall came off, and the text stayed cut.
        type: doc => {
          const popup = doc.querySelector('#gateway-content');
          const wording = popup ? popup.textContent : '';
          return LOGIN_WORDING.test(wording) && !cutOff(doc) ? 'login' : 'paywall';
        },
      },
    },

    snapshot: {
      // archive.today keeps `name` and ids, not classes (Phase 0).
      body: ['section[name="articleBody"]', 'article#story'],
      junk: /^(advertisement|skip advertisement|supported by|continue reading the main story)$/i,
      // Photos are named crops on static01.nyt.com: …-articleLarge.jpg (1,024 px in the snapshots
      // checked). The -superJumbo crop of the same photo is 2,048 px.
      hiresImage: src => {
        if (!/^https:\/\/static\d*\.nyt\.com\//.test(src)) return null;
        const hires = src.replace(/-(articleLarge|articleInline|jumbo|popup|mediumThreeByTwo\d+|threeByTwo\w*|videoSixteenByNine\w*|thumbLarge|square\d+)(\.\w+)(?=\?|$)/, '-superJumbo$2');
        return hires === src ? null : hires;
      },
    },
  };

  root.NYTFix = root.NYTFix || {};
  root.NYTFix.sites = Object.assign(root.NYTFix.sites || {}, { [site.id]: site });
  if (typeof module === 'object' && module.exports) module.exports = site;
})(globalThis);
