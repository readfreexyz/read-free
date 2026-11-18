// The toolbar menu's "Read Free 0.20.0 is out" (src/release.js), with the network stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');
const release = require('../extension/src/release.js');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 18, 12);
const URLS = ['https://readfree.example/', 'https://mirror.example/rf/'];
const latest = (version, date = '2026-11-16T09:00:00Z') => `read-free-release 1\nversion=${version}\nzip=read-free-${version}.zip\nsha256=${'a'.repeat(64)}\nsize=1234\ndate=${date}\n`;
const reply = (body, status = 200) => ({ ok: status < 400, status, text: async () => body });
function memoryArea(data = {}) {
  return { data, async get(key) { return key in data ? { [key]: structuredClone(data[key]) } : {}; }, async set(items) { Object.assign(data, structuredClone(items)); } };
}

test('latest.txt: the version and date, nothing else', () => {
  assert.deepEqual(release.parse(latest('0.20.0')), { version: '0.20.0', date: Date.UTC(2026, 10, 16, 9) });
  assert.deepEqual(release.parse('read-free-release 1\nversion=1.2\n'), { version: '1.2', date: null });
  for (const text of ['', 'version=0.20.0\n', latest('0.20.0').replace('release 1', 'release 2'), latest('0.20.0; rm -rf /'), latest('<b>1</b>'), 'x'.repeat(5000), null])
    assert.equal(release.parse(text), null, JSON.stringify(text)?.slice(0, 40));
  assert.equal(release.parse(latest('0.20.0', 'yesterday')).date, null);
});

test('refresh: at most once a day, the first address that answers, kept', async () => {
  const area = memoryArea();
  const asked = [];
  const fetch = async (url, init) => {
    asked.push([url, init]);
    return url.startsWith('https://readfree.example/') ? reply('', 503) : reply(latest('0.20.0'));
  };
  const record = await release.refresh(area, URLS, { fetch, now: NOW });
  assert.deepEqual(asked.map(a => a[0]), ['https://readfree.example/latest.txt', 'https://mirror.example/rf/latest.txt']);
  assert.equal(asked[0][1].credentials, 'omit');
  assert.equal(asked[0][1].referrerPolicy, 'no-referrer');
  assert.deepEqual(record, { version: '0.20.0', date: Date.UTC(2026, 10, 16, 9), checkedAt: NOW, retryAt: 0 });
  assert.deepEqual(area.data.release, record);
  // Within the day: no request
  await release.refresh(area, URLS, { fetch: async () => assert.fail('asked again'), now: NOW + DAY - 1 });
  // A day on: asked again
  await release.refresh(area, URLS, { fetch: async () => reply(latest('0.21.0')), now: NOW + DAY });
  assert.equal(area.data.release.version, '0.21.0');
});

test('refresh: nothing answers, so try again in an hour, keeping what was known', async () => {
  const area = memoryArea({ release: { version: '0.20.0', date: 5, checkedAt: NOW - 2 * DAY, retryAt: 0 } });
  const down = async () => { throw new TypeError('offline'); };
  const record = await release.refresh(area, URLS, { fetch: down, now: NOW });
  assert.deepEqual(record, { version: '0.20.0', date: 5, checkedAt: NOW - 2 * DAY, retryAt: NOW + HOUR });
  await release.refresh(area, URLS, { fetch: async () => assert.fail('within the hour'), now: NOW + HOUR - 1 });
  assert.equal((await release.refresh(area, URLS, { fetch: async () => reply(latest('0.20.1')), now: NOW + HOUR })).version, '0.20.1');
});

test('refresh: no addresses, no requests', async () => {
  assert.deepEqual(await release.refresh(memoryArea(), [], { fetch: async () => assert.fail('asked') }), {});
});

test('refresh: a release without a date counts from when it was first seen', async () => {
  const area = memoryArea();
  const fetch = async () => reply('read-free-release 1\nversion=0.20.0\n');
  assert.equal((await release.refresh(area, URLS, { fetch, now: NOW })).date, NOW);
  assert.equal((await release.refresh(area, URLS, { fetch, now: NOW + 2 * DAY })).date, NOW, 'still the first sighting');
});

test('notice: a newer version, a day old, linking to the first address', () => {
  const record = { version: '0.20.0', date: NOW - DAY };
  assert.deepEqual(release.notice(record, '0.19.0', { urls: URLS, now: NOW }), { version: '0.20.0', href: 'https://readfree.example/', text: 'Read Free 0.20.0 is out' });
  assert.equal(release.notice(record, '0.20.0', { urls: URLS, now: NOW }), null, 'the same');
  assert.equal(release.notice(record, '0.20.1', { urls: URLS, now: NOW }), null, 'older');
  assert.equal(release.notice({ version: '0.19.10', date: NOW - DAY }, '0.19.9', { urls: URLS, now: NOW })?.version, '0.19.10', 'numerically');
  assert.equal(release.notice({ ...record, date: NOW - DAY + 1 }, '0.19.0', { urls: URLS, now: NOW }), null, 'not a day old: those with the script have it by then');
  assert.equal(release.notice(record, '0.19.0', { urls: [], now: NOW }), null, 'no addresses');
  assert.equal(release.notice({}, '0.19.0', { urls: URLS, now: NOW }), null);
});
