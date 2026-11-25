// End-to-end tests of the content script: the real extension scripts, loaded in manifest
// order into a jsdom page, with fake chrome APIs and canned archive.today responses.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const manifest = require('../extension/manifest.json');
const { livePageHtml, interactivePageHtml, pinInteractive, ftLivePageHtml, atlanticLivePageHtml, atlanticSnapshotHtml, newyorkerLivePageHtml, newyorkerSnapshotHtml, cookingLivePageHtml, genericLivePageHtml, genericSnapshotHtml, latimesLivePageHtml, thestarLivePageHtml, nineLivePageHtml, nineSnapshotHtml, spiegelLivePageHtml, spiegelSnapshotHtml, nationalpostLivePageHtml, nationalpostSnapshotHtml, corriereLivePageHtml, corriereHomeHtml, spectatorLivePageHtml, reutersLivePageHtml, lalibreLivePageHtml, lalibrePianoOffer, dailymailLivePageHtml, usatodayLivePageHtml, raiseWall, snapshotHtml, ftSnapshotHtml, timemapFor, mementoUrl, memoryArea } = require('./fixtures.js');
const { VERSION: CACHE_VERSION } = require('../extension/src/cache.js');
const archive = require('../extension/src/archive.js');

const EXT = path.join(__dirname, '..', 'extension');
// The scripts the manifest puts on the page, in the order they run: page-world guards
// (world MAIN, document_start) first, then the content scripts of the site's entry.
const scriptsFor = url => {
  const host = new URL(url).hostname;
  // A match pattern's host: exact, or *.example.com for the domain and its subdomains (Chrome's rule).
  const hostMatches = pattern => {
    const want = /^https:\/\/([^/]+)\//.exec(pattern)[1];
    return want === host || (want.startsWith('*.') && (host === want.slice(2) || host.endsWith(want.slice(1))));
  };
  const entries = manifest.content_scripts.filter(c => c.matches.some(hostMatches));
  const ordered = [...entries.filter(e => e.world === 'MAIN'), ...entries.filter(e => e.world !== 'MAIN')];
  return ordered.flatMap(e => e.js).map(f => fs.readFileSync(path.join(EXT, f), 'utf8'));
};
// A site made only of shared pieces (adapter.defineSite): the core scripts with this adapter in
// place of a real site's.
const GENERIC_ADAPTER = `NYTFix.adapter.defineSite({
  id: 'example', name: 'Example News', shortName: 'Example', hosts: ['news.example.com'],
  isArticle: path => path.startsWith('/2026/'),
  live: { body: '.story-body', wall: { services: ['piano'], reveal: '.locked', type: NYTFix.adapter.textOnPage('.story-body') } },
});`;
const genericScripts = () => manifest.content_scripts[0].js.flatMap(f => {
  if (f.startsWith('sites/')) return [GENERIC_ADAPTER];
  return [fs.readFileSync(path.join(EXT, f), 'utf8')];
});
const GENERIC_ARTICLE = 'https://news.example.com/2026/11/14/story';
const ARTICLE = 'https://www.nytimes.com/2026/11/14/world/europe/test-article.html';
const OTHER_PATH = '/2026/11/15/world/another-article.html';
const OTHER = `https://www.nytimes.com${OTHER_PATH}`;
// Snapshot times, oldest to newest.
const T = [Date.UTC(2026, 10, 14, 1), Date.UTC(2026, 10, 14, 5), Date.UTC(2026, 10, 14, 9), Date.UTC(2026, 10, 14, 13)];

const timemapUrl = article => `https://archive.ph/timemap/${article}`;
const newestUrl = (article, host = 'archive.ph') => `https://${host}/newest/${article}`;
const snapshotUrl = (ms, article = ARTICLE) => mementoUrl(article, ms, 'https://archive.ph');
const ok = body => ({ ok: true, status: 200, url: 'ignored', body });
const statusText = page => page.doc.getElementById('nytfix-status')?.shadowRoot.querySelector('.label').textContent;
const LIVE = 'https://www.nytimes.com/live/2026/11/13/us/test-live-blog';
// The paywalled live page shows 3 short paragraphs (~420 characters).
const COMPLETE = snapshotHtml({ paragraphs: 12 }); // ~2,000 characters
const BEHIND_PAYWALL = snapshotHtml({ paragraphs: 3 }); // ~500: longer than the page, still incomplete

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(check, timeout = 3000) {
  const start = Date.now();
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${check}`);
    await sleep(10);
  }
}

// responses: { [url]: response, or a function returning one (or a promise of one) }.
// Unlisted /newest/<article> requests are answered the way archive.today does: with the newest
// snapshot in that article's timemap response (its url set to the snapshot's own address, as
// after the redirect), or 404 when the timemap has none. Fetching through /newest/ records only
// the /newest/ URL in `fetched`.
// storage: chrome.storage.local (saved articles); sync: chrome.storage.sync (settings).
// newer: what the service worker says when asked for a newer version (release.notice()), or null;
// or a function giving the reply (a promise that never settles: no answer, as while it starts).
// What the content scripts put on the page's global on purpose: their namespace, and the stand-ins
// page/piano-adblock.js pins for La Libre's ad-blocker check
const MEANT_GLOBALS = new Set(['NYTFix', '__nytfixLoaded', 'setNptTechAdblockerCookie', 'blockAdBlock']);

function boot({ url = ARTICLE, html = livePageHtml(), responses = {}, storage = memoryArea(), sync = memoryArea(), scripts = scriptsFor(url), newer = null } = {}) {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', e => { if (!/Not implemented: (window\.scroll|Window's scroll)/.test(e.message)) console.error(e); });
  const logs = [];
  virtualConsole.on('info', (...args) => logs.push(args.join(' ')));
  const { window } = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  const doc = window.document;

  const fetched = [];
  const marks = []; // the toolbar mark's states, in order (null: cleared)
  const listeners = [];
  window.chrome = {
    runtime: {
      onMessage: { addListener: fn => listeners.push(fn) },
      sendMessage: async msg => {
        if (msg.type === 'nytfix:mark') {
          marks.push(msg.state);
          return undefined;
        }
        if (msg.type === 'nytfix:newer') return typeof newer === 'function' ? newer() : newer;
        fetched.push(msg.url);
        return answer(msg.url);
      },
    },
    storage: { local: storage, sync },
  };
  async function answer(requested) {
    const response = responses[requested];
    if (response) return typeof response === 'function' ? response() : response;
    const newest = /^https:\/\/([^/]+)\/newest\/(.+)$/.exec(requested);
    if (newest) {
      const [, host, article] = newest;
      const tm = await answer(`https://${host}/timemap/${article}`);
      const [latest] = tm.ok && tm.status === 200 ? archive.newestFirst(archive.parseTimemap(tm.body), 1) : [];
      if (!latest) return { ok: true, status: 404, url: requested, body: '' };
      const snapshot = archive.toMirror(latest.url, host);
      const res = await answer(snapshot);
      return res.ok ? { ...res, url: snapshot } : res;
    }
    return { ok: true, status: 404, url: requested, body: '' };
  }
  // Chrome runs content scripts in strict mode, where assigning to a name never declared throws;
  // jsdom quietly makes a global of it instead (0.22.0 shipped one, "newer"). So a global the
  // scripts didn't mean to make fails the test when the page is closed.
  const before = new Set(Object.getOwnPropertyNames(window));
  for (const src of scripts) window.eval(src);
  // (window[0], window[1]…: the page's frames, not globals)
  const leaked = () => Object.getOwnPropertyNames(window).filter(name => !before.has(name) && !MEANT_GLOBALS.has(name) && !/^\d+$/.test(name));

  return {
    window, doc, fetched, marks, storage, logs,
    mark: () => marks[marks.length - 1] ?? null,
    toggle: () => new Promise(resolve => listeners[0]({ type: 'nytfix:toggle' }, {}, resolve)),
    // Plain copies: objects made in the page have its own prototypes.
    state: () => new Promise(resolve => listeners[0]({ type: 'nytfix:state' }, {}, r => resolve(JSON.parse(JSON.stringify(r))))),
    // The content script reads the settings before it acts on the page: one turn of the event loop.
    started: () => sleep(0),
    body: () => doc.querySelector('.nytfix-body'),
    banner: () => doc.getElementById('nytfix-banner'),
    button: label => [...(doc.getElementById('nytfix-banner')?.querySelectorAll('button') || [])].find(b => b.textContent === label),
    close: () => {
      const stray = leaked();
      window.close();
      if (stray.length) throw new Error(`the content scripts made globals they never declared: ${stray.join(', ')}`);
    },
  };
}

test('swaps in the newest snapshot as soon as the paywall shows, and saves it', async () => {
  const page = boot({
    responses: {
      [timemapUrl(ARTICLE)]: ok(timemapFor(ARTICLE, [T[3]])),
      [snapshotUrl(T[3])]: ok(COMPLETE),
    },
  });
  try {
    await waitFor(page.body);
    assert.equal(page.body().querySelectorAll('p').length, 12);
    assert.deepEqual(page.fetched, [newestUrl(ARTICLE)], 'one request: the newest snapshot, straight away');
    assert.equal(page.mark(), 'swapped', 'the toolbar icon is marked');
    assert.equal(page.banner().querySelector('a').href, snapshotUrl(T[3]));
    assert.equal(page.doc.getElementById('site-content').hasAttribute('inert'), false);
    // Links point at the original pages, and the photo loads from NYT's own image server.
    assert.equal(page.body().querySelector('p a').href, 'https://www.nytimes.com/2026/01/01/world/other.html');
    assert.equal(page.body().querySelector('figure img').src, 'https://static01.nyt.com/images/2026/11/11/multimedia/photo.jpg');
    await waitFor(() => page.storage.data[`article:${ARTICLE}`]);
  } finally {
    page.close();
  }
});

// NYT since 2026-11-25 (the user's Chrome): the article body and other parts are inert, not main.
test("NYT's wall since Nov 2026: the article goes in, every part is usable again, and undo puts the wall back as it was", async () => {
  const parts = ['section[name="articleBody"]', '#story > header', 'aside.related', '.masthead-row'];
  const html = livePageHtml({ marks: 'parts', upsell: 'inside' });
  const page = boot({ html, responses: { [timemapUrl(ARTICLE)]: ok(timemapFor(ARTICLE, [T[3]])), [snapshotUrl(T[3])]: ok(COMPLETE) } });
  try {
    await waitFor(page.body);
    assert.deepEqual(page.fetched, [newestUrl(ARTICLE)]);
    assert.equal(page.mark(), 'swapped');
    for (const part of parts) {
      const el = page.doc.querySelector(part);
      assert.equal(el.hasAttribute('inert'), false, `${part} can be clicked`);
      assert.equal(el.hasAttribute('aria-hidden'), false, `${part} can be read by a screen reader`);
    }
    assert.equal(page.body().closest('[inert], [aria-hidden="true"]'), null);
    await waitFor(() => page.storage.data[`article:${ARTICLE}`]);
    assert.equal((await page.toggle()).state, 'idle');
    for (const part of parts) {
      const el = page.doc.querySelector(part);
      assert.ok(el.hasAttribute('inert'), `${part} as NYT had it`);
      assert.equal(el.getAttribute('aria-hidden'), 'true', part);
    }
  } finally {
    page.close();
  }
});

test("NYT's wall since Nov 2026, going up after the page is drawn, and put back by NYT afterwards", async () => {
  const page = boot({ html: livePageHtml({ wall: null, upsell: 'inside' }), responses: { [timemapUrl(ARTICLE)]: ok(timemapFor(ARTICLE, [T[3]])), [snapshotUrl(T[3])]: ok(COMPLETE) } });
  try {
    await page.started();
    assert.deepEqual(page.fetched, [], 'no wall yet: nothing is asked for');
    raiseWall(page.doc, 'paywall', { marks: 'parts' });
    await waitFor(page.body);
    const section = page.doc.querySelector('section[name="articleBody"]');
    section.setAttribute('inert', '');
    section.setAttribute('aria-hidden', 'true');
    await waitFor(() => !section.hasAttribute('inert') && !section.hasAttribute('aria-hidden'));
  } finally {
    page.close();
  }
});

test('uses the archive.today address chosen in the settings', async () => {
  const timemap = `https://archive.is/timemap/${ARTICLE}`;
  const snapshot = mementoUrl(ARTICLE, T[3], 'https://archive.is');
  const page = boot({
    sync: memoryArea({ settings: { mirror: 'archive.is' } }),
    responses: { [timemap]: ok(timemapFor(ARTICLE, [T[3]])), [snapshot]: ok(COMPLETE) },
  });
  try {
    await waitFor(page.body);
    assert.deepEqual(page.fetched, [newestUrl(ARTICLE, 'archive.is')]);
    assert.equal(page.banner().querySelector('a').href, snapshot);
  } finally {
    page.close();
  }
});

test('a paywall comes off at once, before archive.today has answered', async () => {
  let release;
  const page = boot({
    responses: {
      [timemapUrl(ARTICLE)]: ok(timemapFor(ARTICLE, [T[3]])),
      [snapshotUrl(T[3])]: () => new Promise(resolve => { release = () => resolve(ok(COMPLETE)); }),
    },
  });
  const main = page.doc.getElementById('site-content');
  try {
    await page.started(); // the settings, read first
    assert.equal(main.hasAttribute('inert'), false, 'clickable straight away');
    assert.ok(page.doc.querySelector('.css-hgm7bf').hasAttribute('data-nytfix-hidden'));
    await waitFor(() => release);
    assert.equal(page.body(), null, 'still waiting for the snapshot');
    assert.match(statusText(page), /Getting the newest archive\.today snapshot/);
    release();
    await waitFor(page.body);
  } finally {
    page.close();
  }
});

test("while archive.today loads, a placeholder stands in for NYT's subscription line", async () => {
  let release;
  const page = boot({
    html: livePageHtml({ upsell: 'inside' }),
    responses: {
      [timemapUrl(ARTICLE)]: ok(timemapFor(ARTICLE, [T[3]])),
      [snapshotUrl(T[3])]: () => new Promise(resolve => { release = () => resolve(ok(COMPLETE)); }),
    },
  });
  const upsellLine = page.doc.querySelector('.css-upsell');
  try {
    await waitFor(() => release);
    const box = page.doc.querySelector('.nytfix-loading');
    assert.match(box.textContent, /Loading the rest of this article/);
    assert.ok(upsellLine.hasAttribute('data-nytfix-hidden'));
    release();
    await waitFor(page.body);
    assert.equal(page.doc.querySelector('.nytfix-loading'), null, 'gone once the text is in');
    assert.ok(upsellLine.closest('[data-nytfix-hidden]'), 'and the subscription line stays hidden');
  } finally {
    page.close();
  }
});

test("if archive.today has nothing, the placeholder says so and NYT's line comes back", async () => {
  const page = boot({ html: livePageHtml({ upsell: 'inside' }), responses: { [timemapUrl(ARTICLE)]: ok('') } });
  try {
    await waitFor(() => page.doc.querySelector('.nytfix-loading')?.dataset.kind === 'info');
    assert.match(page.doc.querySelector('.nytfix-loading').textContent, /no snapshot of this article yet/);
    assert.equal(page.doc.querySelector('.css-upsell').hasAttribute('data-nytfix-hidden'), false);
  } finally {
    page.close();
  }
});

test('"Try again" in the placeholder fetches the article again, still holding it to the paywalled page', async () => {
  // A network hiccup (on /newest/ and again on the timemap's snapshot), then a snapshot captured
  // behind the paywall, held back until the new attempt's placeholder is up.
  const hiccup = { ok: false, error: 'net::ERR_NETWORK_CHANGED' };
  let release;
  const held = new Promise(resolve => { release = () => resolve(ok(BEHIND_PAYWALL)); });
  const answers = [hiccup, hiccup, held];
  const storage = memoryArea();
  const page = boot({
    html: livePageHtml({ upsell: 'inside' }),
    storage,
    responses: {
      [timemapUrl(ARTICLE)]: ok(timemapFor(ARTICLE, [T[3]])),
      [snapshotUrl(T[3])]: () => answers.shift(),
    },
  });
  const note = () => page.doc.querySelector('.nytfix-loading[data-kind="error"]');
  const tryAgain = () => note().querySelector('button');
  try {
    await waitFor(note);
    assert.match(note().textContent, /ERR_NETWORK_CHANGED/);
    assert.equal(tryAgain().textContent, 'Try again');
    assert.ok(page.button('Try again'), 'the banner offers it too');

    tryAgain().click();
    await waitFor(() => !note() && page.doc.querySelector('.nytfix-loading .nytfix-spinner'));
    assert.equal(page.doc.querySelectorAll('.nytfix-loading').length, 1, 'the old note made way for the new attempt');

    release();
    await waitFor(page.body);
    assert.equal(page.body().querySelectorAll('p').length, 3);
    // The wall is off by now, but the page still counts as paywalled: the snapshot isn't taken
    // for the whole article, only shown as the best there is.
    assert.match(statusText(page), /may be missing the end/);
    await waitFor(() => storage.data[`article:${ARTICLE}`]);
    assert.equal(storage.data[`article:${ARTICLE}`].partial, true);
  } finally {
    page.close();
  }
});

test('a saved copy swaps in without ever showing the placeholder', async () => {
  const storage = memoryArea({
    [`article:${ARTICLE}`]: {
      v: CACHE_VERSION,
      savedAt: Date.now(),
      blocks: [1, 2, 3, 4].map(n => ({ type: 'paragraph', text: `Saved placeholder paragraph ${n}.` })),
      snapshotUrl: snapshotUrl(T[3]),
      snapshotTime: T[3],
    },
  });
  const page = boot({ html: livePageHtml({ upsell: 'inside' }), storage });
  let sawPlaceholder = false;
  new page.window.MutationObserver(() => { sawPlaceholder ||= Boolean(page.doc.querySelector('.nytfix-loading')); })
    .observe(page.doc.body, { subtree: true, childList: true });
  try {
    await waitFor(page.body);
    await sleep(20);
    assert.equal(sawPlaceholder, false);
  } finally {
    page.close();
  }
});

test('falls back to an older snapshot when the newest was captured behind the paywall', async () => {
  const page = boot({
    responses: {
      [timemapUrl(ARTICLE)]: ok(timemapFor(ARTICLE, [T[1], T[2], T[3]])),
      [snapshotUrl(T[3])]: ok(BEHIND_PAYWALL),
      [snapshotUrl(T[2])]: ok(COMPLETE),
    },
  });
  try {
    await waitFor(page.body);
    assert.deepEqual(page.fetched, [newestUrl(ARTICLE), timemapUrl(ARTICLE), snapshotUrl(T[2])]);
    assert.equal(page.body().querySelectorAll('p').length, 12);
    assert.equal(page.banner().querySelector('a').href, snapshotUrl(T[2]));
  } finally {
    page.close();
  }
});

test('tries at most three snapshots, then shows the longest one, saved only briefly', async () => {
  const storage = memoryArea();
  const page = boot({
    storage,
    responses: {
      [timemapUrl(ARTICLE)]: ok(timemapFor(ARTICLE, T)),
      [snapshotUrl(T[3])]: ok(BEHIND_PAYWALL),
      [snapshotUrl(T[2])]: ok(BEHIND_PAYWALL),
      [snapshotUrl(T[1])]: ok(BEHIND_PAYWALL),
      [snapshotUrl(T[0])]: ok(COMPLETE), // never reached
    },
  });
  try {
    await waitFor(page.body);
    assert.deepEqual(page.fetched, [newestUrl(ARTICLE), timemapUrl(ARTICLE), snapshotUrl(T[2]), snapshotUrl(T[1])]);
    assert.equal(page.body().querySelectorAll('p').length, 3);
    assert.match(statusText(page), /Showing the longest archive\.today snapshot\. It may be missing the end/);
    assert.notEqual(page.banner()?.dataset.kind, 'error');
    await waitFor(() => storage.data[`article:${ARTICLE}`]);
    assert.equal(storage.data[`article:${ARTICLE}`].partial, true);
  } finally {
    page.close();
  }
});

test('says so, and shows nothing, when no snapshot has more text than the page', async () => {
  const page = boot({
    html: livePageHtml({ paragraphs: 4 }), // ~560 characters, more than BEHIND_PAYWALL's ~510
    responses: {
      [timemapUrl(ARTICLE)]: ok(timemapFor(ARTICLE, [T[2], T[3]])),
      [snapshotUrl(T[3])]: ok(BEHIND_PAYWALL),
      [snapshotUrl(T[2])]: ok(BEHIND_PAYWALL),
    },
  });
  try {
    await waitFor(() => page.banner()?.dataset.kind === 'error');
    assert.equal(page.body(), null);
    assert.match(page.banner().textContent, /2 newest archive\.today snapshots look incomplete too: the longest has 510 characters, and this page already shows 564/);
    assert.ok(page.button('Try again'));
    assert.equal(page.button('Use the longest anyway'), undefined, 'it would show less than the page');
  } finally {
    page.close();
  }
});

test('uses a saved copy without any network request', async () => {
  const storage = memoryArea({
    [`article:${ARTICLE}`]: {
      v: CACHE_VERSION,
      savedAt: Date.now(),
      blocks: [1, 2, 3].map(n => ({ type: 'paragraph', text: `Saved placeholder paragraph ${n}.` })),
      snapshotUrl: snapshotUrl(T[3]),
      snapshotTime: T[3],
    },
  });
  const page = boot({ storage });
  try {
    await waitFor(page.body);
    assert.deepEqual(page.fetched, []);
    assert.equal(page.body().querySelectorAll('p').length, 3);
  } finally {
    page.close();
  }
});

// When /newest/ doesn't come through, the timemap is a second way in.

test('if the newest snapshot times out, the list of snapshots is asked for instead', async () => {
  const page = boot({
    responses: {
      [newestUrl(ARTICLE)]: { ok: false, error: 'timed out after 90 s' },
      [timemapUrl(ARTICLE)]: ok(timemapFor(ARTICLE, [T[2], T[3]])),
      [snapshotUrl(T[3])]: ok(COMPLETE),
    },
  });
  try {
    await waitFor(page.body);
    assert.deepEqual(page.fetched, [newestUrl(ARTICLE), timemapUrl(ARTICLE), snapshotUrl(T[3])]);
    assert.equal(page.banner().querySelector('a').href, snapshotUrl(T[3]));
  } finally {
    page.close();
  }
});

test("an error from /newest/ isn't taken for \"no snapshot\"; neither is a 404 from the snapshot it led to", async () => {
  for (const newest of [
    { ok: true, status: 504, url: newestUrl(ARTICLE), body: 'Gateway Time-out' },
    { ok: true, status: 404, url: snapshotUrl(T[3]), body: '' },
  ]) {
    const page = boot({
      responses: {
        [newestUrl(ARTICLE)]: newest,
        [timemapUrl(ARTICLE)]: ok(timemapFor(ARTICLE, [T[2], T[3]])),
        [snapshotUrl(T[3])]: ok(COMPLETE),
      },
    });
    try {
      await waitFor(page.body);
      assert.equal(page.fetched[1], timemapUrl(ARTICLE), String(newest.status));
      assert.equal(page.storage.data[`missing:${ARTICLE}`], undefined, 'not remembered as missing');
    } finally {
      page.close();
    }
  }
});

test('an incomplete newest snapshot is still shown when the list of older ones hangs', async () => {
  const page = boot({
    html: livePageHtml({ upsell: 'inside' }),
    responses: {
      [newestUrl(ARTICLE)]: { ok: true, status: 200, url: snapshotUrl(T[3]), body: BEHIND_PAYWALL },
      [timemapUrl(ARTICLE)]: { ok: false, error: 'timed out after 20 s' },
    },
  });
  try {
    await waitFor(page.body);
    assert.equal(page.body().querySelectorAll('p').length, 3);
    assert.match(statusText(page), /may be missing the end/);
    assert.equal(page.doc.querySelector('.nytfix-loading'), null);
  } finally {
    page.close();
  }
});

// Chrome can restart the service worker, or Read Free reload, while a download is in flight:
// "the message channel closed before a response was received". Asked again once, a fresh service
// worker answers, and the newest snapshot still comes the quick way, not by the list of snapshots.
test("the background worker goes away mid-request: asked again once, the newest snapshot still comes the quick way", async () => {
  let asked = 0;
  const newest = () => {
    asked += 1;
    if (asked === 1) throw new Error('A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received');
    return { ...ok(COMPLETE), url: snapshotUrl(T[3]) };
  };
  const page = boot({ responses: { [newestUrl(ARTICLE)]: newest } });
  try {
    await waitFor(page.body);
    assert.equal(asked, 2, 'asked twice');
    assert.deepEqual(page.fetched, [newestUrl(ARTICLE), newestUrl(ARTICLE)], 'no list of snapshots');
    assert.equal(page.banner()?.dataset.kind === 'error', false);
    assert.ok(page.logs.some(l => l.includes("the background worker didn't answer; asking it again")));
  } finally {
    page.close();
  }
});

test("the background worker doesn't answer twice: the reader is told, as before", async () => {
  const gone = () => { throw new Error('Could not establish connection. Receiving end does not exist.'); };
  const page = boot({ responses: { [newestUrl(ARTICLE)]: gone, [timemapUrl(ARTICLE)]: gone } });
  try {
    await waitFor(() => page.banner()?.dataset.kind === 'error');
    assert.match(page.banner().textContent, /background worker didn't answer/);
  } finally {
    page.close();
  }
});

// archive.ph's connections closed without an answer, for minutes at a time (2026-11-25): one other
// address is asked.
const DROPPED = { ok: false, error: 'Failed to fetch', reason: 'unreachable' };
const onIs = url => url.replace('https://archive.ph/', 'https://archive.is/');

test("archive.ph can't be connected to: archive.is is asked once, and the links go there", async () => {
  const page = boot({
    responses: {
      [newestUrl(ARTICLE)]: DROPPED,
      [newestUrl(ARTICLE, 'archive.is')]: { ...ok(COMPLETE), url: onIs(snapshotUrl(T[3])) },
    },
  });
  try {
    await waitFor(page.body);
    assert.deepEqual(page.fetched, [newestUrl(ARTICLE), newestUrl(ARTICLE, 'archive.is')]);
    assert.equal(page.banner().querySelector('a').href, onIs(snapshotUrl(T[3])));
    assert.ok(page.logs.some(l => l.includes('trying archive.is instead')));
  } finally {
    page.close();
  }
});

test('the other address is kept for the rest: an incomplete snapshot there, then its list and older ones', async () => {
  const page = boot({
    responses: {
      [newestUrl(ARTICLE)]: DROPPED,
      [newestUrl(ARTICLE, 'archive.is')]: { ...ok(BEHIND_PAYWALL), url: onIs(snapshotUrl(T[3])) },
      [onIs(timemapUrl(ARTICLE))]: ok(timemapFor(ARTICLE, [T[2], T[3]])),
      [onIs(snapshotUrl(T[2]))]: ok(COMPLETE),
    },
  });
  try {
    await waitFor(page.body);
    assert.deepEqual(page.fetched, [newestUrl(ARTICLE), newestUrl(ARTICLE, 'archive.is'), onIs(timemapUrl(ARTICLE)), onIs(snapshotUrl(T[2]))]);
    assert.equal(page.banner().querySelector('a').href, onIs(snapshotUrl(T[2])));
  } finally {
    page.close();
  }
});

test("the connection drops on the list or on a snapshot: the other address is asked for that", async () => {
  const timedOut = { ok: false, error: 'timed out after 90 s' };
  for (const [dropped, then] of [
    [timemapUrl(ARTICLE), [onIs(timemapUrl(ARTICLE)), onIs(snapshotUrl(T[3]))]],
    [snapshotUrl(T[3]), [onIs(snapshotUrl(T[3]))]],
  ]) {
    const page = boot({
      responses: {
        [newestUrl(ARTICLE)]: timedOut,
        [timemapUrl(ARTICLE)]: ok(timemapFor(ARTICLE, [T[3]])),
        [onIs(timemapUrl(ARTICLE))]: ok(timemapFor(ARTICLE, [T[3]])),
        [onIs(snapshotUrl(T[3]))]: ok(COMPLETE),
        [dropped]: DROPPED,
      },
    });
    try {
      await waitFor(page.body);
      assert.deepEqual(page.fetched, [newestUrl(ARTICLE), timemapUrl(ARTICLE), ...(dropped === timemapUrl(ARTICLE) ? [] : [dropped]), ...then], dropped);
    } finally {
      page.close();
    }
  }
});

test("neither address can be connected to: the reader's own is still asked for the list, and may answer", async () => {
  const page = boot({
    responses: {
      [newestUrl(ARTICLE)]: DROPPED,
      [newestUrl(ARTICLE, 'archive.is')]: DROPPED,
      [timemapUrl(ARTICLE)]: ok(timemapFor(ARTICLE, [T[3]])),
      [snapshotUrl(T[3])]: ok(COMPLETE),
    },
  });
  try {
    await waitFor(page.body);
    assert.deepEqual(page.fetched, [newestUrl(ARTICLE), newestUrl(ARTICLE, 'archive.is'), timemapUrl(ARTICLE), snapshotUrl(T[3])]);
  } finally {
    page.close();
  }
});

test('nothing answers: the banner says so in plain words, links to the chosen address, and each is asked no more than it has to be', async () => {
  const page = boot({
    responses: { [newestUrl(ARTICLE)]: DROPPED, [newestUrl(ARTICLE, 'archive.is')]: DROPPED, [timemapUrl(ARTICLE)]: DROPPED },
  });
  try {
    await waitFor(() => page.banner()?.dataset.kind === 'error');
    assert.match(page.banner().textContent, /Couldn't connect to archive\.today: neither archive\.ph nor archive\.is answered\./);
    assert.match(page.banner().textContent, /Wait a minute and try again\./);
    assert.doesNotMatch(page.banner().textContent, /Failed to fetch/);
    assert.equal(page.banner().querySelector('a').href, archive.searchUrl(ARTICLE, 'archive.ph'));
    assert.deepEqual(page.fetched, [newestUrl(ARTICLE), newestUrl(ARTICLE, 'archive.is'), timemapUrl(ARTICLE)]);
    assert.equal(page.storage.data[`missing:${ARTICLE}`], undefined, 'not remembered as missing');
    assert.ok(page.logs.some(l => l.includes('archive.ph: Failed to fetch (unreachable)')), "the browser's own words are in the console");
  } finally {
    page.close();
  }
});

test('neither answers and the list times out too: the banner still says neither answered', async () => {
  const page = boot({
    responses: { [newestUrl(ARTICLE)]: DROPPED, [newestUrl(ARTICLE, 'archive.is')]: DROPPED, [timemapUrl(ARTICLE)]: { ok: false, error: 'timed out after 20 s' } },
  });
  try {
    await waitFor(() => page.banner()?.dataset.kind === 'error');
    assert.match(page.banner().textContent, /neither archive\.ph nor archive\.is answered/);
    assert.doesNotMatch(page.banner().textContent, /timed out/);
  } finally {
    page.close();
  }
});

test("neither answers and it took long: the reader isn't kept waiting for a third request", async () => {
  let page;
  const late = () => { page.window.Date.now = () => Date.now() + 41000; return DROPPED; }; // 41 s have gone by
  page = boot({ responses: { [newestUrl(ARTICLE)]: DROPPED, [newestUrl(ARTICLE, 'archive.is')]: late } });
  try {
    await waitFor(() => page.banner()?.dataset.kind === 'error');
    assert.match(page.banner().textContent, /neither archive\.ph nor archive\.is answered/);
    assert.deepEqual(page.fetched, [newestUrl(ARTICLE), newestUrl(ARTICLE, 'archive.is')]);
  } finally {
    page.close();
  }
});

test('the other address wants a CAPTCHA: it says which, links there, and asks no further', async () => {
  const page = boot({
    responses: {
      [newestUrl(ARTICLE)]: DROPPED,
      [newestUrl(ARTICLE, 'archive.is')]: { ok: true, status: 200, url: newestUrl(ARTICLE, 'archive.is'), body: '<div class="g-recaptcha"></div>' },
    },
  });
  try {
    await waitFor(() => page.banner()?.dataset.kind === 'error');
    assert.match(page.banner().textContent, /archive\.is wants a CAPTCHA/);
    assert.equal(page.banner().querySelector('a').href, archive.searchUrl(ARTICLE, 'archive.is'));
    assert.deepEqual(page.fetched, [newestUrl(ARTICLE), newestUrl(ARTICLE, 'archive.is')]);
  } finally {
    page.close();
  }
});

test("the answer breaks off partway: the list is asked for at the same address, as for a timeout", async () => {
  const page = boot({
    responses: {
      [newestUrl(ARTICLE)]: { ok: false, error: 'network error', reason: 'cut-off' },
      [timemapUrl(ARTICLE)]: ok(timemapFor(ARTICLE, [T[3]])),
      [snapshotUrl(T[3])]: { ok: false, error: 'network error', reason: 'cut-off' },
    },
  });
  try {
    await waitFor(() => page.banner()?.dataset.kind === 'error');
    assert.deepEqual(page.fetched, [newestUrl(ARTICLE), timemapUrl(ARTICLE), snapshotUrl(T[3])]);
    assert.match(page.banner().textContent, /The connection to archive\.ph broke off before the page had arrived\./);
  } finally {
    page.close();
  }
});

test('a CAPTCHA on /newest/ is reported at once; asking another way would hit it too', async () => {
  const page = boot({
    responses: { [newestUrl(ARTICLE)]: { ok: true, status: 200, url: newestUrl(ARTICLE), body: '<div class="g-recaptcha"></div>' } },
  });
  try {
    await waitFor(() => page.banner()?.dataset.kind === 'error');
    assert.match(page.banner().textContent, /CAPTCHA/);
    assert.deepEqual(page.fetched, [newestUrl(ARTICLE)]);
    // Report a problem: an email the reader writes and sends, with what happened and the
    // outlet, never the article's address; opened by the mail app, not in a tab
    const report = [...page.banner().querySelectorAll('a')].find(a => a.textContent === 'Report a problem');
    assert.ok(report, 'a Report a problem link');
    assert.match(report.href, /^mailto:hello@readfree\.xyz\?subject=/);
    const mail = new URLSearchParams(report.href.slice(report.href.indexOf('?') + 1));
    assert.match(mail.get('subject'), /a problem on The New York Times$/);
    assert.match(mail.get('body'), /^What happened: .*CAPTCHA/);
    assert.ok(!mail.get('body').includes(ARTICLE) && !mail.get('body').includes('nytimes.com'), "no article address");
    assert.equal(report.target, '', 'not in a new tab');
    assert.equal(report.title, 'Email hello@readfree.xyz');
  } finally {
    page.close();
  }
});

test('remembers that there is no snapshot yet; "Check again" asks anew', async () => {
  const responses = { [timemapUrl(ARTICLE)]: ok('') };
  const first = boot({ responses });
  try {
    await waitFor(() => /no snapshot of this article yet/.test(first.banner()?.textContent || ''));
    await waitFor(() => first.storage.data[`missing:${ARTICLE}`]);
  } finally {
    first.close();
  }

  const reload = boot({ responses, storage: first.storage });
  try {
    await waitFor(() => /no snapshot of this article yet/.test(reload.banner()?.textContent || ''));
    assert.deepEqual(reload.fetched, [], 'the remembered answer is used');
    reload.button('Check again').click();
    await waitFor(() => reload.fetched.length === 1);
    assert.deepEqual(reload.fetched, [newestUrl(ARTICLE)]);
  } finally {
    reload.close();
  }
});

test('does nothing at all when there is no paywall', async () => {
  const page = boot({ html: livePageHtml({ wall: null }) });
  try {
    await sleep(700);
    assert.deepEqual(page.fetched, []);
    assert.equal(page.doc.getElementById('nytfix-status'), null);
    assert.equal(page.banner(), null);
  } finally {
    page.close();
  }
});

test('starts over when NYT navigates to another article in-page, without restoring the old paywall', async () => {
  const page = boot({
    responses: {
      [timemapUrl(ARTICLE)]: ok(timemapFor(ARTICLE, [T[3]])),
      [snapshotUrl(T[3])]: ok(COMPLETE),
      [timemapUrl(OTHER)]: ok(''),
    },
  });
  try {
    await waitFor(page.body);
    assert.equal(page.mark(), 'swapped');
    page.window.history.pushState({}, '', OTHER_PATH);
    await waitFor(() => page.body() === null, 3000);
    assert.equal(page.mark(), null, "the old page's mark is cleared");
    assert.equal(page.doc.getElementById('site-content').hasAttribute('inert'), false, 'the page stays clickable');
    assert.ok(!page.doc.documentElement.classList.contains('nytfix-off'), "the old wall isn't brought back");
    raiseWall(page.doc, 'paywall'); // the new article has a paywall of its own
    await waitFor(() => page.fetched.includes(newestUrl(OTHER)));
    await waitFor(() => /no snapshot of this article yet/.test(page.banner()?.textContent || ''));
  } finally {
    page.close();
  }
});

test('toolbar: undo puts the paywall back, a second click swaps again from the cache', async () => {
  const page = boot({
    responses: {
      [timemapUrl(ARTICLE)]: ok(timemapFor(ARTICLE, [T[3]])),
      [snapshotUrl(T[3])]: ok(COMPLETE),
    },
  });
  try {
    await waitFor(page.body);
    await waitFor(() => page.storage.data[`article:${ARTICLE}`]);
    assert.equal((await page.toggle()).state, 'idle');
    assert.equal(page.body(), null);
    assert.equal(page.doc.getElementById('site-content').hasAttribute('inert'), true);
    assert.ok(page.doc.documentElement.classList.contains('nytfix-off'), "NYT's wall is shown again");
    assert.equal(page.mark(), null, "the icon's mark is cleared");
    await page.toggle();
    await waitFor(page.body);
    assert.equal(page.fetched.length, 1, 'the second swap came from the cache');
    assert.equal(page.mark(), 'swapped');
  } finally {
    page.close();
  }
});

// Chrome runs content scripts in strict mode, where an undeclared name throws; jsdom quietly
// makes a global of one that's assigned. So the answer must come late, or never, for a missing
// declaration to show here (0.22.0 shipped one: "Something went wrong: newer is not defined").
test("the service worker doesn't answer about a newer version: the wall still comes off with its usual message", async () => {
  for (const [label, newer] of [['no answer', () => new Promise(() => {})], ['an error', () => Promise.reject(new Error('Receiving end does not exist.'))]]) {
    const page = boot({ html: livePageHtml({ wall: 'login' }), newer });
    try {
      await waitFor(() => statusText(page));
      assert.match(statusText(page), /Removed the login wall/, label);
      assert.doesNotMatch(statusText(page), /Something went wrong/, label);
      assert.equal(page.doc.getElementById('nytfix-status').shadowRoot.querySelector('.newer'), null, label);
    } finally {
      page.close();
    }
  }
});

test('a newer version out: the status bar says so once the wall is off, with how to update', async () => {
  // A regular reader (NYT explained two days ago): nothing else to say, so this is what shows
  const now = Date.now();
  const days = [1, 2, 3, 4].map(n => new Date(now - n * 86400000).toISOString().slice(0, 10));
  const storage = memoryArea({ notify: { v: 1, fixed: 30, days, sites: { nyt: now - 2 * 86400000 } } });
  const newer = { version: '0.22.0', href: 'https://readfree.xyz/#update', text: 'Read Free 0.22.0 is out' };
  const page = boot({ html: livePageHtml({ wall: 'login' }), storage, newer });
  try {
    const note = await waitFor(() => page.doc.getElementById('nytfix-status')?.shadowRoot.querySelector('.newer'));
    assert.match(note.querySelector('.ask-text').textContent, /^Read Free 0\.22\.0 is out\./);
    assert.equal(note.querySelector('a').href, 'https://readfree.xyz/#update');
    assert.equal(page.doc.getElementById('nytfix-status').shadowRoot.querySelector('.ask:not(.newer)'), null, 'no donation link with it');
    assert.deepEqual(page.fetched, [], 'nothing fetched for it');
    assert.equal(storage.data.notify.update.lastAt > 0, true, 'remembered, so it waits three days');
  } finally {
    page.close();
  }
});

test('login wall on an article: lifted at once, no archive request, toolbar toggles it', async () => {
  const page = boot({ html: livePageHtml({ wall: 'login' }) });
  const main = page.doc.getElementById('site-content');
  try {
    await waitFor(() => !main.hasAttribute('inert'));
    assert.deepEqual(page.fetched, []);
    assert.equal(page.body(), null, "NYT's own text stays");
    assert.ok(page.doc.documentElement.classList.contains('nytfix-active'));
    assert.match(statusText(page), /Removed the login wall/);

    assert.equal((await page.toggle()).state, 'idle');
    assert.ok(main.hasAttribute('inert'), 'undo puts the wall back');
    assert.ok(page.doc.documentElement.classList.contains('nytfix-off'));
    await page.toggle();
    assert.equal(main.hasAttribute('inert'), false, 'and the toolbar lifts it again');
    assert.deepEqual(page.fetched, []);
  } finally {
    page.close();
  }
});

test('a wall that shows up mid-scroll is lifted with the reader kept in place', async () => {
  const page = boot({ html: livePageHtml({ wall: null }) });
  const { doc, window } = page;
  const main = doc.getElementById('site-content');
  // jsdom can't scroll: the content's top edge sits 120 px down and moves up as the page scrolls.
  const scroller = { scrollTop: 0 };
  main.getBoundingClientRect = () => ({ top: 120 - scroller.scrollTop });
  Object.defineProperty(doc, 'scrollingElement', { configurable: true, value: scroller });
  const scrollTo = async (y, { reader }) => {
    if (reader) doc.dispatchEvent(new window.Event('wheel'));
    scroller.scrollTop = y;
    doc.dispatchEvent(new window.Event('scroll'));
    await sleep(40); // the extension samples on the next animation frame
  };
  try {
    // The page container is already position: fixed, as it may be on live blogs.
    doc.querySelector('[data-testid="vi-gateway-container"]').style.position = 'fixed';
    for (const y of [400, 800, 1200, 1600, 2000]) await scrollTo(y, { reader: true });
    await sleep(1100); // the reader stops to read
    await scrollTo(0, { reader: false }); // the wall arrives: NYT drops the page back to the top
    raiseWall(doc, 'login');
    await waitFor(() => !main.hasAttribute('inert'));
    assert.equal(scroller.scrollTop, 2000, 'back where the reader was');

    await scrollTo(0, { reader: false }); // NYT scrolls once more after the wall comes off
    await waitFor(() => scroller.scrollTop === 2000, 1000);
  } finally {
    page.close();
  }
});

test("NYT's paywall with the login wall's wording: the cut text gets the archived article, not just the lift", async () => {
  const page = boot({
    html: livePageHtml({ wall: 'login', upsell: 'inside' }),
    responses: { [timemapUrl(ARTICLE)]: ok(timemapFor(ARTICLE, [T[3]])), [snapshotUrl(T[3])]: ok(COMPLETE) },
  });
  try {
    await waitFor(page.body);
    assert.deepEqual(page.fetched, [newestUrl(ARTICLE)]);
    assert.equal(page.body().querySelectorAll('p').length, 12);
    assert.doesNotMatch(statusText(page) || '', /login wall/);
  } finally {
    page.close();
  }
});

test('login wall on a live blog is lifted too', async () => {
  const page = boot({ url: LIVE, html: livePageHtml({ wall: 'login', section: false }) });
  try {
    await waitFor(() => !page.doc.getElementById('site-content').hasAttribute('inert'));
    assert.deepEqual(page.fetched, []);
  } finally {
    page.close();
  }
});

const INTERACTIVE = 'https://www.nytimes.com/interactive/2026/11/24/climate/test-interactive.html';
test('login wall on an interactive page: unpinned, nothing fetched; undo pins it again', async () => {
  const page = boot({ url: INTERACTIVE, html: interactivePageHtml({ scrolled: 300 }) });
  try {
    const main = page.doc.getElementById('site-content');
    await waitFor(() => main.style.position === '');
    assert.equal(main.style.width, '');
    assert.equal(main.style.marginTop, '');
    assert.deepEqual(page.fetched, []);
    assert.equal(page.mark(), 'lifted');
    assert.match(statusText(page), /Removed NYT's wall/);
    main.setAttribute('style', 'position: fixed; width: 100%; margin-top: -300px;'); // NYT pins it again
    await waitFor(() => main.style.position === '');
    assert.equal((await page.toggle()).state, 'idle');
    assert.equal(main.style.position, 'fixed', "NYT's version: as NYT had it");
    assert.equal(main.style.width, '100%');
    assert.equal(main.style.marginTop, '-300px');
    assert.ok(page.doc.documentElement.classList.contains('nytfix-off'));
    assert.deepEqual(page.fetched, []);
  } finally {
    page.close();
  }
});

test('login wall on an interactive page, going up after the page is drawn', async () => {
  const page = boot({ url: INTERACTIVE, html: interactivePageHtml({ wall: null }) });
  try {
    await page.started();
    assert.equal(page.mark(), null);
    pinInteractive(page.doc);
    await waitFor(() => page.mark() === 'lifted');
    assert.equal(page.doc.getElementById('site-content').style.position, '');
    assert.deepEqual(page.fetched, []);
  } finally {
    page.close();
  }
});

test("an NYT page Read Free doesn't work on: its wall is left showing, not hidden with the page still held", async () => {
  for (const url of ['https://www.nytimes.com/es/2026/11/24/espanol/test.html', 'https://www.nytimes.com/section/world']) {
    const page = boot({ url, html: interactivePageHtml() });
    try {
      await waitFor(() => page.doc.documentElement.classList.contains('nytfix-off'));
      assert.equal(page.doc.getElementById('site-content').style.position, 'fixed');
      assert.equal((await page.toggle()).state, 'not-article');
      assert.deepEqual(page.fetched, []);
    } finally {
      page.close();
    }
  }
});

test("paywall on an interactive page, with the new note: the subscription line gives it away, and NYT's wall is shown", async () => {
  const html = interactivePageHtml().replace('</main>', '<div><p><a href="https://www.nytimes.com/subscription?x">Subscribe to The Times</a> to read as many articles as you like.</p></div></main>');
  const page = boot({ url: INTERACTIVE, html });
  try {
    await waitFor(() => page.doc.documentElement.classList.contains('nytfix-off'));
    assert.equal(page.doc.getElementById('site-content').style.position, 'fixed');
    assert.equal(page.mark(), null);
    assert.deepEqual(page.fetched, []);
  } finally {
    page.close();
  }
});

test("paywall on a live blog: NYT's wall is shown as it is, and the toolbar explains why", async () => {
  const page = boot({ url: LIVE, html: livePageHtml({ wall: 'paywall', section: false }) });
  try {
    await sleep(300);
    assert.deepEqual(page.fetched, []);
    assert.ok(page.doc.getElementById('site-content').hasAttribute('inert'));
    assert.ok(page.doc.documentElement.classList.contains('nytfix-off'));
    await page.toggle();
    assert.match(statusText(page), /Pages like this one behind NYT's paywall aren't supported yet/);
    assert.deepEqual(page.fetched, []);
  } finally {
    page.close();
  }
});

test('toolbar on a page that is not an article reports it and fetches nothing', async () => {
  const page = boot({ url: 'https://www.nytimes.com/section/world', html: livePageHtml({ wall: null }) });
  try {
    assert.equal((await page.toggle()).state, 'not-article');
    await sleep(50);
    assert.deepEqual(page.fetched, []);
  } finally {
    page.close();
  }
});

// FT: a barrier page instead of the article (the user's diagnostic)

const FT_ARTICLE = 'https://www.ft.com/content/4aba8386-35cc-463b-a79c-a0c85c362c89';

test('FT: the barrier page is picked up at once, and the archived article goes in after the headline', async () => {
  const page = boot({
    url: FT_ARTICLE,
    html: ftLivePageHtml(),
    responses: {
      [timemapUrl(FT_ARTICLE)]: ok(timemapFor(FT_ARTICLE, [T[3]])),
      [snapshotUrl(T[3], FT_ARTICLE)]: ok(ftSnapshotHtml({ paragraphs: 8 })),
    },
  });
  try {
    await waitFor(page.body);
    assert.deepEqual(page.fetched, [newestUrl(FT_ARTICLE)]);
    const barrier = page.doc.getElementById('barrier-page');
    assert.equal(barrier.nextElementSibling, page.banner(), 'banner right after the headline');
    assert.equal(page.banner().nextElementSibling, page.body(), 'then the article');
    assert.equal(page.body().querySelectorAll('p').length, 8);
    assert.equal(page.body().querySelector('figure img').src, 'https://images.ft.com/v3/image/raw/photo.jpg');
    assert.ok(!page.doc.documentElement.classList.contains('nytfix-off'), 'ft.css keeps the offers hidden');

    page.button("Show FT's version").click();
    assert.equal(page.body(), null);
    assert.ok(page.doc.documentElement.classList.contains('nytfix-off'), "FT's barrier page is back");
  } finally {
    page.close();
  }
});

test("FT: while archive.today loads, a loading box sits under FT's headline", async () => {
  let release;
  const page = boot({
    url: FT_ARTICLE,
    html: ftLivePageHtml(),
    responses: {
      [timemapUrl(FT_ARTICLE)]: ok(timemapFor(FT_ARTICLE, [T[3]])),
      [snapshotUrl(T[3], FT_ARTICLE)]: () => new Promise(resolve => { release = () => resolve(ok(ftSnapshotHtml())); }),
    },
  });
  try {
    await waitFor(() => release);
    const box = page.doc.getElementById('barrier-page').nextElementSibling;
    assert.ok(box.classList.contains('nytfix-loading'));
    release();
    await waitFor(page.body);
    assert.equal(page.doc.querySelector('.nytfix-loading'), null);
  } finally {
    page.close();
  }
});

test("FT: when archive.today has nothing, FT's barrier page shows again under a note", async () => {
  const page = boot({ url: FT_ARTICLE, html: ftLivePageHtml(), responses: { [timemapUrl(FT_ARTICLE)]: ok('') } });
  try {
    await waitFor(() => /no snapshot of this article yet/.test(page.banner()?.textContent || ''));
    assert.ok(page.doc.documentElement.classList.contains('nytfix-off'));
    assert.equal(page.body(), null);
  } finally {
    page.close();
  }
});

test("FT: a subscriber's page has no barrier, so nothing happens", async () => {
  const page = boot({ url: FT_ARTICLE, html: ftLivePageHtml({ barrier: false }) });
  try {
    await sleep(300);
    assert.deepEqual(page.fetched, []);
    assert.equal(page.doc.getElementById('nytfix-status'), null);
  } finally {
    page.close();
  }
});

// The Atlantic: the body cut by Zephr, no visible gate

const ATLANTIC = 'https://www.theatlantic.com/politics/2026/11/test-article/689437/';

test('Atlantic: a cut body on a paywalled article is replaced with the archived text', async () => {
  const page = boot({
    url: ATLANTIC,
    html: atlanticLivePageHtml({ cut: true }),
    responses: {
      [timemapUrl(ATLANTIC)]: ok(timemapFor(ATLANTIC, [T[3]])),
      [snapshotUrl(T[3], ATLANTIC)]: ok(atlanticSnapshotHtml({ paragraphs: 20 })),
    },
  });
  try {
    await waitFor(page.body);
    assert.equal(page.body().querySelectorAll('p').length, 20);
    assert.ok(page.body().querySelector('p').className.includes('ArticleParagraph_root'), "The Atlantic's own paragraph style");
    assert.match(page.banner().textContent, /Show The Atlantic's version/);
  } finally {
    page.close();
  }
});

test("Atlantic: a subscriber's full body is left alone", async () => {
  const page = boot({ url: ATLANTIC, html: atlanticLivePageHtml({ cut: false }) });
  try {
    await sleep(300);
    assert.deepEqual(page.fetched, []);
  } finally {
    page.close();
  }
});

// The New Yorker: the text is on the page; a modal and hidden paragraphs are the wall

const NEWYORKER = 'https://www.newyorker.com/news/the-lede/test-story';

test('New Yorker: the paywall is lifted without asking archive.today', async () => {
  const page = boot({ url: NEWYORKER, html: newyorkerLivePageHtml({ wall: true }) });
  try {
    await waitFor(() => page.doc.documentElement.classList.contains('nytfix-active'));
    assert.deepEqual(page.fetched, []);
    assert.equal(page.body(), null, "The New Yorker's own text stays");
    assert.match(statusText(page), /Removed the paywall/);
  } finally {
    page.close();
  }
});

test("New Yorker: if the paywalled paragraphs aren't on the page, archive.today fills in", async () => {
  const page = boot({
    url: NEWYORKER,
    html: newyorkerLivePageHtml({ wall: true, paywallParagraphs: false }),
    responses: {
      [timemapUrl(NEWYORKER)]: ok(timemapFor(NEWYORKER, [T[3]])),
      [snapshotUrl(T[3], NEWYORKER)]: ok(newyorkerSnapshotHtml({ paragraphs: 12 })),
    },
  });
  try {
    await waitFor(page.body);
    assert.equal(page.body().querySelectorAll('p').length, 12);
  } finally {
    page.close();
  }
});

test("New Yorker: the guard held the cut: the offer is hidden, the text stays, nothing is fetched", async () => {
  const offer = '<div class="DualOfferInContentBarrierContainer-grPbkb">Subscribe to keep reading.</div>';
  const page = boot({ url: NEWYORKER, html: newyorkerLivePageHtml({ wall: false, ld: true, offer }) });
  try {
    await sleep(200);
    assert.equal(page.doc.getElementById('nytfix-status'), null, 'an offer over a whole article is no wall');
    page.doc.documentElement.setAttribute('data-nytfix-held', 'truncate');
    await waitFor(() => page.doc.documentElement.classList.contains('nytfix-active'));
    assert.deepEqual(page.fetched, []);
    assert.ok(page.doc.querySelector('.journey-unit__container').closest('[data-nytfix-hidden]'), 'the offer is hidden');
    assert.equal(page.doc.querySelectorAll('.body__inner-container p').length, 6);
    assert.match(statusText(page), /Removed the paywall/);
  } finally {
    page.close();
  }
});

test('New Yorker: no modal, no wall, nothing happens', async () => {
  const page = boot({ url: NEWYORKER, html: newyorkerLivePageHtml({ wall: false }) });
  try {
    await sleep(300);
    assert.deepEqual(page.fetched, []);
    assert.equal(page.doc.getElementById('nytfix-status'), null);
  } finally {
    page.close();
  }
});

// NYT Cooking: the recipe is on the page, clipped and inert

const RECIPE = 'https://cooking.nytimes.com/recipes/793393632-test-recipe';

test('NYT Cooking: the recipe is let go and the sign-up box hidden, nothing fetched; again if the wall comes back', async () => {
  const page = boot({ url: RECIPE, html: cookingLivePageHtml() });
  const { doc } = page;
  try {
    await waitFor(() => doc.documentElement.classList.contains('nytfix-active'));
    const recipe = doc.querySelector('[class*="recipebody_body-container"]');
    const box = doc.querySelector('[class*="omacookingtruncator"]');
    assert.equal(recipe.hasAttribute('inert'), false);
    assert.ok(recipe.hasAttribute('data-nytfix-reveal'), 'not clipped (content.css)');
    assert.ok(box.hasAttribute('data-nytfix-hidden'));
    assert.equal(doc.querySelectorAll('.ingredients_ingredients__FLjsC li').length, 16);
    assert.deepEqual(page.fetched, []);
    assert.match(statusText(page), /Removed NYT Cooking's wall/);
    recipe.setAttribute('inert', '');
    await waitFor(() => !recipe.hasAttribute('inert'));
  } finally {
    page.close();
  }
});

test('NYT Cooking: a recipe without the wall, and a wall that comes up later', async () => {
  const page = boot({ url: RECIPE, html: cookingLivePageHtml({ wall: false }) });
  const { doc } = page;
  try {
    await sleep(300);
    assert.equal(doc.getElementById('nytfix-status'), null);
    const recipe = doc.querySelector('[class*="recipebody_body-container"]');
    recipe.classList.add('recipebody_is-extended-truncator-fade__raetB');
    recipe.setAttribute('inert', '');
    await waitFor(() => doc.documentElement.classList.contains('nytfix-active'));
    assert.equal(recipe.hasAttribute('inert'), false);
    assert.deepEqual(page.fetched, []);
  } finally {
    page.close();
  }
});

// Sites built from shared pieces

test('a site that sent the whole article: the cover comes off, hidden text shows, nothing is fetched', async () => {
  const page = boot({ url: GENERIC_ARTICLE, html: genericLivePageHtml({ whole: true }), scripts: genericScripts() });
  const { doc } = page;
  try {
    await waitFor(() => /Removed Example's wall/.test(statusText(page) || ''));
    assert.deepEqual(page.fetched, []);
    assert.ok(doc.querySelector('.tp-modal').hasAttribute('data-nytfix-hidden'));
    assert.ok(doc.querySelector('.tp-backdrop').hasAttribute('data-nytfix-hidden'));
    assert.equal(doc.querySelector('.locked').getAttribute('data-nytfix-reveal'), 'display');
    assert.equal(doc.body.getAttribute('data-nytfix-unlock'), '');

    // Piano draws its modal again: hidden again.
    doc.body.insertAdjacentHTML('beforeend', '<div class="tp-modal" id="again"><div>Still here</div></div>');
    await waitFor(() => doc.getElementById('again').hasAttribute('data-nytfix-hidden'));

    // The toolbar button puts the site's version back.
    await page.toggle();
    assert.equal(doc.querySelector('.tp-modal').hasAttribute('data-nytfix-hidden'), false);
    assert.equal(doc.querySelector('.locked').hasAttribute('data-nytfix-reveal'), false);
    assert.equal(doc.body.hasAttribute('data-nytfix-unlock'), false);
    assert.ok(doc.documentElement.classList.contains('nytfix-off'));
  } finally {
    page.close();
  }
});

test('a site that cut the article: archive.today fills in, with the snapshot body found automatically', async () => {
  const snapshot = mementoUrl(GENERIC_ARTICLE, T[3], 'https://archive.ph');
  const page = boot({
    url: GENERIC_ARTICLE,
    html: genericLivePageHtml({ whole: false }),
    scripts: genericScripts(),
    responses: {
      [timemapUrl(GENERIC_ARTICLE)]: ok(timemapFor(GENERIC_ARTICLE, [T[3]])),
      [snapshot]: ok(genericSnapshotHtml({ paragraphs: 12 })),
    },
  });
  try {
    await waitFor(page.body);
    assert.deepEqual(page.fetched, [newestUrl(GENERIC_ARTICLE)]);
    const texts = [...page.body().querySelectorAll('p')].map(p => p.textContent);
    assert.equal(texts.length, 12, 'the 12 paragraphs, not the navigation, related story, comments or footer');
    assert.ok(texts.every(text => /^Example paragraph \d+\./.test(text)));
    assert.equal(page.body().querySelector('p').className, 'para', "in the site's own paragraph class");
    assert.ok(page.doc.querySelector('.tp-modal').hasAttribute('data-nytfix-hidden'));
    assert.equal(page.doc.body.getAttribute('data-nytfix-unlock'), '');
  } finally {
    page.close();
  }
});

// Batch 1, end to end on their real manifest entries

test('latimes: the metering popup comes off, the hidden text shows and scrolling unlocks, with nothing fetched', async () => {
  for (const [layout, url] of [
    ['gated', 'https://www.latimes.com/california/newsletter/2026-11-14/police-union'],
    ['longform', 'https://www.latimes.com/business/story/2026-11-14/downtown'],
  ]) {
    const page = boot({ url, html: latimesLivePageHtml({ layout }) });
    const { doc } = page;
    try {
      await waitFor(() => /Removed LA Times's wall/.test(statusText(page) || ''));
      assert.deepEqual(page.fetched, [], layout);
      assert.ok(doc.querySelector('modality-custom-element').hasAttribute('data-nytfix-hidden'), layout);
      assert.equal(doc.querySelector('.subscriber-content').getAttribute('data-nytfix-reveal'), 'display', layout);
      assert.equal(doc.body.getAttribute('data-nytfix-unlock'), '', layout);
      // Shown and scrollable, even though the site's rules are !important.
      const style = el => page.window.getComputedStyle(el);
      assert.equal(style(doc.querySelector('.subscriber-content')).display, 'block', layout);
      assert.equal(style(doc.body).overflowY, 'visible', layout);

      // The site's version: everything as it was.
      await page.toggle();
      assert.equal(style(doc.querySelector('.subscriber-content')).display, 'none', layout);
      assert.equal(doc.querySelector('.subscriber-content').getAttribute('style'), '', layout);
      assert.equal(style(doc.body).overflowY, 'hidden', layout);
    } finally {
      page.close();
    }
  }
});

test('thestar: the hidden paragraphs show and the offers popup goes, with nothing fetched', async () => {
  const page = boot({ url: 'https://www.thestar.com/news/world/x/article_99aff827-65aa-5a36-aedf-1cec7cf5038b.html', html: thestarLivePageHtml({ locked: true }) });
  const { doc } = page;
  try {
    await waitFor(() => /Removed The Star's wall/.test(statusText(page) || ''));
    assert.deepEqual(page.fetched, []);
    const blocks = [...doc.querySelectorAll('.subscriber-only')];
    assert.equal(blocks.length, 8);
    assert.ok(blocks.every(b => b.getAttribute('data-nytfix-reveal') === 'display'));
    assert.ok(doc.getElementById('access-offers-modal').hasAttribute('data-nytfix-hidden'));
  } finally {
    page.close();
  }
});

test('an ad-blocker notice over the article is hidden, wall or no wall', async () => {
  const page = boot({ url: 'https://www.latimes.com/politics/story/2026-11-13/what-caused-it', html: latimesLivePageHtml({ metered: false }) });
  const { doc } = page;
  try {
    doc.body.insertAdjacentHTML('beforeend', '<div id="adblock-notice" style="position: fixed"><p>Please turn off your ad blocker to keep reading. Allow ads, or subscribe.</p></div>');
    await waitFor(() => page.window.getComputedStyle(doc.getElementById('adblock-notice')).display === 'none');
    assert.deepEqual(page.fetched, []);
  } finally {
    page.close();
  }
});

test('after the wall comes off, the reader\'s scrolling counts, and an ad-blocker notice puts them back there', async () => {
  const page = boot({ url: 'https://www.latimes.com/politics/story/2026-11-13/what-caused-it', html: latimesLivePageHtml({ layout: 'gated' }) });
  const { doc, window } = page;
  try {
    await waitFor(() => /Removed LA Times's wall/.test(statusText(page) || ''));
    assert.ok(doc.body.classList.contains('met-panel-open'), 'LA Times leaves its class behind');
    // The reader scrolls 1,500 px down the article (jsdom has no layout: the page content's top
    // edge is stubbed).
    let top = 0;
    doc.querySelector('main').getBoundingClientRect = () => ({ top, bottom: top + 5000, left: 0, right: 800, width: 800, height: 5000 });
    doc.dispatchEvent(new window.WheelEvent('wheel', { deltaY: 1500 }));
    top = -1500;
    doc.dispatchEvent(new window.Event('scroll'));
    await sleep(50);
    // The notice's script throws the page back to the top, then the notice shows.
    top = 0;
    doc.body.insertAdjacentHTML('beforeend', '<div id="adblock-notice" style="position: fixed"><p>Please turn off your ad blocker. Allow ads, or subscribe.</p></div>');
    const line = await waitFor(() => page.logs.find(l => l.includes('keeping your place') && l.includes('"target":-1500')));
    assert.ok(line, 'put back where the reader had scrolled to, not where the notice left the page');
    assert.ok(page.logs.some(l => l.includes('hid an ad-blocker notice') && l.includes('"tracked":-1500')));
  } finally {
    page.close();
  }
});

test('a popup that opens after the wall is off and glides the page to the top: the reader is put back', async () => {
  const page = boot({ url: 'https://www.latimes.com/politics/story/2026-11-13/what-caused-it', html: latimesLivePageHtml({ layout: 'gated' }) });
  const { doc, window } = page;
  try {
    await waitFor(() => /Removed LA Times's wall/.test(statusText(page) || ''));
    await sleep(1600); // past the hold that follows the lift
    let top = 0;
    doc.querySelector('main').getBoundingClientRect = () => ({ top, bottom: top + 5000, left: 0, right: 800, width: 800, height: 5000 });
    const step = async y => { top = y; doc.dispatchEvent(new window.Event('scroll')); await sleep(30); };
    doc.dispatchEvent(new window.WheelEvent('wheel', { deltaY: 1500 }));
    await step(-1500);
    // The metering script glides to the top as the reader passes its trigger point.
    for (let y = -1300; y <= 0; y += 200) await step(y);
    const line = await waitFor(() => page.logs.find(l => l.includes('scrolled up by itself')));
    assert.match(line, /against input, -1500 -> /);
    assert.ok(page.logs.some(l => l.includes('keeping your place') && l.includes('"target":-1500')));
  } finally {
    page.close();
  }
});

// Batch 2, end to end on their real manifest entries

for (const [name, url, html, snapshotHtml, check] of [
  ['the Age', 'https://www.theage.com.au/national/victoria/the-bikie-boss-20261114-p61d87.html', nineLivePageHtml(), nineSnapshotHtml({ paragraphs: 12 }),
    doc => assert.ok(doc.getElementById('paywall-prompt-wrapper-piano-id').hasAttribute('data-nytfix-hidden'))],
  ['Der Spiegel', 'https://www.spiegel.de/stil/mode-trends-a-766e3d45-154b-4fa0-a588-dd01be87331e', spiegelLivePageHtml({ plus: true }), spiegelSnapshotHtml({ paragraphs: 10 }),
    doc => assert.ok(doc.querySelector('.nytfix-body .RichText p'))],
]) {
  test(`${name}: the wall comes off and the archived article takes the cut text's place`, async () => {
    const snapshot = mementoUrl(url, T[3], 'https://archive.ph');
    const page = boot({ url, html, responses: { [timemapUrl(url)]: ok(timemapFor(url, [T[3]])), [snapshot]: ok(snapshotHtml) } });
    try {
      await waitFor(page.body);
      assert.deepEqual(page.fetched, [newestUrl(url)]);
      assert.ok(page.body().querySelectorAll('p').length >= 10);
      check(page.doc);
    } finally {
      page.close();
    }
  });
}

for (const layout of ['wide', 'opinion']) {
  test(`the Herald, ${layout} layout: the archived text takes the cut text's place, above the footer; the comments prompt goes`, async () => {
    const url = 'https://www.smh.com.au/sport/cricket/x-20261114-p61e5d.html';
    const snapshot = mementoUrl(url, T[3], 'https://archive.ph');
    const page = boot({ url, html: nineLivePageHtml({ layout }), responses: { [timemapUrl(url)]: ok(timemapFor(url, [T[3]])), [snapshot]: ok(nineSnapshotHtml({ paragraphs: 12 })) } });
    const { doc } = page;
    try {
      await waitFor(page.body);
      const body = doc.querySelector('.nytfix-body');
      assert.equal(body.parentElement.className, 'sc-c502', 'in the body div');
      assert.equal(body.classList.contains('nytfix-fallback'), false);
      assert.ok([...doc.querySelectorAll('.sc-c502 > p')].every(p => p.hasAttribute('data-nytfix-hidden')), "the site's own paragraphs are hidden");
      const footer = doc.querySelector('[data-testid="article-footer"]');
      assert.ok(body.compareDocumentPosition(footer) & 4, 'the footer comes after the text');
      assert.ok(doc.getElementById('comments-cta-piano-id').hasAttribute('data-nytfix-hidden'));
      assert.equal(footer.hasAttribute('data-nytfix-hidden'), false);
      if (layout === 'opinion') assert.equal(doc.querySelector('.sc-6112-15').closest('[data-nytfix-hidden]'), null, 'the standfirst stays');
      assert.equal(body.querySelectorAll('p').length, 12);
    } finally {
      page.close();
    }
  });
}

// Nine's React code, as far as Piano's event goes: a stand-in that cuts the body to its first 2
// paragraphs on 'payWall', puts it back on 'NO_PAYWALL', and locks scrolling on 'scrollLock'.
// Registered after the extension's scripts, as the site's own scripts are.
function nineApp(window) {
  const doc = window.document;
  const body = doc.querySelector('.sc-c502');
  const full = body.innerHTML;
  const heard = [];
  window.addEventListener('pianoContentWall', e => {
    heard.push(e.detail.type);
    if (e.detail.type === 'payWall') [...body.querySelectorAll(':scope > p')].slice(2).forEach(p => p.remove());
    if (e.detail.type === 'NO_PAYWALL') body.innerHTML = full;
    if (e.detail.type === 'scrollLock') doc.body.style.overflow = 'hidden';
  });
  const piano = type => window.dispatchEvent(new window.CustomEvent('pianoContentWall', { detail: { type } }));
  return { heard, piano };
}

test("the Herald: Piano's wall event is held back, so the article is never cut; its box is lifted and nothing fetched", async () => {
  const url = 'https://www.smh.com.au/sport/cricket/x-20261114-p61e5d.html';
  const page = boot({ url, html: nineLivePageHtml({ cut: false, prompt: false, layout: 'wide' }) });
  const { doc, window } = page;
  try {
    const app = nineApp(window);
    // Piano decides the reader gets the wall: its box goes up, and it tells the page to cut.
    doc.querySelector('.article').insertAdjacentHTML('beforeend', '<div id="paywall-prompt-wrapper-piano-id" class="paywall-prompt-piano-active"><div id="paywall-prompt-piano-id"><iframe></iframe></div></div>');
    app.piano('payWall');
    app.piano('scrollLock');
    assert.deepEqual(app.heard, [], 'the site never heard it');
    assert.equal(doc.documentElement.getAttribute('data-nytfix-held'), 'payWall scrollLock');
    await waitFor(() => doc.getElementById('paywall-prompt-wrapper-piano-id').hasAttribute('data-nytfix-hidden'));
    assert.equal(doc.querySelectorAll('.sc-c502 > p').length, 14, 'the whole article');
    assert.equal(window.getComputedStyle(doc.body).overflow, 'visible');
    assert.equal(page.body(), null, 'no archived text');
    assert.deepEqual(page.fetched, [], 'no archive.today request');
    assert.match(statusText(page), /Removed The Herald's wall/);
    assert.ok(page.logs.some(l => l.includes('held back Piano\'s "payWall" event')));
  } finally {
    page.close();
  }
});

test("the Herald: the site's version lets the held events through; running the extension again undoes the cut", async () => {
  const url = 'https://www.smh.com.au/sport/cricket/x-20261114-p61e5d.html';
  const page = boot({ url, html: nineLivePageHtml({ cut: false, prompt: false, layout: 'wide' }) });
  const { doc, window } = page;
  try {
    const app = nineApp(window);
    app.piano('payWall');
    await waitFor(() => page.logs.some(l => l.includes('Removed The Herald')) || statusText(page));
    assert.equal((await page.toggle()).state, 'idle');
    assert.deepEqual(app.heard, ['payWall'], 'released');
    assert.equal(doc.querySelectorAll('.sc-c502 > p').length, 2, "the site's version: cut");
    assert.equal(doc.documentElement.hasAttribute('data-nytfix-held'), false);
    await page.toggle();
    assert.deepEqual(app.heard, ['payWall', 'NO_PAYWALL'], 'held again, and the cut undone');
    assert.equal(doc.querySelectorAll('.sc-c502 > p').length, 14);
    assert.equal(page.body(), null);
    assert.deepEqual(page.fetched, []);
  } finally {
    page.close();
  }
});

test('the Age: when the site redraws the article after the swap, the archived text goes back in', async () => {
  const url = 'https://www.theage.com.au/culture/books/x-20261114-p61bs1.html';
  const snapshot = mementoUrl(url, T[3], 'https://archive.ph');
  const page = boot({ url, html: nineLivePageHtml(), responses: { [timemapUrl(url)]: ok(timemapFor(url, [T[3]])), [snapshot]: ok(nineSnapshotHtml({ paragraphs: 12 })) } });
  const { doc } = page;
  try {
    await waitFor(page.body);
    // React redraws the body: a fresh copy of the site's own, the archived text gone.
    const old = doc.querySelector('.sc-c502');
    const fresh = old.cloneNode(true);
    fresh.querySelectorAll('.nytfix-body').forEach(n => n.remove());
    fresh.querySelectorAll('[data-nytfix-hidden]').forEach(n => n.removeAttribute('data-nytfix-hidden'));
    old.replaceWith(fresh);
    await waitFor(() => doc.querySelector('.sc-c502 .nytfix-body'), 3000);
    assert.ok([...doc.querySelectorAll('.sc-c502 > p')].every(p => p.hasAttribute('data-nytfix-hidden')));
    assert.ok(page.logs.some(l => l.includes('redrew the article')));
  } finally {
    page.close();
  }
});

// Batch 3, end to end on their real manifest entries

test('nationalpost: the trimmed body gets the archived article, without the video player or ad line', async () => {
  const url = 'https://nationalpost.com/news/defence/canada-military-exercises-arctic/';
  const snapshot = mementoUrl(url, T[3], 'https://archive.ph');
  const page = boot({ url, html: nationalpostLivePageHtml(), responses: { [timemapUrl(url)]: ok(timemapFor(url, [T[3]])), [snapshot]: ok(nationalpostSnapshotHtml({ paragraphs: 12 })) } });
  try {
    await waitFor(page.body);
    assert.deepEqual(page.fetched, [newestUrl(url)]);
    const body = page.body();
    assert.ok(body.closest('.article-content__content-group'), 'in the article body');
    assert.equal(body.querySelectorAll('p').length, 12);
    assert.equal(body.querySelector('p').className, 'wp-block-paragraph');
    assert.ok([...body.querySelectorAll('p')].every(p => /^NP (more )?paragraph/.test(p.textContent)));
    assert.ok(page.doc.querySelector('.pmd-paywall-trimmed-marker').hasAttribute('data-nytfix-hidden'));
  } finally {
    page.close();
  }
});

test("corriere: Piano's modal over the whole article comes off, with nothing fetched", async () => {
  const url = 'https://www.corriere.it/esteri/26_novembre_14/x-8e63fa3b-6c0d-49ae-827c-f09199dc9xlk.shtml';
  const page = boot({ url, html: corriereLivePageHtml({ pianoModal: true }) });
  try {
    await waitFor(() => /Removed Corriere's wall/.test(statusText(page) || ''));
    assert.deepEqual(page.fetched, []);
    assert.ok(page.doc.querySelector('.tp-modal').hasAttribute('data-nytfix-hidden'));
    assert.equal(page.body(), null);
    assert.equal(page.doc.querySelector('.modal-access').closest('[data-nytfix-hidden]'), null, 'the other-device notice is left alone');
  } finally {
    page.close();
  }
});

for (const lock of [false, true]) test(`spectator${lock ? ', scrolling locked' : ''}: the hidden paid part shows, Piano's slot and the fade go, with nothing fetched`, async () => {
  const url = 'https://spectator.com/article/will-nigel-farage-go-down-with-donald-trump/';
  const page = boot({ url, html: spectatorLivePageHtml({ paid: 'hidden', lock }) });
  const { doc } = page;
  try {
    await waitFor(() => /Removed The Spectator's wall/.test(statusText(page) || ''));
    assert.deepEqual(page.fetched, []);
    const paid = doc.querySelector('.paywalled-content');
    assert.equal(paid.getAttribute('data-nytfix-reveal'), 'display');
    assert.notEqual(page.window.getComputedStyle(paid).display, 'none');
    assert.ok(doc.querySelector('.reggradient').hasAttribute('data-nytfix-hidden'));
    assert.ok(doc.querySelector('.below-article-paywall').hasAttribute('data-nytfix-hidden'));
    assert.equal(page.window.getComputedStyle(doc.body).overflowY, 'visible');
  } finally {
    page.close();
  }
});

test("corriere's local editions: the wall's event is held back, so the whole article stays and nothing is fetched", async () => {
  const url = 'https://milano.corriere.it/notizie/cronaca/26_novembre_15/io-madre-di-3-figli-40e77b89-3f4d-4477-88d6-f80b085adxlk.shtml';
  const page = boot({ url, html: corriereLivePageHtml() });
  const { doc, window } = page;
  try {
    // Corriere's AbcTestPaywall: on the event, delete every block after the first.
    window.addEventListener('pno_abc_test:init', () => [...doc.querySelectorAll('#content-to-read > .content')].slice(1).forEach(b => b.remove()));
    // Piano decides; its inline wall goes in.
    doc.getElementById('content-to-read').insertAdjacentHTML('beforeend', '<div id="pno_wall_inline"><iframe></iframe></div>');
    window.dispatchEvent(new window.CustomEvent('pno_abc_test:init'));
    await waitFor(() => /Removed Corriere's wall/.test(statusText(page) || ''));
    assert.equal(doc.querySelectorAll('#content-to-read > .content').length, 6, 'nothing deleted');
    assert.ok(doc.getElementById('pno_wall_inline').hasAttribute('data-nytfix-hidden'));
    assert.deepEqual(page.fetched, []);
  } finally {
    page.close();
  }
});

test("corriere's homepage: the ad-blocker popup is held back, and if it shows anyway it's hidden and scrolling unlocked", async () => {
  const page = boot({ url: 'https://www.corriere.it/', html: corriereHomeHtml() });
  const { doc, window } = page;
  try {
    let loaded = false;
    doc.addEventListener('adblockActivated', () => { loaded = true; });
    doc.dispatchEvent(new window.Event('adblockActivated', { bubbles: true }));
    assert.equal(loaded, false, 'the popup never loads');
    // One already on the page (or drawn some other way): hidden by its wording.
    await waitFor(() => doc.querySelector('.rcs-anti-adblocker__box').hasAttribute('data-nytfix-notice'));
    assert.equal(window.getComputedStyle(doc.body).overflowY, 'visible');
    assert.equal(doc.documentElement.hasAttribute('data-nytfix-held'), false);
  } finally {
    page.close();
  }
});

test("spectator's magazine wall: the clip comes off and the fade and offer box go, with nothing fetched", async () => {
  const url = 'https://spectator.com/article/another-metoo-post-moral-panic-spectator-editorial/';
  const page = boot({ url, html: spectatorLivePageHtml({ clip: true }) });
  const { doc, window } = page;
  try {
    await waitFor(() => /Removed The Spectator's wall/.test(statusText(page) || ''));
    const entry = doc.querySelector('.entry-content');
    assert.equal(entry.getAttribute('data-nytfix-reveal'), '');
    assert.ok(doc.querySelector('.reggradient').hasAttribute('data-nytfix-hidden'));
    assert.ok(doc.querySelector('.below-article-paywall').hasAttribute('data-nytfix-hidden'));
    assert.deepEqual(page.fetched, []);
  } finally {
    page.close();
  }
});

test("corriere in a private window: the wall empties the page, the article goes back as it goes, and the wall comes off", async () => {
  const url = 'https://corrieredibologna.corriere.it/notizie/cronaca/26_novembre_15/concerto-088aeb76-5ca5-46b3-8a97-cd291c18cxlk.shtml';
  const page = boot({ url, html: corriereLivePageHtml() });
  const { doc } = page;
  try {
    await page.started(); // seconds before the wall, on the real site
    // Piano's private-browsing wall: its modal up, then the article removed in pieces.
    doc.body.insertAdjacentHTML('beforeend', '<div class="tp-modal wall-modal"><iframe></iframe></div><div class="tp-backdrop tp-active"></div>');
    doc.body.classList.add('tp-modal-open');
    doc.getElementById('content-to-read').remove();
    doc.querySelector('.aside-right').remove();
    doc.querySelector('section.body-article').remove();
    for (const el of doc.querySelectorAll('#l-header > div > .container, #l-main > .wrapper > .container, #l-footer > div > .container')) el.remove();
    await waitFor(() => /Removed Corriere's wall/.test(statusText(page) || ''));
    assert.equal(doc.querySelectorAll('#content-to-read > .content').length, 6, 'the whole article, back');
    assert.ok(doc.querySelector('main h1'));
    assert.ok(doc.querySelector('#l-header nav.menu__nav'), 'the menu');
    assert.ok(doc.querySelector('#l-header .logo'), 'the top bar');
    assert.ok(doc.querySelector('.aside-right'), 'the right-hand column');
    assert.ok(doc.querySelector('#l-footer .container p'), 'the footer');
    assert.ok(doc.querySelector('.tp-modal').hasAttribute('data-nytfix-hidden'));
    assert.ok(doc.querySelector('.tp-backdrop').hasAttribute('data-nytfix-hidden'));
    assert.deepEqual(page.fetched, [], 'nothing fetched');
    assert.equal(page.body(), null, 'nothing swapped in');
    assert.ok(page.logs.some(l => l.includes('removed the article from the page')));
  } finally {
    page.close();
  }
});

// Batch 4, end to end on their real manifest entries

test("reuters: the paywall modal comes off and scrolling unlocks, with nothing fetched", async () => {
  const url = 'https://www.reuters.com/world/us/battle-young-male-voters-2026-11-15/';
  const page = boot({ url, html: reutersLivePageHtml({ modal: true }) });
  const { doc, window } = page;
  try {
    await waitFor(() => /Removed Reuters's wall/.test(statusText(page) || ''));
    assert.equal(page.mark(), 'lifted', 'the toolbar icon is marked');
    window.dispatchEvent(new window.PageTransitionEvent('pagehide', { persisted: true }));
    await waitFor(() => page.mark() === null);
    window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: true }));
    await waitFor(() => page.mark() === 'lifted'); // back from the back/forward cache
    assert.ok(doc.querySelector('[data-testid="Modal"]').hasAttribute('data-nytfix-hidden'));
    // The modal locks both (seen live).
    assert.equal(window.getComputedStyle(doc.documentElement).overflowY, 'visible');
    assert.equal(window.getComputedStyle(doc.body).overflowY, 'visible');
    assert.deepEqual(page.fetched, []);
  } finally {
    page.close();
  }
});

test("reuters: the wall's crop comes off too (the layout capped at 150vh, the footer hidden)", async () => {
  const url = 'https://www.reuters.com/world/us/battle-young-male-voters-2026-11-15/';
  const page = boot({ url, html: reutersLivePageHtml({ modal: true, restricted: true }) });
  const { doc, window } = page;
  const css = doc.createElement('style'); // the extension's stylesheet, which uncrops revealed elements
  css.textContent = fs.readFileSync(path.join(EXT, 'content.css'), 'utf8');
  doc.head.append(css);
  try {
    await waitFor(() => /Removed Reuters's wall/.test(statusText(page) || ''));
    for (const testid of ['RegularArticleLayout', 'MainContent']) {
      const style = window.getComputedStyle(doc.querySelector(`[data-testid="${testid}"]`));
      assert.equal(style.maxHeight, 'none', testid);
      assert.equal(style.overflow, 'visible', testid);
    }
    assert.equal(window.getComputedStyle(doc.querySelector('[data-testid="MainContent"]')).display, 'grid', 'its own layout kept');
    assert.notEqual(window.getComputedStyle(doc.querySelector('[class*="footer-container"]')).display, 'none', 'the footer is back');
    assert.deepEqual(page.fetched, []);
  } finally {
    page.close();
  }
});

test("reuters: the crop alone is the wall (the modal gone, as on the user's saved page)", async () => {
  const url = 'https://www.reuters.com/world/us/battle-young-male-voters-2026-11-15/';
  const page = boot({ url, html: reutersLivePageHtml({ restricted: true }) });
  const { doc, window } = page;
  const css = doc.createElement('style'); // the extension's stylesheet, which uncrops revealed elements
  css.textContent = fs.readFileSync(path.join(EXT, 'content.css'), 'utf8');
  doc.head.append(css);
  try {
    await waitFor(() => /Removed Reuters's wall/.test(statusText(page) || ''));
    assert.equal(window.getComputedStyle(doc.querySelector('[data-testid="MainContent"]')).maxHeight, 'none');
    assert.deepEqual(page.fetched, []);
  } finally {
    page.close();
  }
});

test("lalibre: the hidden rest shows, and stays when Piano's offer wipes it, with nothing fetched", async () => {
  const url = 'https://www.lalibre.be/economie/entreprises-startup/2026/11/14/meta-NZWTWPRU3JHINEJZR6Y4RT4E6I/';
  const page = boot({ url, html: lalibreLivePageHtml() });
  const { doc, window } = page;
  // The extension's stylesheet, which uncollapses revealed text.
  const css = doc.createElement('style');
  css.textContent = fs.readFileSync(path.join(EXT, 'content.css'), 'utf8');
  doc.head.append(css);
  // Drawn: La Libre collapses the hidden rest (height 0, opacity 0) rather than display: none.
  const drawn = el => { const st = window.getComputedStyle(el); return st.display !== 'none' && st.opacity !== '0' && st.height !== '0px'; };
  try {
    await waitFor(() => /Removed La Libre's wall/.test(statusText(page) || ''));
    assert.ok(drawn(doc.getElementById('story-content-MEMBER')), 'shown');
    // Seconds later, Piano fills its slot with an offer.
    lalibrePianoOffer(doc);
    await waitFor(() => doc.getElementById('story-content-MEMBER'));
    const rest = doc.getElementById('story-content-MEMBER');
    assert.equal(rest.querySelectorAll('p').length, 8, 'the whole rest, back');
    assert.ok(drawn(rest));
    await waitFor(() => doc.querySelector('.tp-container-inner').hasAttribute('data-nytfix-hidden'));
    assert.deepEqual(page.fetched, []);
    assert.ok(page.logs.some(l => l.includes('removed the article from the page')));
  } finally {
    page.close();
  }
});

test('lalibre: free articles are left alone', async () => {
  const page = boot({ url: 'https://www.lalibre.be/international/2026/11/14/x-QDUJHHIQ7VARHLM7HELDDEM7UU/', html: lalibreLivePageHtml({ type: 'FREE' }) });
  try {
    await sleep(300);
    assert.equal(page.doc.documentElement.classList.contains('nytfix-active'), false);
    assert.deepEqual(page.fetched, []);
    assert.deepEqual(page.marks, [], 'no wall, no mark (nothing sent at all)');
  } finally {
    page.close();
  }
});

test("dailymail: a Mail+ article shows whole, laid out as the site does it, the Mail+ box hidden and nothing fetched; undo puts the wall back", async () => {
  const url = 'https://www.dailymail.com/health/article-16292777/banish-midlife-wrinkles-red-light-expert-guide-led-mask.html';
  const page = boot({ url, html: dailymailLivePageHtml() });
  const { doc, window } = page;
  const css = doc.createElement('style'); // the extension's stylesheet, which uncaps revealed elements
  css.textContent = fs.readFileSync(path.join(EXT, 'content.css'), 'utf8');
  doc.head.append(css);
  const shown = el => window.getComputedStyle(el).display !== 'none';
  try {
    await waitFor(() => /Removed the Daily Mail's wall/.test(statusText(page) || ''));
    assert.ok(doc.body.classList.contains('is-paywall-processed'), "the class the site's rules wait for");
    const ps = [...doc.querySelectorAll('[itemprop="articleBody"] p')];
    assert.ok(ps.length > 10 && ps.every(shown), 'every paragraph shows');
    assert.equal(window.getComputedStyle(doc.getElementById('third-link')).display, 'inline', 'links inside paragraphs stay inline');
    assert.equal(window.getComputedStyle(doc.querySelector('[itemprop="articleBody"]')).maxHeight, 'none', 'the 20px cap is off');
    assert.equal(shown(doc.querySelector('.related-replace-paywall')), false, 'the Mail+ box is hidden');
    assert.deepEqual(page.fetched, []);
    assert.equal(page.mark(), 'lifted');
    await page.toggle(); // undo
    assert.equal(doc.body.classList.contains('is-paywall-processed'), false);
    assert.equal(shown(ps[5]), false, "the site's wall is back");
    assert.equal(page.mark(), null);
  } finally {
    page.close();
  }
});

test("dailymail: Zephr's inline Mail+ banner after the text, and the fade over its last lines, are hidden too", async () => {
  const url = 'https://www.dailymail.com/debate/article-16287795/BRYONY-GORDON-brave-women.html';
  const page = boot({ url, html: dailymailLivePageHtml({ inline: true }) });
  const { doc, window } = page;
  const css = doc.createElement('style');
  css.textContent = fs.readFileSync(path.join(EXT, 'content.css'), 'utf8');
  doc.head.append(css);
  try {
    await waitFor(() => /Removed the Daily Mail's wall/.test(statusText(page) || ''));
    const body = doc.querySelector('[itemprop="articleBody"]');
    assert.equal(window.getComputedStyle(body.nextElementSibling).display, 'none', 'the banner, fade and all');
    assert.equal(window.getComputedStyle(body).maxHeight, 'none');
    assert.ok([...body.querySelectorAll('p')].every(p => window.getComputedStyle(p).display !== 'none'));
  } finally {
    page.close();
  }
});

test('dailymail: free articles are left alone', async () => {
  const page = boot({ url: 'https://www.dailymail.co.uk/news/article-16242235/x.html', html: dailymailLivePageHtml({ plus: false }) });
  try {
    await sleep(300);
    assert.equal(page.doc.body.classList.contains('is-paywall-processed'), false);
    assert.deepEqual(page.fetched, []);
    assert.deepEqual(page.marks, []);
  } finally {
    page.close();
  }
});

test("usatoday: Admiral's ad-blocker popup is hidden and scrolling unlocks; the free story itself is left alone", async () => {
  const url = 'https://www.usatoday.com/story/news/politics/elections/2026/11/15/demomatic-women-veterans-congress/92676928007/';
  const page = boot({ url, html: usatodayLivePageHtml() });
  const { doc, window } = page;
  try {
    await waitFor(() => doc.querySelector('.fEy1Z2XT').hasAttribute('data-nytfix-notice'));
    assert.equal(window.getComputedStyle(doc.querySelector('.fEy1Z2XT')).display, 'none');
    assert.equal(window.getComputedStyle(doc.documentElement).overflowY, 'visible');
    assert.equal(doc.documentElement.classList.contains('nytfix-active'), false, 'no wall');
    assert.deepEqual(page.fetched, []);
    assert.deepEqual(page.marks, [], 'no wall, no mark');
  } finally {
    page.close();
  }
});

// Off on a site, or everywhere (settings.js), and the toolbar menu's questions

test('off on this site: the page is left as the site sends it, wall and all, and the icon goes grey', async () => {
  const page = boot({ sync: memoryArea({ settings: { disabledSites: ['nyt'] } }) });
  const { doc } = page;
  try {
    await waitFor(() => page.mark() === 'off');
    await sleep(50);
    assert.ok(doc.documentElement.classList.contains('nytfix-off'), "the site's CSS shows its wall again");
    assert.equal(doc.getElementById('site-content').hasAttribute('inert'), true, 'the wall is still up');
    assert.equal(doc.querySelector('[data-nytfix-hidden]'), null, 'nothing hidden');
    assert.deepEqual(page.fetched, [], 'nothing fetched');
    assert.equal(doc.getElementById('nytfix-status'), null, 'no status bar');
    assert.deepEqual(await page.state(), { site: 'nyt', state: 'off', mark: 'off', restored: false });
    assert.equal((await page.toggle()).state, 'off', 'the menu offers no button, but a stray toggle does nothing');
    assert.equal(doc.querySelector('[data-nytfix-hidden]'), null);
  } finally {
    page.close();
  }
});

test('off everywhere: the same on every site; another site turned off leaves this one on', async () => {
  const off = boot({ sync: memoryArea({ settings: { enabled: false } }) });
  try {
    await waitFor(() => off.mark() === 'off');
    assert.equal((await off.state()).state, 'off');
    assert.deepEqual(off.fetched, []);
  } finally {
    off.close();
  }
  const on = boot({
    sync: memoryArea({ settings: { disabledSites: ['ft', 'smh'] } }),
    responses: { [timemapUrl(ARTICLE)]: ok(timemapFor(ARTICLE, [T[3]])), [snapshotUrl(T[3])]: ok(COMPLETE) },
  });
  try {
    await waitFor(on.body);
    assert.equal(on.mark(), 'swapped');
  } finally {
    on.close();
  }
});

test("the menu asks what's going on: the site, what was done, and whether the reader undid it", async () => {
  const page = boot({ responses: { [timemapUrl(ARTICLE)]: ok(timemapFor(ARTICLE, [T[3]])), [snapshotUrl(T[3])]: ok(COMPLETE) } });
  try {
    await waitFor(page.body);
    assert.deepEqual(await page.state(), { site: 'nyt', state: 'applied', mark: 'swapped', restored: false });
    await page.toggle(); // "Show the site's version"
    assert.deepEqual(await page.state(), { site: 'nyt', state: 'idle', mark: null, restored: true });
  } finally {
    page.close();
  }
  const section = boot({ url: 'https://www.nytimes.com/section/world' });
  try {
    await section.started();
    assert.equal((await section.state()).state, 'not-article');
  } finally {
    section.close();
  }
});


// The notification once the wall is off (notify.js): the reason the first time, then quiet

test("reuters: the first wall off says why Reuters is boycotted, with its source; a regular reader's next one says nothing", async () => {
  const url = 'https://www.reuters.com/world/us/battle-young-male-voters-2026-11-15/';
  const storage = memoryArea();
  const first = boot({ url, html: reutersLivePageHtml({ modal: true }), storage });
  try {
    await waitFor(() => /Removed Reuters's wall\.$/.test(statusText(first) || ''));
    const shadow = first.doc.getElementById('nytfix-status').shadowRoot;
    assert.equal(shadow.querySelector('.why').hidden, false);
    assert.match(shadow.querySelector('.why-head').textContent, /Why we don't pay Reuters/);
    assert.match(shadow.querySelector('.source').href, /^https:\/\/fair\.org\//);
    assert.equal(shadow.querySelector('.ask'), null, 'no donation link with a reason (and none set)');
    await waitFor(() => storage.data.notify?.fixed === 1);
    assert.ok(storage.data.notify.sites.reuters);
  } finally {
    first.close();
  }
  // A regular reader: past the first articles, Reuters explained last week.
  const regular = memoryArea({ notify: { v: 1, fixed: 40, articles: [], days: [], sites: { reuters: Date.now() - 7 * 864e5 }, donate: {} } });
  const later = boot({ url: 'https://www.reuters.com/world/another-story-2026-11-16/', html: reutersLivePageHtml({ modal: true }), storage: regular });
  try {
    await waitFor(() => later.mark() === 'lifted');
    await sleep(50);
    assert.equal(later.doc.getElementById('nytfix-status'), null, 'no notification: the toolbar ✓ marks it');
    assert.equal(regular.data.notify.fixed, 41);
  } finally {
    later.close();
  }
});

// The reader's tally (notify.js counts, tally.js words it), and the donation link with it.
const notifyLib = require('../extension/src/notify.js');

test("the reader's tally: NYT's login wall counts the article as read, not paid; Reuters's wall as both", async () => {
  const month = notifyLib.monthOf(Date.now());
  const storage = memoryArea();
  const login = boot({ html: livePageHtml({ wall: 'login' }), storage });
  try {
    await waitFor(() => storage.data.notify?.months?.[month]?.nyt);
    assert.deepEqual(storage.data.notify.months[month].nyt, { read: 1, paid: 0 }, 'a free account would have done');
  } finally {
    login.close();
  }
  const reuters = boot({ url: 'https://www.reuters.com/world/us/battle-young-male-voters-2026-11-15/', html: reutersLivePageHtml({ modal: true }), storage });
  try {
    await waitFor(() => storage.data.notify?.months?.[month]?.reuters);
    assert.deepEqual(storage.data.notify.months[month], { nyt: { read: 1, paid: 0 }, reuters: { read: 1, paid: 1 } });
  } finally {
    reuters.close();
  }
});

test('the donation link says what the reader read this month and roughly what it would have cost; after "I\'ve donated", never', async () => {
  const url = 'https://www.reuters.com/world/another-story-2026-11-16/';
  const month = notifyLib.monthOf(Date.now());
  // A donation link set, and a regular reader: Reuters explained last week, never asked to donate.
  const scripts = scriptsFor(url);
  scripts.splice(scripts.length - 1, 0, "NYTFix.settings.tipLink = () => ({ text: 'Support the project', short: 'Donate', href: 'https://example.com/tip' });");
  const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const record = () => memoryArea({ notify: { v: 1, fixed: 40, articles: [], days: [daysAgo(3), daysAgo(2)], sites: { reuters: Date.now() - 7 * 864e5 }, donate: {},
    months: { [month]: { nyt: { read: 9, paid: 9 }, ft: { read: 2, paid: 2 } } } } });
  const asked = boot({ url, html: reutersLivePageHtml({ modal: true }), storage: record(), scripts });
  try {
    await waitFor(() => asked.doc.getElementById('nytfix-status')?.shadowRoot.querySelector('.ask'));
    const words = asked.doc.getElementById('nytfix-status').shadowRoot.querySelector('.ask-text').textContent;
    assert.match(words, /^This month: 12 articles from 3 outlets, about \$\d+ in subscriptions you didn't pay them\. .*chip in/);
  } finally {
    asked.close();
  }
  const donated = boot({ url, html: reutersLivePageHtml({ modal: true }), storage: record(), sync: memoryArea({ settings: { donated: true } }), scripts });
  try {
    await waitFor(() => donated.mark() === 'lifted');
    await sleep(50);
    assert.equal(donated.doc.getElementById('nytfix-status')?.shadowRoot.querySelector('.ask') ?? null, null, 'never asked again');
  } finally {
    donated.close();
  }
});

// Batch 6 (docs/outlet-coverage.md). ABC sends the paid part hidden, and its own inline script
// deletes it once Evolok refuses access (or shows it, when the reader may read).
const { abcLivePageHtml, abcDeny } = require('./fixtures-batch6.js');
const ABC_URL = 'https://www.abc.es/espana/moncloa-guarda-grabacion-abogado-pp-reventar-campana-20261113010127-nt.html';

// The content-script's sources for ABC, with Evolok's deadline shortened for the test.
const abcScripts = waitMs => {
  const scripts = scriptsFor(ABC_URL);
  scripts.splice(scripts.length - 1, 0, `NYTFix.sites.abces.live.wall.decision.waitMs = ${waitMs};`);
  return scripts;
};
const paidShown = page => {
  const paid = page.doc.querySelector('.v-d--1 div.paywall');
  return Boolean(paid) && paid.querySelectorAll('p').length === 11 && page.window.getComputedStyle(paid).display !== 'none';
};

test("abc, access refused: the paid part is shown at once; the site deletes it, it's put back, and only then is the wall reported", async () => {
  const page = boot({ url: ABC_URL, html: abcLivePageHtml() });
  const { doc } = page;
  try {
    await waitFor(() => doc.querySelector('.c-text')?.hasAttribute('data-nytfix-hidden'));
    assert.ok(paidShown(page), 'shown before Evolok answers');
    await sleep(50);
    assert.doesNotMatch(statusText(page) || '', /wall/, 'nothing said while Evolok decides');
    assert.equal(page.mark(), null);
    abcDeny(doc); // Evolok's answer arrives after the content script started
    await waitFor(() => /Removed ABC's wall/.test(statusText(page) || ''));
    assert.deepEqual(page.fetched, []);
    assert.ok(paidShown(page), 'div.paywall is back, and shown');
    assert.ok(doc.querySelector('.v-d--1 > p > span.paywall'), 'and the rest of the first paragraph');
    assert.ok(doc.querySelector('ev-engagement').hasAttribute('data-nytfix-hidden'));
    assert.equal(page.mark(), 'lifted');
  } finally {
    page.close();
  }
});

test('abc, access allowed: the paid part was hidden only until Evolok answered, so nothing is said and the lift is taken back', async () => {
  const page = boot({ url: ABC_URL, html: abcLivePageHtml() });
  const { doc } = page;
  try {
    await waitFor(() => doc.querySelector('.c-text')?.hasAttribute('data-nytfix-hidden'));
    // The page's script, for a reader who may read: show the paid part, drop the placeholders.
    for (const el of doc.querySelectorAll('[data-0f4d396afa946b14d21]')) { el.removeAttribute('hidden'); el.removeAttribute('data-0f4d396afa946b14d21'); }
    for (const el of doc.querySelectorAll('[data-ffdb2e6afa946b14d2f]')) el.remove();
    await sleep(50);
    assert.equal((await page.state()).state, 'idle');
    assert.deepEqual(page.fetched, []);
    assert.ok(paidShown(page), 'the site shows it now');
    assert.equal(doc.querySelector('[data-nytfix-reveal], [data-nytfix-hidden]'), null, 'none of the lift left behind');
    assert.doesNotMatch(statusText(page) || '', /wall/);
    assert.equal(page.mark(), null, 'no ✓ on the toolbar icon');
  } finally {
    page.close();
  }
});

test("abc, Evolok never answers: the text would have stayed hidden, so after the wait it's reported", async () => {
  const page = boot({ url: ABC_URL, html: abcLivePageHtml(), scripts: abcScripts(300) });
  try {
    await waitFor(() => page.doc.querySelector('.c-text')?.hasAttribute('data-nytfix-hidden'));
    assert.doesNotMatch(statusText(page) || '', /wall/);
    await waitFor(() => /Removed ABC's wall/.test(statusText(page) || ''));
    assert.ok(paidShown(page));
    assert.equal(page.mark(), 'lifted');
    assert.deepEqual(page.fetched, []);
  } finally {
    page.close();
  }
});

test('abc, already allowed when the extension starts: no wall, nothing said, nothing fetched', async () => {
  const page = boot({ url: ABC_URL, html: abcLivePageHtml({ state: 'allowed', consent: true }) });
  try {
    await sleep(150);
    assert.deepEqual(page.fetched, []);
    assert.doesNotMatch(statusText(page) || '', /wall/);
  } finally {
    page.close();
  }
});

// NRC cuts its own article, seconds after the page loads, once Zephr and Sophi have decided.
const { nrcLivePageHtml, nrcShowWall } = require('./fixtures-batch6.js');
const NRC_URL = 'https://www.nrc.nl/nieuws/2026/11/15/de-warme-band-tussen-de-vs-en-israel-staat-zwaar-onder-druk-a4941362';

for (const [label, paragraphs] of [['a long article', 12], ['a short one (3 paragraphs, under 150 words)', 3]]) {
  test(`nrc, ${label}: its script cuts it after the extension started; every paragraph goes straight back, in order, and the wall comes off`, async () => {
    const page = boot({ url: NRC_URL, html: nrcLivePageHtml({ paragraphs }) });
    const { doc } = page;
    try {
      await page.started();
      await sleep(30);
      assert.doesNotMatch(statusText(page) || '', /wall/, 'no wall yet');
      assert.deepEqual(page.fetched, [], 'nothing fetched before the wall, short or not');
      const before = doc.querySelector('.vorm__article-content').innerHTML;
      nrcShowWall(doc);
      await waitFor(() => /Removed NRC's wall/.test(statusText(page) || ''));
      assert.equal(doc.querySelector('.vorm__article-content').innerHTML, before, 'the article as sent');
      assert.ok(doc.querySelector('body > .paywall--hard').hasAttribute('data-nytfix-hidden'), 'the hard wall hidden');
      const html = page.window.getComputedStyle(doc.documentElement);
      assert.deepEqual([html.position, html.overflowY], ['static', 'visible'], 'scrolling unlocked: <html> unpinned, not just overflow');
      await sleep(30);
      assert.deepEqual(page.fetched, []);
      assert.equal(page.mark(), 'lifted');
    } finally {
      page.close();
    }
  });
}

test('nrc: a short article with no wall is left alone', async () => {
  const page = boot({ url: NRC_URL, html: nrcLivePageHtml({ paragraphs: 3 }) });
  try {
    await page.started();
    await sleep(150);
    assert.deepEqual(page.fetched, []);
    assert.doesNotMatch(statusText(page) || '', /wall/);
    assert.equal(page.mark(), null);
  } finally {
    page.close();
  }
});

test('nrc: cut before the extension started, it goes to archive.today', async () => {
  const page = boot({ url: NRC_URL, html: nrcLivePageHtml({ paragraphs: 1, hard: true }) });
  try {
    await waitFor(() => page.fetched.length > 0);
    assert.match(page.fetched[0], /archive\.(ph|today|is)/);
  } finally {
    page.close();
  }
});
