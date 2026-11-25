// Haaretz, in English (haaretz.com) and Hebrew (haaretz.co.il) (docs/outlet-coverage.md, "Batch 7").
// Seen in the built-in browser and in pages fetched signed out, 2026-11-24 and 25.
// - The server sends one paragraph (151 to 431 characters) in
//   section[data-testid="article-body-wrapper"], as p[data-testid="rich-text"] children. A few
//   seconds in, its placeholder (a spinner) gives way to the offer: a child <div> linking to
//   promotion.<site> and login.<site>. Nothing is drawn over the page and scrolling isn't locked.
// - Not only .premium addresses are cut: so were 5 of 8 others in English (the page data calls most
//   of them "open"); the other 3 came whole (14, 14 and 40 paragraphs), as did 4 of 4 in Hebrew.
// - The JSON-LD can't tell: every article is marked paywalled, cut or whole, and its articleBody is
//   the first paragraph alone, so a cut page looks whole next to it. The sign of the wall is the
//   offer as the last thing in the body, after under 150 words (an offer between paragraphs, or
//   after a whole article, is no wall).
// - The offer comes from Haaretz's own API. When that refuses (as it does headless Chrome: 403s), the
//   spinner stays for good, and an ad blocker could do the same. So a spinner still there 8 s
//   after it was first seen counts as the wall too.
// - Class names are hashed; data-testid isn't. The body is display: contents, so it has no box
//   of its own and checkVisibility() says no: what's in it is looked at instead.
// - archive.today: every copy made up to Nov 23, 2026 was whole (9 of 9: 7 English, 2 Hebrew, some
//   made the day the article came out; TheMarker's too, 2 of 2). Every one made on Nov 24 is the cut page (9 copies of 6
//   articles, two of them TheMarker's; the one looked into stops at the spinner). So it has the
//   articles archived before then, and newer ones only if that changes. A cut copy gives nothing
//   (snapshotBody); older ones are tried, and else the reader is told. In a whole copy the
//   paragraphs are children of one <section> in <main>, with no id, role or itemprop on it, while
//   the teaser cards and the comments have ids: so it's found by what it holds.
// - Not covered: TheMarker (themarker.com), walled the same way; its copies follow the same dates.
(function (root) {
  'use strict';

  const adapter = root.NYTFix?.adapter || require('../src/adapter.js');
  const BODY = '[data-testid="article-body-wrapper"]';
  const OFFER = `${BODY} > div:has(a[href^="https://promotion."])`;
  const SPINNER = `${BODY} > div:has([data-testid="logo-loading-indicator"])`;
  const SPINNER_MS = 8000;
  const CUT_WORDS = 150;
  const MIN_PARAGRAPH = 40; // characters
  const MIN_PARAGRAPHS = 3;

  const clean = s => s.replace(/\s+/g, ' ').trim();

  // The block ends the body, and what's before it is a teaser.
  function endsTeaser(block) {
    const paragraphs = [...block.parentElement.children].filter(el => el.tagName === 'P');
    const words = paragraphs.reduce((n, p) => n + clean(p.textContent).split(' ').length, 0);
    const last = paragraphs.at(-1);
    const ends = !last || Boolean(last.compareDocumentPosition(block) & 4); // 4: FOLLOWING
    return ends && words < CUT_WORDS;
  }

  // How long this page's spinner has been there.
  const spinners = new WeakMap(); // document -> { path, since }
  function spinnerAge(doc) {
    const path = doc.location ? doc.location.pathname : '';
    if (![...doc.querySelectorAll(SPINNER)].some(endsTeaser)) {
      spinners.delete(doc);
      return 0;
    }
    const seen = spinners.get(doc);
    if (seen && seen.path === path) return Date.now() - seen.since;
    spinners.set(doc, { path, since: Date.now() });
    return 0;
  }

  const walled = doc => [...doc.querySelectorAll(OFFER)].some(offer => endsTeaser(offer) && adapter.visible(offer)) || spinnerAge(doc) >= SPINNER_MS;

  // In a snapshot: the <section> in <main> whose own children hold the most paragraph text. Null in
  // a copy of the cut page: what's around its teaser could pass for more of the article.
  function snapshotBody(content) {
    let best = null;
    for (const section of content.querySelectorAll('main section:not(#comments-section, #comments-section *)')) {
      const lengths = [...section.children]
        .filter(el => (el.tagName === 'DIV' || el.tagName === 'P') && !el.querySelector('div, p, section, ul, figure'))
        .map(el => clean(el.textContent).length)
        .filter(n => n >= MIN_PARAGRAPH);
      const chars = lengths.reduce((n, length) => n + length, 0);
      if (lengths.length >= MIN_PARAGRAPHS && (!best || chars > best.chars)) best = { section, chars };
    }
    return best && best.section;
  }

  const site = adapter.defineSite({
    id: 'haaretz',
    name: 'Haaretz',
    shortName: 'Haaretz',
    hosts: ['www.haaretz.com', 'www.haaretz.co.il'],
    // Each edition's articles are its own: looked up at the address they're at.
    normalizeUrl: href => {
      const url = new URL(href);
      return `https://${url.hostname}${url.pathname}`;
    },
    // Articles: /israel-news/2026-11-23/ty-article/.premium/some-slug/000001a2-087a-da36-afe6-6b7af8bf0000
    // (also ty-article-magazine, -opinion…; no slug in Hebrew, no .premium on open ones).
    isArticle: path => /\/\d{4}-\d{2}-\d{2}\/ty-article(?!-live\/)(-[a-z]+)?\/(\.[a-z]+\/)?([^/]+\/)?[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\/?$/.test(path),
    isLive: path => /\/ty-article-live\//.test(path),
    live: {
      body: BODY,
      story: 'main',
      wall: {
        detect: walled,
        hide: [OFFER, SPINNER],
        type: () => 'paywall',
      },
    },
    snapshot: { body: snapshotBody },
  });

  if (typeof module === 'object' && module.exports) module.exports = site;
})(globalThis);
