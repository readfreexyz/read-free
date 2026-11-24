// The signed Firefox file of a release (tools/firefox-release.mjs, tools/release.sh build,
// tools/publish.sh), offline: a throwaway repository and key, and a stand-in for Mozilla that zips
// the package with a META-INF/ folder. Nothing is sent anywhere.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const has = cmd => spawnSync('/bin/sh', ['-c', `command -v ${cmd}`]).status === 0;
const missing = ['git', 'ssh-keygen', 'zip', 'unzip', 'curl'].filter(cmd => !has(cmd));
const skip = missing.length ? `needs ${missing.join(', ')}` : process.platform === 'win32' && 'not on Windows';
const sha256 = data => createHash('sha256').update(data).digest('hex');
const SITE = 'https://site.example/';

test('releases for Firefox', { skip }, async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readfree-firefox-test-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  const repo = path.join(tmp, 'repo');
  for (const dir of ['extension', 'website']) fs.cpSync(path.join(ROOT, dir), path.join(repo, dir), { recursive: true });
  const git = (...args) => run('git', ['-c', 'user.name=t', '-c', 'user.email=t@localhost', ...args], { cwd: repo });
  // A page with a Firefox part, whatever the site's own has
  const page = path.join(repo, 'website', 'index.html');
  const pageText = fs.readFileSync(page, 'utf8').replace(/^ *<!-- firefox -->\n[\s\S]*?^ *<!-- \/firefox -->\n/gm, '').replace(/^ *<!-- chrome-only -->\n[\s\S]*?^ *<!-- \/chrome-only -->\n/gm, '')
    .replace('</body>', '<!-- firefox -->\n<a href="{{xpi}}">Add to Firefox</a>\n<!-- /firefox -->\n<!-- chrome-only -->\n<p>Chrome alone</p>\n<!-- /chrome-only -->\n</body>');
  fs.writeFileSync(page, pageText);
  git('init', '-q');
  const manifest = path.join(repo, 'extension', 'manifest.json');
  const commit = (version, extra = '') => {
    fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace(/"version": "[^"]*"/, `"version": "${version}"`));
    fs.writeFileSync(path.join(repo, 'extension', 'extra[1].txt'), extra);
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', version);
  };

  // Mozilla's stand-in: the package zipped with a signature; counts its uses. EDIT: what it changes.
  const signer = path.join(tmp, 'sign.sh');
  const log = path.join(tmp, 'sign.log');
  const signAs = (edit = '') => fs.writeFileSync(signer, `#!/bin/sh
set -e
echo signed >> "${log}"
rm -rf "${tmp}/signing"
cp -R "$1" "${tmp}/signing"; cd "${tmp}/signing"
echo uuid > "$1/.amo-upload-uuid" # as web-ext does
printf '%s' "$(cat manifest.json)" > m && mv m manifest.json # as Mozilla does: written anew, no line break at the end
mkdir META-INF; for f in manifest.mf mozilla.sf mozilla.rsa cose.sig; do echo x > META-INF/$f; done
${edit}
zip -q -r "$2/read_free-signed.xpi" .
cd /; rm -rf "${tmp}/signing"
`, { mode: 0o755 });
  signAs();
  const signings = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').length : 0);

  const cache = path.join(tmp, 'cache');
  const dist = path.join(tmp, 'dist');
  const key = path.join(tmp, 'key');
  run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'read-free', '-f', key]);
  const ssh = `read-free namespaces="read-free-release" ${fs.readFileSync(`${key}.pub`, 'utf8').split(' ').slice(0, 2).join(' ')}`;
  const installer = path.join(tmp, 'install.sh');
  fs.writeFileSync(installer, fs.readFileSync(path.join(ROOT, 'website', 'install.sh'), 'utf8')
    .replace(/^RELEASE_URLS=.*$/m, `RELEASE_URLS='${SITE} https://mirror.example.github.io/'`).replace(/^SIGNER=.*$/m, `SIGNER='${ssh}'`));
  const env = { ...process.env, READFREE_REPO: repo, READFREE_DIST: dist, READFREE_RELEASE_KEY: key, READFREE_INSTALLER: installer, READFREE_FIREFOX_CACHE: cache, READFREE_FIREFOX_SIGN: signer, READFREE_VERIFY: '0' };
  const build = (more = {}) => spawnSync('sh', [path.join(ROOT, 'tools', 'release.sh'), 'build'], { encoding: 'utf8', env: { ...env, ...more } });
  const good = (more = {}) => { const res = build(more); assert.equal(res.status, 0, res.stdout + res.stderr); return res; };
  const inDist = name => fs.readFileSync(path.join(dist, name));
  const listed = () => fs.readdirSync(dist).filter(f => /xpi$|^updates/.test(f)).sort();

  await t.test('build: the committed extension, signed once, with updates.json and the page linking to it', () => {
    commit('1.0.0');
    good();
    assert.equal(signings(), 1);
    assert.deepEqual(listed(), ['read-free-1.0.0.xpi', 'updates.json']);
    assert.deepEqual(JSON.parse(inDist('updates.json')), { addons: { 'read-free@readfree.xyz': { updates: [{
      version: '1.0.0', update_link: `${SITE}read-free-1.0.0.xpi`, update_hash: `sha256:${sha256(inDist('read-free-1.0.0.xpi'))}`,
      applications: { gecko: { strict_min_version: '140.0' } } }] } } });
    const inside = JSON.parse(run('unzip', ['-p', path.join(dist, 'read-free-1.0.0.xpi'), 'manifest.json']));
    assert.equal(inside.browser_specific_settings.gecko.update_url, `${SITE}updates.json`);
    const html = String(inDist('index.html'));
    assert.ok(html.includes('href="read-free-1.0.0.xpi"'), 'the link');
    assert.ok(!/Chrome alone/.test(html), 'not the Chrome-only part');
    assert.ok(!/^ *<!-- \/?(firefox|chrome-only) -->/m.test(html), 'no markers left');
  });

  await t.test('build: the same extension again (a site-only release) uses the file already signed', () => {
    const before = inDist('read-free-1.0.0.xpi');
    fs.writeFileSync(page, pageText.replace('Chrome alone', 'Chrome, alone'));
    git('commit', '-q', '-a', '-m', 'site');
    good();
    assert.equal(signings(), 1);
    assert.ok(inDist('read-free-1.0.0.xpi').equals(before));
  });

  await t.test('build: another extension under a version already signed is refused, and dist/ left as it was', () => {
    const before = inDist('latest.txt');
    commit('1.0.0', 'changed');
    const res = build();
    assert.equal(res.status, 1);
    assert.match(res.stderr, /signs a version once: bump the version/);
    assert.equal(signings(), 1, 'not sent');
    assert.ok(inDist('latest.txt').equals(before));
    commit('1.0.1', 'changed');
    good();
    assert.equal(signings(), 2);
    assert.deepEqual(listed(), ['read-free-1.0.1.xpi', 'updates.json'], "the older version's file is gone");
  });

  await t.test('build: what comes back must be what was sent, and signed', () => {
    const cases = [
      ['echo "//" >> background.js', /has another background\.js/],
      ['sed "s/browsingActivity/none/" manifest.json > m && mv m manifest.json', /has another manifest\.json/],
      ['echo x > added.js', /doesn't hold this release's files \(added\.js\)/],
      ['rm src/access.js', /doesn't hold this release's files \(src\/access\.js\)/],
      ['rm META-INF/mozilla.rsa', /isn't signed by Mozilla/],
    ];
    cases.forEach(([edit, pattern], i) => {
      signAs(edit);
      commit(`1.1.${i}`);
      const res = build();
      assert.equal(res.status, 1, edit);
      assert.match(res.stderr, pattern, edit);
    });
    signAs('exit 1');
    commit('1.2.0');
    assert.match(build().stderr, /Mozilla didn't return a signed file/);
    assert.ok(!fs.readdirSync(cache).some(f => /^1\.[12]\./.test(f)), 'none of them used again');
    assert.ok(fs.existsSync(path.join(cache, 'refused-1.1.0.xpi')), 'but kept to look at');
    signAs();
  });

  await t.test('build: a signed file downloaded by hand, if it is this release', () => {
    good(); // 1.2.0, signed
    const file = path.join(tmp, 'by-hand.xpi');
    fs.copyFileSync(path.join(dist, 'read-free-1.2.0.xpi'), file);
    fs.rmSync(cache, { recursive: true });
    const before = signings();
    good({ READFREE_FIREFOX_XPI: file });
    assert.equal(signings(), before, 'not sent again');
    assert.ok(inDist('read-free-1.2.0.xpi').equals(fs.readFileSync(file)));
    commit('1.3.0');
    assert.match(build({ READFREE_FIREFOX_XPI: file }).stderr, /has another manifest\.json/);
  });

  // publish.sh, with a stand-in for npx and Wrangler
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  const deployed = path.join(tmp, 'deployed');
  fs.writeFileSync(path.join(bin, 'npx'), `#!/bin/sh\nls "$(sed -n 's/.*"directory": "\\(.*\\)".*/\\1/p' wrangler.json)" > "${deployed}"\n`, { mode: 0o755 });
  const publish = () => {
    fs.rmSync(deployed, { force: true });
    return spawnSync('/bin/sh', [path.join(ROOT, 'tools', 'publish.sh'), 'site'], { encoding: 'utf8', timeout: 60000, env: { ...env, PATH: `${bin}:${process.env.PATH}`, CLOUDFLARE_API_TOKEN: 'x', CLOUDFLARE_ACCOUNT_ID: 'x' } });
  };

  await t.test('publish: the Firefox file and updates.json go up with the rest', () => {
    good();
    const res = publish();
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const up = fs.readFileSync(deployed, 'utf8').trim().split('\n');
    assert.ok(up.includes('read-free-1.3.0.xpi') && up.includes('updates.json'), up.join());
  });

  await t.test('publish: refuses a Firefox file, an updates.json and a page out of step', () => {
    const changing = (name, change, pattern) => {
      const file = path.join(dist, name);
      const before = fs.existsSync(file) ? fs.readFileSync(file) : null;
      change(file, before);
      const res = publish();
      if (before) fs.writeFileSync(file, before); else fs.rmSync(file, { force: true });
      assert.equal(res.status, 1, name + res.stdout);
      assert.match(res.stderr, pattern);
      assert.ok(!fs.existsSync(deployed));
    };
    changing('updates.json', f => fs.rmSync(f), /no updates\.json/);
    changing('updates.json', (f, was) => fs.writeFileSync(f, String(was).replace('sha256:', 'sha256:0')), /doesn't describe read-free-1\.3\.0\.xpi/);
    changing('updates.json', (f, was) => fs.writeFileSync(f, String(was).replace(SITE, 'https://elsewhere.example/')), /doesn't describe/);
    changing('read-free-1.3.0.xpi', f => fs.writeFileSync(f, 'not a zip'), /isn't signed by Mozilla/);
    changing('read-free-1.3.0.xpi', f => fs.rmSync(f), /updates\.json in .* without read-free-1\.3\.0\.xpi/);
    changing('read-free-0.9.0.xpi', f => fs.writeFileSync(f, 'x'), /isn't this release's/);
    changing('index.html', (f, was) => fs.writeFileSync(f, String(was).replace('href="read-free-1.3.0.xpi"', 'href="#"')), /index\.html doesn't link/);
  });

  await t.test('READFREE_FIREFOX=no: a release for Chrome alone, its page without the Firefox part', () => {
    const before = signings();
    commit('1.4.0');
    good({ READFREE_FIREFOX: 'no' });
    assert.equal(signings(), before);
    assert.deepEqual(listed(), []);
    assert.ok(/Chrome, alone/.test(String(inDist('index.html'))), 'the Chrome-only part');
    assert.ok(!/\.xpi/.test(String(inDist('index.html'))), 'no link');
    assert.equal(publish().status, 0);
  });
});

// Mozilla's API stood in for, on this machine: what the key check sends, and what it makes of the answers.
test("amo-check: signs in with the key as Mozilla wants, sends nothing, and says the account's public name", async t => {
  const http = require('node:http');
  const { createHmac } = require('node:crypto');
  const { checkKey } = await import('../tools/firefox-release.mjs');
  const key = { issuer: 'user:1:2', secret: 's'.repeat(64) };
  const asked = [];
  let taken = false;
  const server = http.createServer((req, res) => {
    const [head, body, signature] = (req.headers.authorization || '').replace(/^JWT /, '').split('.');
    const claims = body ? JSON.parse(Buffer.from(body, 'base64url')) : {};
    asked.push({ method: req.method, url: req.url, claims });
    const good = createHmac('sha256', key.secret).update(`${head}.${body}`).digest('base64url') === signature && claims.iss === key.issuer;
    if (!good) return res.writeHead(401).end('{}');
    if (req.url.endsWith('/accounts/profile/')) return res.end(JSON.stringify({ display_name: 'Read Free', email: 'private@example.com' }));
    return res.writeHead(taken ? 403 : 404).end('{}');
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/v5/`;
  const lines = await checkKey(key, { base });
  assert.deepEqual(lines, ['Mozilla takes the key. The account\'s public name: "Read Free"', 'read-free@readfree.xyz: not taken yet']);
  assert.ok(asked.every(a => a.method === 'GET'));
  assert.deepEqual(asked.map(a => a.url), ['/api/v5/accounts/profile/', '/api/v5/addons/addon/read-free%40readfree.xyz/']);
  const { iat, exp } = asked[0].claims;
  assert.equal(exp - iat, 60);
  taken = true;
  assert.match((await checkKey(key, { base }))[1], /someone may have it/);
  await assert.rejects(checkKey({ issuer: key.secret, secret: key.issuer }, { base }), /may be swapped/);
});

test('amo-test: a tiny add-on that is not Read Free, signed and checked', { skip }, async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readfree-amo-test-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const signer = path.join(tmp, 'sign.sh');
  fs.writeFileSync(signer, '#!/bin/sh\nset -e\ncd "$1"; echo uuid > .amo-upload-uuid; mkdir META-INF; for f in manifest.mf mozilla.sf mozilla.rsa; do echo x > META-INF/$f; done\nzip -q -r "$2/x.xpi" . -x .amo-upload-uuid; rm -rf META-INF\n', { mode: 0o755 });
  const file = path.join(tmp, 'out', 'test.xpi');
  const res = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'firefox-release.mjs'), 'test', file], { encoding: 'utf8', env: { ...process.env, READFREE_FIREFOX_SIGN: signer } });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const names = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).split('\n').filter(n => n && !n.endsWith('/') && !n.startsWith('META-INF'));
  assert.deepEqual(names.sort(), ['background.js', 'manifest.json']);
  const m = JSON.parse(execFileSync('unzip', ['-p', file, 'manifest.json'], { encoding: 'utf8' }));
  assert.equal(m.browser_specific_settings.gecko.id, 'read-free-signing-test@readfree.xyz');
  assert.ok(!/read.?free/i.test(m.name));
});
