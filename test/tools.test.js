// The research and release tools (tools/) say what they are: none sets a user agent of its own,
// let alone a browser's, to get past an outlet's bot check. Sites that refuse scripts are looked
// at in a browser instead.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TOOLS = path.join(__dirname, '..', 'tools');

test('the tools never pass themselves off as a browser', () => {
  const files = fs.readdirSync(TOOLS).filter(f => /\.(mjs|js|sh)$/.test(f));
  assert.ok(files.includes('probe-outlets.mjs') && files.includes('site-health.mjs'));
  for (const file of files) {
    const code = fs.readFileSync(path.join(TOOLS, file), 'utf8');
    assert.doesNotMatch(code, /Mozilla\/\d/, `${file}: a browser's user agent`);
    assert.doesNotMatch(code, /['"]user-agent['"]\s*:|\buserAgent\s*:/i, `${file}: a user agent of its own`);
    assert.doesNotMatch(code, /curl[^\n]*\s(-A|--user-agent)\s/, `${file}: curl with a user agent of its own`);
  }
});
