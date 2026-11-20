// src/site-mark.js, on Read Free's own site: the front page says Read Free is installed in this
// browser, and which version. Plain text into the page's placeholder; nothing on any other page;
// no globals (Chrome's strict mode would throw on one never declared, where jsdom makes it).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const settings = require('../extension/src/settings.js');

const ROOT = path.join(__dirname, '..');
const SCRIPT = fs.readFileSync(path.join(ROOT, 'extension', 'src', 'site-mark.js'), 'utf8');
const PAGE = fs.readFileSync(path.join(ROOT, 'website', 'index.html'), 'utf8').replace(/\{\{[a-z0-9]+\}\}/g, 'x');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json'), 'utf8'));

function run(html, url = 'https://readfree.xyz/') {
  const { window } = new JSDOM(html, { url, runScripts: 'outside-only' });
  window.chrome = { runtime: { getManifest: () => ({ version: '0.23.0' }) } };
  const before = new Set(Object.getOwnPropertyNames(window));
  window.eval(SCRIPT);
  const stray = Object.getOwnPropertyNames(window).filter(name => !before.has(name));
  return { doc: window.document, stray, close: () => window.close() };
}

test('the front page: "Read Free 0.23.0 is installed in this browser", shown', () => {
  const page = run(PAGE);
  const note = page.doc.getElementById('installed');
  assert.equal(note.textContent, '✓ Read Free 0.23.0 is installed in this browser.');
  assert.equal(note.hidden, false);
  assert.equal(note.children.length, 0, 'plain text');
  assert.deepEqual(page.stray, []);
  page.close();
});

test('any other page: left alone', () => {
  for (const html of ['<!doctype html><p>Older front page, no placeholder</p>', '<!doctype html><p id="installed" hidden>not ours</p>']) {
    const page = run(html);
    assert.equal(page.doc.body.innerHTML, new JSDOM(html).window.document.body.innerHTML, 'as parsed, untouched');
    assert.deepEqual(page.stray, []);
    page.close();
  }
});

test("it runs on Read Free's own addresses, and only there", () => {
  const entry = manifest.content_scripts.find(cs => cs.js.includes('src/site-mark.js'));
  assert.ok(entry, 'a content script entry');
  assert.deepEqual(entry.js, ['src/site-mark.js'], 'alone');
  assert.deepEqual(entry.matches, settings.RELEASE_URLS.map(url => `${url}*`), 'the release addresses (settings.RELEASE_URLS)');
});
