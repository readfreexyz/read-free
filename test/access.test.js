// src/access.js: the addresses Firefox hasn't let Read Free work on.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const access = require('../extension/src/access.js');
const { memoryArea } = require('./fixtures.js');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../extension/manifest.json'), 'utf8'));
const gecko = { browser_specific_settings: { gecko: { id: 'read-free@readfree.xyz' } } };
const api = (off, m = { ...manifest, ...gecko }) => ({ runtime: { getManifest: () => m }, permissions: { contains: async ({ origins }) => origins.every(o => !off.includes(o)) } });

test("wanted: every address in the manifest once, but Read Free's own sites", () => {
  const list = access.wanted(manifest);
  assert.equal(new Set(list).size, list.length);
  for (const origin of ['https://archive.ph/*', 'https://www.nytimes.com/*', 'https://cooking.nytimes.com/*', 'https://*.corriere.it/*']) assert.ok(list.includes(origin), origin);
  assert.ok(!list.some(o => /readfree/.test(o)));
});

test('missing: what Firefox has not granted; nothing in Chrome, or when it cannot say', async () => {
  const off = ['https://cooking.nytimes.com/*', 'https://archive.fo/*'];
  assert.deepEqual((await access.missing(api(off))).sort(), [...off].sort());
  assert.deepEqual(await access.missing(api([])), []);
  assert.deepEqual(await access.missing(api(off, manifest)), [], 'Chrome');
  assert.deepEqual(await access.missing({ ...api(off), permissions: undefined }), []);
  assert.deepEqual(await access.missing({ ...api(off), permissions: { contains: async () => { throw new Error('no'); } } }), []);
});

test('unseen: not those the reader has been told about', async () => {
  const area = memoryArea();
  const list = ['https://a.example/*', 'https://b.example/*'];
  assert.deepEqual(await access.unseen(list, area), list);
  await access.see(['https://a.example/*'], area);
  assert.deepEqual(await access.unseen(list, area), ['https://b.example/*']);
  assert.deepEqual(await access.unseen([], area), []);
});

test('names: hosts, without www., the first few', () => {
  const of = (...hosts) => access.names(hosts.map(h => `https://${h}/*`));
  assert.equal(of('cooking.nytimes.com'), 'cooking.nytimes.com');
  assert.equal(of('www.ft.com', '*.corriere.it'), 'ft.com and corriere.it');
  assert.equal(of('a.x', 'b.x', 'c.x', 'd.x'), 'a.x, b.x, c.x and d.x');
  assert.equal(of('a.x', 'b.x', 'c.x', 'd.x', 'e.x'), 'a.x, b.x, c.x and 2 more');
});
