const test = require('node:test');
const assert = require('node:assert/strict');
const articleCache = require('../extension/src/cache.js');
const { memoryArea } = require('./fixtures.js');

const URL_A = 'https://www.nytimes.com/2026/11/14/world/a.html';
const snapshot = n => ({
  blocks: [{ type: 'paragraph', text: `Placeholder paragraph ${n}.` }],
  snapshotUrl: `https://archive.ph/2026111405053${n}/https://www.nytimes.com/x.html`,
  snapshotTime: Date.UTC(2026, 10, 14, 5, 5, 30 + n),
});

test('returns null for an article that was never saved', async () => {
  const cache = articleCache.create(memoryArea());
  assert.equal(await cache.get(URL_A), null);
});

test('returns exactly what was saved', async () => {
  const cache = articleCache.create(memoryArea());
  await cache.put(URL_A, snapshot(1));
  assert.deepEqual(await cache.get(URL_A), snapshot(1));
});

test('treats entries older than the TTL as missing, and deletes them', async () => {
  const clock = { now: 1_000_000 };
  const area = memoryArea();
  const cache = articleCache.create(area, { now: () => clock.now, ttlMs: 1000 });
  await cache.put(URL_A, snapshot(1));
  clock.now += 1001;
  assert.equal(await cache.get(URL_A), null);
  assert.deepEqual(Object.keys(area.data), []);
});

test('ignores entries saved in an older format', async () => {
  const area = memoryArea({ [`article:${URL_A}`]: { v: 0, savedAt: Date.now(), ...snapshot(1) } });
  assert.equal(await articleCache.create(area).get(URL_A), null);
});

test('drops expired articles and the oldest past the size cap, and leaves other keys alone', async () => {
  const clock = { now: 1_000_000 };
  const url = n => `https://www.nytimes.com/2026/11/14/world/${n}.html`;
  // How much one saved article takes, measured the way the cache does.
  const probe = articleCache.create(memoryArea());
  await probe.put(url(1), snapshot(1));
  const { bytes } = await probe.usage();

  const area = memoryArea({ settings: { mirror: 'archive.ph' } });
  const cache = articleCache.create(area, { now: () => clock.now, ttlMs: 10_000, maxBytes: Math.floor(bytes * 2.5) });
  for (const n of [1, 2, 3]) {
    await cache.put(url(n), snapshot(n));
    clock.now += 100;
  }
  assert.deepEqual(Object.keys(area.data).sort(), [
    `article:${url(2)}`, `article:${url(3)}`,
    `info:${url(2)}`, `info:${url(3)}`,
    'settings',
  ]);

  clock.now += 10_000; // 2 and 3 are now expired
  await cache.put(URL_A, snapshot(4));
  assert.deepEqual(Object.keys(area.data).sort(), [`article:${URL_A}`, `info:${URL_A}`, 'settings']);
});

test('keeps articles for 30 days by default', async () => {
  const clock = { now: 1_000_000 };
  const cache = articleCache.create(memoryArea(), { now: () => clock.now });
  await cache.put(URL_A, snapshot(1));
  clock.now += 29 * 24 * 60 * 60 * 1000;
  assert.deepEqual(await cache.get(URL_A), snapshot(1));
  clock.now += 2 * 24 * 60 * 60 * 1000;
  assert.equal(await cache.get(URL_A), null);
});

test('drops text saved by an older version, which has no info entry', async () => {
  const old = `https://www.nytimes.com/2026/11/13/world/old.html`;
  const area = memoryArea({ [`article:${old}`]: { v: 2, savedAt: Date.now(), ...snapshot(9) } });
  const cache = articleCache.create(area);
  await cache.put(URL_A, snapshot(1));
  assert.deepEqual(Object.keys(area.data).sort(), [`article:${URL_A}`, `info:${URL_A}`]);
});

test('works without getKeys (Chrome before 130)', async () => {
  const area = memoryArea({ settings: { mirror: 'archive.ph' } });
  delete area.getKeys;
  const cache = articleCache.create(area, { maxBytes: 1 });
  await cache.put(URL_A, snapshot(1)); // too big for the cap, so it's trimmed right away
  assert.deepEqual(Object.keys(area.data), ['settings']);
});

test('usage and clear cover saved articles and "no snapshot" answers, nothing else', async () => {
  const area = memoryArea({ settings: { mirror: 'archive.is' } });
  const cache = articleCache.create(area);
  await cache.put(URL_A, snapshot(1));
  await cache.putMissing('https://www.nytimes.com/2026/11/14/world/b.html');
  const { articles, bytes } = await cache.usage();
  assert.equal(articles, 1);
  const stored = JSON.stringify(area.data[`article:${URL_A}`]).length + JSON.stringify(area.data[`info:${URL_A}`]).length;
  assert.ok(bytes > stored && bytes < stored + 200, `about the stored size (${bytes} vs ${stored})`);
  await cache.clear();
  assert.deepEqual(await cache.usage(), { articles: 0, bytes: 0 });
  assert.deepEqual(Object.keys(area.data), ['settings']);
});

test('remembers "no snapshot yet" until its shorter TTL runs out', async () => {
  const clock = { now: 1_000_000 };
  const cache = articleCache.create(memoryArea(), { now: () => clock.now, missingTtlMs: 1000 });
  assert.equal(await cache.getMissing(URL_A), null);
  await cache.putMissing(URL_A);
  clock.now += 500;
  assert.deepEqual(await cache.getMissing(URL_A), { checkedAt: 1_000_000 });
  clock.now += 501;
  assert.equal(await cache.getMissing(URL_A), null);
});

test('keeps a copy that may be missing its end only until the shorter TTL runs out', async () => {
  const clock = { now: 1_000_000 };
  const cache = articleCache.create(memoryArea(), { now: () => clock.now, partialTtlMs: 1000 });
  await cache.put(URL_A, snapshot(1), { partial: true });
  clock.now += 1000;
  assert.deepEqual(await cache.get(URL_A), snapshot(1));
  clock.now += 1;
  assert.equal(await cache.get(URL_A), null);
});

test('saving an article clears its "no snapshot yet" entry', async () => {
  const area = memoryArea();
  const cache = articleCache.create(area);
  await cache.putMissing(URL_A);
  await cache.put(URL_A, snapshot(1));
  assert.equal(await cache.getMissing(URL_A), null);
  assert.deepEqual(Object.keys(area.data).sort(), [`article:${URL_A}`, `info:${URL_A}`]);
});
