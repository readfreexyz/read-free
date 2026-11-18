// Shared pieces for site adapters (sites/*.js), so a new site is mostly settings. Loaded before
// the adapters. See docs/outlet-coverage.md for the outlets these were built from.
//
// - defineSite(config): fills in the usual defaults and registers the adapter.
// - The page's JSON-LD (articleLd): most news sites mark paywalled articles for search engines
//   (isAccessibleForFree: false, with hasPart naming the paywalled section) and many give the
//   article's length (wordCount, or the whole articleBody).
// - Wall checks built on it:
//   - cutBody: the article is marked paywalled and its body is cut short (The Atlantic).
//   - textOnPage: whether the whole article is already on the page (CNN, LA Times, Newsweek,
//     The Globe and Mail and the Toronto Star send it all, then hide it), so taking the cover off
//     is enough, without waiting for archive.today.
// - Paywall services (SERVICES): what common paywall providers put on the page. An adapter
//   lists the ones its site uses (wall.services), and lifting the wall hides their elements.
// - wallHeld: a page-world guard (page/*.js) kept the site's own code from cutting the article
//   (The Age, the Herald). The first thing to try for a new site: if the page carries the whole
//   article and the site cuts it in the browser, stopping the cut is faster than archive.today.
(function (root) {
  'use strict';

  const clean = s => s.replace(/\s+/g, ' ').trim();
  const wordCount = text => (clean(text) ? clean(text).split(' ').length : 0);

  // What common paywall services put on the page while their wall is up.
  //   hide: elements to hide when the wall comes off (re-hidden if the service draws them again)
  //   shown: elements whose presence, with content, means the service's wall is up
  const SERVICES = {
    // Piano (formerly Tinypass): its templates open in a .tp-modal over a .tp-backdrop, and
    // it locks scrolling with body.tp-modal-open (lifting the wall unlocks scrolling anyway).
    piano: { hide: ['.tp-modal', '.tp-backdrop'], shown: ['.tp-modal'] },
    // Zephr renders its outcomes into slots tagged with the outcome's label (seen on The
    // Atlantic, at the end of the article body).
    zephr: { hide: ['[data-zephr-outcome-label]'], shown: [] },
  };

  // Selectors from a site's wall settings plus those of the services it uses.
  function selectorsFor(wall, key) {
    if (!wall) return [];
    const own = [].concat(wall[key] || []);
    const fromServices = [].concat(wall.services || []).flatMap(name => (SERVICES[name] && SERVICES[name][key]) || []);
    return [...own, ...fromServices];
  }

  // The article's JSON-LD, read once per page (adapters call this on DOM changes):
  // { paywalled, parts, wordCount, bodyWords }, or null if the page has no article entry.
  //   paywalled: isAccessibleForFree is false ("False" and false both seen)
  //   parts: the hasPart selectors marked not free (.paywall, .meteredContent…)
  //   wordCount / bodyWords: the article's length, if given (wordCount, or articleBody's words)
  const ldCache = new WeakMap();
  function articleLd(doc) {
    const path = doc.location ? doc.location.pathname : '';
    const cached = ldCache.get(doc);
    if (cached && cached.path === path) return cached.value;
    let value = null;
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
      let items;
      try { items = [].concat(JSON.parse(script.textContent)); } catch { continue; }
      for (const item of items.flatMap(i => (i && i['@graph']) || [i])) {
        if (!item || !/Article|BlogPosting|Report/i.test([].concat(item['@type']).join(' '))) continue;
        const notFree = v => String(v).toLowerCase() === 'false';
        const count = Number(item.wordCount);
        value = {
          paywalled: notFree(item.isAccessibleForFree),
          parts: [].concat(item.hasPart || []).filter(p => p && notFree(p.isAccessibleForFree) && typeof p.cssSelector === 'string').map(p => p.cssSelector),
          wordCount: count > 0 ? count : null,
          bodyWords: typeof item.articleBody === 'string' && item.articleBody.trim() ? wordCount(item.articleBody) : null,
        };
        break;
      }
      if (value) break;
    }
    ldCache.set(doc, { path, value });
    return value;
  }

  const markedPaywalled = doc => Boolean(articleLd(doc)?.paywalled);

  // Words in the <p> paragraphs of every element matching `selector`, hidden ones included; null
  // if nothing matches.
  function bodyWords(doc, selector) {
    const bodies = [...doc.querySelectorAll(selector)];
    if (!bodies.length) return null;
    return bodies.reduce((n, body) => n + [...body.querySelectorAll('p')].reduce((m, p) => m + wordCount(p.textContent), 0), 0);
  }

  // Is the whole article on the page? True when the body has at least `share` of the length the
  // JSON-LD gives; false when it has less; null when the page doesn't say how long the article
  // is (or there's no body). The JSON-LD's text can include more than the paragraphs (lists,
  // subheadings): an LA Times long-form page had 971 of 1,052 words in paragraphs. A cut page
  // keeps far less (a few preview paragraphs), so 3/4 tells them apart.
  function wholeTextOnPage(doc, selector, { share = 0.75 } = {}) {
    const words = bodyWords(doc, selector);
    const ld = articleLd(doc);
    const expected = ld && (ld.wordCount || ld.bodyWords);
    if (words === null || !expected) return null;
    return words >= expected * share;
  }

  // wall.detect for a site that cuts the text without a visible gate: the article is marked
  // paywalled and its body holds fewer than maxWords words.
  function cutBody({ body, maxWords }) {
    return doc => {
      const words = bodyWords(doc, body);
      return words !== null && words < maxWords && markedPaywalled(doc);
    };
  }

  // wall.type for a site that sends the whole article and hides it: 'lift' (take the cover
  // off, nothing to fetch) when the text is all there, else 'paywall' (archive.today). When the
  // JSON-LD doesn't give the length, `minWords` decides, if set; otherwise it's 'paywall', since
  // fetching a snapshot is the safe choice.
  function textOnPage(body, { minWords = null, share = 0.75 } = {}) {
    return doc => {
      const whole = wholeTextOnPage(doc, body, { share });
      if (whole !== null) return whole ? 'lift' : 'paywall';
      const words = bodyWords(doc, body);
      return minWords && words !== null && words >= minWords ? 'lift' : 'paywall';
    };
  }

  // Is the element drawn? (Not display: none or visibility: hidden, itself or above.) Chrome's
  // checkVisibility; elsewhere (the tests) the element's own computed style.
  function visible(el) {
    if (typeof el.checkVisibility === 'function') return el.checkVisibility({ visibilityProperty: true });
    // Without checkVisibility (jsdom): not drawn when it or an ancestor has display: none (The
    // Spectator hides the paywalled <span> around its paragraphs).
    const win = el.ownerDocument.defaultView;
    if (win.getComputedStyle(el).visibility === 'hidden') return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) if (win.getComputedStyle(n).display === 'none') return false;
    return true;
  }

  // wall.detect: some element matching one of the selectors is drawn and has content (children,
  // text, or a shadow root: LA Times' metering popup draws everything in one). Paywall services
  // keep their modal on the page, hidden, until it's needed (Piano's .tp-modal on CNN).
  function anyShown(selectors) {
    const selector = [].concat(selectors).join(', ');
    return doc => [...doc.querySelectorAll(selector)].some(el =>
      (el.childElementCount > 0 || el.shadowRoot || clean(el.textContent).length > 0) && visible(el));
  }

  // Scrolling is locked: overflow-y hidden on <html> or <body>, or <body> pinned in place.
  // (CNN keeps overflow-x hidden on <html>; that doesn't count.)
  function scrollLocked(doc) {
    const win = doc.defaultView;
    return [doc.documentElement, doc.body].some(el => el && win.getComputedStyle(el).overflowY === 'hidden') ||
      Boolean(doc.body && win.getComputedStyle(doc.body).position === 'fixed');
  }

  // The last few paragraphs of the body are on the page but not drawn: the text is there,
  // hidden behind the wall.
  function tailHidden(doc, selector, last = 3) {
    const paragraphs = [...doc.querySelectorAll(selector)].flatMap(body => [...body.querySelectorAll('p')])
      .filter(p => clean(p.textContent).length >= 40);
    const tail = paragraphs.slice(-last);
    return tail.length > 0 && tail.some(p => !visible(p));
  }

  // The body is cut off by its own box: a max-height with overflow hidden (The Spectator's
  // magazine articles: 650px, the rest of the text still in it, under a white fade).
  function clipped(doc, selector) {
    const win = doc.defaultView;
    return [...doc.querySelectorAll(selector)].some(el => {
      const style = win.getComputedStyle(el);
      return style.maxHeight !== 'none' && /hidden|clip/.test(style.overflowY || style.overflow);
    });
  }

  // wall.detect for a site whose wall hasn't been seen yet: the article is marked paywalled and
  // shows a sign of a wall. Its body is cut short (below the JSON-LD's length, or under minWords
  // when there's none) or clipped, scrolling is locked, or the end of the text is hidden.
  // locked: false for a site where something else locks scrolling (Corriere's cookie-consent
  // wall pins <body>).
  function walledArticle({ body, minWords = 150, locked = true }) {
    return doc => {
      if (!markedPaywalled(doc)) return false;
      const words = bodyWords(doc, body);
      if (words === null) return false;
      // Cut short: against the length the JSON-LD gives, if it gives one, else minWords.
      const whole = wholeTextOnPage(doc, body);
      const cut = whole === null ? words < minWords : !whole;
      return cut || clipped(doc, body) || (locked && scrollLocked(doc)) || tailHidden(doc, body);
    };
  }

  // wall.detect: any of these checks.
  const anyOf = (...checks) => doc => checks.some(check => check(doc));

  // A page-world guard (page/*.js) held back the site's own wall: <html data-nytfix-held> lists
  // what it held. The article was never cut, so lifting what's left of the wall is enough.
  const HELD_ATTR = 'data-nytfix-held';
  const wallHeld = doc => doc.documentElement.hasAttribute(HELD_ATTR);

  // The content script put back what the site's own script removed from the article (live.keep):
  // <html data-nytfix-kept>. Kept from the start, the text is whole, however short the article.
  const KEPT_ATTR = 'data-nytfix-kept';
  const cutKept = doc => doc.documentElement.hasAttribute(KEPT_ATTR);

  // Snapshot body selectors for a new site: archive.today keeps itemprop and name, and 'auto'
  // lets the extractor find the biggest block of text (extract.js).
  const SNAPSHOT_BODY = ['[itemprop="articleBody"]', '[name="articleBody"]', 'auto'];

  // A site adapter from the settings that differ from site to site, with defaults for the rest:
  //   id, name, shortName, hosts (the first is the canonical host)
  //   isArticle(path)                       which pages are articles
  //   live.body                             the article body on the live page
  //   live.keep                             parts of the article a wall deletes (put back as it goes)
  //   live.wall: detect / popup, type, hide, reveal, classes, services, liftedMessage
  //   live.wall.decision: { pending(doc), allowed(doc), waitMs }  the site decides late whether
  //                                         the reader may read (content.js, awaitDecision)
  //   snapshot.body / skip / junk / hiresImage
  // Defaults: no live blogs, URLs normalized to https://<first host><path>, story and main
  // from <main> and <article>, scrolling unlocked when the wall comes off, and the generic
  // snapshot body. Registers the adapter in NYTFix.sites and returns it.
  function defineSite(config) {
    const host = config.hosts.find(h => !h.startsWith('*.')) || config.hosts[0];
    const live = config.live || {};
    const wall = {
      inert: null,
      container: null,
      unlockScroll: true,
      liftedMessage: `Removed ${config.shortName || config.name}'s wall. The whole article was already on the page.`,
      ...(live.wall || {}),
    };
    // No check of its own: the wall is up when one of its paywall services shows.
    if (!wall.detect && !wall.popup && selectorsFor(wall, 'shown').length) wall.detect = anyShown(selectorsFor(wall, 'shown'));
    const site = {
      isLive: () => false,
      normalizeUrl: href => `https://${host}${new URL(href).pathname}`,
      ...config,
      live: {
        story: 'main article, article, main',
        main: 'main',
        upsellLink: null,
        ...live,
        wall,
      },
      snapshot: { body: SNAPSHOT_BODY, skip: null, junk: null, ...(config.snapshot || {}) },
    };
    root.NYTFix = root.NYTFix || {};
    root.NYTFix.sites = Object.assign(root.NYTFix.sites || {}, { [site.id]: site });
    return site;
  }

  const adapter = {
    SERVICES, SNAPSHOT_BODY, selectorsFor, articleLd, markedPaywalled, bodyWords, wholeTextOnPage,
    cutBody, textOnPage, visible, anyShown, scrollLocked, tailHidden, clipped, walledArticle, anyOf, defineSite,
    HELD_ATTR, wallHeld, KEPT_ATTR, cutKept,
  };
  root.NYTFix = Object.assign(root.NYTFix || {}, { adapter });
  if (typeof module === 'object' && module.exports) module.exports = adapter;
})(globalThis);
