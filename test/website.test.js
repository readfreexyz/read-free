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
  for (const script of without.querySelectorAll('script')) script.remove();
  assert.ok(!/firefox|xpi/i.test(without.body.textContent));
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

test("only what's for the visitor's browser and system is shown; the rest in a closed section, all of it there", () => {
  const AGENTS = {
    firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:160.0) Gecko/20100101 Firefox/160.0',
    firefoxWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:160.0) Gecko/20100101 Firefox/160.0',
    chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
    chromeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
    chromeLinux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
    chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
    firefoxAndroid: 'Mozilla/5.0 (Android 15; Mobile; rv:160.0) Gecko/160.0 Firefox/160.0',
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
  };
  const open = (page, agent, hash = '') => new JSDOM(page, {
    url: `https://site.example/${hash}`, runScripts: agent ? 'dangerously' : undefined,
    beforeParse(win) { if (agent) Object.defineProperty(win.navigator, 'userAgent', { value: agent }); },
  }).window.document;
  // Each card, with "+" when it goes across; those in the closed section in brackets
  const names = cards => [...cards].map(c => c.id + (c.classList.contains('wide') ? '+' : '')).join(' ');
  const order = (page, agent) => {
    const doc = open(page, agent);
    const more = doc.querySelector('.ways > details');
    if (more) assert.equal(more.open, false, 'closed');
    return names(doc.querySelectorAll('main .ways:not(details .ways) > .card')) + (more ? ` (${names(more.querySelectorAll('.ways > .card'))})` : '');
  };
  const withIt = variant('chrome-only');
  const plain = 'mac windows firefox update';
  assert.equal(order(withIt), plain, 'without the script: everything shows, Firefox after Chrome');
  for (const agent of ['firefoxMac', 'firefoxWindows']) assert.equal(order(withIt, AGENTS[agent]), 'firefox+ (mac windows update+)', agent);
  for (const agent of ['chromeMac', 'chromeLinux']) assert.equal(order(withIt, AGENTS[agent]), 'mac+ update+ (windows firefox)', agent);
  assert.equal(order(withIt, AGENTS.chromeWindows), 'windows+ update+ (mac firefox)');
  for (const agent of ['chromebook', 'firefoxAndroid', 'iphone']) assert.equal(order(withIt, AGENTS[agent]), plain, agent);
  // A release for Chrome alone
  const without = variant('firefox');
  assert.equal(order(without), 'mac windows update+');
  assert.equal(order(without, AGENTS.firefoxMac), 'mac windows update+', 'no Firefox card to show alone');
  assert.equal(order(without, AGENTS.chromeWindows), 'windows+ update+ (mac+)');
  // A link to a card opens the section it's in (the extension links to #update)
  const isOpen = (agent, hash) => open(withIt, AGENTS[agent], hash).querySelector('.ways > details').open;
  assert.equal(isOpen('firefoxMac', '#update'), true);
  assert.equal(isOpen('chromeMac', '#firefox'), true);
  assert.equal(isOpen('chromeMac', '#update'), false, 'shown already');
  assert.equal(isOpen('chromeMac', '#load'), false);
  // Step 2 is Chrome's: in Firefox it goes with Chrome's cards, and Firefox's own card keeps the
  // line that says Read Free is installed
  const step2 = d => d.getElementById('load').closest('section');
  const firefox = open(withIt, AGENTS.firefoxMac);
  assert.ok(step2(firefox).closest('details'), 'in the closed section');
  assert.equal(firefox.getElementById('installed').closest('.card').id, 'firefox');
  assert.equal(firefox.getElementById('installed').hidden, true, 'the extension shows it');
  assert.equal(firefox.getElementById('chrome-step').hidden, true);
  assert.equal(firefox.querySelector('#get .number').hidden, true, 'no lone 1');
  assert.equal(isOpen('firefoxMac', '#load'), true);
  for (const d of [open(withIt, AGENTS.chromeMac), open(withIt, AGENTS.iphone), open(withIt), open(without, AGENTS.firefoxMac)]) {
    assert.equal(step2(d).closest('details'), null);
    assert.ok(step2(d).contains(d.getElementById('installed')));
    assert.equal(d.getElementById('chrome-step')?.hidden ?? false, false);
  }
  // The commands and Copy buttons work wherever their card is
  const doc = open(withIt, AGENTS.chromeMac);
  assert.ok(doc.querySelector('details #command-win') && doc.querySelector('#command'));
});

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
  // The address of Chrome's own page: the same from a mirror
  const copyExt = page.getElementById('copy-ext');
  assert.equal(copyExt.hidden, false);
  assert.equal(load('https://mirror.example/').getElementById('copy-ext').hidden, true);
  copyExt.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(copied[2], 'chrome://extensions');
  page.defaultView.close();
});
