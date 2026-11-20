// The service worker (extension/background.js): the toolbar icon and its mark.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { memoryArea } = require('./fixtures.js');

const EXT = path.join(__dirname, '../extension');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

// local: chrome.storage.local (the release record, src/release.js). version: the running one.
// fetch: answers for Read Free's site (latest.txt).
function worker({ sync = memoryArea(), local = memoryArea(), version = '0.21.0', fetch = async () => { throw new Error('offline'); } } = {}) {
  const calls = [];
  const listeners = { message: [], changed: [], alarm: [], installed: [] };
  const alarms = {};
  const record = name => async details => { calls.push([name, details]); };
  const chrome = {
    runtime: { id: 'nytfix', onMessage: { addListener: fn => listeners.message.push(fn) }, onStartup: { addListener: () => {} }, getPlatformInfo: async () => ({}), getURL: p => `chrome-extension://nytfix/${p}`, getManifest: () => ({ version }), onInstalled: { addListener: fn => listeners.installed.push(fn) } },
    storage: { sync, local, onChanged: { addListener: fn => listeners.changed.push(fn) } },
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
    tabs: { sendMessage: async () => ({}), create: record('tab') },
  };
  const context = vm.createContext({ chrome, console, setTimeout, clearTimeout, setInterval, clearInterval, URL, AbortController, fetch });
  context.self = context;
  context.importScripts = (...files) => { for (const f of files) vm.runInContext(fs.readFileSync(path.join(EXT, f), 'utf8'), context); };
  vm.runInContext(fs.readFileSync(path.join(EXT, 'background.js'), 'utf8'), context);
  const send = (msg, sender, respond = () => {}) => listeners.message[0](msg, sender, respond);
  const changeSettings = value => { for (const fn of listeners.changed) fn({ settings: { newValue: value } }, 'sync'); };
  const changeLocal = (key, value) => { for (const fn of listeners.changed) fn({ [key]: { newValue: value } }, 'local'); };
  const fireAlarm = name => { for (const fn of listeners.alarm) fn({ name }); };
  const installed = reason => { for (const fn of listeners.installed) fn({ reason }); };
  // Plain copies: objects made inside the vm context have their own prototypes.
  const last = name => { const found = calls.filter(([n]) => n === name).pop()?.[1]; return found && JSON.parse(JSON.stringify(found)); };
  return { calls, send, last, changeSettings, changeLocal, fireAlarm, installed, alarms };
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
