// Daily Mail (docs/outlet-coverage.md, batch 5): www.dailymail.co.uk, and the US edition
// www.dailymail.com it redirects American readers to.
// - Mail+ articles send the whole text: div[itemprop="articleBody"] holds every paragraph,
//   subheading and photo (50 paragraphs and 1,830 words, 53 and 1,811, 19 and 837 in three
//   samples). The JSON-LD marks them paywalled (isAccessibleForFree false) but gives no length.
//   <body> carries is-paywalled-article.
// - The wall is CSS: four rules, all for body.is-paywalled-article:not(.is-paywall-processed)
//   (and not the deep-dive and Shorthand layouts). On desktop they hide everything in the
//   article body that is the third child or later of its parent (paragraphs, but also links
//   and spans inside paragraphs: `[itemprop=articleBody] :nth-child(n+3)`) and draw a fade in
//   its ::after; on mobile, the same past the 27th child. A script also caps the article body
//   at max-height: 20px with overflow hidden (inline), and a Mail+ box goes in after it
//   (.related-replace-paywall; Zephr's .zephr-paywall is in the page too). Scrolling isn't
//   locked.
// - Zephr's "inline" paywall outcome adds a blue "Subscribe to continue reading" Mail+ banner,
//   with a white fade over the last lines (seen by the user on two articles, then in this
//   profile). The site's articleDefer.js makes it: it caps the body at the height of the free
//   paragraphs, marks it data-is-inline-paywall-mounted, inserts a new div.noskim right after it
//   (d.after(p)) and renders the banner, fade included, into that div. It may add a "trending"
//   block after it (#mol-fe-paywall-inline-trending). Zephr's other outcomes go in
//   div#mol-fe-zephr-outcome-wrapper, which the site keeps in a <template> after the body.
// - So the lift gives <body> the class the site's rules wait for (is-paywall-processed, which
//   no other rule uses), takes the cap off the body, and hides the Mail+ box, the inline banner
//   and Zephr's outcomes: the text shows as the site lays it out, nothing fetched. If the text isn't there,
//   archive.today fills in.
(function (root) {
  'use strict';

  const adapter = root.NYTFix?.adapter || require('../src/adapter.js');
  const BODY = '[itemprop="articleBody"]';
  const BOX = '.related-replace-paywall';
  // The inline paywall: the Mail+ banner (and its fade) right after the body, and its trending block.
  const INLINE = [`${BODY}[data-is-inline-paywall-mounted] + .noskim`, '#mol-fe-paywall-inline-trending'];
  const OUTCOME = '[id$="zephr-outcome-wrapper"]'; // Zephr's other outcomes

  const site = adapter.defineSite({
    id: 'dailymail',
    name: 'Daily Mail',
    shortName: 'the Daily Mail',
    hosts: ['www.dailymail.co.uk', 'www.dailymail.com'],
    // Articles: /health/article-16292777/banish-midlife-wrinkles.html,
    // /tvshowbiz/article-16293149/David-Walliams-ex-Lara-Stone.html.
    isArticle: path => /\/article-\d+\/[A-Za-z0-9-]+\.html$/.test(path),
    live: {
      body: BODY,
      wall: {
        // Locked scrolling isn't counted: the wall doesn't lock it, ad-blocker and consent
        // popups can.
        detect: adapter.anyOf(adapter.anyShown([BOX, ...INLINE, OUTCOME]), adapter.walledArticle({ body: BODY, locked: false })),
        classes: { body: 'is-paywall-processed' },
        reveal: [BODY],
        hide: [BOX, ...INLINE, OUTCOME, '.zephr-paywall'],
        // The JSON-LD gives no length; Mail+ articles run to hundreds of words.
        type: adapter.textOnPage(BODY, { minWords: 250 }),
      },
    },
  });

  if (typeof module === 'object' && module.exports) module.exports = site;
})(globalThis);
