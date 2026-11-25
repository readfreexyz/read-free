// Copy page details (src/details.js): the page's structure, and none of what a reader would mind.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { livePageHtml, interactivePageHtml } = require('./fixtures.js');

const EXT = path.join(__dirname, '../extension');
const manifest = require('../extension/manifest.json');
for (const f of ['src/adapter.js', 'src/paywall.js', 'src/render.js']) require(path.join(EXT, f));
const details = require('../extension/src/details.js');
for (const f of new Set(manifest.content_scripts.flatMap(c => c.js).filter(f => f.startsWith('sites/')))) require(path.join(EXT, f));
const sites = globalThis.NYTFix.sites;
const at = (html, url = 'https://www.nytimes.com/2026/11/24/arts/design/SECRETSLUG-steps-down.html') => new JSDOM(html, { url }).window.document;
const META = { version: '1.2.3', browser: 'Chrome 158', state: 'idle' };

test('says what is there: the adapter\'s parts, what is inert or pinned, how the text ends', () => {
  const text = details.describe(at(livePageHtml({ marks: 'parts', upsell: 'inside' })), sites.nyt, META);
  assert.match(text, /^Read Free: 1\.2\.3 Chrome 158 on nyt; idle$/m);
  assert.match(text, /^page: \/N\/N\/N\/w\/w\/w; article:true live:false/m);
  assert.match(text, /^body: 1 section kids:\d+ chars:\d+ .* inert aria-hidden$/m);
  assert.match(text, /^wall: seen:true type:paywall/m);
  assert.match(text, /^inert: .*section in main/m);
  assert.match(text, /^popup says: .*withoutLoggingIn/m);
  assert.match(text, /^text ends: subscribeTo|subscribe/m);
  const pinned = details.describe(at(interactivePageHtml(), 'https://www.nytimes.com/interactive/2026/11/24/climate/x.html'), sites.nyt, { ...META, missed: 'frozen' });
  assert.match(pinned, /missed: frozen/);
  assert.match(pinned, /main#site-content fixed .* inline:fixed/);
  assert.match(pinned, /live:true/);
});

test("none of the article's words or address, the reader's name or email, or ids the site made up", () => {
  let html = livePageHtml({ marks: 'parts', upsell: 'inside' })
    .replace('<h1>Headline</h1>', '<h1 id="SECRETTITLE-in-full" data-testid="SECRETTEST-headline">SECRETHEADLINE</h1>')
    .replace('Live paragraph 1.', 'SECRETBODY')
    .replace('<div></div></div></div>', '<div id="user-SECRETID-928158" data-testid="profile-SECRETNAME">Welcome back, SECRETNAME (secret.reader@example.com)</div></div></div>')
    .replace('<body>', '<body class="SECRETCLASS" data-user="SECRETDATA"><div id="how-paywall-SECRETPART-works" inert style="position:fixed">SECRETOVER</div>');
  const text = details.describe(at(html), sites.nyt, META);
  assert.ok(!/SECRET|secret|example\.com|nytimes|928158|Welcome|arts|design/.test(text), text);
  assert.ok(text.length < 6000, `${text.length} characters`);
  assert.match(text, /#\?/, 'an id is there, without its name');
});

test('every supported site: answered on an ordinary page and an empty one, without throwing', () => {
  for (const site of Object.values(sites)) {
    for (const html of ['<!doctype html><body><main><article><p>SECRET words</p></article></main></body>', '<!doctype html><body></body>']) {
      const host = site.hosts[0].replace('*.', 'x.');
      const text = details.describe(at(html, `https://${host}/2026/11/24/SECRET.html`), site, META);
      assert.match(text, new RegExp(`on ${site.id};`));
      assert.ok(!/SECRET/.test(text), site.id);
    }
  }
});

test('the menu has the button, and every page that runs the content script can answer it', () => {
  const popup = fs.readFileSync(path.join(EXT, 'popup/popup.html'), 'utf8');
  assert.match(popup, /id="details"/);
  for (const c of manifest.content_scripts.filter(c => c.js.includes('src/content.js'))) {
    assert.ok(c.js.indexOf('src/details.js') !== -1 && c.js.indexOf('src/details.js') < c.js.indexOf('src/content.js'), c.matches[0]);
  }
});
