// Piano's ad-blocker check: keep it from finding the reader's ad blocker, so the site's
// "you're using an ad blocker" popup (a Piano experience) never shows. Used on La Libre
// (docs/outlet-coverage.md, batch 4); the check is Piano's own, so other Piano sites can share
// this guard.
//
// Runs in the page's own JavaScript world (manifest: "world": "MAIN"), at document_start,
// before any of the site's scripts.
//
// Piano decides from a cookie, __adblocker ("true" for 5 minutes), which its Composer sends with
// each experience request; the popup is a modal with its text in Piano's iframe, out of reach of
// notices.js, which reads the page's text. La Libre's bundle inserts Piano's snippet
// (script#piano-adblocker): it clears the cookie, defines setNptTechAdblockerCookie(adblocker),
// and loads www.npttech.com/advertising.js with onerror="setNptTechAdblockerCookie(true)". The
// cookie turns true two ways:
// - The ad blocker stops that script: its onerror says true. Here setNptTechAdblockerCookie is
//   defined first, as a property the snippet can't replace (its `var` assignment goes to a setter
//   that ignores it), and it always says false.
// - The script loads: it's BlockAdBlock. It plants a bait div (classes like "ad", "adsbygoogle",
//   "pub_300x250", 1px, off screen) and, if the ad blocker hides it, writes the cookie itself.
//   But it uses window.blockAdBlock if one exists: blockAdBlock.onDetected(…),
//   .onNotDetected(…), then .check(). Here blockAdBlock is defined first: its check plants no
//   bait and reports "not detected", so the script writes false.
// Seen in the user's incognito window, then in their main window: the popup over a free article.
// A true cookie left by an earlier page (it lasts 5 minutes) is cleared at once.
(function () {
  'use strict';

  const COOKIE = '__adblocker';
  const log = what => console.info(`[Read Free] kept Piano's ad-blocker check from finding the ad blocker (${what})`);

  const noAdBlocker = () => {
    document.cookie = `${COOKIE}=false; max-age=300; path=/`;
  };

  if (/(?:^|;\s*)__adblocker=true\b/.test(document.cookie)) noAdBlocker();

  // A property of window the site's scripts can read but not replace.
  const pin = (name, value) => {
    try {
      Object.defineProperty(window, name, { configurable: false, get: () => value, set: () => {} });
    } catch {
      // Already defined (the guard ran twice): nothing to do.
    }
  };

  // The snippet's onerror (the bait script blocked).
  pin('setNptTechAdblockerCookie', () => {
    log('the bait script was blocked');
    noAdBlocker();
  });

  // BlockAdBlock's interface, as the bait script uses it; every check comes out negative.
  const notDetected = [];
  const blockAdBlock = {
    on(detected, fn) {
      if (!detected && typeof fn === 'function') notDetected.push(fn);
      return this;
    },
    onDetected(fn) { return this.on(true, fn); },
    onNotDetected(fn) { return this.on(false, fn); },
    check() {
      setTimeout(() => {
        log('the bait script loaded; its check reports nothing');
        for (const fn of notDetected.splice(0)) {
          try { fn(); } catch { /* the site's callback */ }
        }
      }, 1);
      return true;
    },
    emitEvent() { return this; },
    clearEvent() { notDetected.length = 0; return this; },
    setOptions() { return this; },
    createBait() {},
    destroyBait() {},
    checkBait() {},
    stopLoop() {},
    log() {},
  };
  pin('blockAdBlock', blockAdBlock);
})();
