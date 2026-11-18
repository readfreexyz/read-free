// Remembers where the reader scrolled, so lifting a wall can put them back there.
//
// When a wall appears NYT pins the page and it lands back at the top. How NYT pins it varies
// (the page container may already be position: fixed on live blogs), so instead of guessing
// from page state, only trust scrolling the reader did:
// - it must follow the reader's own input (wheel, touch, keys, pointer) within INPUT_WINDOW_MS,
//   so scrolls NYT makes by itself never count;
// - it must not be a one-frame jump back to the top of the page, which is what NYT's reset
//   looks like if it lands while the reader is still scrolling;
// - it must go the way the reader's input went: LA Times' metering script glides the page to
//   the top (window.scroll({ top: 0, behavior: 'smooth' })) before each popup, often right as
//   the reader scrolls down past its trigger point, in steps too small to look like a jump;
// - and nothing counts while the wall is showing.
//
// onJumpUp(position, top, verdict): the page moved well above the reader's place without them
// (the content script puts them back, once it has acted on the page).
(function (root) {
  'use strict';

  const INPUT_WINDOW_MS = 1000; // trackpad momentum keeps scrolling a while after the last input
  const JUMP_PX = 250;
  const AGAINST_PX = 50;  // a move this big the other way from the reader's input isn't theirs
  const JUMP_UP_PX = 300; // how far above the reader's place counts as being thrown back up
  // Keys that scroll, and which way (1: down the page, -1: up).
  const KEY_DIRECTION = { ArrowDown: 1, PageDown: 1, End: 1, ' ': 1, ArrowUp: -1, PageUp: -1, Home: -1 };
  const NEAR_TOP_PX = 60;
  const LOG_SIZE = 12;

  // measure(): where the page content's top edge is, in viewport pixels (render.anchorTop).
  // isWallShowing(): true while positions can't be trusted.
  function track(doc, { measure, isWallShowing = () => false, onJumpUp = () => {}, now = Date.now } = {}) {
    const win = doc.defaultView;
    const nextFrame = win.requestAnimationFrame ? cb => win.requestAnimationFrame(cb) : cb => win.setTimeout(cb, 16);
    let lastInput = -Infinity;
    let direction = 0; // which way the reader's last input scrolls: 1 down, -1 up, 0 unknown
    let position = null;
    let previous = null;
    let pageTop = measure(); // the least-scrolled position seen: scrolling down only lowers it
    let queued = false;
    const log = [];

    const onInput = e => {
      if (e.type === 'pointermove' && !e.buttons) return; // only drags, e.g. the scrollbar
      lastInput = now();
      if (e.type === 'wheel') direction = Math.sign(e.deltaY || 0);
      else if (e.type === 'keydown') direction = (KEY_DIRECTION[e.key] || 0) * (e.key === ' ' && e.shiftKey ? -1 : 1);
      else direction = 0; // touch and drags: either way
    };
    const sample = () => {
      queued = false;
      const top = measure();
      pageTop = Math.max(pageTop, top);
      let verdict = 'reader';
      if (isWallShowing()) verdict = 'wall showing';
      else if (now() - lastInput > INPUT_WINDOW_MS) verdict = 'not the reader';
      // (unless the reader asked to go up: Home, Page Up, the wheel turned up)
      else if (direction !== -1 && previous !== null && top - previous > JUMP_PX && top >= pageTop - NEAR_TOP_PX) verdict = 'jump to top';
      // The content's top edge moving up the screen means scrolling down (1), and vice versa.
      else if (previous !== null && direction && Math.abs(top - previous) > AGAINST_PX && Math.sign(previous - top) !== direction) verdict = 'against input';
      if (verdict === 'reader') position = top;
      else if (verdict !== 'wall showing' && position !== null && top - position > JUMP_UP_PX) onJumpUp(position, top, verdict);
      previous = top;
      log.push({ at: now(), top: Math.round(top), verdict });
      if (log.length > LOG_SIZE) log.shift();
    };
    const onScroll = () => {
      if (queued) return;
      queued = true;
      nextFrame(sample);
    };

    const opts = { capture: true, passive: true };
    const inputs = ['wheel', 'touchmove', 'keydown', 'pointerdown', 'pointermove'];
    for (const type of inputs) doc.addEventListener(type, onInput, opts);
    doc.addEventListener('scroll', onScroll, opts);

    return {
      // The last place the reader scrolled to themselves (a measure() value), or null.
      position: () => position,
      // True while the reader is (or just was) scrolling.
      readerActive: () => now() - lastInput <= INPUT_WINDOW_MS,
      // Recent samples, newest last, for the debug log.
      log: () => log.map(({ at, top, verdict }) => `${((at - now()) / 1000).toFixed(1)}s ${top} ${verdict}`),
      reset() {
        position = null;
        previous = null;
        pageTop = measure();
        log.length = 0;
      },
      stop() {
        for (const type of inputs) doc.removeEventListener(type, onInput, opts);
        doc.removeEventListener('scroll', onScroll, opts);
      },
    };
  }

  const scroll = { track, INPUT_WINDOW_MS };
  root.NYTFix = Object.assign(root.NYTFix || {}, { scroll });
  if (typeof module === 'object' && module.exports) module.exports = scroll;
})(globalThis);
