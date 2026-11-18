// The ways to give, from Read Free's site (src/donations.js), and the donation page that shows
// them (give/), with the network and chrome.storage stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const donations = require('../extension/src/donations.js');
const notify = require('../extension/src/notify.js');

const KOFI = { name: 'Ko-fi', href: 'https://ko-fi.com/readfree', note: 'Card, PayPal or Apple Pay' };
const LIBERAPAY = { name: 'Liberapay', href: 'https://liberapay.com/readfree', note: 'Weekly, monthly or yearly; no fee' };
const KOFI_EMBED = 'https://ko-fi.com/readfree/?hidefeed=true&widget=true&embed=true&preview=true';
const list = (...ways) => ({ v: 1, ways });

function memoryArea(data = {}) {
  return {
    data,
    async get(key) { return key in data ? { [key]: structuredClone(data[key]) } : {}; },
    async set(items) { Object.assign(data, structuredClone(items)); },
  };
}
const reply = (body, { status = 200 } = {}) => ({ ok: status < 400, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

test('a list keeps known donation services, as plain text', () => {
  assert.deepEqual(donations.normalize(list(KOFI, LIBERAPAY)), { ways: [KOFI, LIBERAPAY] });
  assert.deepEqual(donations.normalize(list({ name: '  Ko-fi\n', href: 'https://ko-fi.com/readfree' })).ways, [{ name: 'Ko-fi', href: 'https://ko-fi.com/readfree', note: '' }]);
  // Hidden direction and zero-width characters don't survive
  assert.equal(donations.normalize(list({ ...LIBERAPAY, name: 'Libera‮pay​' })).ways[0].name, 'Libera pay');
  for (const href of ['https://www.paypal.com/donate/?hosted_button_id=X', 'https://paypal.me/readfree', 'https://github.com/sponsors/readfree', 'https://opencollective.com/readfree', 'https://donate.stripe.com/abc'])
    assert.equal(donations.normalize(list({ name: 'X', href })).ways.length, 1, href);
});

test('anything else in a list is dropped', () => {
  const bad = [
    { name: 'Plain http', href: 'http://ko-fi.com/readfree' },
    { name: 'Script', href: 'javascript:alert(1)' },
    { name: 'Lookalike', href: 'https://ko-fi.com.evil.example/readfree' },
    { name: 'Unknown', href: 'https://evil.example/donate' },
    { name: 'Login', href: 'https://user:pass@ko-fi.com/readfree' },
    { name: 'Port', href: 'https://ko-fi.com:8443/readfree' },
    { name: 'Not sponsors', href: 'https://github.com/login' },
    { name: 'Not donate', href: 'https://www.paypal.com/signin' },
    { name: 'x'.repeat(40), href: 'https://liberapay.com/a' },
    { name: '', href: 'https://liberapay.com/b' },
    { name: 'Note', href: 'https://liberapay.com/c', note: { html: '<b>' } },
    { name: 'Long note', href: 'https://liberapay.com/d', note: 'x'.repeat(200) },
    { name: 'Inherited', href: 'https://constructor/x' },
    { name: 'Inherited too', href: 'https://__proto__/x' },
    null, 'Ko-fi',
  ];
  assert.deepEqual(donations.normalize(list(KOFI, ...bad, KOFI)).ways, [KOFI], 'and duplicates');
  const many = Array.from({ length: 9 }, (_, i) => ({ name: `Way ${i}`, href: `https://liberapay.com/way${i}` }));
  assert.equal(donations.normalize(list(...many)).ways.length, donations.LIMITS.ways);
});

test('an empty list pauses donations; a broken one is no list at all', () => {
  assert.deepEqual(donations.normalize(list()), { ways: [] });
  assert.equal(donations.normalize(list({ name: 'Unknown', href: 'https://evil.example/' })), null, 'ways listed, none usable');
  for (const raw of [null, 'x', [], { ways: [KOFI] }, { v: 2, ways: [KOFI] }, { v: 1, ways: 'Ko-fi' }]) assert.equal(donations.normalize(raw), null, JSON.stringify(raw));
});

test('the built-in list is TIP_URL, when it is a known service', () => {
  assert.deepEqual(donations.builtIn(), { ways: [{ name: 'Ko-fi', href: 'https://ko-fi.com/readfree', note: '' }] });
  assert.deepEqual(donations.builtIn(''), { ways: [] });
  assert.deepEqual(donations.builtIn('https://evil.example/'), { ways: [] });
});

test('only a Ko-fi page comes first in a panel, its embed built here; the rest are links', () => {
  assert.deepEqual(donations.view({ ways: [KOFI, LIBERAPAY] }), { panel: { ...KOFI, embed: KOFI_EMBED }, links: [LIBERAPAY], none: false });
  assert.deepEqual(donations.view({ ways: [LIBERAPAY, KOFI] }), { panel: null, links: [LIBERAPAY, KOFI], none: false }, 'the list decides which leads');
  assert.deepEqual(donations.view({ ways: [] }), { panel: null, links: [], none: true });
  assert.equal(donations.view({ ways: [{ ...KOFI, href: 'https://ko-fi.com/readfree/shop' }] }).panel, null, 'not a page Ko-fi frames');
});

test('refresh: the first address with a good list wins, and is kept', async () => {
  const area = memoryArea();
  const asked = [];
  const fetch = async (url, init) => {
    asked.push([url, init]);
    if (url === 'https://a.example/donate.json') throw new TypeError('offline');
    if (url === 'https://b.example/donate.json') return reply('not found', { status: 404 });
    if (url === 'https://c.example/donate.json') return reply('<html>parked</html>');
    return reply(list(LIBERAPAY, KOFI));
  };
  const urls = ['a', 'b', 'c', 'd'].map(h => `https://${h}.example/donate.json`);
  assert.deepEqual(await donations.refresh(area, urls, { fetch, now: 42 }), { ways: [LIBERAPAY, KOFI] });
  assert.equal(asked.length, 4);
  assert.deepEqual(area.data.donations, { ways: [LIBERAPAY, KOFI], at: 42 });
  const init = asked[0][1];
  assert.equal(init.credentials, 'omit');
  assert.equal(init.cache, 'no-store');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.deepEqual(await donations.load(area, urls), { ways: [LIBERAPAY, KOFI] });
});

test('refresh: no good answer keeps the list it had', async () => {
  const area = memoryArea({ donations: { ways: [KOFI], at: 1 } });
  const answers = [reply('{ nope'), reply('x'.repeat(donations.LIMITS.bytes + 1)), reply(list({ name: 'Evil', href: 'https://evil.example/' })), reply(list(KOFI), { status: 500 })];
  for (const answer of answers) assert.equal(await donations.refresh(area, ['https://a.example/d.json'], { fetch: async () => answer }), null);
  assert.equal(await donations.refresh(area, [], { fetch: async () => assert.fail('no address, no request') }), null);
  // Too slow: given up on
  const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  assert.equal(await donations.refresh(area, ['https://a.example/d.json'], { fetch: hang, timeoutMs: 20 }), null);
  assert.deepEqual(area.data.donations, { ways: [KOFI], at: 1 });
});

test('load: only a good kept list, and only while there is an address to get one from', async () => {
  const urls = ['https://readfree.example/donate.json'];
  assert.equal(await donations.load(memoryArea(), urls), null);
  assert.deepEqual(await donations.load(memoryArea({ donations: { ways: [] } }), urls), { ways: [] }, 'paused');
  assert.equal(await donations.load(memoryArea({ donations: { ways: 'x' } }), urls), null);
  assert.equal(await donations.load({ get: async () => { throw new Error('gone'); } }, urls), null);
  assert.equal(await donations.load(memoryArea({ donations: { ways: [LIBERAPAY] } }), []), null, 'no address: back to the built-in link');
});

// The donation page, with its own scripts, chrome.storage and fetch stubbed.
const GIVE = path.join(__dirname, '..', 'extension', 'give');
async function openGive({ local = {}, urls = [], answer = null, months = {} } = {}) {
  const html = fs.readFileSync(path.join(GIVE, 'give.html'), 'utf8');
  const { window } = new JSDOM(html, { url: 'chrome-extension://abc/give/give.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const area = memoryArea(local);
  area.data.notify = { ...notify.fresh(), months };
  window.chrome = { storage: { local: area } };
  const asked = [];
  window.fetch = async url => { asked.push(url); return answer ? answer(url) : reply('', { status: 404 }); };
  const scripts = [...window.document.querySelectorAll('script[src]')].map(s => path.join(GIVE, s.getAttribute('src')));
  for (const file of scripts) {
    window.eval(fs.readFileSync(file, 'utf8'));
    if (file.endsWith('settings.js')) window.NYTFix.settings.DONATIONS_URLS = urls;
  }
  const doc = window.document;
  const start = Date.now();
  while (!(area.data.notify.donate.snoozeUntil > 0)) {
    if (Date.now() - start > 3000) throw new Error('the page never finished');
    await new Promise(r => setTimeout(r, 10));
  }
  await new Promise(r => setTimeout(r, 30)); // the refresh, if any
  const $ = id => doc.getElementById(id);
  const shown = id => !$(id).hidden;
  return { window, doc, $, shown, area, asked, links: id => [...$(id).querySelectorAll('a.way')].map(a => [a.querySelector('.way-name').textContent, a.href]) };
}
const tallied = () => ({ [notify.monthOf(Date.now())]: { nyt: { read: 9, paid: 9 } } });

test('give page: the built-in Ko-fi panel, with nothing set up', async () => {
  const page = await openGive();
  assert.equal(page.$('title').textContent, 'Keep Read Free alive');
  assert.ok(page.shown('tip-step') && page.shown('panel') && page.shown('fallback'));
  assert.ok(!page.shown('aid-step') && !page.shown('ways') && !page.shown('others') && !page.shown('paused'));
  assert.equal(page.$('kofi').getAttribute('src'), KOFI_EMBED);
  assert.match(page.$('privacy').textContent, /^Ko‑fi's panel loads only on this page/);
  assert.deepEqual(page.asked, [], 'no address set: no request');
});

test('give page: a kept list without Ko-fi shows links, and no frame', async () => {
  const page = await openGive({ local: { donations: { ways: [LIBERAPAY, { name: 'PayPal', href: 'https://paypal.me/readfree' }] } }, urls: ['https://readfree.example/donate.json'], months: tallied() });
  assert.ok(page.doc.body.classList.contains('two-steps'));
  assert.ok(page.shown('aid-step') && page.shown('ways') && !page.shown('panel'));
  assert.equal(page.$('tip-head').textContent, 'Some of it: Read Free');
  assert.deepEqual(page.links('ways'), [['Liberapay', 'https://liberapay.com/readfree'], ['PayPal', 'https://paypal.me/readfree']]);
  assert.equal(page.$('kofi').getAttribute('src'), null);
  assert.equal(page.$('ways').querySelector('a').rel, 'noopener noreferrer');
});

test('give page: the site’s current list replaces the kept one', async () => {
  const urls = ['https://readfree.example/donate.json'];
  const page = await openGive({ local: { donations: { ways: [KOFI] } }, urls, answer: () => reply(list(KOFI, LIBERAPAY)) });
  assert.deepEqual(page.asked, urls);
  assert.ok(page.shown('panel') && page.shown('others'));
  assert.deepEqual(page.links('others-list'), [['Liberapay', 'https://liberapay.com/readfree']]);
  assert.match(page.$('privacy').textContent, /This list comes from Read Free's website/);
  assert.deepEqual(page.area.data.donations.ways, [KOFI, LIBERAPAY]);
});

test('give page: without an address, a kept list is ignored', async () => {
  const page = await openGive({ local: { donations: { ways: [LIBERAPAY] } } });
  assert.equal(page.$('kofi').getAttribute('src'), KOFI_EMBED);
  assert.ok(!page.shown('ways'));
});

test('give page: an unreachable site leaves the kept list up', async () => {
  const page = await openGive({ local: { donations: { ways: [LIBERAPAY] } }, urls: ['https://readfree.example/donate.json'], answer: () => { throw new TypeError('offline'); } });
  assert.deepEqual(page.links('ways'), [['Liberapay', 'https://liberapay.com/readfree']]);
});

test('give page: donations paused, UNRWA alone', async () => {
  const urls = ['https://readfree.example/donate.json'];
  const page = await openGive({ urls, answer: () => reply(list()) });
  assert.equal(page.$('title').textContent, "Read Free isn't taking donations right now");
  assert.ok(!page.shown('tip-step') && page.shown('paused') && page.shown('paused-aid') && !page.shown('paused-text'));
  assert.equal(page.$('paused-aid').href, 'https://www.unrwa.org/donate');
  assert.equal(page.$('kofi').getAttribute('src'), 'about:blank', 'the built-in panel it started with is closed');

  const withTally = await openGive({ urls, answer: () => reply(list()), months: tallied() });
  assert.match(withTally.$('title').textContent, /^Put the \$\d+ to work$/);
  assert.ok(withTally.shown('aid-step') && withTally.shown('paused-text') && !withTally.shown('paused-aid'));
  assert.ok(!withTally.doc.body.classList.contains('two-steps'), 'no step numbers for one step');
});
