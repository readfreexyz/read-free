const test = require('node:test');
const assert = require('node:assert/strict');
const paywall = require('../extension/src/paywall.js');
const nyt = require('../extension/sites/nyt.js');
const { parse, livePageHtml, raiseWall } = require('./fixtures.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// jsdom has no layout, so every element measures 0×0, just like the popup does in the extension
// (content.css hides it). Fake a size where a test needs the popup visibly on screen.
function setSize(doc, width, height) {
  doc.querySelector('#gateway-content').getBoundingClientRect = () => ({ width, height });
}

test('a wall is up when the popup has content and the page is inert, even at 0×0', () => {
  const up = parse(livePageHtml({ wall: 'paywall' }));
  assert.equal(paywall.wallInPage(up, nyt), true);
  assert.equal(paywall.isActive(up, nyt), true);
  assert.equal(paywall.isActive(parse(livePageHtml({ wall: null })), nyt), false);
});

test('an empty popup, or a page that is not inert, is not a wall', () => {
  const emptyPopup = parse(livePageHtml({ wall: null }));
  emptyPopup.getElementById('site-content').setAttribute('inert', '');
  assert.equal(paywall.isActive(emptyPopup, nyt), false);

  const notInert = parse(livePageHtml({ wall: 'paywall' }));
  notInert.getElementById('site-content').removeAttribute('inert');
  assert.equal(paywall.isActive(notInert, nyt), false);
});

test('a popup visibly on screen counts too (NYT\'s version, shown on request)', () => {
  const doc = parse(livePageHtml({ wall: 'paywall' }));
  doc.getElementById('site-content').removeAttribute('inert');
  setSize(doc, 1165, 370);
  assert.equal(paywall.isActive(doc, nyt), true);
});

test('wallType tells the login wall from the paywall, and is null with no wall', () => {
  assert.equal(paywall.wallType(parse(livePageHtml({ wall: null })), nyt), null);
  assert.equal(paywall.wallType(parse(livePageHtml({ wall: 'login' })), nyt), 'login');
  assert.equal(paywall.wallType(parse(livePageHtml({ wall: 'paywall' })), nyt), 'paywall');
});

test("NYT's paywall popup carries the login wall's \"without signing in\" note too; the cut-off text decides", () => {
  // Login wording, but the body ends in "Subscribe to The Times…": the text is cut, so it's the paywall.
  assert.equal(paywall.wallType(parse(livePageHtml({ wall: 'login', upsell: 'inside' })), nyt), 'paywall');
  // Login wording and the whole story: the login wall.
  assert.equal(paywall.wallType(parse(livePageHtml({ wall: 'login' })), nyt), 'login');
  // The print-edition note under the article links to a subscription page too, outside the body.
  const doc = parse(livePageHtml({ wall: 'login' }));
  doc.getElementById('story').insertAdjacentHTML('beforeend', '<div class="bottom-of-article"><div><p>A version of this article appears in print. <a href="https://www.nytimes.com/subscriptions/Multiproduct/x.html">Order Reprints</a> | Today’s Paper | Subscribe</p></div></div>');
  assert.equal(paywall.wallType(doc, nyt), 'login');
});

test('watch fires right away when a wall is already up', () => {
  let calls = 0;
  const stop = paywall.watch(parse(livePageHtml()), nyt, () => calls++);
  assert.equal(calls, 1);
  stop();
});

test('watch reacts to a wall going up in a MutationObserver callback, before the next paint', async () => {
  const doc = parse(livePageHtml({ wall: null }));
  let calls = 0;
  const stop = paywall.watch(doc, nyt, () => calls++, { intervalMs: 60000 }); // polling won't help
  raiseWall(doc, 'login');
  await sleep(0); // mutation callbacks are microtasks: they run before this macrotask
  assert.equal(calls, 1);
  raiseWall(doc, 'login');
  await sleep(0);
  assert.equal(calls, 1, 'only once');
  stop();
});

test('watch stops when told to, and after its time limit', async () => {
  const stoppedDoc = parse(livePageHtml({ wall: null }));
  let stoppedCalls = 0;
  paywall.watch(stoppedDoc, nyt, () => stoppedCalls++, { intervalMs: 5 })();

  const lateDoc = parse(livePageHtml({ wall: null }));
  let lateCalls = 0;
  paywall.watch(lateDoc, nyt, () => lateCalls++, { intervalMs: 5, timeoutMs: 20 });

  await sleep(50);
  raiseWall(stoppedDoc, 'paywall');
  raiseWall(lateDoc, 'paywall');
  await sleep(30);
  assert.equal(stoppedCalls, 0);
  assert.equal(lateCalls, 0);
});
