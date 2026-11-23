// The Windows installer (website/install.ps1), as far as it can be checked here: it's run for
// real on a GitHub Windows machine (.github/workflows/windows-installer.yml, test/windows/).
// Here: Windows PowerShell 5.1 reads a file without a byte-order mark in the system's code page,
// so it must be plain ASCII; it holds the same key, addresses and limits as install.sh (tools/
// release.sh writes them into both); and it answers the commands the docs give.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PS1 = fs.readFileSync(path.join(ROOT, 'website', 'install.ps1'));
const ps1 = PS1.toString('latin1');
const sh = fs.readFileSync(path.join(ROOT, 'website', 'install.sh'), 'utf8');

const shValue = name => sh.match(new RegExp(`^${name}='?(.*?)'?$`, 'm'))?.[1];
const psValue = name => ps1.match(new RegExp(`^\\$${name} = '?(.*?)'?$`, 'm'))?.[1];

test('plain ASCII, no byte-order mark, Unix line ends', () => {
  const nonAscii = [...PS1].filter(b => b > 0x7f).length;
  assert.equal(nonAscii, 0, 'Windows PowerShell 5.1 would read other characters in the system code page');
  assert.notDeepEqual([...PS1.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.ok(!ps1.includes('\r'));
});

test("the same key, addresses and limits as install.sh", () => {
  for (const name of ['SIGNER', 'RELEASE_URLS', 'NAMESPACE', 'PRINCIPAL', 'MAX_ZIP']) {
    assert.ok(psValue(name), `install.ps1 sets $${name}`);
    assert.equal(psValue(name), shValue(name), name);
  }
});

test('the commands the docs and the site give', () => {
  for (const command of ['install', 'update', 'status', 'uninstall']) assert.match(ps1, new RegExp(`^  '${command}' \\{`, 'm'), command);
  assert.match(ps1, /no-schedule/);
  // The hourly task runs the kept copy, logging
  assert.match(ps1, /\$Self = Join-Path \$Base 'Read Free updater\.ps1'/);
  assert.match(ps1, /-File \$\(Q \$Self\) update log/);
  // Signatures by Windows' own OpenSSH, before anything in latest.txt is read
  assert.ok(ps1.indexOf('-Y verify') < ps1.indexOf("Field 'version'"));
  // The command shown at its top is the site's
  const page = fs.readFileSync(path.join(ROOT, 'website', 'index.html'), 'utf8');
  const shown = ps1.match(/^#   (irm https:\/\/readfree\.xyz\/install\.ps1 .*)$/m)?.[1];
  assert.ok(shown, 'install.ps1 shows its command');
  assert.ok(page.includes(shown.replace('https://readfree.xyz/', '{{site}}')), "the site's command is the same");
});

test('each variable spelled one way: PowerShell ignores case, so $task would be $TASK', () => {
  // Uninstall once set $task to the scheduled task, which made $TASK (its name) that object too
  for (const [file, text] of [['website/install.ps1', ps1], ['test/windows/install-test.ps1', fs.readFileSync(path.join(ROOT, 'test', 'windows', 'install-test.ps1'), 'latin1')]]) {
    const spellings = new Map();
    for (const [name] of text.matchAll(/(?<![`\\])\$[A-Za-z_]\w*/g)) {
      const key = name.toLowerCase();
      spellings.set(key, new Set([...(spellings.get(key) || []), name]));
    }
    const twoWays = [...spellings.values()].filter(set => set.size > 1).map(set => [...set].join(' / '));
    assert.deepEqual(twoWays, [], file);
  }
});
