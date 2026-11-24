// The toolbar menu (extension/popup/): what it says about a tab, and the supported sites it knows.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe } = require('../extension/popup/view.js');
const ui = require('../extension/ui/sites.js');
const settings = require('../extension/src/settings.js');

const EXT = path.join(__dirname, '../extension');
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
require('../extension/src/adapter.js');
for (const file of ui.adapterFiles(manifest)) require(path.join(EXT, file));
const sites = globalThis.NYTFix.sites;

const ON = settings.normalize({});
const url = href => new URL(href);
const nyt = sites.nyt;

test('adapterFiles: every sites/*.js the manifest loads, once each; siteForHost finds them by host', () => {
  const files = ui.adapterFiles(manifest);
  assert.equal(new Set(files).size, files.length);
  assert.ok(files.includes('sites/nyt.js') && files.includes('sites/nine.js'));
  assert.ok(!files.some(f => f.startsWith('page/')), 'page-world guards are not adapters');
  // As Firefox's getManifest() gives them
  const firefox = { content_scripts: manifest.content_scripts.map(cs => ({ ...cs, js: cs.js.map(f => `moz-extension://98b3fa72-ba0c-41df-8c94-96f3ffef86f5/${f}`) })) };
  assert.deepEqual(ui.adapterFiles(firefox), files);
  assert.equal(ui.siteForHost(sites, 'www.nytimes.com').id, 'nyt');
  assert.equal(ui.siteForHost(sites, 'www.smh.com.au').id, 'smh');
  assert.equal(ui.siteForHost(sites, 'milano.corriere.it').id, 'corriere', "'*.' hosts");
  assert.equal(ui.siteForHost(sites, 'example.com'), null);
  assert.equal(ui.siteForHost(sites, 'nytimes.com.example.com'), null);
});

test('an unsupported site, or a page that is not on the web', () => {
  const other = describe({ url: url('https://www.example.com/a'), site: null, page: null, prefs: ON });
  assert.equal(other.title, 'example.com');
  assert.match(other.text, /Not one of the news sites/);
  assert.equal(other.action, null);
  assert.equal(describe({ url: url('chrome://extensions/'), site: null, page: null, prefs: ON }).title, 'This page');
});

test('what the wall did on this page, and the button that goes with it', () => {
  const at = page => describe({ url: url('https://www.nytimes.com/2026/11/14/us/x.html'), site: nyt, page, prefs: ON });
  const swapped = at({ state: 'applied', mark: 'swapped' });
  assert.equal(swapped.title, 'The New York Times');
  assert.equal(swapped.sub, 'nytimes.com');
  assert.equal(swapped.tone, 'ok');
  assert.match(swapped.text, /from archive\.today/);
  assert.deepEqual(swapped.action, { id: 'toggle', label: "Show the site's version", primary: false });
  assert.match(at({ state: 'applied', mark: 'lifted' }).text, /already on the page/);
  assert.equal(at({ state: 'loading' }).tone, 'working');
  assert.equal(at({ state: 'loading' }).action, null, 'nothing to press while it loads');
  assert.deepEqual(at({ state: 'idle', restored: true }).action, { id: 'toggle', label: 'Remove the wall', primary: true });
  assert.equal(at({ state: 'idle' }).action.label, 'Load from archive.today');
  assert.equal(at({ state: 'not-article' }).action, null);
  assert.deepEqual(at(null).action, { id: 'reload', label: 'Reload page', primary: true }, 'no content script: open before install');
});

test('off on this site, off everywhere, and reloading after a switch', () => {
  const at = (prefs, page = { state: 'off' }, reloading = false) => describe({ url: url('https://www.nytimes.com/x'), site: nyt, page, prefs, reloading });
  const siteOff = at(settings.normalize({ disabledSites: ['nyt'] }));
  assert.equal(siteOff.tone, 'off');
  assert.match(siteOff.text, /Off on this site/);
  assert.equal(siteOff.action, null);
  assert.match(at(settings.normalize({ enabled: false })).text, /Off on all sites/);
  assert.match(at(ON, { state: 'off' }).text, /Reload the page/, 'turned back on since the page loaded');
  assert.equal(at(ON, null, true).tone, 'working');
  assert.match(at(ON, null, true).text, /Reloading/);
});
