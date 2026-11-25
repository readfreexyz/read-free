// The settings page's saved articles (extension/options/): the words for them, and the page itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { memoryArea } = require('./fixtures.js');
const saved = require('../extension/options/saved.js');
const articleCache = require('../extension/src/cache.js');

const OPTIONS = path.join(__dirname, '../extension/options');
const NOW = new Date(2026, 10, 25, 9).getTime();
const hours = n => n * 3600 * 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const entry = (url, extra = {}) => ({ url, savedAt: NOW - hours(1), bytes: 46 * 1024, partial: false, title: '', ...extra });

test('rows: the title, or the address in words; the outlet, the day by the calendar, the size', () => {
  const rows = saved.rows([
    entry('https://www.nytimes.com/2026/11/24/us/iowa-lead-explosion.html', { title: 'An Explosion Is Coming' }),
    entry('https://www.wsj.com/politics/policy/some-story-about-things-948d6eb9', { savedAt: NOW - hours(10), partial: true }),
    entry('https://www.theatlantic.com/health/2026/11/skin-care/689523/', { savedAt: NOW - hours(24 * 5), bytes: 3 * 1024 * 1024 }),
    entry('https://www.ft.com/content/0a1b2c3d-0000-1111-2222-333344445555', { bytes: 10 }),
    entry('http://insecure.example/x-story'), entry('javascript:alert(1)'), entry('not an address'),
  ], { now: NOW, siteName: host => ({ 'www.nytimes.com': 'The New York Times' })[host] || null });
  assert.deepEqual(rows.map(r => [r.title, r.meta]), [
    ['An Explosion Is Coming', 'The New York Times · saved today · 46 KB'],
    ['Some story about things', 'wsj.com · saved yesterday · 46 KB · may be missing its end'],
    ['Skin care', 'theatlantic.com · saved 5 days ago · 3.0 MB'],
    ['www.ft.com', 'ft.com · saved today · 1 KB'],
  ]);
  assert.equal(saved.total([entry('a'), entry('b')]), '2 articles, 92 KB');
  assert.equal(saved.total([entry('a')]), '1 article, 46 KB');
});

test('a title is only ever text', () => {
  const { document } = new JSDOM('').window;
  const item = saved.build(document, { url: 'https://example.com/x', title: '<img src=x onerror=alert(1)>', meta: '<b>' }, () => {});
  assert.equal(item.querySelector('img, b'), null);
  assert.equal(item.querySelector('a').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(item.querySelector('a').rel, 'noopener noreferrer');
  assert.equal(item.querySelector('button').getAttribute('aria-label'), 'Remove <img src=x onerror=alert(1)>');
});

// The page, with the real HTML and scripts. saveFirst: how many articles are saved before it opens.
async function openPage({ saveFirst = 0 } = {}) {
  const listeners = [];
  const local = memoryArea();
  const raw = { set: local.set.bind(local), remove: local.remove.bind(local) };
  const tell = keys => { for (const fn of listeners) fn(Object.fromEntries(keys.map(k => [k, {}])), 'local'); };
  local.set = async items => { await raw.set(items); tell(Object.keys(items)); };
  local.remove = async keys => { await raw.remove(keys); tell([].concat(keys)); };
  const cache = articleCache.create(local);
  let at = Date.now() - 1000;
  const save = async n => {
    const stamped = articleCache.create(local, { now: () => ++at });
    await stamped.put(`https://www.nytimes.com/2026/11/24/us/story-number-${n}.html`, { blocks: [], snapshotUrl: 'https://archive.ph/x', snapshotTime: 1 }, { title: `Story ${n}` });
  };
  for (let n = 1; n <= saveFirst; n++) await save(n);
  const html = fs.readFileSync(path.join(OPTIONS, 'options.html'), 'utf8');
  const { window } = new JSDOM(html, { url: 'https://options.test/options/options.html', runScripts: 'outside-only', pretendToBeVisual: true });
  window.chrome = {
    runtime: { getManifest: () => ({ version: '1.0.0', content_scripts: [], host_permissions: [] }), getURL: p => p, openOptionsPage: () => {} },
    storage: { local, sync: memoryArea(), onChanged: { addListener: fn => listeners.push(fn) } },
  };
  window.TextEncoder = TextEncoder;
  for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) {
    window.eval(fs.readFileSync(path.join(OPTIONS, src), 'utf8'));
    if (src.endsWith('ui/sites.js')) window.eval("NYTFix.ui.loadSites = async () => ({ nyt: { id: 'nyt', name: 'The New York Times', hosts: ['www.nytimes.com'], live: {} } });");
  }
  const $ = id => window.document.getElementById(id);
  const titles = () => [...$('saved-list').querySelectorAll('a')].map(a => a.textContent);
  for (let i = 0; i < 100 && !/^(?:No saved articles|Clear all \()/.test($('clear').textContent); i++) await sleep(10);
  return { window, $, titles, save, cache, close: () => window.close() };
}

test('the page lists what is saved, newest first, and keeps up while it is open', async () => {
  const page = await openPage();
  try {
    assert.deepEqual(page.titles(), []);
    assert.equal(page.$('clear').textContent, 'No saved articles');
    assert.equal(page.$('clear').disabled, true);
    await page.save(1);
    await page.save(2);
    await sleep(250);
    assert.deepEqual(page.titles(), ['Story 2', 'Story 1']);
    assert.equal(page.$('saved-count').textContent, '2');
    assert.match(page.$('clear').textContent, /^Clear all \(2 articles, \d+ KB\)$/);
    assert.equal(page.$('clear').disabled, false);
    assert.match(page.$('saved-list').querySelector('.saved-meta').textContent, /^The New York Times · saved today · /);
    assert.equal(page.$('saved-list').querySelector('a').href, 'https://www.nytimes.com/2026/11/24/us/story-number-2.html');
  } finally {
    page.close();
  }
});

test('Remove takes one off and leaves the keyboard on the next; Clear all takes the rest', async () => {
  const page = await openPage({ saveFirst: 3 });
  try {
    const removeOf = title => [...page.$('saved-list').children].find(li => li.textContent.includes(title)).querySelector('button');
    const button = removeOf('Story 2');
    button.focus();
    button.click();
    await sleep(300); // and the redraw that the change itself brings
    assert.deepEqual(page.titles(), ['Story 3', 'Story 1']);
    assert.equal(page.window.document.activeElement, removeOf('Story 1'));
    assert.equal((await page.cache.list()).length, 2);
    page.$('clear').click();
    await sleep(300);
    assert.deepEqual(page.titles(), []);
    assert.equal(page.$('clear').textContent, 'No saved articles');
    assert.deepEqual(await page.cache.list(), []);
  } finally {
    page.close();
  }
});

test('the last one removed: the keyboard goes to the heading, not nowhere', async () => {
  const page = await openPage({ saveFirst: 1 });
  try {
    const button = page.$('saved-list').querySelector('button');
    button.focus();
    button.click();
    await sleep(300);
    assert.equal(page.window.document.activeElement, page.$('saved-title'));
  } finally {
    page.close();
  }
});

test('ten at first, the rest on request', async () => {
  const page = await openPage({ saveFirst: 13 });
  try {
    assert.equal(page.titles().length, 10);
    assert.equal(page.$('saved-more').hidden, false);
    assert.equal(page.$('saved-more').textContent, 'Show all 13');
    page.$('saved-more').click();
    await sleep(100);
    assert.equal(page.titles().length, 13);
    assert.equal(page.titles()[12], 'Story 1');
    assert.equal(page.$('saved-more').hidden, true);
  } finally {
    page.close();
  }
});
