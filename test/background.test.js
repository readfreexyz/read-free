// The service worker (extension/background.js): the toolbar icon and its mark.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { memoryArea } = require('./fixtures.js');
const { importedScripts } = require('../extension/src/update.js');

const EXT = path.join(__dirname, '../extension');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

// local: chrome.storage.local (the release record, src/release.js). version: the running one.
// fetch: answers for Read Free's site (latest.txt). firefox: run as Firefox does, a background
// page with no importScripts, given the same files first (tools/firefox.mjs), and a manifest with
// Mozilla's settings. permissions: chrome.permissions, for Firefox (src/access.js). speed: its
// timers run this much faster.
function worker({ sync = memoryArea(), local = memoryArea(), version = '0.21.0', fetch = async () => { throw new Error('offline'); }, speed = 1, session = null, windows = false, firefox = false, permissions = null } = {}) {
  const calls = [];
  const listeners = { message: [], changed: [], alarm: [], installed: [], removed: [], updated: [], windowGone: [] };
  const alarms = {};
  const record = name => async details => { calls.push([name, details]); };
  const chrome = {
    runtime: { id: 'nytfix', onMessage: { addListener: fn => listeners.message.push(fn) }, onStartup: { addListener: () => {} }, getPlatformInfo: async () => ({}), getURL: p => `chrome-extension://nytfix/${p}`, getManifest: () => ({ version, host_permissions: ['https://archive.ph/*'], content_scripts: [{ matches: ['https://www.nytimes.com/*', 'https://cooking.nytimes.com/*'] }], ...(firefox ? { browser_specific_settings: { gecko: { id: 'read-free@readfree.xyz' } } } : {}) }), onInstalled: { addListener: fn => listeners.installed.push(fn) } },
    storage: { sync, local, ...(session ? { session } : {}), onChanged: { addListener: fn => listeners.changed.push(fn) } },
    alarms: {
      get: async name => alarms[name],
      create: async (name, info) => { alarms[name] = { name, ...info }; },
      onAlarm: { addListener: fn => listeners.alarm.push(fn) },
    },
    action: {
      setBadgeText: record('text'),
      setBadgeBackgroundColor: record('color'),
      setBadgeTextColor: record('textColor'),
      setTitle: record('title'),
      setIcon: record('icon'),
    },
    tabs: { sendMessage: async (id, msg) => { calls.push(['message', { id, ...msg }]); return {}; }, create: record('tab'), onRemoved: { addListener: fn => listeners.removed.push(fn) }, onUpdated: { addListener: fn => listeners.updated.push(fn) } },
    ...(windows ? { windows: { get: async () => ({ left: 100, top: 50, width: 1400, height: 900 }), create: async details => { calls.push(['window', details]); return { id: 70, tabs: [{ id: 700 }] }; }, remove: async id => { calls.push(['closed', id]); for (const fn of listeners.windowGone) fn(id); }, onRemoved: { addListener: fn => listeners.windowGone.push(fn) } } } : {}),
    ...(permissions ? { permissions } : {}),
  };
  const context = vm.createContext({ chrome, console, setTimeout: (fn, ms) => setTimeout(fn, ms / speed), clearTimeout, setInterval, clearInterval, URL, AbortController, fetch });
  context.self = context;
  const run = f => vm.runInContext(fs.readFileSync(path.join(EXT, f), 'utf8'), context);
  const source = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');
  if (firefox) {
    for (const f of [...importedScripts(source), 'background.js']) run(f);
  } else {
    context.importScripts = (...files) => files.forEach(run);
    run('background.js');
  }
  const send = (msg, sender, respond = () => {}) => listeners.message[0](msg, sender, respond);
  const changeSettings = value => { for (const fn of listeners.changed) fn({ settings: { newValue: value } }, 'sync'); };
  const changeLocal = (key, value) => { for (const fn of listeners.changed) fn({ [key]: { newValue: value } }, 'local'); };
  const fireAlarm = name => { for (const fn of listeners.alarm) fn({ name }); };
  const closeTab = tabId => { for (const fn of listeners.removed) fn(tabId); };
  const installed = reason => { for (const fn of listeners.installed) fn({ reason }); };
  // Plain copies: objects made inside the vm context have their own prototypes.
  const last = name => { const found = calls.filter(([n]) => n === name).pop()?.[1]; return found && JSON.parse(JSON.stringify(found)); };
  return { calls, send, last, changeSettings, changeLocal, fireAlarm, installed, closeTab, alarms, context, updated: (tabId, info) => { for (const fn of listeners.updated) fn(tabId, info); }, windowGone: id => { for (const fn of listeners.windowGone) fn(id); } };
}

test("toolbar mark: a green check on the tab's icon while the wall is off, cleared on request", async () => {
  const w = worker();
  await tick();
  w.send({ type: 'nytfix:mark', state: 'lifted', title: "Removed Reuters's wall." }, { id: 'nytfix', tab: { id: 7 } });
  await tick();
  assert.deepEqual(w.last('text'), { tabId: 7, text: '✓' });
  assert.equal(w.last('color').tabId, 7);
  assert.equal(w.last('title').title, "Read Free: Removed Reuters's wall.");
  w.send({ type: 'nytfix:mark', state: null }, { id: 'nytfix', tab: { id: 7 } });
  await tick();
  assert.deepEqual(w.last('text'), { tabId: 7, text: '' });
  assert.deepEqual(w.last('title'), { tabId: 7, title: 'Read Free' });
});

test("the status bar's donation link opens the extension's own donation page, next to the reader's tab", async () => {
  const w = worker();
  await tick();
  w.send({ type: 'nytfix:give' }, { id: 'nytfix', tab: { id: 7, index: 2 } });
  assert.deepEqual(w.last('tab'), { url: 'chrome-extension://nytfix/give/give.html', index: 3, openerTabId: 7 });
  const before = w.calls.length;
  w.send({ type: 'nytfix:give' }, { id: 'someone-else', tab: { id: 7, index: 2 } });
  assert.equal(w.calls.length, before, 'only its own content scripts');
});

test("toolbar mark: only the extension's own content scripts can set it", async () => {
  const w = worker();
  await tick();
  const before = w.calls.length;
  w.send({ type: 'nytfix:mark', state: 'lifted', title: 'x' }, { id: 'someone-else', tab: { id: 7 } });
  w.send({ type: 'nytfix:mark', state: 'lifted', title: 'x' }, { id: 'nytfix' }); // no tab
  await tick();
  assert.equal(w.calls.length, before);
});

test('toolbar icon: grey while off everywhere, and on a tab whose site is off', async () => {
  const w = worker({ sync: memoryArea({ settings: { enabled: false } }) });
  await tick();
  assert.deepEqual(w.last('icon'), { path: { 16: 'icons/off-16.png', 32: 'icons/off-32.png' } });
  assert.deepEqual(w.last('title'), { title: 'Read Free: off on all sites' });
  w.changeSettings({ enabled: true });
  assert.deepEqual(w.last('icon'), { path: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' } });
  assert.deepEqual(w.last('title'), { title: 'Read Free' });

  w.send({ type: 'nytfix:mark', state: 'off', title: 'Off on The New York Times.' }, { id: 'nytfix', tab: { id: 3 } });
  await tick();
  assert.deepEqual(w.last('icon'), { tabId: 3, path: { 16: 'icons/off-16.png', 32: 'icons/off-32.png' } });
  assert.deepEqual(w.last('title'), { tabId: 3, title: 'Read Free: Off on The New York Times.' });
});

// A newer version (src/release.js): the arrow on the toolbar icon, the daily check, and the
// content script's question
const DAY = 24 * 60 * 60 * 1000;
const releaseRecord = (version, ageMs = 2 * DAY) => ({ version, date: Date.now() - ageMs, checkedAt: Date.now(), retryAt: 0, seenAt: Date.now() - ageMs });
const latestTxt = (version, date) => `read-free-release 1\nversion=${version}\nzip=read-free-${version}.zip\nsha256=${'a'.repeat(64)}\nsize=1\ndate=${date}\n`;
const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };

test('a newer version: an arrow on the toolbar icon and a tooltip saying so, once it is a day old', async () => {
  const w = worker({ local: memoryArea({ release: releaseRecord('0.22.0') }), version: '0.21.0' });
  await settle();
  assert.deepEqual(w.last('text'), { text: '↑' });
  assert.deepEqual(w.last('title'), { title: 'Read Free: version 0.22.0 is out' });
  assert.equal(w.last('color').color, '#c2415b');

  const current = worker({ local: memoryArea({ release: releaseRecord('0.22.0') }), version: '0.22.0' });
  await settle();
  assert.deepEqual(current.last('text'), { text: '' }, 'running it: no arrow');
  assert.deepEqual(current.last('title'), { title: 'Read Free' });

  const fresh = worker({ local: memoryArea({ release: releaseRecord('0.22.0', DAY / 2) }), version: '0.21.0' });
  await settle();
  assert.deepEqual(fresh.last('text'), { text: '' }, 'not a day old: those with the install script have it by then');
});

test('the daily check: an hourly alarm made once, asking the site at most daily; never at start', async () => {
  const asked = [];
  const fetch = async url => { asked.push(url); return { ok: true, text: async () => latestTxt('0.22.0', new Date(Date.now() - 2 * DAY).toISOString().slice(0, 19) + 'Z') }; };
  const local = memoryArea();
  const w = worker({ local, fetch });
  await settle();
  assert.deepEqual(asked, [], 'nothing fetched when the service worker starts');
  assert.deepEqual(JSON.parse(JSON.stringify(w.alarms['nytfix:release'])), { name: 'nytfix:release', delayInMinutes: 1, periodInMinutes: 60 });
  w.fireAlarm('nytfix:update'); // the reload check's alarm: not this one
  await settle();
  assert.deepEqual(asked, []);
  w.fireAlarm('nytfix:release');
  await settle();
  assert.deepEqual(asked, ['https://readfree.xyz/latest.txt']);
  assert.equal(local.data.release.version, '0.22.0');
  assert.deepEqual(w.last('text'), { text: '' }, 'just learned of it: held for two hours (release.HOLD)');
  w.fireAlarm('nytfix:release');
  await settle();
  assert.equal(asked.length, 1, 'at most once a day');
});

test("the content script's question: what's known, from the saved record, nothing fetched; only its own", async () => {
  const fetch = async () => assert.fail('fetched');
  const w = worker({ local: memoryArea({ release: releaseRecord('0.22.0') }), fetch });
  await settle();
  const answers = [];
  assert.equal(w.send({ type: 'nytfix:newer' }, { id: 'nytfix', tab: { id: 4 } }, a => answers.push(a)), true, 'answers later');
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(answers)), [{ version: '0.22.0', href: 'https://readfree.xyz/#update', text: 'Read Free 0.22.0 is out' }]);
  const none = worker({ local: memoryArea(), fetch });
  await settle();
  const nothing = [];
  none.send({ type: 'nytfix:newer' }, { id: 'nytfix', tab: { id: 4 } }, a => nothing.push(a));
  await settle();
  assert.deepEqual(nothing, [null]);
  const other = [];
  assert.equal(w.send({ type: 'nytfix:newer' }, { id: 'someone-else', tab: { id: 4 } }, a => other.push(a)), false);
  await settle();
  assert.deepEqual(other, []);
});

test('in Firefox: a background page given the same files; Firefox does the updating, so no check and no arrow', async () => {
  const fetch = async () => assert.fail('fetched');
  const local = memoryArea({ release: releaseRecord('0.22.0') });
  const w = worker({ firefox: true, local, version: '0.21.0', fetch });
  await settle();
  assert.deepEqual(w.alarms, {}, 'no daily check');
  assert.ok(!w.calls.some(([name, details]) => name === 'text' && details.text === '↑'), 'no arrow');
  assert.equal(w.last('title').title, 'Read Free');
  const answers = [];
  w.send({ type: 'nytfix:newer' }, { id: 'nytfix', tab: { id: 4 } }, a => answers.push(a));
  await settle();
  assert.deepEqual(answers, [null], 'nothing for the status bar either');
  w.changeLocal('release', releaseRecord('0.23.0'));
  assert.ok(!w.calls.some(([name, details]) => name === 'text' && details.text === '↑'));
  // The rest works as in Chrome
  w.send({ type: 'nytfix:mark', state: 'lifted', title: "Removed Reuters's wall." }, { id: 'nytfix', tab: { id: 7 } });
  await settle();
  assert.deepEqual(w.last('text'), { tabId: 7, text: '✓' });
});

// chrome.permissions with these addresses off; allow() grants them all.
function firefoxPermissions(off) {
  const listeners = [];
  return {
    off: new Set(off),
    contains: async function ({ origins }) { return origins.every(o => !this.off.has(o)); },
    onAdded: { addListener: fn => listeners.push(fn) },
    onRemoved: { addListener: fn => listeners.push(fn) },
    allow() { this.off.clear(); listeners.forEach(fn => fn()); },
  };
}

test('in Firefox: a ! while an address an update added is off, until the reader has seen it or allowed it', async () => {
  const cooking = 'https://cooking.nytimes.com/*';
  const permissions = firefoxPermissions([cooking]);
  const w = worker({ firefox: true, permissions });
  await settle();
  assert.deepEqual(w.last('text'), { text: '!' });
  assert.equal(w.last('title').title, 'Read Free: new sites need your OK');
  // A tab's ✓ wins, and the ! comes back after it
  w.send({ type: 'nytfix:mark', state: 'lifted', title: 'x' }, { id: 'nytfix', tab: { id: 7 } });
  await settle();
  assert.deepEqual(w.last('text'), { tabId: 7, text: '✓' });
  w.send({ type: 'nytfix:mark', state: null }, { id: 'nytfix', tab: { id: 7 } });
  await settle();
  assert.deepEqual(w.last('text'), { tabId: 7, text: '!' });
  permissions.allow();
  await settle();
  assert.deepEqual(w.last('text'), { text: '' });

  const local = memoryArea();
  const seen = worker({ firefox: true, permissions: firefoxPermissions([cooking]), local });
  await settle();
  assert.deepEqual(seen.last('text'), { text: '!' });
  await local.set({ accessSeen: [cooking] });
  seen.changeLocal('accessSeen', [cooking]);
  await settle();
  assert.deepEqual(seen.last('text'), { text: '' }, 'turned off on purpose: it stops asking');

  const all = worker({ firefox: true, permissions: firefoxPermissions([]) });
  await settle();
  assert.deepEqual(all.last('text'), { text: '' });
  // Chrome grants what the manifest asks
  const chrome = worker({ permissions: firefoxPermissions([cooking]) });
  await settle();
  assert.deepEqual(chrome.last('text'), { text: '' });
});

test("a tab's ✓ cleared: back to the arrow; the menu's own check moves it too", async () => {
  const w = worker({ local: memoryArea({ release: releaseRecord('0.22.0') }) });
  await settle();
  w.send({ type: 'nytfix:mark', state: 'lifted', title: "Removed Reuters's wall." }, { id: 'nytfix', tab: { id: 7 } });
  await tick();
  assert.deepEqual(w.last('text'), { tabId: 7, text: '✓' });
  w.send({ type: 'nytfix:mark', state: null }, { id: 'nytfix', tab: { id: 7 } });
  await tick();
  assert.deepEqual(w.last('text'), { tabId: 7, text: '↑' });
  assert.deepEqual(w.last('color'), { tabId: 7, color: '#c2415b' });
  assert.deepEqual(w.last('title'), { tabId: 7, title: 'Read Free: version 0.22.0 is out' });

  const quiet = worker();
  await settle();
  quiet.changeLocal('release', releaseRecord('0.22.0'));
  assert.deepEqual(quiet.last('text'), { text: '↑' }, 'the menu found it');
});

// Chrome stops an idle service worker, and a content script's message starts it again: the
// mark waits for what's saved (a newer version, off everywhere), not the defaults before it loads.
test("a mark that wakes the service worker: the arrow and the tooltip from what's saved", async () => {
  const w = worker({ local: memoryArea({ release: releaseRecord('0.22.0') }) });
  w.send({ type: 'nytfix:mark', state: null }, { id: 'nytfix', tab: { id: 7 } }); // nothing loaded yet
  await settle();
  assert.deepEqual(w.last('text'), { tabId: 7, text: '↑' });
  assert.deepEqual(w.last('title'), { tabId: 7, title: 'Read Free: version 0.22.0 is out' });

  const off = worker({ sync: memoryArea({ settings: { enabled: false } }) });
  off.send({ type: 'nytfix:mark', state: null }, { id: 'nytfix', tab: { id: 3 } });
  await settle();
  assert.deepEqual(off.last('title'), { tabId: 3, title: 'Read Free: off on all sites' });
});

test('the welcome page: once, when Read Free is first loaded; never on an update or a reload', async () => {
  const local = memoryArea();
  const w = worker({ local });
  await settle();
  const tabs = () => w.calls.filter(([name]) => name === 'tab').map(([, d]) => d.url);
  w.installed('update');
  w.installed('chrome_update');
  await settle();
  assert.deepEqual(tabs(), [], 'an update, a reload or a new Chrome: nothing');
  w.installed('install');
  await settle();
  assert.deepEqual(tabs(), ['chrome-extension://nytfix/welcome/welcome.html']);
  assert.ok(local.data.welcomed, 'remembered');
  w.installed('install');
  await settle();
  assert.equal(tabs().length, 1, 'never twice');
});

// What a content script hears when archive.today can't be fetched: no answer at all (another address
// may do), an answer that broke off, or a timeout.
test('a failed fetch says why: unreachable, cut off, or only slow', async () => {
  const ask = fetch => new Promise(resolve => {
    worker({ fetch }).send({ type: 'nytfix:fetch', url: 'https://archive.ph/newest/x', timeoutMs: 30 }, { id: 'nytfix', tab: { id: 1 } }, r => resolve(JSON.parse(JSON.stringify(r))));
  });
  const aborted = signal => new Promise((_, no) => signal.addEventListener('abort', () => no(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  assert.deepEqual(await ask(async () => { throw new TypeError('Failed to fetch'); }), { ok: false, error: 'Failed to fetch', reason: 'unreachable' });
  assert.deepEqual(await ask(async () => ({ status: 200, url: 'x', text: async () => { throw new TypeError('network error'); } })), { ok: false, error: 'network error', reason: 'cut-off' });
  assert.deepEqual(await ask((url, { signal }) => aborted(signal)), { ok: false, error: 'timed out after 0 s' });
  assert.deepEqual(await ask(async (url, { signal }) => ({ status: 200, url: 'x', text: () => aborted(signal) })), { ok: false, error: 'timed out after 0 s' }, 'slow partway is a timeout too');
  assert.deepEqual(await ask(async () => ({ status: 200, url: 'https://archive.ph/x', text: async () => 'hi' })), { ok: true, status: 200, url: 'https://archive.ph/x', body: 'hi' });
});

// Firefox retries dropped connections by itself, so a fetch can hang until its time is up: there,
// after 25 s, the address is asked for its icon.
test('no answer for long: an address whose icon comes is only slow; one that says nothing is unreachable', async () => {
  const PAGE = 'https://archive.ph/newest/x';
  const hang = signal => new Promise((_, no) => signal.addEventListener('abort', () => no(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const run = async (page, icon, timeoutMs = 90000, firefox = true) => {
    const asked = [];
    const fetch = (url, init) => { asked.push(url); return url === PAGE ? page(init) : icon(init); };
    const reply = await new Promise(resolve => {
      worker({ fetch, speed: 200, firefox, permissions: { contains: async () => true } }).send({ type: 'nytfix:fetch', url: PAGE, timeoutMs }, { id: 'nytfix', tab: { id: 1 } }, r => resolve(JSON.parse(JSON.stringify(r))));
    });
    await new Promise(resolve => setTimeout(resolve, 60)); // anything asked late would show
    return { reply, icons: asked.filter(u => u === 'https://archive.ph/favicon.ico').length, others: asked.filter(u => u !== PAGE && u !== 'https://archive.ph/favicon.ico') };
  };
  const answer = { status: 200, url: PAGE, text: async () => 'hi' };
  const late = ms => ({ signal }) => Promise.race([hang(signal), new Promise(r => setTimeout(() => r(answer), ms / 200))]);
  const never = ({ signal }) => hang(signal);
  const icon404 = async () => ({ status: 404 });

  const silent = await run(never, never);
  assert.deepEqual(silent.reply, { ok: false, error: 'no answer in 35 s', reason: 'unreachable' });
  assert.equal(silent.icons, 1, 'asked once');
  assert.deepEqual(silent.others, []);
  assert.deepEqual((await run(never, async () => { throw new TypeError('Failed to fetch'); })).reply.reason, 'unreachable');

  const slow = await run(never, icon404);
  assert.deepEqual(slow.reply, { ok: false, error: 'timed out after 90 s' }, 'any answer for the icon: only slow');
  assert.equal((await run(late(70000), icon404)).reply.ok, true, 'a slow render is waited for');
  assert.equal((await run(late(30000), never)).reply.ok, true, 'it came while the icon was being asked for');

  const quick = await run(late(2000), never);
  assert.equal(quick.reply.ok, true);
  assert.equal(quick.icons, 0, 'nothing more is asked of an address that answers');
  const body = { status: 200, url: PAGE, text: () => new Promise(r => setTimeout(() => r('hi'), 60000 / 200)) };
  const big = await run(async () => body, never);
  assert.equal(big.reply.ok, true, 'a long download is left alone');
  assert.equal(big.icons, 0);
  assert.equal((await run(never, never, 20000)).icons, 0, 'a request with a short limit has no time for it');
  const chrome = await run(never, never, 90000, false);
  assert.deepEqual(chrome.reply, { ok: false, error: 'timed out after 90 s' }, 'Chrome: not asked, since fetch() says so itself');
  assert.equal(chrome.icons, 0);
});

// Requests to archive.today: one at a time, a second apart (here 1000 times faster), the tab being
// read first; after a CAPTCHA, none until it's completed or the reader asks.
const CAPTCHA = '<div class="g-recaptcha"></div>';
function archiveWorker({ session = memoryArea(), answer = async () => 'text', status = () => 200, speed = 100 } = {}) {
  const asked = [];
  const open = new Map(); // url -> answer it
  let most = 0;
  const fetch = async url => {
    const name = url.replace('https://archive.ph/newest/', '');
    asked.push(name);
    let done;
    const answered = new Promise(r => { done = r; });
    open.set(name, body => { open.delete(name); done(body); });
    most = Math.max(most, open.size);
    const auto = await answer(name);
    if (auto !== undefined) open.get(name)(auto);
    const body = await answered;
    if (body instanceof Error) throw body;
    return { status: status(name), url: body === CAPTCHA ? `https://archive.ph/20261114130000/${name}` : url, text: async () => body };
  };
  const w = worker({ fetch, speed, session });
  const replies = {};
  const ask = (name, tabId, { visible = true, force = false } = {}) => {
    w.send({ type: 'nytfix:fetch', url: `https://archive.ph/newest/${name}`, timeoutMs: 90000, visible, force }, { id: 'nytfix', tab: { id: tabId } }, r => { replies[name] = JSON.parse(JSON.stringify(r)); });
  };
  const wanted = () => new Promise(resolve => w.send({ type: 'nytfix:check', host: 'archive.ph' }, { id: 'nytfix', tab: { id: 1 } }, resolve));
  // Every request answered: one left hanging keeps its timers, and the test run, going
  const finish = async () => {
    for (let i = 0; i < 20; i++) {
      for (const done of [...open.values()]) done('text');
      await pause(10);
    }
  };
  return { w, asked, open, replies, ask, wanted, finish, most: () => most };
}
const pause = ms => new Promise(r => setTimeout(r, ms));

test('archive.today is asked one thing at a time, a second apart', async () => {
  const a = archiveWorker({ answer: async () => undefined, speed: 20 }); // a gap of 50 ms
  for (const [i, name] of ['one', 'two', 'three'].entries()) a.ask(name, i + 1, { visible: false });
  await pause(20);
  assert.deepEqual(a.asked, ['one']);
  await pause(150);
  assert.deepEqual(a.asked, ['one'], 'the first is still on its way');
  a.open.get('one')('text');
  await pause(20);
  assert.deepEqual(a.asked, ['one', 'two'], 'the gap was over long ago');
  a.open.get('two')('text');
  await pause(15);
  assert.deepEqual(a.asked, ['one', 'two'], 'not before the gap is');
  await pause(80);
  assert.deepEqual(a.asked, ['one', 'two', 'three']);
  a.open.get('three')('text');
  await pause(20);
  assert.equal(a.most(), 1);
  assert.deepEqual(Object.values(a.replies).map(r => r.ok), [true, true, true]);
  await a.finish();
});

test('the tab being read goes first, and need not wait for another; never more than two at once', async () => {
  const a = archiveWorker({ answer: async () => undefined });
  a.ask('hidden1', 1, { visible: false });
  await pause(30);
  a.ask('hidden2', 2, { visible: false });
  a.ask('shown', 3);
  await pause(40);
  assert.deepEqual(a.asked, ['hidden1', 'shown']);
  a.ask('shown2', 4);
  await pause(60);
  assert.deepEqual(a.asked, ['hidden1', 'shown'], 'two on their way');
  a.open.get('hidden1')('text');
  await pause(40);
  assert.deepEqual(a.asked, ['hidden1', 'shown', 'shown2']);
  a.w.send({ type: 'nytfix:looking', visible: true }, { id: 'nytfix', tab: { id: 2 } });
  a.open.get('shown')('text');
  await pause(40);
  assert.deepEqual(a.asked, ['hidden1', 'shown', 'shown2', 'hidden2'], 'the reader got to that tab');
  assert.equal(a.most(), 2);
  await a.finish();
});

test("a closed tab's request is dropped", async () => {
  const a = archiveWorker({ answer: async () => undefined });
  a.ask('one', 1, { visible: false });
  a.ask('two', 2, { visible: false });
  a.ask('three', 3, { visible: false });
  await pause(20);
  a.w.closeTab(2);
  a.open.get('one')('text');
  await pause(40);
  a.open.get('three')('text');
  await pause(40);
  assert.deepEqual(a.asked, ['one', 'three']);
  await a.finish();
});

test('after a CAPTCHA nothing more is asked, by any page, until the reader asks; getting past it lets the rest through', async () => {
  const session = memoryArea();
  const a = archiveWorker({ session, answer: async name => (name === 'first' || name === 'early' ? CAPTCHA : 'text') });
  a.ask('first', 1);
  a.ask('second', 2, { visible: false });
  await pause(60);
  assert.deepEqual(a.asked, ['first']);
  assert.equal(a.replies.first.ok, true, 'the page sees the CAPTCHA itself');
  assert.deepEqual(a.replies.second, { ok: false, error: 'a check is waiting', reason: 'check', check: 'https://archive.ph/20261114130000/first' });
  assert.equal(await a.wanted(), true);

  const again = archiveWorker({ session, answer: async name => (name === 'early' ? CAPTCHA : 'text') }); // the worker restarted
  again.ask('third', 3);
  await pause(40);
  assert.deepEqual(again.asked, [], 'remembered');
  again.ask('early', 4, { force: true });
  await pause(40);
  assert.deepEqual(again.asked, ['early']);
  assert.equal(await again.wanted(), true, 'not completed yet');
  again.ask('done', 5, { force: true });
  await pause(40);
  assert.equal(await again.wanted(), false);
  again.ask('fourth', 6);
  await pause(60);
  assert.deepEqual(again.asked, ['early', 'done', 'fourth']);
  assert.equal(again.replies.fourth.ok, true);
});

test('a check is forgotten after a minute; another address has none; a failure neither sets nor clears one', async () => {
  const session = memoryArea();
  const a = archiveWorker({ session, answer: async name => (name === 'first' ? CAPTCHA : name === 'broken' ? new TypeError('Failed to fetch') : 'text') });
  a.ask('first', 1);
  await pause(40);
  a.ask('broken', 1, { force: true });
  await pause(40);
  assert.equal(await a.wanted(), true);
  const other = await new Promise(r => a.w.send({ type: 'nytfix:check', host: 'archive.is' }, { id: 'nytfix', tab: { id: 1 } }, r));
  assert.equal(other, false);
  const down = archiveWorker({ session, status: () => 503 });
  down.ask('down', 1, { force: true });
  await pause(40);
  assert.equal(await down.wanted(), true, 'a server error is no answer');
  session.data['nytfix:checks']['archive.ph'].at -= 60 * 1000 + 1;
  const later = archiveWorker({ session });
  assert.equal(await later.wanted(), false);
});

// Completing the check: the archive page in a small window over the reader's
test('the check opens in a small window, in the same cookies; its second page asks again; an answer closes it', async () => {
  const session = memoryArea();
  let body = CAPTCHA;
  const w = worker({ session, windows: true, speed: 100, fetch: async url => ({ status: 200, url, text: async () => body }) });
  const openCheck = (url, tab = { id: 5, windowId: 9, incognito: false }) => new Promise(r => w.send({ type: 'nytfix:openCheck', url }, { id: 'nytfix', tab }, r));
  const told = () => w.calls.filter(([n, d]) => n === 'message' && d.type === 'nytfix:checked').map(([, d]) => d.id);
  assert.equal(await openCheck('https://evil.example/https://archive.ph/'), false, 'only archive.today');
  assert.equal(await openCheck('https://archive.ph/x', null), false);
  assert.equal(w.last('window'), undefined);
  assert.equal(await openCheck('https://archive.ph/20261114130000/https://www.wsj.com/x'), true);
  assert.deepEqual(w.last('window'), { url: 'https://archive.ph/20261114130000/https://www.wsj.com/x', type: 'popup', width: 520, height: 720, left: 540, top: 110 });
  w.updated(700, { status: 'loading' });
  w.updated(700, { status: 'complete' });
  w.updated(123, { status: 'complete' });
  await pause(20);
  assert.deepEqual(told(), [], 'the check itself');
  w.updated(700, { status: 'complete' });
  await pause(20);
  assert.deepEqual(told(), [5]);
  const ask = () => new Promise(r => w.send({ type: 'nytfix:fetch', url: 'https://archive.ph/newest/x', timeoutMs: 90000, force: true }, { id: 'nytfix', tab: { id: 5 } }, r));
  await ask();
  await pause(20);
  assert.equal(w.last('closed'), undefined, 'still a CAPTCHA: the window stays');
  body = 'the article';
  await ask();
  await pause(30);
  assert.equal(w.last('closed'), 70);
  assert.deepEqual(told(), [5], 'closed by Read Free: nothing more to ask');
});

test('no check window from incognito; the reader closing one asks once; another tab has no part in it', async () => {
  const w = worker({ session: memoryArea(), windows: true, fetch: async url => ({ status: 200, url, text: async () => 'the article' }) });
  const openCheck = tab => new Promise(r => w.send({ type: 'nytfix:openCheck', url: 'https://archive.ph/x' }, { id: 'nytfix', tab }, r));
  assert.equal(await openCheck({ id: 6, windowId: 9, incognito: true }), false);
  assert.equal(w.last('window'), undefined, 'never in the regular window, with its history');
  await openCheck({ id: 6, windowId: 9, incognito: false });
  w.windowGone(70);
  await pause(10);
  assert.deepEqual(w.last('message'), { id: 6, type: 'nytfix:checked' });
  w.windowGone(70);
  await pause(10);
  assert.equal(w.calls.filter(([n]) => n === 'message').length, 1);
  // Another tab's article being answered is nothing to do with this one's check
  await openCheck({ id: 6, windowId: 9, incognito: false });
  await new Promise(r => w.send({ type: 'nytfix:fetch', url: 'https://archive.ph/newest/other', timeoutMs: 90000, force: true }, { id: 'nytfix', tab: { id: 8 } }, r));
  await pause(20);
  assert.equal(w.last('closed'), undefined);
  const none = worker({ session: memoryArea() });
  assert.equal(await new Promise(r => none.send({ type: 'nytfix:openCheck', url: 'https://archive.ph/x' }, { id: 'nytfix', tab: { id: 1 } }, r)), false, 'no windows here: a tab, then');
});
