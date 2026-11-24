// Read Free in Firefox (docs/firefox.md): the package tools/firefox.mjs makes from extension/, and
// what the extension does differently there. The background page is in background.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { JSDOM } = require('jsdom');
const settings = require('../extension/src/settings.js');
const { importedScripts } = require('../extension/src/update.js');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const TOOL = path.join(ROOT, 'tools', 'firefox.mjs');
const chromeManifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const backgroundSource = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');
const tool = () => import(TOOL);
const GECKO = {
  id: 'read-free@readfree.xyz',
  strict_min_version: '140.0',
  update_url: 'https://readfree.xyz/updates.json',
  data_collection_permissions: { required: ['browsingActivity'] },
};

// Every file under dir, relative, without hidden ones
function files(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).filter(e => !e.name.startsWith('.')).flatMap(e => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? files(full, base) : [path.relative(base, full)];
  }).sort();
}

test("Firefox's manifest: Chrome's, with a background page given the service worker's files, and Mozilla's settings", async () => {
  const { firefoxManifest } = await tool();
  const m = firefoxManifest(chromeManifest, backgroundSource, 'https://readfree.xyz/');
  assert.deepEqual(m.background, { scripts: [...importedScripts(backgroundSource), 'background.js'] });
  assert.deepEqual(m.background.scripts, ['src/archive.js', 'src/settings.js', 'src/update.js', 'src/release.js', 'src/access.js', 'background.js']);
  for (const file of m.background.scripts) assert.ok(fs.existsSync(path.join(EXT, file)), file);
  assert.deepEqual(m.browser_specific_settings, { gecko: GECKO });
  for (const key of Object.keys(chromeManifest).filter(k => k !== 'background')) assert.deepEqual(m[key], chromeManifest[key], key);
  assert.deepEqual(Object.keys(m).sort(), [...Object.keys(chromeManifest), 'browser_specific_settings'].sort());
  // Chrome's own manifest stays Chrome's: no keys it doesn't know
  assert.equal(chromeManifest.browser_specific_settings, undefined);
  assert.deepEqual(Object.keys(chromeManifest.background), ['service_worker']);
  assert.ok(settings.isFirefox(m));
  assert.ok(!settings.isFirefox(chromeManifest));
});

test("Firefox's manifest: only a plain https site, and only from a manifest with a service worker", async () => {
  const { firefoxManifest } = await tool();
  for (const site of ['http://readfree.xyz/', 'https://readfree.xyz', 'https://readfree.xyz/?a=1', '', 'https://readfree.xyz/"x/']) {
    assert.throws(() => firefoxManifest(chromeManifest, backgroundSource, site), /plain https/, site);
  }
  assert.throws(() => firefoxManifest({ ...chromeManifest, background: {} }, backgroundSource, 'https://readfree.xyz/'), /service_worker/);
  assert.equal(firefoxManifest(chromeManifest, backgroundSource, 'https://readfreexyz.github.io/').browser_specific_settings.gecko.update_url, 'https://readfreexyz.github.io/updates.json');
});

test('the package: the working folder\'s files, with the manifest for Firefox; updates from the first release address', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'read-free-firefox-'));
  try {
    execFileSync(process.execPath, [TOOL, '--out', out], { stdio: 'pipe' });
    assert.deepEqual(files(out), files(EXT));
    for (const file of files(EXT).filter(f => f !== 'manifest.json')) {
      assert.ok(fs.readFileSync(path.join(out, file)).equals(fs.readFileSync(path.join(EXT, file))), file);
    }
    const m = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    assert.deepEqual(m.browser_specific_settings.gecko, { ...GECKO, update_url: `${settings.RELEASE_URLS[0]}updates.json` });
    assert.equal(m.version, chromeManifest.version);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('the package from a commit: the files as committed there (as releases are)', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'read-free-firefox-'));
  try {
    execFileSync(process.execPath, [TOOL, '--out', out, '--from', 'HEAD', '--site', 'https://readfree.xyz/'], { stdio: 'pipe' });
    const committed = execFileSync('git', ['-C', ROOT, 'ls-tree', '-r', '--name-only', 'HEAD:extension'], { encoding: 'utf8' }).trim().split('\n').sort();
    assert.deepEqual(files(out), committed.filter(f => !path.basename(f).startsWith('.')));
    assert.equal(fs.readFileSync(path.join(out, 'background.js'), 'utf8'), execFileSync('git', ['-C', ROOT, 'show', 'HEAD:extension/background.js'], { encoding: 'utf8' }));
    const m = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    assert.equal(m.version, JSON.parse(execFileSync('git', ['-C', ROOT, 'show', 'HEAD:extension/manifest.json'], { encoding: 'utf8' })).version);
    assert.ok(m.browser_specific_settings.gecko);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("Report a problem names Firefox and its version", () => {
  assert.equal(settings.browserName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:160.0) Gecko/20100101 Firefox/160.0'), 'Firefox 160');
  assert.equal(settings.browserName('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0'), 'Firefox 140');
  assert.equal(settings.browserName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36'), 'Chrome 157');
});

// The welcome page with its scripts stubbed: the outlets list empty, the browser told apart by
// the manifest.
function welcome(manifest) {
  const html = fs.readFileSync(path.join(EXT, 'welcome', 'welcome.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  const { window } = dom;
  window.chrome = { runtime: { getManifest: () => manifest, openOptionsPage: () => {} } };
  window.NYTFix = { ui: { loadSites: async () => ({}), byName: () => 0 }, settings: { isFirefox: () => settings.isFirefox(manifest) } };
  window.eval(fs.readFileSync(path.join(EXT, 'welcome', 'welcome.js'), 'utf8'));
  return window.document;
}

test("the welcome page: Chrome's Developer mode tip, or in Firefox, that it updates by itself", () => {
  const chrome = welcome({ version: '0.25.0', background: { service_worker: 'background.js' } });
  assert.equal(chrome.getElementById('tip-chrome').hidden, false);
  assert.equal(chrome.getElementById('tip-firefox').hidden, true);
  const firefox = welcome({ version: '0.25.0', browser_specific_settings: { gecko: { id: 'read-free@readfree.xyz' } } });
  assert.equal(firefox.getElementById('tip-chrome').hidden, true);
  assert.equal(firefox.getElementById('tip-firefox').hidden, false);
  assert.match(firefox.getElementById('tip-firefox').textContent, /Firefox installs new versions of Read\s+Free by itself/);
  // The page loads settings.js (and the archive.js it needs) before welcome.js
  const scripts = [...chrome.querySelectorAll('script[src]')].map(s => s.getAttribute('src'));
  assert.ok(scripts.indexOf('../src/archive.js') < scripts.indexOf('../src/settings.js'));
  assert.ok(scripts.indexOf('../src/settings.js') < scripts.indexOf('welcome.js'));
});
