// Page-world guards (extension/page/*.js): scripts that run in the site's own JavaScript world
// before its scripts, and keep the site's code from cutting the article.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const NINE = fs.readFileSync(path.join(__dirname, '../extension/page/nine.js'), 'utf8');

// A page with the guard loaded first, then the site's own listener (Nine's React code).
function ninePage() {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.theage.com.au/x-20261114-p61d87.html', runScripts: 'outside-only' });
  window.console.info = () => {};
  window.eval(NINE);
  const heard = [];
  window.addEventListener('pianoContentWall', e => heard.push(e.detail));
  const piano = detail => window.dispatchEvent(new window.CustomEvent('pianoContentWall', { detail }));
  const send = action => window.document.dispatchEvent(new window.CustomEvent(`nytfix:${action}`));
  const held = () => window.document.documentElement.getAttribute('data-nytfix-held');
  return { window, heard, piano, send, held };
}

test("nine: Piano's paywall, registration wall and scroll lock are held back; other events go through", () => {
  const page = ninePage();
  page.piano({ type: 'payWall', extra: 1 });
  page.piano({ type: 'regWall' });
  page.piano({ type: 'scrollLock' });
  page.piano({ type: 'meter' });
  page.piano(null);
  assert.deepEqual(page.heard, [{ type: 'meter' }, null]);
  assert.equal(page.held(), 'payWall regWall scrollLock');
});

test('nine: release lets the held events through as they were, in order, and stops holding', () => {
  const page = ninePage();
  page.piano({ type: 'payWall', extra: 1 });
  page.piano({ type: 'scrollLock' });
  page.send('release');
  assert.deepEqual(page.heard, [{ type: 'payWall', extra: 1 }, { type: 'scrollLock' }]);
  assert.equal(page.held(), null);
  page.piano({ type: 'payWall' });
  assert.equal(page.heard.length, 3, 'not held any more');
});

test('nine: hold again undoes what got through (NO_PAYWALL), and only then', () => {
  const page = ninePage();
  page.send('hold');
  assert.deepEqual(page.heard, [], 'nothing got through, nothing to undo');
  page.send('release');
  page.piano({ type: 'payWall' });
  page.send('hold');
  assert.deepEqual(page.heard.map(d => d.type), ['payWall', 'NO_PAYWALL']);
  assert.equal(page.held(), 'payWall');
  page.piano({ type: 'payWall' });
  assert.equal(page.heard.length, 2, 'holding again');
});

const CORRIERE = fs.readFileSync(path.join(__dirname, '../extension/page/corriere.js'), 'utf8');

// A Corriere page: the guard first, then the site's loader listening for its two events.
function corrierePage() {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://milano.corriere.it/notizie/x.shtml', runScripts: 'outside-only' });
  window.console.info = () => {};
  window.eval(CORRIERE);
  const heard = [];
  window.addEventListener('pno_abc_test:init', () => heard.push('wall'));
  window.document.addEventListener('adblockActivated', () => heard.push('adblock'));
  const doc = window.document;
  return {
    window, heard,
    wall: () => window.dispatchEvent(new window.CustomEvent('pno_abc_test:init')),
    adblock: () => doc.dispatchEvent(new window.Event('adblockActivated', { bubbles: true })),
    send: action => doc.dispatchEvent(new window.CustomEvent(`nytfix:${action}`)),
    held: () => doc.documentElement.getAttribute('data-nytfix-held'),
  };
}

test("corriere: the wall's event and the ad-blocker popup's are held back; only the wall counts as one", () => {
  const page = corrierePage();
  page.adblock();
  assert.deepEqual(page.heard, []);
  assert.equal(page.held(), null, 'the ad-blocker popup is no paywall');
  page.wall();
  assert.deepEqual(page.heard, []);
  assert.equal(page.held(), 'pno_abc_test:init');
});

test("corriere: release lets both through (the site's version); hold holds what comes next", () => {
  const page = corrierePage();
  page.adblock();
  page.wall();
  page.send('release');
  assert.deepEqual(page.heard, ['adblock', 'wall']);
  assert.equal(page.held(), null);
  page.send('hold');
  page.wall();
  assert.deepEqual(page.heard, ['adblock', 'wall'], 'held again');
});

const PIANO_ADBLOCK = fs.readFileSync(path.join(__dirname, '../extension/page/piano-adblock.js'), 'utf8');

// Piano's ad-blocker snippet as La Libre's bundle inserts it (the bait script's load left out:
// its onerror is fired by hand, as when an ad blocker stops it).
const PIANO_SNIPPET = `document.cookie = "__adblocker=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
var setNptTechAdblockerCookie = function(adblocker) { var d = new Date(); d.setTime(d.getTime() + 60 * 5 * 1000); document.cookie = "__adblocker=" + (adblocker ? "true" : "false") + "; expires=" + d.toUTCString() + "; path=/"; };
var bait = document.createElement("script"); bait.setAttribute("onerror", "setNptTechAdblockerCookie(true);"); document.head.appendChild(bait);`;

function lalibrePage({ guard = true } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://www.lalibre.be/belgique/2026/11/15/x-YV6CMZWTJFGJTAXWG5DYBQ2YH4/', runScripts: 'dangerously' });
  const { window } = dom;
  window.console.info = () => {};
  if (guard) window.eval(PIANO_ADBLOCK);
  const script = window.document.createElement('script');
  script.textContent = PIANO_SNIPPET;
  window.document.head.appendChild(script);
  const blocked = () => window.document.querySelector('head > script:last-child').dispatchEvent(new window.Event('error'));
  const flag = () => (window.document.cookie.match(/(?:^|;\s*)__adblocker=([^;]*)/) || [])[1];
  return { window, blocked, flag };
}

test("piano-adblock: without the guard, a blocked bait script flags the ad blocker (the test's premise)", () => {
  const page = lalibrePage({ guard: false });
  page.blocked();
  assert.equal(page.flag(), 'true');
});

test("piano-adblock: with the guard, Piano's check records no ad blocker, the snippet's own function notwithstanding", () => {
  const page = lalibrePage();
  page.blocked();
  assert.equal(page.flag(), 'false');
  assert.equal(typeof page.window.setNptTechAdblockerCookie, 'function');
  page.window.setNptTechAdblockerCookie(true);
  assert.equal(page.flag(), 'false');
});

// The bait script when it loads (www.npttech.com/advertising.js), reduced to what it does: it's
// BlockAdBlock, using window.blockAdBlock if there is one; its check plants a bait element, which
// the ad blocker hides here, so it reports "detected" and writes the cookie itself.
const PIANO_BAIT = `(function (t) {
  function n(v) { document.cookie = "__adblocker=" + (v ? "true" : "false") + "; path=/"; }
  function Bab() { this.event = { detected: [], notDetected: [] }; }
  Bab.prototype.onDetected = function (f) { this.event.detected.push(f); return this; };
  Bab.prototype.onNotDetected = function (f) { this.event.notDetected.push(f); return this; };
  Bab.prototype.check = function () { var self = this; setTimeout(function () { self.event.detected.forEach(function (f) { f(); }); }, 1); };
  t.BlockAdBlock = new Bab();
  if (t.blockAdBlock === undefined) t.blockAdBlock = new Bab();
  if (typeof blockAdBlock === "undefined") n(true);
  else { blockAdBlock.onDetected(function () { n(true); }); blockAdBlock.onNotDetected(function () { t.__purposefulCheck || n(false); }); blockAdBlock.check(); }
})(window);`;

function baitLoads(page) {
  const script = page.window.document.createElement('script');
  script.textContent = PIANO_BAIT;
  page.window.document.head.appendChild(script);
  return new Promise(resolve => page.window.setTimeout(resolve, 20));
}

test('piano-adblock: without the guard, the bait script that loads finds the ad blocker (the premise)', async () => {
  const page = lalibrePage({ guard: false });
  await baitLoads(page);
  assert.equal(page.flag(), 'true');
});

test('piano-adblock: with the guard, the bait script that loads gets a BlockAdBlock that finds nothing', async () => {
  const page = lalibrePage();
  await baitLoads(page);
  assert.equal(page.flag(), 'false');
  page.window.eval('window.blockAdBlock = { check() {} };');
  assert.equal(typeof page.window.blockAdBlock.onNotDetected, 'function', "the site can't swap it out");
});

test("piano-adblock: a true flag left by an earlier page is cleared before the site's scripts run", () => {
  const { window } = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://www.lalibre.be/', runScripts: 'outside-only' });
  window.console.info = () => {};
  window.document.cookie = '__adblocker=true; path=/';
  window.eval(PIANO_ADBLOCK);
  assert.match(window.document.cookie, /(?:^|;\s*)__adblocker=false\b/);
});

// The New Yorker's subscription engine, as read from its script on 2026-11-24: everything matching
// a selector past the first is removed, again whenever something is added.
const NEWYORKER = fs.readFileSync(path.join(__dirname, '../extension/page/newyorker.js'), 'utf8');
const { newyorkerLivePageHtml } = require('./fixtures.js');
const SELECTORS = ['[data-testid="ArticlePageChunks"] > *', '.body__inner-container > *'];

function newyorkerPage({ guard = true } = {}) {
  const { window } = new JSDOM(newyorkerLivePageHtml({ wall: false }), { url: 'https://www.newyorker.com/magazine/2026/11/30/test-story', runScripts: 'outside-only' });
  window.console.info = () => {};
  if (guard) window.eval(NEWYORKER);
  const doc = window.document;
  const truncate = () => {
    for (const selector of SELECTORS) {
      const cut = () => [...doc.querySelectorAll(selector)].forEach((el, i) => { if (i >= 1) el.remove(); });
      cut();
      new window.MutationObserver(records => { if (records.some(r => r.addedNodes.length)) cut(); }).observe(doc, { childList: true, subtree: true });
    }
  };
  const send = action => doc.dispatchEvent(new window.CustomEvent(`nytfix:${action}`));
  return { window, doc, truncate, send, text: () => doc.querySelectorAll('.body__inner-container p').length, held: () => doc.documentElement.getAttribute('data-nytfix-held') };
}

test("newyorker: without the guard, the engine leaves one paragraph (the test's premise)", () => {
  const page = newyorkerPage({ guard: false });
  page.truncate();
  assert.equal(page.text(), 1);
});

test('newyorker: the article is kept, and said to be; ads go as the site likes; a whole page is left alone', () => {
  const page = newyorkerPage();
  assert.equal(page.held(), null);
  page.truncate();
  assert.equal(page.text(), 6);
  assert.equal(page.held(), 'truncate');
  assert.equal(page.doc.querySelector('.ad'), null, 'an ad row between the sections');

  const free = newyorkerPage();
  free.doc.querySelector('.ad').remove();
  assert.equal(free.doc.querySelector('.ad'), null);
  assert.equal(free.held(), null, 'an ad going is no wall');
  // Elsewhere on the page, and by React's way (removeChild), nothing changes
  free.doc.querySelector('header').remove();
  assert.equal(free.doc.querySelector('header'), null);
  const p = free.doc.querySelector('.body__inner-container p');
  p.parentNode.removeChild(p);
  assert.equal(free.text(), 5);
  assert.equal(free.held(), null);
});

test("newyorker: release cuts the article as the site would; hold brings it all back, in order", () => {
  const page = newyorkerPage();
  const before = [...page.doc.querySelectorAll('.body__inner-container p')].map(p => p.textContent);
  page.truncate();
  page.send('release');
  assert.equal(page.text(), 1, "the site's version");
  assert.equal(page.held(), null);
  page.send('hold');
  assert.deepEqual([...page.doc.querySelectorAll('.body__inner-container p')].map(p => p.textContent), before);
  assert.equal(page.held(), 'truncate');
});

test('newyorker: another page: what was held on the one before no longer counts', () => {
  const page = newyorkerPage();
  page.truncate();
  const main = page.doc.querySelector('main');
  main.parentNode.removeChild(main); // the site shows another page
  page.send('hold');
  assert.equal(page.held(), null);
});
