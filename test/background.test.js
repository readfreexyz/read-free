// The service worker (extension/background.js): the toolbar icon and its mark.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { memoryArea } = require('./fixtures.js');

const EXT = path.join(__dirname, '../extension');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function worker({ sync = memoryArea() } = {}) {
  const calls = [];
  const listeners = { message: [], changed: [] };
  const record = name => async details => { calls.push([name, details]); };
  const chrome = {
    runtime: { id: 'nytfix', onMessage: { addListener: fn => listeners.message.push(fn) }, onStartup: { addListener: () => {} }, getPlatformInfo: async () => ({}), getURL: p => `chrome-extension://nytfix/${p}` },
    storage: { sync, onChanged: { addListener: fn => listeners.changed.push(fn) } },
    action: {
      setBadgeText: record('text'),
      setBadgeBackgroundColor: record('color'),
      setBadgeTextColor: record('textColor'),
      setTitle: record('title'),
      setIcon: record('icon'),
    },
    tabs: { sendMessage: async () => ({}), create: record('tab') },
  };
  const context = vm.createContext({ chrome, console, setTimeout, clearTimeout, setInterval, clearInterval, URL, AbortController });
  context.self = context;
  context.importScripts = (...files) => { for (const f of files) vm.runInContext(fs.readFileSync(path.join(EXT, f), 'utf8'), context); };
  vm.runInContext(fs.readFileSync(path.join(EXT, 'background.js'), 'utf8'), context);
  const send = (msg, sender) => listeners.message[0](msg, sender, () => {});
  const changeSettings = value => { for (const fn of listeners.changed) fn({ settings: { newValue: value } }, 'sync'); };
  // Plain copies: objects made inside the vm context have their own prototypes.
  const last = name => { const found = calls.filter(([n]) => n === name).pop()?.[1]; return found && JSON.parse(JSON.stringify(found)); };
  return { calls, send, last, changeSettings };
}

test("toolbar mark: a green check on the tab's icon while the wall is off, cleared on request", async () => {
  const w = worker();
  await tick();
  w.send({ type: 'nytfix:mark', state: 'lifted', title: "Removed Reuters's wall." }, { id: 'nytfix', tab: { id: 7 } });
  assert.deepEqual(w.last('text'), { tabId: 7, text: '✓' });
  assert.equal(w.last('color').tabId, 7);
  assert.equal(w.last('title').title, "Read Free: Removed Reuters's wall.");
  w.send({ type: 'nytfix:mark', state: null }, { id: 'nytfix', tab: { id: 7 } });
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
  assert.deepEqual(w.last('icon'), { tabId: 3, path: { 16: 'icons/off-16.png', 32: 'icons/off-32.png' } });
  assert.deepEqual(w.last('title'), { tabId: 3, title: 'Read Free: Off on The New York Times.' });
});
