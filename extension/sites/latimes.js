// Los Angeles Times (docs/outlet-coverage.md, batch 1). Seen in the user's Chrome, past the meter:
// - The page sends the whole article. On a gated article only a few preview paragraphs show;
//   the rest sit in a div.subscriber-content.hidden block (display: none via the classes
//   .subscriber-content and .hidden), photos included, which never load while it's hidden.
//   Seen on a newsletter page (4 paragraphs shown, 35 hidden) and on a long-form "For
//   subscribers" page (all 28 hidden). On a plain metered story everything was visible.
// - Paragraphs sit directly inside .ct-rich-text-children blocks under article.story (on long
//   form pages, one nested in another; the first block can be the bulleted summary).
// - The wall is a metering popup, <modality-custom-element name="metering-modal" role="dialog">,
//   drawn in its own shadow root, with scrolling locked through body.met-panel-open
//   (overflow: hidden). The JSON-LD gives the whole articleBody.
// - So taking the wall off is enough: hide the popup, show the hidden block, unlock scrolling.
//   If the text is ever cut, archive.today fills in (2 of 2 samples archived, complete, no
//   body marker: found automatically).
(function (root) {
  'use strict';

  const adapter = root.NYTFix?.adapter || require('../src/adapter.js');
  const BODY = 'article.story .ct-rich-text-children:has(> p)';
  const LOCKED = '.subscriber-content';
  const POPUP = 'modality-custom-element[name="metering-modal"]';

  const ARTICLE = /^\/[a-z0-9-]+(\/[a-z0-9-]+)*\/(story|newsletter|articulo)\/\d{4}-\d{2}-\d{2}\/[a-z0-9-]+$/;
  const textOnPage = adapter.textOnPage(BODY);
  const site = adapter.defineSite({
    id: 'latimes',
    name: 'Los Angeles Times',
    shortName: 'LA Times',
    hosts: ['www.latimes.com'],
    // Articles: /politics/story/2026-11-13/slug, /entertainment-arts/movies/story/2026-11-14/slug,
    // newsletters: /california/newsletter/2026-11-14/slug, and in Spanish:
    // /espanol/entretenimiento/articulo/2026-11-24/slug.
    isArticle: path => ARTICLE.test(path),
    // The metering popup comes up on everything else too (the user, 2026-11-25: a gift guide,
    // /lifestyle/list/slug): lists, recipes (/recipe/slug), projects, stories with no date. It only
    // has to come off there; nothing is asked of archive.today. Not the home page or a section's.
    isLive: path => !ARTICLE.test(path) && path.split('/').filter(Boolean).length > 1,
    live: {
      body: BODY,
      wall: {
        detect: adapter.anyOf(
          doc => Boolean(doc.body && doc.body.classList.contains('met-panel-open')),
          adapter.anyShown(POPUP),
          doc => [...doc.querySelectorAll(LOCKED)].some(el => !adapter.visible(el)),
        ),
        hide: POPUP,
        reveal: LOCKED,
        type: doc => (ARTICLE.test(doc.location?.pathname || '') ? textOnPage(doc) : 'lift'),
      },
    },
    snapshot: { skip: 'modality-custom-element' },
  });

  if (typeof module === 'object' && module.exports) module.exports = site;
})(globalThis);
