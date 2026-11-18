// Detects a site's walls, from the selectors in its adapter (site.live.wall). On NYT, per the
// incognito diagnostics (docs/phase0-findings.md): when a wall is up NYT fills the popup and
// makes the page content `inert`; without one (and always for subscribers) the popup is empty
// and nothing is inert.
//
// Site CSS hides the popup before it can be drawn, so it measures 0×0 even when it's up. That's
// why detection reads the DOM instead of the popup's size.
(function (root) {
  'use strict';

  const wallOf = site => (site && site.live && site.live.wall) || null;

  // A wall is up: the popup has content and, on sites that do this (wall.inert), the page has
  // been made inert. FT has no inert: its "popup" is a whole barrier page. No layout involved,
  // so it's cheap enough to check on every DOM change.
  //
  // A site whose wall isn't a popup can say how to spot it instead (wall.detect: The Atlantic
  // cuts the text with no visible gate). Keep it cheap: it also runs on DOM changes.
  function wallInPage(doc, site) {
    const wall = wallOf(site);
    if (!wall) return false;
    if (typeof wall.detect === 'function') return Boolean(wall.detect(doc));
    const popup = doc.querySelector(wall.popup);
    if (!popup || popup.childElementCount === 0) return false;
    return !wall.inert || Boolean(doc.querySelector(wall.inert));
  }

  // Also true when the popup is visibly on screen (when the reader has asked for the site's
  // version, or if the site ever shows it without making the page inert).
  function isActive(doc, site) {
    const wall = wallOf(site);
    if (!wall) return false;
    if (wallInPage(doc, site)) return true;
    if (typeof wall.detect === 'function' || !wall.popup) return false;
    const popup = doc.querySelector(wall.popup);
    if (!popup) return false;
    const { width, height } = popup.getBoundingClientRect();
    return width > 0 && height > 0;
  }

  // The popup's own wording (for telling walls apart, and for the console log).
  function popupWording(doc, site) {
    const wall = wallOf(site);
    const popup = wall && wall.popup && doc.querySelector(wall.popup);
    return popup ? popup.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  // Which wall is up, or null:
  // - 'login': the whole story is already in the page underneath, so lifting the wall is enough.
  //   NYT's "free to read, log in to continue" wall (live blog test: 158 of 158 paragraphs), told
  //   apart by its wording (wall.login); The New Yorker decides with wall.type.
  // - 'paywall': the article text is cut, so archive.today is needed.
  function wallType(doc, site) {
    if (!isActive(doc, site)) return null;
    if (typeof wallOf(site).type === 'function') return wallOf(site).type(doc);
    const login = wallOf(site).login;
    return login && login.test(popupWording(doc, site)) ? 'login' : 'paywall';
  }

  // Calls onFound once, as soon as a wall is up. A MutationObserver callback runs before the
  // browser paints, so reacting there means the wall is dealt with before it's ever drawn.
  // Polling is the fallback. Returns a function that stops watching.
  function watch(doc, site, onFound, { intervalMs = 500, timeoutMs = 60000 } = {}) {
    if (!wallOf(site)) return () => {};
    const win = doc.defaultView;
    let stopped = false;
    const found = () => {
      stop();
      onFound();
    };
    const observer = new win.MutationObserver(() => {
      if (!stopped && wallInPage(doc, site)) found();
    });
    // data-nytfix-held: a page-world guard (page/*.js) held the site's wall back.
    observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['inert', 'data-nytfix-held'] });
    const timer = win.setInterval(() => {
      if (!stopped && isActive(doc, site)) found();
    }, intervalMs);
    const limit = win.setTimeout(stop, timeoutMs);
    function stop() {
      stopped = true;
      observer.disconnect();
      win.clearInterval(timer);
      win.clearTimeout(limit);
    }
    if (isActive(doc, site)) found();
    return stop;
  }

  const paywall = { wallInPage, isActive, popupWording, wallType, watch };
  root.NYTFix = Object.assign(root.NYTFix || {}, { paywall });
  if (typeof module === 'object' && module.exports) module.exports = paywall;
})(globalThis);
