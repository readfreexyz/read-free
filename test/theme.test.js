// Themes (extension/themes/<name>/, switched with tools/theme.mjs): each defines the same colors,
// the active one is copied in whole, and every file the manifest and pages name is there.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const EXT = path.join(__dirname, '../extension');
const read = f => fs.readFileSync(path.join(EXT, f), 'utf8');
const themes = fs.readdirSync(path.join(EXT, 'themes')).filter(t => fs.statSync(path.join(EXT, 'themes', t)).isDirectory());
const tokens = css => [...new Set([...css.matchAll(/(--nf-[a-z0-9-]+)\s*:/g)].map(m => m[1]))].sort();

test('both themes are there, and define the same colors for the extension pages and for news pages', () => {
  assert.ok(themes.includes('classic') && themes.includes('solidarity'), themes.join(', '));
  const [first, ...rest] = themes;
  for (const t of rest) {
    assert.deepEqual(tokens(read(`themes/${t}/theme.css`)), tokens(read(`themes/${first}/theme.css`)), `${t}/theme.css`);
    assert.deepEqual(tokens(read(`themes/${t}/page.css`)), tokens(read(`themes/${first}/page.css`)), `${t}/page.css`);
  }
});

test('every color the pages use is one a theme defines', () => {
  const defined = new Set([...tokens(read('themes/classic/theme.css')), ...tokens(read('themes/classic/page.css'))]);
  const used = f => [...read(f).matchAll(/var\((--nf-[a-z0-9-]+)/g)].map(m => m[1]);
  for (const f of ['ui/ui.css', 'popup/popup.css', 'options/options.css', 'content.css', 'src/status.js']) {
    for (const name of used(f)) assert.ok(defined.has(name), `${f} uses ${name}`);
  }
});

test('the active theme is copied in whole: ui/theme.css, the block in content.css, the icons', () => {
  const active = /theme "([a-z-]+)"/i.exec(read('ui/theme.css'))[1];
  assert.equal(read('ui/theme.css'), read(`themes/${active}/theme.css`));
  const css = read('content.css');
  const block = css.slice(css.indexOf('/* theme:start'), css.indexOf('/* theme:end */'));
  assert.match(block, new RegExp(`themes/${active}/page.css`));
  assert.deepEqual(tokens(block), tokens(read(`themes/${active}/page.css`)));
  assert.doesNotMatch(block.replace(/\/\*[\s\S]*?\*\//g, ''), /url\((?!"data:)/, 'news pages get data: URLs only');
  assert.equal(read('icons/icon.svg'), read(`themes/${active}/icon.svg`));
});

test("every file the manifest and the extension's pages name exists", () => {
  const manifest = JSON.parse(read('manifest.json'));
  const files = [...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon), manifest.action.default_popup, manifest.options_ui.page];
  for (const t of themes) for (const f of ['theme.css', 'page.css', 'icon.svg', 'icon-16.svg', 'icon-off.svg', 'icon-16-off.svg']) files.push(`themes/${t}/${f}`);
  for (const f of ['icons/off-16.png', 'icons/off-32.png']) files.push(f); // background.js
  for (const f of files) assert.ok(fs.existsSync(path.join(EXT, f)), f);
  // Each theme's url(...) in theme.css is relative to ui/
  for (const t of themes) {
    for (const [, url] of read(`themes/${t}/theme.css`).matchAll(/url\(([^)"]+)\)/g)) assert.ok(fs.existsSync(path.join(EXT, 'ui', url)), `${t}: ${url}`);
  }
  // Scripts and styles the extension's pages load
  for (const page of ['popup/popup.html', 'options/options.html', 'give/give.html']) {
    for (const [, ref] of read(page).matchAll(/(?:src|href)="(\.\.\/[^"]+|[\w.-]+\.(?:js|css))"/g)) {
      assert.ok(fs.existsSync(path.join(EXT, path.dirname(page), ref)), `${page}: ${ref}`);
    }
  }
});
