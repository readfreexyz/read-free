const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const scroll = require('../extension/src/scroll.js');

// A tracker on a blank page. jsdom can't scroll, so `page.scrolled` stands in for the scroll
// position: the content's top edge sits 120 px down and moves up as the page scrolls.
function setup({ wall = () => false, onJumpUp } = {}) {
  const { window } = new JSDOM('<!doctype html><html><body><main id="site-content"></main></body></html>', { pretendToBeVisual: true });
  const doc = window.document;
  const page = { scrolled: 0, now: 1_000_000 };
  const tracker = scroll.track(doc, { measure: () => 120 - page.scrolled, isWallShowing: wall, onJumpUp, now: () => page.now });
  const nextFrame = () => new Promise(r => setTimeout(r, 40));
  const scrollEvent = async y => {
    page.scrolled = y;
    doc.dispatchEvent(new window.Event('scroll'));
    await nextFrame();
  };
  return {
    window, doc, page, tracker,
    // The reader scrolls: their input comes first.
    readerScroll: async y => { doc.dispatchEvent(new window.Event('wheel')); await scrollEvent(y); },
    // The reader turns the wheel (deltaY > 0: down the page) and the page moves to y.
    wheel: async (deltaY, y) => { doc.dispatchEvent(new window.WheelEvent('wheel', { deltaY })); await scrollEvent(y); },
    key: async (key, y, extra = {}) => { doc.dispatchEvent(new window.KeyboardEvent('keydown', { key, ...extra })); await scrollEvent(y); },
    // The page scrolls by itself (NYT).
    pageScroll: scrollEvent,
    done: () => { tracker.stop(); window.close(); },
  };
}

test('remembers where the reader scrolled', async () => {
  const s = setup();
  await s.readerScroll(500);
  await s.readerScroll(2000);
  assert.equal(s.tracker.position(), 120 - 2000);
  s.done();
});

test('ignores a scroll the page makes by itself', async () => {
  const s = setup();
  await s.readerScroll(2000);
  s.page.now += 1500; // the reader stops and reads
  await s.pageScroll(0); // NYT drops the page back to the top
  assert.equal(s.tracker.position(), 120 - 2000);
  assert.match(s.tracker.log().at(-1), /0? 120 not the reader$/);
  s.done();
});

test('ignores a one-frame jump to the top even while the reader is scrolling', async () => {
  const s = setup();
  await s.readerScroll(2000);
  await s.pageScroll(0); // lands within the reader's input window
  assert.equal(s.tracker.position(), 120 - 2000);
  assert.match(s.tracker.log().at(-1), /jump to top$/);
  s.done();
});

test('a reader scrolling back up to the top gradually still counts', async () => {
  const s = setup();
  await s.readerScroll(1000);
  for (let y = 800; y >= 0; y -= 200) await s.readerScroll(y);
  assert.equal(s.tracker.position(), 120);
  s.done();
});

test('ignores everything while the wall is showing', async () => {
  const s = setup({ wall: () => true });
  await s.readerScroll(800);
  assert.equal(s.tracker.position(), null);
  s.done();
});

test('only pointer drags count as input, not plain mouse movement', async () => {
  const s = setup();
  s.doc.dispatchEvent(new s.window.MouseEvent('pointermove', { buttons: 0 }));
  await s.pageScroll(600);
  assert.equal(s.tracker.position(), null);
  s.doc.dispatchEvent(new s.window.MouseEvent('pointermove', { buttons: 1 })); // dragging the scrollbar
  await s.pageScroll(900);
  assert.equal(s.tracker.position(), 120 - 900);
  s.done();
});

test('readerActive is true for a moment after input; reset forgets the position', async () => {
  const s = setup();
  await s.readerScroll(2000);
  assert.equal(s.tracker.readerActive(), true);
  s.page.now += scroll.INPUT_WINDOW_MS + 1;
  assert.equal(s.tracker.readerActive(), false);
  s.tracker.reset();
  assert.equal(s.tracker.position(), null);
  s.done();
});

test("a page gliding to the top while the reader scrolls down isn't the reader, and is reported", async () => {
  const jumps = [];
  const s = setup({ onJumpUp: (position, top, verdict) => jumps.push({ position, top, verdict }) });
  await s.wheel(100, 1000);
  await s.wheel(100, 2000);
  // LA Times' metering script: window.scroll({ top: 0, behavior: 'smooth' }), in 200 px steps.
  for (let y = 1800; y >= 0; y -= 200) await s.pageScroll(y);
  assert.equal(s.tracker.position(), 120 - 2000, 'still where the reader scrolled to');
  assert.match(s.tracker.log().at(-1), /against input$/);
  assert.ok(jumps.length > 0);
  assert.deepEqual({ position: jumps[0].position, verdict: jumps[0].verdict }, { position: 120 - 2000, verdict: 'against input' });
  s.done();
});

test('the reader scrolling up with the wheel or keys still counts, and nothing is reported', async () => {
  const jumps = [];
  const s = setup({ onJumpUp: () => jumps.push(1) });
  await s.wheel(100, 2000);
  for (let y = 1800; y >= 600; y -= 200) await s.wheel(-100, y);
  assert.equal(s.tracker.position(), 120 - 600);
  await s.key('Home', 0);
  assert.equal(s.tracker.position(), 120);
  await s.key('End', 3000);
  await s.key(' ', 2200, { shiftKey: true }); // Shift+Space: a page up
  assert.equal(s.tracker.position(), 120 - 2200);
  assert.deepEqual(jumps, []);
  s.done();
});

test('a scroll the page makes by itself long after the reader stopped is reported once far enough up', async () => {
  const jumps = [];
  const s = setup({ onJumpUp: (position, top, verdict) => jumps.push(verdict) });
  await s.wheel(100, 2000);
  s.page.now += 5000;
  await s.pageScroll(1900); // 100 px: not far enough
  assert.deepEqual(jumps, []);
  await s.pageScroll(0);
  assert.deepEqual(jumps, ['not the reader']);
  s.done();
});
