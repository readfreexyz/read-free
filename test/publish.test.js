// tools/publish.sh, offline: a release built by tools/release.sh with a throwaway key, a bare
// repository standing in for the GitHub Pages one (a clone of it with a git identity of its own),
// and a stand-in for npx that records what Wrangler would have been asked to deploy, and from
// where. Nothing is fetched (READFREE_VERIFY=0) and nothing leaves the machine.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PUBLISH = path.join(ROOT, 'tools', 'publish.sh');
const has = cmd => spawnSync('/bin/sh', ['-c', `command -v ${cmd}`]).status === 0;
const missing = ['git', 'ssh-keygen', 'curl'].filter(cmd => !has(cmd));
const skip = missing.length ? `needs ${missing.join(', ')}` : process.platform === 'win32' && 'not on Windows';

test('publish: checks the release, then the mirror and the site', { skip }, async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readfree-publish-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  const git = (cwd, ...args) => run('git', ['-c', 'user.name=t', '-c', 'user.email=t@localhost', ...args], { cwd });

  // A release, as tools/release.sh builds it
  const key = path.join(tmp, 'key');
  run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'read-free', '-f', key]);
  const signer = `read-free namespaces="read-free-release" ${fs.readFileSync(`${key}.pub`, 'utf8').split(' ').slice(0, 2).join(' ')}`;
  const installer = path.join(tmp, 'install.sh');
  fs.writeFileSync(installer, fs.readFileSync(path.join(ROOT, 'website', 'install.sh'), 'utf8')
    .replace(/^RELEASE_URLS=.*$/m, "RELEASE_URLS='https://site.example/ https://mirror.example.github.io/'")
    .replace(/^SIGNER=.*$/m, `SIGNER='${signer}'`));
  const repo = path.join(tmp, 'repo');
  for (const dir of ['extension', 'website']) fs.cpSync(path.join(ROOT, dir), path.join(repo, dir), { recursive: true });
  git(repo, 'init', '-q');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'x');
  const dist = path.join(tmp, 'dist');
  run('sh', [path.join(ROOT, 'tools', 'release.sh'), 'build'], { env: { ...process.env, READFREE_REPO: repo, READFREE_DIST: dist, READFREE_RELEASE_KEY: key, READFREE_INSTALLER: installer } });
  const version = fs.readFileSync(path.join(dist, 'latest.txt'), 'utf8').match(/^version=(.*)$/m)[1];
  fs.writeFileSync(path.join(dist, '.DS_Store'), 'Finder was here');

  // The mirror: a bare repository named as GitHub Pages names them, and a clone with its own identity
  const bare = path.join(tmp, 'mirror.example.github.io.git');
  run('git', ['init', '-q', '--bare', bare]);
  const seed = path.join(tmp, 'seed');
  run('git', ['clone', '-q', bare, seed]);
  fs.writeFileSync(path.join(seed, '.nojekyll'), '');
  fs.writeFileSync(path.join(seed, 'old.txt'), 'an earlier release');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-q', '-m', 'seed');
  git(seed, 'push', '-q', 'origin', 'HEAD:master');
  const mirror = path.join(tmp, 'site');
  run('git', ['clone', '-q', bare, mirror]);
  run('git', ['config', 'user.name', 'Read Free'], { cwd: mirror });
  run('git', ['config', 'user.email', 'readfree@users.noreply.example'], { cwd: mirror });
  const published = () => run('git', ['--git-dir', bare, 'ls-tree', '--name-only', 'HEAD']).trim().split('\n').sort();
  const commits = () => Number(run('git', ['--git-dir', bare, 'rev-list', '--count', 'HEAD']).trim());

  // npx, recording what it was asked to do
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  const npxLog = path.join(tmp, 'npx.log');
  fs.writeFileSync(path.join(bin, 'npx'), `#!/bin/sh
{ echo "cwd=$(pwd)"; echo "args=$*"; echo "token=$CLOUDFLARE_API_TOKEN account=$CLOUDFLARE_ACCOUNT_ID metrics=$WRANGLER_SEND_METRICS"; } > "${npxLog}"
prev=; for a in "$@"; do [ "$prev" = --config ] && cp "$a" "${npxLog}.json"; prev=$a; done
dir=$(sed -n 's/.*"directory": "\\(.*\\)".*/\\1/p' "${npxLog}.json"); ls -A "$dir" > "${npxLog}.files"
exit 0
`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, READFREE_DIST: dist, READFREE_MIRROR_REPO: mirror, READFREE_VERIFY: '0', CLOUDFLARE_API_TOKEN: 'test-token', CLOUDFLARE_ACCOUNT_ID: 'test-account' };
  const publish = (...args) => spawnSync('/bin/sh', [PUBLISH, ...args], { encoding: 'utf8', env, timeout: 60000 });
  const deployed = () => fs.existsSync(npxLog);
  const clearNpx = () => { for (const f of [npxLog, `${npxLog}.json`, `${npxLog}.files`]) fs.rmSync(f, { force: true }); };
  const files = ['.nojekyll', '_headers', 'donate.json', 'index.html', 'install.sh', 'latest.txt', 'latest.txt.sig', 'og.png', `read-free-${version}.zip`].sort();

  await t.test('publishes: the mirror committed as its own identity in UTC, the site deployed from elsewhere', () => {
    const res = publish();
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.deepEqual(published(), files, 'the release replaces the old files; nothing hidden from dist/');
    const last = format => run('git', ['--git-dir', bare, 'log', '-1', `--format=${format}`, '--date=raw']).trim();
    assert.equal(last('%an <%ae>'), 'Read Free <readfree@users.noreply.example>', "the clone's own identity");
    assert.match(last('%ad'), / \+0000$/, 'in UTC');
    assert.equal(last('%s'), `Read Free ${version}`);
    // Wrangler: run from a temporary folder, never this repository, with the release's files only
    const log = fs.readFileSync(npxLog, 'utf8');
    const cwd = log.match(/^cwd=(.*)$/m)[1];
    for (const root of [ROOT, fs.realpathSync(ROOT)]) assert.ok(!cwd.startsWith(root), `Wrangler ran in ${cwd}`);
    assert.ok(!fs.existsSync(cwd), 'its temporary folder is gone');
    assert.match(log, /^args=--yes wrangler@[\d.]+ deploy --config \S+wrangler\.json$/m);
    assert.match(log, /token=test-token account=test-account metrics=false/);
    const config = JSON.parse(fs.readFileSync(`${npxLog}.json`, 'utf8'));
    assert.equal(config.name, 'readfree');
    assert.deepEqual(fs.readFileSync(`${npxLog}.files`, 'utf8').trim().split('\n').sort(), files.filter(f => f !== '.nojekyll'));
    assert.match(res.stdout, /mirror: pushed/);
    assert.match(res.stdout, /site: deployed/);
  });

  await t.test('the same release again: nothing new to commit', () => {
    clearNpx();
    const before = commits();
    const res = publish('mirror');
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /already has Read Free/);
    assert.equal(commits(), before);
    assert.equal(deployed(), false, 'mirror only: no deploy');
  });

  await t.test('site only: the mirror is left alone', () => {
    clearNpx();
    const before = commits();
    const res = publish('site');
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.equal(deployed(), true);
    assert.equal(commits(), before);
  });

  // Each refusal: exit 1, nothing pushed, nothing deployed
  const refused = (label, pattern, args = []) => {
    clearNpx();
    const before = commits();
    const res = publish(...args);
    assert.equal(res.status, 1, `${label}: ${res.stdout}${res.stderr}`);
    assert.match(res.stderr, pattern, label);
    assert.equal(commits(), before, `${label}: pushed`);
    assert.equal(deployed(), false, `${label}: deployed`);
  };
  const editing = (file, change, body) => {
    const before = fs.readFileSync(file);
    try {
      change(before);
      body();
    } finally {
      fs.writeFileSync(file, before);
    }
  };

  await t.test('refuses a release whose latest.txt was changed after signing', () => {
    const file = path.join(dist, 'latest.txt');
    editing(file, text => fs.writeFileSync(file, String(text).replace(/^date=.*$/m, 'date=2030-01-01T00:00:00Z')),
      () => refused('edited latest.txt', /signature doesn't check out/));
  });

  await t.test('refuses a release without _headers', () => {
    const file = path.join(dist, '_headers');
    editing(file, () => fs.rmSync(file), () => refused('no _headers', /no _headers/));
  });

  await t.test('refuses a mirror without a git identity of its own', () => {
    run('git', ['config', '--unset', 'user.email'], { cwd: mirror });
    try {
      refused('no identity', /no git identity of its own/, ['mirror']);
    } finally {
      run('git', ['config', 'user.email', 'readfree@users.noreply.example'], { cwd: mirror });
    }
  });

  await t.test('refuses a mirror with uncommitted changes, or one that is not a GitHub Pages repository', () => {
    const stray = path.join(mirror, 'stray.txt');
    fs.writeFileSync(stray, 'work in progress');
    try {
      refused('dirty mirror', /uncommitted changes/, ['mirror']);
    } finally {
      fs.rmSync(stray);
    }
    run('git', ['remote', 'set-url', 'origin', path.join(tmp, 'elsewhere.git')], { cwd: mirror });
    try {
      refused('not GitHub Pages', /isn't a GitHub Pages repository/, ['mirror']);
    } finally {
      run('git', ['remote', 'set-url', 'origin', bare], { cwd: mirror });
    }
  });
});
