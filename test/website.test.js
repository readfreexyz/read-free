// The site's front page (website/index.html): its outlets are the extension's live sites, it loads
// nothing from elsewhere, its link-preview picture is beside it, its script is the one its CSP
// allows, tools/release.sh fills each of its fields, and its install command follows the address
// it's served from only when that's plain.
// test/install.test.js checks a page release.sh built.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const ui = require('../extension/ui/sites.js');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const PAGE = fs.readFileSync(path.join(ROOT, 'website', 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
require('../extension/src/adapter.js');
for (const file of ui.adapterFiles(manifest)) require(path.join(EXT, file));

const doc = new JSDOM(PAGE).window.document;

test('the outlets: the extension\'s live sites, by name', () => {
  const listed = [...doc.querySelectorAll('#sites li')].map(li => li.textContent.trim());
  const live = Object.values(globalThis.NYTFix.sites).filter(s => s.live).sort(ui.byName).map(s => s.name);
  assert.deepEqual(listed, live);
});

test('one script, the one the CSP allows', () => {
  const scripts = [...PAGE.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.equal((PAGE.match(/<script/g) || []).length, 1);
  const sum = crypto.createHash('sha256').update(scripts[0][1]).digest('base64');
  const csp = doc.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
  assert.match(csp, /default-src 'none'/);
  assert.ok(csp.includes(`script-src 'sha256-${sum}'`), `the script's hash is now 'sha256-${sum}'`);
  // From outside, only Cloudflare's Web Analytics script (added to readfree.xyz by Cloudflare, not
  // in this file), reporting to the site itself. The footer says so.
  assert.deepEqual(csp.match(/https?:[^\s;]+/g), ['https://static.cloudflareinsights.com/beacon.min.js/']);
  assert.match(csp, /; connect-src 'self';/);
  assert.doesNotMatch(csp, /\*|script-src[^;]*'(self|unsafe-inline|unsafe-eval)'/);
  assert.match(doc.querySelector('footer').textContent, /Cloudflare, adds a script/);
  assert.doesNotMatch(scripts[0][1], /\{\{/, 'no release fields in the script: they would change its hash');
});

test('it loads nothing from elsewhere', () => {
  for (const el of doc.querySelectorAll('[src], link[href], iframe, object, embed')) {
    assert.match(el.getAttribute('src') || el.getAttribute('href') || '', /^data:/, el.outerHTML.slice(0, 80));
  }
  for (const url of PAGE.match(/url\([^)]*\)/g) || []) assert.match(url, /^url\("?data:/, url);
  assert.equal(doc.querySelector('meta[name="referrer"]').content, 'no-referrer');
});

test('link previews: og: tags with the site\'s address, and their picture beside the page', () => {
  const meta = property => doc.querySelector(`meta[property="${property}"]`)?.content;
  assert.equal(meta('og:url'), '{{site}}');
  assert.equal(meta('og:description'), doc.querySelector('meta[name="description"]').content);
  assert.equal(doc.querySelector('meta[name="twitter:card"]')?.content, 'summary_large_image');
  // Absolute (apps fetch it without the page), and in website/ itself: release.sh publishes
  // only that level
  const image = meta('og:image');
  assert.match(image || '', /^\{\{site\}\}[a-z0-9-]+\.png$/);
  const png = fs.readFileSync(path.join(ROOT, 'website', image.replace('{{site}}', '')));
  assert.equal(png.toString('latin1', 12, 16), 'IHDR');
  assert.equal(png.readUInt32BE(16), Number(meta('og:image:width')));
  assert.equal(png.readUInt32BE(20), Number(meta('og:image:height')));
  assert.ok(png.length < 300 * 1024, 'small enough for every app that shows previews');
});

test("the placeholder Read Free fills in once it's installed, and the link to its source", () => {
  const note = doc.getElementById('installed');
  assert.ok(note?.classList.contains('installed'), 'src/site-mark.js writes into #installed.installed');
  assert.equal(note.hidden, true, 'hidden until then');
  assert.equal(note.textContent, '');
  const repo = [...doc.querySelectorAll('a')].filter(a => a.getAttribute('href') === 'https://github.com/readfreexyz/read-free');
  assert.ok(repo.length >= 1, 'links the open-source repository');
});

test('tools/release.sh fills each of its fields', () => {
  const fields = new Set([...PAGE.matchAll(/\{\{([a-z0-9]+)\}\}/g)].map(m => m[1]));
  const release = fs.readFileSync(path.join(ROOT, 'tools', 'release.sh'), 'utf8');
  const filled = new Set([...release.matchAll(/s\|\{\{([a-z0-9]+)\}\}\|/g)].map(m => m[1]));
  assert.deepEqual([...fields].sort(), [...filled].sort());
});

// As tools/release.sh makes it, with and without a Firefox file
const variant = without => PAGE.split('\n').reduce(({ out, skip }, line) => {
  if (line.includes(`<!-- ${without} -->`)) return { out, skip: true };
  if (line.includes(`<!-- /${without} -->`)) return { out, skip: false };
  return { out: skip || /^ *<!-- \/?(firefox|chrome-only) -->$/.test(line) ? out : [...out, line], skip };
}, { out: [], skip: false }).out.join('\n');

test('Firefox: a card with its file, and the words; or none of it in a release for Chrome alone', () => {
  const words = d => d.querySelector('.lede').textContent.replace(/\s+/g, ' ');
  const withIt = new JSDOM(variant('chrome-only')).window.document;
  assert.equal(withIt.querySelector('#firefox a.download').getAttribute('href'), '{{xpi}}');
  assert.match(words(withIt), /Read Free is an extension for Chrome and Firefox on your computer that gets you past/);
  assert.match(withIt.querySelector('.phone').textContent.replace(/\s+/g, ' '), /works in Chrome or Firefox on a computer/);
  const without = new JSDOM(variant('firefox')).window.document;
  assert.equal(without.getElementById('firefox'), null);
  assert.match(words(without), /Read Free is a Chrome extension for your computer that gets you past/);
  assert.ok(!/firefox|xpi/i.test(without.documentElement.querySelector('body').textContent));
  for (const d of [withIt, without]) {
    assert.equal(d.querySelectorAll('meta[name="description"]').length, 1);
    assert.equal(d.querySelector('meta[property="og:description"]').content, d.querySelector('meta[name="description"]').content);
    assert.doesNotMatch(d.documentElement.innerHTML, /<!-- \/?(firefox|chrome-only) -->/);
  }
});

// The page as built for https://site.example/
const built = PAGE.replaceAll('{{site}}', 'https://site.example/').replace(/\{\{[a-z0-9]+\}\}/g, 'x');
const load = (url, clipboard) => new JSDOM(built, {
  url,
  runScripts: 'dangerously',
  beforeParse(window) { if (clipboard) Object.defineProperty(window.navigator, 'clipboard', { value: clipboard }); },
}).window.document;
const at = site => `curl -fsSLO ${site}install.sh && sh install.sh`;

test('the install command: from the address the page is served from, if that is plain https', () => {
  const command = url => load(url).getElementById('command').textContent;
  assert.equal(command('https://site.example/'), at('https://site.example/'));
  assert.equal(command('https://mirror.example/read-free/'), at('https://mirror.example/read-free/'));
  assert.equal(command('https://mirror.example/read-free/index.html?x=1#y'), at('https://mirror.example/read-free/'));
  assert.equal(command('https://mirror.example:8443/'), at('https://mirror.example:8443/'));
  // Anything else keeps the site's address: the text ends up in a shell
  for (const url of ['http://mirror.example/', 'https://mirror.example/a;curl%20x|sh;/', "https://mirror.example/a'b/", 'https://mirror.example/a$(x)/', 'https://mirror.example/other.html', 'file:///tmp/index.html']) {
    assert.equal(command(url), at('https://site.example/'), url);
  }
});

test("the Windows command: from the page's address too, only when that's plain", () => {
  const command = url => load(url).getElementById('command-win').textContent;
  const at = site => `irm ${site}install.ps1 -OutFile install.ps1; powershell -NoProfile -ExecutionPolicy Bypass -File .\\install.ps1`;
  assert.equal(command('https://site.example/'), at('https://site.example/'));
  assert.equal(command('https://mirror.example/read-free/'), at('https://mirror.example/read-free/'));
  for (const url of ['http://mirror.example/', "https://mirror.example/a'b/", 'https://mirror.example/a$(x)/']) assert.equal(command(url), at('https://site.example/'), url);
});

test('Copy: shown only with a clipboard, and copies the command', async () => {
  assert.equal(load('https://mirror.example/').getElementById('copy').hidden, true);
  const copied = [];
  const page = load('https://mirror.example/', { writeText: text => { copied.push(text); return Promise.resolve(); } });
  const copy = page.getElementById('copy');
  assert.equal(copy.hidden, false);
  copy.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(copied, [at('https://mirror.example/')]);
  assert.equal(copy.textContent, 'Copied');
  // The Windows command's own Copy button
  const copyWin = page.getElementById('copy-win');
  assert.equal(copyWin.hidden, false);
  copyWin.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(copied[1], /^irm https:\/\/mirror\.example\/install\.ps1 /);
  page.defaultView.close();
});
