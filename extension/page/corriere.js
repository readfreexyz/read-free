// Corriere della Sera (www. and the local editions: milano., roma., …): keep the site's own
// scripts from cutting the article and from putting up its ad-blocker popup.
//
// Runs in the page's own JavaScript world (manifest: "world": "MAIN"), at document_start, before
// any of the site's scripts. See page/nine.js for how page-world guards talk to the content
// script (<html data-nytfix-held>, 'nytfix:release', 'nytfix:hold').
//
// Corriere sends the whole article, then its script loader (rcs_orchestrator) starts modules on
// events:
// - 'pno_abc_test:init' on window (fired once Piano decides the reader gets the wall):
//   AbcTestPaywall either deletes every article block after the first from #content-to-read
//   (initWallInline), or locks scrolling (tp-scroll-prevented) under Piano's modal (initManona),
//   by an A/B-test cookie. Held back, the article stays whole; the content script lifts whatever
//   Piano still draws.
// - 'adblockActivated' on document: loads rcs_anti-adblocker, the "Per continuare a leggere non
//   usare il blocco della pubblicità" popup. Held back, it never loads. That's no paywall, so it
//   isn't marked as held.
(function () {
  'use strict';

  const WALL = 'pno_abc_test:init';
  const AD_BLOCK = 'adblockActivated';
  const HELD_ATTR = 'data-nytfix-held';

  let holding = true;
  const held = [];   // [{ name, target, detail }] held back while holding
  const passed = []; // let through while released

  function mark() {
    const root = document.documentElement;
    if (!root) return;
    const walls = held.filter(e => e.name === WALL);
    if (walls.length) root.setAttribute(HELD_ATTR, WALL);
    else root.removeAttribute(HELD_ATTR);
  }

  // Capturing at window: runs before listeners on window itself (registered later, or not
  // capturing) and before the event goes on down to document.
  for (const name of [WALL, AD_BLOCK]) {
    window.addEventListener(name, event => {
      const record = { name, target: event.target === document ? document : window, detail: event.detail };
      if (!holding) {
        passed.push(record);
        return;
      }
      event.stopImmediatePropagation();
      held.push(record);
      mark();
      console.info(`[Read Free] held back Corriere's "${name}" event`);
    }, true);
  }

  document.addEventListener('nytfix:release', () => {
    holding = false;
    const records = held.splice(0);
    mark();
    for (const { name, target, detail } of records) target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
  });

  // Corriere's cut can't be undone (the blocks are deleted), so holding again only applies to
  // what comes next; the content script falls back to archive.today for a cut page.
  document.addEventListener('nytfix:hold', () => {
    holding = true;
    passed.splice(0);
  });
})();
