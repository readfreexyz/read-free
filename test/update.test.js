// Updating itself (extension/src/update.js): reload when a newer version is on disk.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const update = require('../extension/src/update.js');
const { memoryArea } = require('./fixtures.js');

const EXT = path.join(__dirname, '../extension');
const BASE = 'chrome-extension://nytfix/';

// The files on disk (path → text) and the extension around them. The running version is
// fixed; the files can change.
function extension({ running = '1.0.0', files = {}, contexts = [] } = {}) {
  const disk = {
    'background.js': "importScripts('src/archive.js', 'src/update.js');",
    'src/archive.js': '',
    'src/update.js': '',
    'src/content.js': '',
    ...files,
  };
  const manifest = version => JSON.stringify({
    version,
    background: { service_worker: 'background.js' },
    content_scripts: [{ matches: ['https://example.com/*'], js: ['src/content.js'] }],
  });
  if (!('manifest.json' in disk)) disk['manifest.json'] = manifest(running);
  let clock = 1_000_000;
  const reloads = [];
  const listeners = { message: [], alarm: [] };
  const alarms = new Map();
  const chrome = {
    runtime: {
      id: 'nytfix',
      getManifest: () => ({ version: running }),
      getURL: file => BASE + file,
      reload: () => reloads.push(clock),
      getContexts: async () => contexts,
      onMessage: { addListener: fn => listeners.message.push(fn) },
    },
    storage: { session: memoryArea() },
    alarms: {
      get: async name => alarms.get(name),
      create: async (name, info) => { alarms.set(name, { name, ...info, created: clock }); },
      onAlarm: { addListener: fn => listeners.alarm.push(fn) },
    },
  };
  const reads = [];
  const fetch = async (url, init) => {
    assert.equal(init?.cache, 'no-store');
    const file = url.slice(BASE.length);
    reads.push(file);
    if (!(file in disk)) throw new TypeError('Failed to fetch'); // what Chrome does for a missing file
    const text = disk[file];
    return { ok: true, text: async () => text, json: async () => JSON.parse(text) };
  };
  const updater = update.createUpdater({ chrome, fetch, now: () => clock });
  return {
    chrome, disk, reloads, reads, alarms, listeners, updater, contexts,
    tick: () => updater.tick(),
    publish: version => { disk['manifest.json'] = manifest(version); },
    wait: ms => { clock += ms; },
  };
}

test('versions compare as numbers, part by part', () => {
  assert.equal(update.compareVersions('0.14.10', '0.14.9'), 1);
  assert.equal(update.compareVersions('0.14.2', '0.16.0'), -1);
  assert.equal(update.compareVersions('1.0', '1.0.0'), 0);
  assert.equal(update.isNewer('0.14.3', '0.14.2'), true);
  assert.equal(update.isNewer('0.14.2', '0.14.2'), false);
  assert.equal(update.isNewer('0.14.1', '0.14.2'), false);
  assert.equal(update.isNewer('2.0-beta', '1.0'), false); // not a Chrome version
  assert.equal(update.isNewer(undefined, '1.0'), false);
});

test('a newer version on disk: noted at the first check, loaded at the next', async () => {
  const ext = extension({ running: '0.14.2' });
  assert.equal(await ext.tick(), 'current');
  ext.publish('0.14.3');
  assert.equal(await ext.tick(), 'seen');
  assert.deepEqual(ext.reloads, []);
  ext.wait(60_000);
  assert.equal(await ext.tick(), 'reloaded');
  assert.equal(ext.reloads.length, 1);
});

test('the same or an older version on disk: nothing happens', async () => {
  const ext = extension({ running: '0.16.0' });
  ext.publish('0.16.0');
  assert.equal(await ext.tick(), 'current');
  ext.publish('0.14.3');
  assert.equal(await ext.tick(), 'current');
  assert.equal(await ext.tick(), 'current');
  assert.deepEqual(ext.reloads, []);
});

test('a manifest being written (not JSON yet) waits for the next check', async () => {
  const ext = extension({ running: '1.0.0' });
  ext.disk['manifest.json'] = '{ "version": "1.0.1", ';
  assert.equal(await ext.tick(), 'unreadable');
  assert.deepEqual(ext.reloads, []);
});

test('two releases in a row: each new version waits its own check', async () => {
  const ext = extension({ running: '1.0.0' });
  ext.publish('1.0.1');
  assert.equal(await ext.tick(), 'seen');
  ext.publish('1.0.2'); // pushed before the next check
  assert.equal(await ext.tick(), 'seen');
  assert.deepEqual(ext.reloads, []);
  assert.equal(await ext.tick(), 'reloaded');
});

test("a version whose files aren't all there isn't loaded until they are", async () => {
  const ext = extension({ running: '1.0.0' });
  ext.publish('1.0.1');
  delete ext.disk['src/content.js'];
  ext.disk['background.js'] = "importScripts('src/archive.js', 'src/update.js', 'src/new.js');";
  assert.equal(await ext.tick(), 'seen');
  assert.equal(await ext.tick(), 'incomplete');
  assert.deepEqual(ext.reloads, []);
  ext.disk['src/content.js'] = '';
  assert.equal(await ext.tick(), 'incomplete'); // src/new.js, which background.js imports
  ext.disk['src/new.js'] = '';
  assert.equal(await ext.tick(), 'reloaded');
});

test('a missing service worker counts as missing', async () => {
  const ext = extension({ running: '1.0.0' });
  ext.publish('1.0.1');
  delete ext.disk['background.js'];
  await ext.tick();
  assert.equal(await ext.tick(), 'incomplete');
});

test('an archive.today download in flight holds the reload until its timeout has passed', async () => {
  const ext = extension({ running: '1.0.0' });
  ext.publish('1.0.1');
  await ext.tick();
  ext.updater.noteMessage({ type: 'nytfix:fetch', url: 'https://archive.ph/x', timeoutMs: 20000 }, { id: 'nytfix', tab: { id: 3 } });
  assert.equal(await ext.tick(), 'busy');
  ext.wait(20000);
  assert.equal(await ext.tick(), 'busy'); // the margin
  ext.wait(5000);
  assert.equal(await ext.tick(), 'reloaded');
});

test("another extension's messages don't hold it", async () => {
  const ext = extension({ running: '1.0.0' });
  ext.publish('1.0.1');
  await ext.tick();
  ext.updater.noteMessage({ type: 'nytfix:fetch', timeoutMs: 20000 }, { id: 'someone-else' });
  assert.equal(await ext.tick(), 'reloaded');
});

test('an open extension page holds the reload, for 30 minutes at most', async () => {
  const ext = extension({ running: '1.0.0', contexts: [{ contextType: 'TAB' }] });
  ext.publish('1.0.1');
  assert.equal(await ext.tick(), 'seen');
  ext.wait(60_000);
  assert.equal(await ext.tick(), 'busy');
  ext.wait(update.MAX_WAIT_MS - 120_000);
  assert.equal(await ext.tick(), 'busy');
  ext.wait(60_000);
  assert.equal(await ext.tick(), 'reloaded');
});

test('start: one alarm a minute, created only if there is none', async () => {
  const ext = extension();
  ext.updater.start();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(ext.alarms.get(update.ALARM).periodInMinutes, 1);
  const created = ext.alarms.get(update.ALARM).created;
  ext.wait(30_000);
  update.createUpdater({ chrome: ext.chrome, fetch: async () => { throw new Error('unused'); }, now: () => 0 }).start();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(ext.alarms.get(update.ALARM).created, created); // the worker woke up: same alarm
  assert.equal(ext.listeners.message.length, 2);
});

test('start: the alarm runs a check; other alarms and messages are left alone', async () => {
  const ext = extension({ running: '1.0.0' });
  ext.updater.start();
  ext.publish('1.0.1');
  ext.listeners.alarm[0]({ name: 'something-else' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(ext.reads, []);
  ext.listeners.alarm[0]({ name: update.ALARM }); // first sight
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(ext.reloads.length, 0);
  ext.listeners.alarm[0]({ name: update.ALARM }); // a minute later
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(ext.reloads.length, 1);
  // The message listener never answers, so background.js's own listener does.
  assert.equal(ext.listeners.message[0]({ type: 'nytfix:fetch' }, { id: 'nytfix' }, () => {}), undefined);
});

test("the extension's own manifest: every file it names is in the folder", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  const files = update.manifestFiles(manifest);
  assert.ok(files.includes('background.js'));
  assert.ok(files.includes('src/content.js'));
  const imported = update.importedScripts(fs.readFileSync(path.join(EXT, 'background.js'), 'utf8'));
  assert.ok(imported.includes('src/archive.js'));
  for (const file of [...files, ...imported]) assert.ok(fs.existsSync(path.join(EXT, file)), `${file} is missing`);
});

test('the manifest asks for the alarms permission and the service worker loads the updater', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  assert.ok(manifest.permissions.includes('alarms'));
  const imported = update.importedScripts(fs.readFileSync(path.join(EXT, 'background.js'), 'utf8'));
  assert.ok(imported.includes('src/update.js'));
});
