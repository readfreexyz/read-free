const test = require('node:test');
const assert = require('node:assert/strict');
const paywall = require('../extension/src/paywall.js');
const nyt = require('../extension/sites/nyt.js');
const { parse, livePageHtml, interactivePageHtml, raiseWall } = require('./fixtures.js');

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

// The user's Chrome, 2026-11-25: main#site-content isn't inert any more; the article body and
// several divs are, one by one.
test("NYT's wall since Nov 2026: the article body is inert, not the whole page", () => {
  const up = parse(livePageHtml({ marks: 'parts', upsell: 'inside' }));
  assert.equal(up.getElementById('site-content').hasAttribute('inert'), false);
  assert.equal(paywall.isActive(up, nyt), true);
  assert.equal(paywall.wallType(up, nyt), 'paywall');

  const emptyPopup = parse(livePageHtml({ marks: 'parts' }));
  emptyPopup.getElementById('gateway-content').innerHTML = '';
  assert.equal(paywall.isActive(emptyPopup, nyt), false, 'inert, but no popup');

  const onlyElsewhere = parse(livePageHtml({ marks: 'parts' }));
  onlyElsewhere.querySelector('section[name="articleBody"]').removeAttribute('inert');
  assert.equal(paywall.isActive(onlyElsewhere, nyt), false, 'something else inert (a closed menu, say), not the article');
});

test("the wall's note says \"logging in\" since Nov 2026: whole text is the login wall, cut text the paywall", () => {
  assert.equal(paywall.wallType(parse(livePageHtml({ marks: 'parts' })), nyt), 'login');
  assert.equal(paywall.wallType(parse(livePageHtml({ marks: 'parts', upsell: 'inside' })), nyt), 'paywall');
});

// The note is the same on both walls, so on a page with no article body only the subscription line
// can say it's the paywall.
test('no article body: a "Subscribe to…" line in the page makes it the paywall; a print note does not', () => {
  const line = text => {
    const doc = parse(interactivePageHtml());
    doc.querySelector('main').insertAdjacentHTML('beforeend', `<div><p>${text}</p></div>`);
    return paywall.wallType(doc, nyt);
  };
  assert.equal(line('<a href="https://www.nytimes.com/subscription?campaignId=X">Subscribe to The Times</a> to read as many articles as you like.'), 'paywall');
  assert.equal(line('A version of this article appears in print. <a href="https://www.nytimes.com/subscriptions/Multiproduct/x.html">Order Reprints</a> | Today’s Paper | <a href="https://www.nytimes.com/subscriptions/x">Subscribe</a>'), 'login');
  assert.equal(line('Nothing about subscriptions.'), 'login');
});

test('interactive pages: with or without a date in the address', () => {
  for (const path of ['/interactive/2026/11/24/climate/x.html', '/interactive/2021/us/covid-cases.html', '/interactive/projects/x/']) assert.equal(nyt.isLive(path), true, path);
  for (const path of ['/interactive/', '/section/world', '/', '/2026/11/24/climate/x.html', '/live/latest']) assert.equal(nyt.isLive(path), false, path);
});

test('an interactive page under the login wall: pinned in place, nothing inert', () => {
  const up = parse(interactivePageHtml());
  assert.equal(up.querySelector('[inert]'), null);
  assert.equal(paywall.isActive(up, nyt), true);
  assert.equal(paywall.wallType(up, nyt), 'login');
  assert.equal(paywall.isActive(parse(interactivePageHtml({ wall: null })), nyt), false);
  const otherStyle = parse(interactivePageHtml());
  otherStyle.getElementById('site-content').setAttribute('style', 'width: 100%');
  assert.equal(paywall.isActive(otherStyle, nyt), false, 'some other inline style');
  const pinnedOnly = parse(interactivePageHtml());
  pinnedOnly.getElementById('gateway-content').innerHTML = '';
  assert.equal(paywall.isActive(pinnedOnly, nyt), false, 'pinned (a menu, say), but no popup');
});

test('watch reacts to it going up, too, before the next paint', async () => {
  const doc = parse(livePageHtml({ wall: null }));
  let calls = 0;
  const stop = paywall.watch(doc, nyt, () => calls++, { intervalMs: 60000 });
  raiseWall(doc, 'paywall', { marks: 'parts' });
  await sleep(0);
  assert.equal(calls, 1);
  stop();
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

// The popup's size in a browser: NYT shows it only under a wall (data-shown here), and nyt.css hides
// it unless <html> lets it out (nytfix-off, or nytfix-probe for a measurement).
function layOut(doc, { shown = true } = {}) {
  const html = doc.documentElement;
  const seen = [];
  doc.querySelector('#gateway-content').getBoundingClientRect = () => {
    const out = html.classList.contains('nytfix-off') || html.classList.contains('nytfix-probe');
    seen.push([...html.classList].join(' '));
    return shown && out ? { width: 1165, height: 370 } : { width: 0, height: 0 };
  };
  return seen;
}
const unmarked = options => {
  const doc = parse(livePageHtml({ marks: 'parts', ...options }));
  for (const el of doc.querySelectorAll('[inert]')) { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); }
  return doc;
};

test('a wall with marks Read Free does not know: its popup is measured, let out just for that', () => {
  const doc = unmarked({ upsell: 'inside' });
  layOut(doc);
  assert.equal(paywall.wallInPage(doc, nyt), false, 'nothing inert');
  assert.equal(paywall.isActive(doc, nyt), true);
  assert.equal(doc.documentElement.className, '', 'hidden again at once');
  assert.equal(paywall.wallType(doc, nyt), 'paywall');
  const login = unmarked();
  layOut(login);
  assert.equal(paywall.wallType(login, nyt), 'login', 'the login wording, whole text');
});

test('a popup NYT is not showing is no wall, however full; nor is one with neither the wording nor a cut', () => {
  const idle = unmarked({ upsell: 'inside' });
  layOut(idle, { shown: false });
  assert.equal(paywall.isActive(idle, nyt), false, 'filled, but 0x0 once let out');
  const other = unmarked();
  other.getElementById('gateway-content').innerHTML = '<p>Something new.</p>';
  layOut(other);
  assert.equal(paywall.isActive(other, nyt), false);
  assert.equal(paywall.hiddenPopupShows(other, nyt), true, 'shown, though (watchMissed)');
  const empty = unmarked({ upsell: 'inside' });
  empty.getElementById('gateway-content').innerHTML = '';
  const seen = layOut(empty);
  assert.equal(paywall.isActive(empty, nyt), false);
  assert.ok(!seen.some(c => c.includes('nytfix-probe')), 'an empty popup is never let out');
});

test('the popup is measured at most once a second, and not while the wall is off or shown', () => {
  const doc = unmarked({ upsell: 'inside' });
  const seen = layOut(doc);
  for (let i = 0; i < 5; i++) paywall.hiddenPopupShows(doc, nyt);
  assert.equal(seen.filter(c => c === 'nytfix-probe').length, 1);
  for (const state of ['nytfix-active', 'nytfix-off']) {
    const held = unmarked({ upsell: 'inside' });
    held.documentElement.classList.add(state);
    const looks = layOut(held);
    assert.equal(paywall.hiddenPopupShows(held, nyt), false, state);
    assert.ok(!looks.some(c => c.includes('nytfix-probe')), state);
  }
});

const FAST = { pollMs: 10, hiddenAfterMs: 60, cutAfterMs: 120 };
const missedOn = async (doc, site = nyt, { wait = 250, during = () => {} } = {}) => {
  const calls = [];
  const stop = paywall.watchMissed(doc, site, { ...FAST, onHidden: () => calls.push('hidden'), onCut: () => calls.push('cut') });
  during();
  await sleep(wait);
  stop();
  return calls;
};

test('watchMissed: an unknown popup the site would show, a cut article with no wall; each once, after a while', async () => {
  const other = unmarked();
  other.getElementById('gateway-content').innerHTML = '<p>Something new.</p>';
  layOut(other);
  assert.deepEqual(await missedOn(other), ['hidden']);
  const cut = unmarked({ upsell: 'inside' });
  cut.getElementById('gateway-content').innerHTML = '';
  assert.deepEqual(await missedOn(cut), ['cut']);
  assert.deepEqual(await missedOn(cut, nyt, { wait: 60 }), [], 'not at once: the wall may be on its way');
});

test('watchMissed: nothing for a known wall, a wall-free page, or a site without it', async () => {
  const known = parse(livePageHtml({ marks: 'parts', upsell: 'inside' }));
  layOut(known);
  assert.deepEqual(await missedOn(known), []);
  const free = parse(livePageHtml({ wall: null }));
  layOut(free, { shown: false });
  assert.deepEqual(await missedOn(free), []);
  const prefilled = unmarked();
  layOut(prefilled, { shown: false });
  assert.deepEqual(await missedOn(prefilled), [], 'the popup is filled, but not shown');
  const without = { ...nyt, live: { ...nyt.live, wall: { ...nyt.live.wall, failOpen: undefined } } };
  const cut = unmarked({ upsell: 'inside' });
  cut.getElementById('gateway-content').innerHTML = '';
  assert.deepEqual(await missedOn(cut, without), [], 'only where the adapter asks for it');
  const late = unmarked({ upsell: 'inside' });
  late.getElementById('gateway-content').innerHTML = '';
  assert.deepEqual(await missedOn(late, nyt, { during: () => setTimeout(() => raiseWall(late, 'paywall', { marks: 'parts' }), 40) }), [], 'recognized before the note');
});

test('a popup that takes up room but cannot be seen is not on screen', () => {
  const rect = (doc, box, visible = true) => {
    const popup = doc.querySelector('#gateway-content');
    popup.getBoundingClientRect = () => (doc.documentElement.classList.contains('nytfix-probe') ? box : { width: 0, height: 0 });
    popup.checkVisibility = () => visible;
    return paywall.isActive(doc, nyt);
  };
  const seen = { width: 1000, height: 370, top: 300, left: 0 };
  assert.equal(rect(unmarked(), seen), true);
  assert.equal(rect(unmarked(), seen, false), false, 'opacity 0, or visibility hidden');
  assert.equal(rect(unmarked(), { ...seen, top: 5000 }), false, 'below the window');
  assert.equal(rect(unmarked(), { ...seen, left: -2000 }), false, 'off to the side');
  assert.equal(rect(unmarked(), { ...seen, top: -400 }), false, 'above it');
});
