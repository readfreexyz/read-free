const test = require('node:test');
const assert = require('node:assert/strict');
const archive = require('../extension/src/archive.js');
const { TIMEMAP } = require('./fixtures.js');

test('newestFirst takes the newest few mementos, newest first', () => {
  const m = [1, 2, 3, 4, 5].map(time => ({ url: `u${time}`, time }));
  assert.deepEqual(archive.newestFirst(m, 3).map(x => x.time), [5, 4, 3]);
  assert.deepEqual(archive.newestFirst(m.slice(0, 2), 3).map(x => x.time), [2, 1]);
});

test('timemapUrl and searchUrl use the mirror and the raw article URL', () => {
  const url = 'https://www.nytimes.com/2026/11/14/world/x.html';
  assert.equal(archive.timemapUrl(url), `https://archive.ph/timemap/${url}`);
  assert.equal(archive.timemapUrl(url, 'archive.is'), `https://archive.is/timemap/${url}`);
  assert.equal(archive.searchUrl(url), `https://archive.ph/${url}`);
});

test('parseTimemap reads the real timemap shape', () => {
  const mementos = archive.parseTimemap(TIMEMAP);
  assert.equal(mementos.length, 1);
  assert.equal(mementos[0].url, 'http://archive.md/20261114050535/https://www.nytimes.com/2026/11/14/world/europe/test-article.html');
  assert.equal(mementos[0].time, Date.UTC(2026, 10, 14, 5, 5, 35));
});

test('parseTimemap sorts mementos oldest first and skips non-mementos', () => {
  const text = [
    '<https://www.nytimes.com/a.html>; rel="original"',
    '<http://archive.md/20261114120000/https://www.nytimes.com/a.html>; rel="last memento"; datetime="Sat, 14 Nov 2026 12:00:00 GMT"',
    '<http://archive.md/20261113080000/https://www.nytimes.com/a.html>; rel="first memento"; datetime="Fri, 13 Nov 2026 08:00:00 GMT"',
    '<http://archive.md/20261114010000/https://www.nytimes.com/a.html>; rel="memento"; datetime="Sat, 14 Nov 2026 01:00:00 GMT"',
  ].join(',\n');
  const times = archive.parseTimemap(text).map(m => new Date(m.time).toISOString());
  assert.deepEqual(times, ['2026-11-13T08:00:00.000Z', '2026-11-14T01:00:00.000Z', '2026-11-14T12:00:00.000Z']);
});

test('parseTimemap returns [] for an empty or non-timemap body', () => {
  assert.deepEqual(archive.parseTimemap(''), []);
  assert.deepEqual(archive.parseTimemap('<html><body>No results</body></html>'), []);
});

test('toMirror rewrites http://archive.md mementos to https on the chosen mirror', () => {
  const m = 'http://archive.md/20261114050535/https://www.nytimes.com/2026/11/14/world/x.html';
  assert.equal(archive.toMirror(m), 'https://archive.ph/20261114050535/https://www.nytimes.com/2026/11/14/world/x.html');
  assert.equal(archive.toMirror(m, 'archive.is'), 'https://archive.is/20261114050535/https://www.nytimes.com/2026/11/14/world/x.html');
});

test('isArchiveUrl only allows https archive.today mirrors', () => {
  assert.equal(archive.isArchiveUrl('https://archive.ph/timemap/https://www.nytimes.com/x.html'), true);
  assert.equal(archive.isArchiveUrl('https://archive.md/20261114050535/https://www.nytimes.com/x.html'), true);
  assert.equal(archive.isArchiveUrl('http://archive.ph/x'), false);
  assert.equal(archive.isArchiveUrl('https://archive.ph.evil.example/x'), false);
  assert.equal(archive.isArchiveUrl('https://evil.example/https://archive.ph/'), false);
  assert.equal(archive.isArchiveUrl('not a url'), false);
});

test('looksBlocked spots rate limits and CAPTCHA pages but not big snapshots', () => {
  assert.equal(archive.looksBlocked(429, ''), 'rate-limited');
  assert.equal(archive.looksBlocked(200, '<html><form id="captcha"><div class="g-recaptcha"></div></form></html>'), 'captcha');
  assert.equal(archive.looksBlocked(200, 'captcha ' + 'x'.repeat(300000)), null);
  assert.equal(archive.looksBlocked(200, '<html>an ordinary page</html>'), null);
});

test('newestUrl asks the chosen mirror for the newest snapshot', () => {
  assert.equal(archive.newestUrl('https://www.theatlantic.com/x/1/'), 'https://archive.ph/newest/https://www.theatlantic.com/x/1/');
  assert.equal(archive.newestUrl('https://www.ft.com/content/x', 'archive.is'), 'https://archive.is/newest/https://www.ft.com/content/x');
});

test("mementoAt reads a snapshot's time from its address, and only from an archive.today one", () => {
  const url = 'https://archive.ph/20261112214313/https://www.theatlantic.com/international/2026/11/x/689417/';
  assert.deepEqual(archive.mementoAt(url), { url, time: Date.UTC(2026, 10, 12, 21, 43, 13) });
  assert.equal(archive.mementoAt('https://archive.ph/newest/https://www.theatlantic.com/x/1/'), null, 'the lookup URL itself');
  assert.equal(archive.mementoAt('https://archive.ph/CYVvk'), null, 'a short link');
  assert.equal(archive.mementoAt('https://evil.example/20261112214313/https://www.theatlantic.com/x/1/'), null);
  assert.equal(archive.mementoAt('http://archive.ph/20261112214313/https://www.theatlantic.com/x/1/'), null, 'https only');
  assert.equal(archive.mementoAt('not a url'), null);
});
