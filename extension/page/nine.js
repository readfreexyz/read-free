// The Age and the Sydney Morning Herald: keep Piano from cutting the article.
//
// Runs in the page's own JavaScript world (manifest: "world": "MAIN"), at document_start, before
// any of the site's scripts. It can't use the extension's APIs or the content script's code.
//
// Nine's page carries the whole article, in its HTML and in its page data. A second or two
// after loading, Piano decides the reader gets the wall and fires a `pianoContentWall` event at
// window, with detail.type 'payWall' or 'regWall' (and 'scrollLock'). Nine's React code listens
// for it: it cuts the body to its first 2 blocks (`blocks.slice(0, 2)` in the article template)
// and locks scrolling. A 'NO_PAYWALL' event undoes a 'payWall'.
//
// This listener runs first (capturing at window, registered before the site's own) and stops
// those events, so the article is never cut and scrolling never locked. Piano still draws its
// subscribe box; the content script lifts it, as for any wall whose text is all on the page.
//
// How a page-world guard talks to the content script (src/content.js), the same for any site:
// - <html data-nytfix-held="payWall scrollLock">: what it held back. The content script treats
//   that as a wall over a whole article (adapter.wallHeld), so it lifts, with no archive.today.
// - 'nytfix:release' on document (the reader asked for the site's version): let the held events
//   through, and stop holding.
// - 'nytfix:hold' on document (a new page, or the reader ran the extension again): hold again,
//   and undo whatever got through meanwhile.
(function () {
  'use strict';

  const EVENT = 'pianoContentWall';
  const CUTS = ['payWall', 'regWall', 'scrollLock'];
  const UNDO = { type: 'NO_PAYWALL' };
  const HELD_ATTR = 'data-nytfix-held';

  let holding = true;
  const held = [];   // the events' details, held back while holding
  const passed = []; // let through while released

  const typeOf = detail => (detail && typeof detail === 'object' ? detail.type : undefined);
  function mark() {
    const root = document.documentElement;
    if (!root) return;
    if (held.length) root.setAttribute(HELD_ATTR, [...new Set(held.map(typeOf))].join(' '));
    else root.removeAttribute(HELD_ATTR);
  }

  window.addEventListener(EVENT, event => {
    const detail = event.detail;
    if (!CUTS.includes(typeOf(detail))) return;
    if (!holding) {
      passed.push(detail);
      return;
    }
    event.stopImmediatePropagation();
    held.push(detail);
    mark();
    console.info(`[Read Free] held back Piano's "${typeOf(detail)}" event, so the article isn't cut`);
  }, true);

  document.addEventListener('nytfix:release', () => {
    holding = false;
    const details = held.splice(0);
    mark();
    for (const detail of details) window.dispatchEvent(new CustomEvent(EVENT, { detail }));
  });

  document.addEventListener('nytfix:hold', () => {
    holding = true;
    if (!passed.length) return;
    held.push(...passed.splice(0));
    mark();
    window.dispatchEvent(new CustomEvent(EVENT, { detail: UNDO }));
  });
})();
