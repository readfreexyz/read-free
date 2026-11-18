// README.md: its opening names the extension's live sites, all of them, by name, with the right
// count. test/website.test.js checks the same for the site's front page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ui = require('../extension/ui/sites.js');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
require('../extension/src/adapter.js');
for (const file of ui.adapterFiles(manifest)) require(path.join(EXT, file));

test('the opening: "It works on N outlets: …", the live sites by name', () => {
  const opening = README.slice(0, README.indexOf('\n## '));
  const paragraph = opening.split(/\n\s*\n/).find(p => p.startsWith('It works on '));
  assert.ok(paragraph, 'the opening has an "It works on N outlets: …" paragraph');

  const live = Object.values(globalThis.NYTFix.sites).filter(s => s.live).sort(ui.byName).map(s => s.name);
  const expected = `It works on ${live.length} outlets: ${live.slice(0, -1).join(', ')} and ${live.at(-1)}.`;
  assert.equal(paragraph.replace(/\s+/g, ' ').trim(), expected);
});
