// The site's front page (website/index.html): its outlets are the extension's live sites, it loads
// nothing from elsewhere, its link-preview picture is beside it, its script is the one its CSP
// allows, tools/release.sh fills each of its fields, its install command follows the address
// it's served from only when that's plain, and each visitor sees one way at a time (which shows is
// worked out from the page's own CSS).
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

test('Firefox: its part, with its file, and the words; or none of it in a release for Chrome alone', () => {
  const words = d => d.querySelector('.lede').textContent.replace(/\s+/g, ' ');
  const withIt = new JSDOM(variant('chrome-only')).window.document;
  assert.equal(withIt.querySelector('section[data-for="firefox"] a.download').getAttribute('href'), '{{xpi}}');
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

// Which parts of the page show, by the page's own CSS: the selectors in its @supports block
const HIDES = PAGE.match(/@supports selector\(:has\(a\)\) \{([\s\S]*?)\n    \}/)[1].match(/main:has[\s\S]*?(?= \{)/)[0].split(',\n').map(s => s.trim());
const shows = el => !HIDES.some(hides => el.closest(hides)) && !el.closest('.all') && !el.closest('[hidden]');
const shown = (doc, selector) => [...doc.querySelectorAll(selector)].filter(shows);
// What a section says, as shown (closed details too)
const said = (doc, selector) => {
  const copy = doc.querySelector(selector).cloneNode(true);
  const all = [...doc.querySelector(selector).querySelectorAll('*')];
  [...copy.querySelectorAll('*')].map((el, i) => [el, all[i]]).filter(([, was]) => !shows(was)).forEach(([el]) => el.remove());
  return copy.textContent.replace(/\s+/g, ' ').trim();
};
const AGENTS = {
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:160.0) Gecko/20100101 Firefox/160.0',
  firefoxWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:160.0) Gecko/20100101 Firefox/160.0',
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
  chromeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
  edgeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0',
  chromeLinux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
  chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
  safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15',
  firefoxAndroid: 'Mozilla/5.0 (Android 15; Mobile; rv:160.0) Gecko/160.0 Firefox/160.0',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
};
const visit = (page, agent, hash = '') => new JSDOM(page, {
  url: `https://site.example/${hash}`, runScripts: agent ? 'dangerously' : undefined,
  beforeParse(win) { if (agent) Object.defineProperty(win.navigator, 'userAgent', { value: AGENTS[agent] }); },
}).window.document;
const picked = d => ['system', 'way'].map(name => [...d.querySelectorAll(`input[name="${name}"]:checked`)].map(r => r.id).join());
const choose = (d, id) => { d.getElementById(id).checked = true; return d; };

test("the visitor's browser and computer, picked for them", () => {
  const withIt = variant('chrome-only');
  const without = variant('firefox');
  const system = (page, agent) => picked(visit(page, agent))[0];
  assert.equal(system(withIt), 'mac', 'without the script');
  assert.equal(system(withIt, 'chromeMac'), 'mac');
  for (const agent of ['chromeWindows', 'edgeWindows']) assert.equal(system(withIt, agent), 'windows', agent);
  assert.equal(system(withIt, 'chromeLinux'), 'linux');
  assert.equal(system(withIt, 'chromebook'), 'chromebook');
  for (const agent of ['firefoxMac', 'firefoxWindows']) assert.equal(system(withIt, agent), 'firefox', agent);
  for (const agent of ['firefoxAndroid', 'chromeAndroid', 'iphone']) assert.equal(system(withIt, agent), 'mac', `${agent}: as it is in the page`);
  assert.equal(system(without, 'firefoxWindows'), 'windows', 'no Firefox to pick');
  // The way that updates itself, first
  for (const agent of [undefined, ...Object.keys(AGENTS)]) assert.equal(picked(visit(withIt, agent))[1], 'way-line');
  // A choice made before is the browser's to bring back (on Back): nothing here stops it, and
  // the script doesn't pick over it
  assert.equal(visit(withIt).querySelectorAll('input[autocomplete]').length, 0);
  assert.equal(system(withIt.replace('<script>', "<script>document.getElementById('linux').checked = true;</script><script>"), 'chromeWindows'), 'linux');
  // Safari runs neither
  for (const agent of Object.keys(AGENTS)) assert.equal(visit(withIt, agent).getElementById('safari').hidden, agent !== 'safari', agent);
});

test('two ways, one or the other: the choice says so, and only the chosen one shows', () => {
  const page = variant('chrome-only');
  for (const [system, agent] of [['mac', 'chromeMac'], ['windows', 'chromeWindows'], ['linux', 'chromeLinux'], ['mac', undefined]]) {
    const d = visit(page, agent);
    assert.match(said(d, '.choice'), /^There are two ways\. Choose one: .* or Download a file/, system);
    assert.equal(shown(d, '.choice input[type="radio"]').length, 2);
    for (const [way, other] of [['line', 'file'], ['file', 'line']]) {
      choose(d, `way-${way}`);
      assert.ok(shown(d, `[data-way="${way}"]`).length >= 2, `${system}, ${way}: getting it and adding it`);
      assert.deepEqual(shown(d, `[data-way="${other}"]`), [], `${system}, ${way}: nothing of the other way`);
      assert.equal(shown(d, '.command').length, way === 'line' ? 1 : 0, `${system}, ${way}: one command or none`);
      assert.equal(shown(d, 'a.download[href="{{zip}}"]').length, way === 'file' ? 1 : 0, `${system}, ${way}: one download or none`);
      // Adding it to Chrome names the folder that way gives, and only that one
      const add = said(d, 'section[aria-labelledby="load"]');
      const folder = { line: system === 'linux' ? /read-free\/extension/ : /the window with the extension folder/, file: /Choose the Read Free folder in Documents/ };
      assert.match(add, folder[way], `${system}, ${way}`);
      assert.doesNotMatch(add, folder[other], `${system}, ${way}`);
    }
  }
  // A Chromebook has one way, whichever was picked before
  const chromebook = visit(page, 'chromebook');
  for (const way of ['way-line', 'way-file']) {
    choose(chromebook, way);
    assert.deepEqual(shown(chromebook, '.choice'), []);
    assert.deepEqual(shown(chromebook, '[data-way="line"]'), []);
    assert.equal(shown(chromebook, 'a.download[href="{{zip}}"]').length, 1);
  }
  // In a browser that shows everything, the second way's heading says "or" too
  assert.deepEqual([...visit(page).querySelectorAll('h3')].map(h => h.textContent), ['The first way: Paste one line', 'Or the second way: Download a file']);
  // So does each way's step for adding it to Chrome
  for (const li of visit(page).querySelectorAll('#load ~ .card > .steps > li[data-way]')) {
    assert.match(li.querySelector('.all').textContent, li.dataset.way === 'line' ? /^If you pasted the line/ : /^Or, if you downloaded the file/);
  }
  // Where one shows, its steps are under the way's own name
  assert.deepEqual(shown(choose(visit(page), 'way-file'), 'h3').map(h => h.lastChild.textContent), ['Download a file']);
});

test("each computer's own steps, and none of another's", () => {
  const page = variant('chrome-only');
  const WORDS = { mac: /Terminal|Finder|Command/, windows: /PowerShell|File Explorer|Extract All|Windows key/, linux: /On Linux|Open a terminal|Ctrl and L/, chromebook: /Files app|My files/ };
  for (const system of ['mac', 'windows', 'linux', 'chromebook']) {
    for (const way of ['way-line', 'way-file']) {
      const d = choose(choose(visit(page), system), way);
      const words = said(d, 'section[aria-labelledby="get"]') + said(d, 'section[aria-labelledby="load"]');
      for (const [other, re] of Object.entries(WORDS)) if (other !== system) assert.doesNotMatch(words, re, `${system}, ${way}: nothing of ${other}'s`);
      assert.match(words, /Developer mode/);
      assert.doesNotMatch(words, /Add to Firefox/);
      // The key has one name there
      assert.doesNotMatch(words, system === 'mac' ? /\bEnter\b/ : /\bReturn\b/, system);
      // Every list of steps has some, in the order of the page
      for (const list of shown(d, '.steps')) assert.ok([...list.children].some(shows), `${system}, ${way}: no empty list`);
    }
  }
  // The zip unzips to a folder called Read Free, so nobody has to rename one
  for (const a of visit(page).querySelectorAll('a[href="{{zip}}"]')) assert.equal(a.getAttribute('download'), 'Read Free.zip');
});

test("in Firefox: its button, and none of Chrome's steps", () => {
  const page = variant('chrome-only');
  for (const agent of ['firefoxMac', 'firefoxWindows']) {
    const d = visit(page, agent);
    assert.deepEqual(shown(d, 'main section').map(s => s.getAttribute('aria-labelledby')), ['add', 'done', 'updates', 'outlets']);
    assert.equal(shown(d, 'a.download').length, 1);
    assert.doesNotMatch(said(d, 'main section[aria-labelledby="updates"]'), /download/);
    assert.ok(!d.getElementById('installed').closest('[data-for]'), 'where Read Free says it is installed');
  }
  const chrome = visit(page, 'chromeMac');
  assert.deepEqual(shown(chrome, 'main section').map(s => s.getAttribute('aria-labelledby')), ['get', 'load', 'done', 'updates', 'outlets']);
  // Every part named there is on the page
  for (const d of [chrome, visit(variant('firefox'))]) for (const s of d.querySelectorAll('section')) assert.ok(d.getElementById(s.getAttribute('aria-labelledby')), s.getAttribute('aria-labelledby'));
});

test('links to a part of the page: the installers open #load, the extension links to #update', () => {
  const page = variant('chrome-only');
  // After the installer: Chrome's steps for the folder it made
  for (const [agent, system] of [['chromeMac', 'mac'], ['chromeWindows', 'windows'], ['firefoxWindows', 'windows'], ['firefoxMac', 'mac']]) {
    const d = visit(page, agent, '#load');
    assert.deepEqual(picked(d), [system, 'way-line'], agent);
    assert.ok(shows(d.getElementById('load')), agent);
  }
  // A copy loaded by hand: how to update it, open
  const open = (agent, hash) => visit(page, agent, hash).querySelector('#update details').open;
  assert.equal(open('chromeMac', '#update'), true);
  assert.equal(open('chromebook', '#update'), true);
  assert.equal(open('chromeMac', ''), false);
  assert.equal(open('chromeMac', '#load'), false);
  const update = visit(page, 'chromeWindows', '#update').querySelector('#update details');
  assert.ok(shows(update) && shows(update.querySelector('a[href="{{zip}}"]')));
  // A browser and computer by name
  assert.equal(picked(visit(page, 'chromeMac', '#windows'))[0], 'windows');
  assert.equal(picked(visit(page, 'chromeMac', '#firefox'))[0], 'firefox');
  assert.equal(picked(visit(page, 'firefoxMac', '#firefox'))[0], 'firefox');
  assert.equal(picked(visit(page, 'chromeMac', '#nothing'))[0], 'mac');
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
  // The folders the installers use (install.sh's and install.ps1's)
  for (const [id, path] of [['copy-path-mac', '~/Library/Application Support/Read Free/extension'], ['copy-path-win', '%LOCALAPPDATA%\\Read Free'], ['copy-path-linux', '~/.local/share/read-free/extension']]) {
    page.getElementById(id).click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(copied.at(-1), path);
  }
  page.defaultView.close();
});
