// La Libre Belgique (docs/outlet-coverage.md, batch 4), on Arc (Fusion).
// - Sends the whole article, subscriber-only ones too: #story-preview-<type> holds the free
//   paragraphs, and #story-content-<type> (class is-hidden) the rest, inside Piano's slot
//   #piano-paywall-<type> (.ap-StoryPiano-restrictedContent.has-paywall, min-height 500px, not
//   clipped); <type> is MEMBER or PAYING (FREE articles aren't hidden). .is-hidden collapses the
//   rest (height 0, opacity 0, overflow hidden); the preview fades out under a white gradient in
//   its ::before (.is-preview). The page data (Fusion.globalContent.story_elements)
//   holds the same text; the JSON-LD marks them "False". La Libre's own script only unhides the
//   rest for subscribers.
// - Then Piano fills its slot with an offer (div.tp-container-inner > iframe#offer-…), which
//   wipes the text out of it: about 9 s in, well after the page has loaded (4.8 s), so the
//   content script is watching by then.
// - So the text is kept on the page (live.keep puts it back as it's wiped), shown, and Piano's
//   offer hidden; nothing is fetched. archive.today had neither survey sample. Free articles
//   (JSON-LD "True") are never touched.
// - Its ad-blocker popup ("Vous utilisez un bloqueur de publicités", on free articles; paid ones
//   get the paywall offer instead) is a Piano modal with its text in Piano's iframe, so
//   notices.js can't read it. page/piano-adblock.js keeps Piano's ad-blocker check (the
//   npttech.com bait script, blocked or loaded) from finding the blocker.
(function (root) {
  'use strict';

  const adapter = root.NYTFix?.adapter || require('../src/adapter.js');
  const CONTENT = '[id^="story-content-"]';
  const SLOT = '.ap-StoryPiano-restrictedContent.has-paywall';

  // A paid article whose rest is hidden or gone (a subscriber's is shown). .is-hidden collapses
  // it (height 0, opacity 0, overflow hidden) rather than display: none, which the browser
  // still counts as visible, so the class is the sign.
  const walled = doc => {
    if (!adapter.markedPaywalled(doc) || !doc.querySelector(SLOT)) return false;
    const rest = doc.querySelector(CONTENT);
    return !rest || rest.classList.contains('is-hidden') || !adapter.visible(rest);
  };

  const site = adapter.defineSite({
    id: 'lalibre',
    name: 'La Libre Belgique',
    shortName: 'La Libre',
    hosts: ['www.lalibre.be'],
    // Articles: /economie/entreprises-startup/2026/11/14/some-slug-NZWTWPRU3JHINEJZR6Y4RT4E6I/.
    isArticle: path => /\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+-[A-Z0-9]{26}\/?$/.test(path),
    live: {
      body: '#article-text',
      keep: CONTENT,
      wall: {
        services: ['piano'],
        detect: walled,
        reveal: [CONTENT, '.ap-StoryPiano-content.is-preview'],
        hide: [`${SLOT} > .tp-container-inner`, '.ux-PaywallPianoFallback'],
        // The rest on the page (kept): show it. Gone before the extension started: archive.today.
        type: doc => (doc.querySelector(CONTENT) ? 'lift' : 'paywall'),
      },
    },
  });

  if (typeof module === 'object' && module.exports) module.exports = site;
})(globalThis);
