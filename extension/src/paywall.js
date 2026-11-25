// Detects a site's walls, from the selectors in its adapter (site.live.wall). On NYT, per the
// incognito diagnostics (docs/phase0-findings.md): when a wall is up NYT fills the popup and
// makes the page content `inert` (since Nov 2026, parts of it); without one (and always for
// subscribers) the popup is empty and nothing is inert.
//
// Site CSS hides the popup before it can be drawn, so it measures 0×0 even when it's up. That's
// why detection reads the DOM instead of the popup's size.
(function (root) {
  'use strict';

  const wallOf = site => (site && site.live && site.live.wall) || null;

  // A wall is up: the popup has content and, on sites that do this (wall.inert), the page has
  // been made inert (or, NYT's interactive pages, pinned in place). FT has no inert: its "popup"
  // is a whole barrier page. No layout involved, so it's cheap enough to check on every DOM change.
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
  // version, or if the site ever shows it without making the page inert), or would be if site CSS
  // weren't hiding it (wall.probe).
  function isActive(doc, site) {
    const wall = wallOf(site);
    if (!wall) return false;
    if (wallInPage(doc, site)) return true;
    if (typeof wall.detect === 'function' || !wall.popup) return false;
    const popup = doc.querySelector(wall.popup);
    if (!popup) return false;
    if (onScreen(popup)) return true;
    return typeof wall.probe === 'function' && hiddenPopupShows(doc, site) && Boolean(wall.probe(doc));
  }

  // Drawn where it can be seen: a size alone isn't enough (opacity 0, visibility hidden, off to a side).
  function onScreen(el) {
    const { width, height, top = 0, left = 0 } = el.getBoundingClientRect();
    if (!(width > 0 && height > 0)) return false;
    const win = el.ownerDocument.defaultView;
    if (top + height <= 0 || left + width <= 0 || top >= win.innerHeight || left >= win.innerWidth) return false;
    return typeof el.checkVisibility !== 'function' || el.checkVisibility({ opacityProperty: true, visibilityProperty: true, checkOpacity: true, checkVisibilityCSS: true });
  }

  // Would the site be showing its popup, if site CSS didn't hide it? Let out (PROBE_CLASS) just for
  // the measurement: nothing is painted in between. At most once a second, and only with something
  // in the popup; not while the wall is off (it's still there, hidden) or shown.
  const PROBE_CLASS = 'nytfix-probe';
  const PROBE_EVERY_MS = 1000;
  const probed = new WeakMap(); // document -> { at, shows }
  function hiddenPopupShows(doc, site) {
    const popup = doc.querySelector(wallOf(site)?.popup || ':not(*)');
    const html = doc.documentElement;
    if (!popup || popup.childElementCount === 0 || html.classList.contains('nytfix-off') || html.classList.contains('nytfix-active')) return false;
    const last = probed.get(doc);
    const now = Date.now();
    if (last && last.popup === popup && now - last.at < PROBE_EVERY_MS) return last.shows;
    html.classList.add(PROBE_CLASS);
    const shows = onScreen(popup);
    html.classList.remove(PROBE_CLASS);
    probed.set(doc, { at: now, popup, shows });
    return shows;
  }

  // A wall Read Free doesn't know (sites with wall.failOpen). onHidden: site CSS is hiding a popup
  // the site would be showing, and it isn't recognized. onCut: the article's text is cut (wall.cut),
  // and there's no wall to see. Each once, and only if it stays so for a while: the site may be
  // about to put up a wall that is recognized. Returns a function that stops watching.
  function watchMissed(doc, site, { onHidden, onCut, pollMs = 1000, hiddenAfterMs = 4000, cutAfterMs = 8000, timeoutMs = 60000 } = {}) {
    const wall = wallOf(site);
    if (!wall || !wall.failOpen) return () => {};
    const win = doc.defaultView;
    const since = {};
    const told = {};
    const lasts = (name, on, ms, tell) => {
      if (!on) since[name] = null;
      else since[name] = since[name] ?? Date.now();
      if (told[name] || !on || Date.now() - since[name] < ms) return;
      told[name] = true;
      tell();
    };
    const timer = win.setInterval(() => {
      const known = isActive(doc, site); // the other watch acts on it
      lasts('hidden', !known && hiddenPopupShows(doc, site), hiddenAfterMs, onHidden);
      lasts('cut', !known && Boolean(wall.cut && wall.cut(doc)), cutAfterMs, onCut);
    }, pollMs);
    const stop = () => {
      win.clearInterval(timer);
      win.clearTimeout(limit);
    };
    const limit = win.setTimeout(stop, timeoutMs);
    return stop;
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

  const paywall = { wallInPage, isActive, hiddenPopupShows, popupWording, wallType, watch, watchMissed };
  root.NYTFix = Object.assign(root.NYTFix || {}, { paywall });
  if (typeof module === 'object' && module.exports) module.exports = paywall;
})(globalThis);
