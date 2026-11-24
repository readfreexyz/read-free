// Releases and the install script, end to end: tools/release.sh builds and signs releases (with a
// throwaway key), a local https server stands in for the site, and website/install.sh installs
// and updates into a temporary HOME. A copy of the script gets the test key and address, as
// tools/release.sh keygen and the maintainer would write them. Nothing is scheduled
// (--no-schedule): launchctl and crontab act on the real account whatever HOME says.
// Every refused release must leave the installed folder as it was, and nothing behind.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const settings = require('../extension/src/settings.js');

const ROOT = path.join(__dirname, '..');
const INSTALLER = path.join(ROOT, 'website', 'install.sh');
const has = cmd => spawnSync('/bin/sh', ['-c', `command -v ${cmd}`]).status === 0;
const missing = ['git', 'zip', 'unzip', 'curl', 'ssh-keygen', 'openssl'].filter(cmd => !has(cmd));
const skip = missing.length ? `needs ${missing.join(', ')}` : process.platform === 'win32' && 'not on Windows';

// The address list the shipped script holds, as the extension's
const scriptUrls = text => (text.match(/^RELEASE_URLS='(.*)'$/m)?.[1] || '').split(/\s+/).filter(Boolean);

test('the install script and the extension list the same release addresses', () => {
  assert.deepEqual(scriptUrls(fs.readFileSync(INSTALLER, 'utf8')), [...settings.RELEASE_URLS]);
  for (const url of settings.RELEASE_URLS) assert.match(url, /^https:\/\/[^\s']+\/$/);
});

test('the shipped signing key, once there, is a bare key: no user@host comment', () => {
  const signer = fs.readFileSync(INSTALLER, 'utf8').match(/^SIGNER='(.*)'$/m)[1];
  if (!signer) return; // not made yet: the script refuses to run
  assert.match(signer, /^read-free namespaces="read-free-release" ssh-ed25519 [A-Za-z0-9+/=]+$/);
});

test('install, update, and refusing every bad release', { skip }, async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readfree-install-'));
  const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  // A throwaway release key, and another that isn't it
  const key = path.join(tmp, 'release-key');
  const other = path.join(tmp, 'other-key');
  for (const k of [key, other]) run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'read-free', '-f', k]);
  const signer = `read-free namespaces="read-free-release" ${fs.readFileSync(`${key}.pub`, 'utf8').split(' ').slice(0, 2).join(' ')}`;

  // The site: https on localhost, with a certificate made here
  const site = path.join(tmp, 'site');
  fs.mkdirSync(site);
  run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost',
    '-keyout', path.join(tmp, 'tls.key'), '-out', path.join(tmp, 'tls.crt')], { stdio: 'ignore' });
  // In a process of its own: the script runs synchronously from this one. A file .truncate in
  // the site makes it send the first 1000 bytes of each zip.
  const SERVER = `
    const fs = require('fs'), path = require('path'), https = require('https');
    const [site, key, cert] = process.argv.slice(1);
    const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
      const file = path.join(site, path.basename(decodeURIComponent(req.url)));
      if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
      const body = fs.readFileSync(file);
      res.writeHead(200).end(file.endsWith('.zip') && fs.existsSync(path.join(site, '.truncate')) ? body.subarray(0, 1000) : body);
    });
    server.listen(0, 'localhost', () => console.log(server.address().port));`;
  const server = spawn(process.execPath, ['-e', SERVER, site, path.join(tmp, 'tls.key'), path.join(tmp, 'tls.crt')], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => server.kill());
  const port = await new Promise((resolve, reject) => {
    server.stdout.once('data', chunk => resolve(String(chunk).trim()));
    server.once('exit', code => reject(new Error(`the test server stopped (${code})`)));
  });
  const url = `https://localhost:${port}/`;

  // The script, with the test key and address written in
  const shipped = fs.readFileSync(INSTALLER, 'utf8');
  const script = path.join(tmp, 'install.sh');
  const writeScript = (urls, signerLine) => fs.writeFileSync(script, shipped
    .replace(/^RELEASE_URLS=.*$/m, `RELEASE_URLS='${urls}'`)
    .replace(/^SIGNER=.*$/m, `SIGNER='${signerLine}'`));
  writeScript(url, signer);

  // A repository to release from: the extension, at any version
  const repo = path.join(tmp, 'repo');
  fs.cpSync(path.join(ROOT, 'extension'), path.join(repo, 'extension'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'website'), path.join(repo, 'website'), { recursive: true });
  run('git', ['init', '-q'], { cwd: repo });
  const git = (...args) => run('git', ['-c', 'user.name=t', '-c', 'user.email=t@localhost', ...args], { cwd: repo });
  const dist = path.join(tmp, 'dist');
  const release = version => {
    const file = path.join(repo, 'extension', 'manifest.json');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/"version": "[^"]*"/, `"version": "${version}"`));
    git('add', '-A');
    git('commit', '-q', '-m', version);
    run('sh', [path.join(ROOT, 'tools', 'release.sh'), 'build'], { env: { ...process.env, READFREE_FIREFOX: 'no', READFREE_REPO: repo, READFREE_DIST: dist, READFREE_RELEASE_KEY: key, READFREE_INSTALLER: script } });
    return { zip: `read-free-${version}.zip`, latest: fs.readFileSync(path.join(dist, 'latest.txt'), 'utf8') };
  };
  const publish = () => {
    for (const f of fs.readdirSync(site)) fs.rmSync(path.join(site, f), { force: true });
    for (const f of fs.readdirSync(dist)) fs.copyFileSync(path.join(dist, f), path.join(site, f));
  };
  const sign = (keyFile, namespace = 'read-free-release') => {
    fs.rmSync(path.join(site, 'latest.txt.sig'), { force: true });
    run('ssh-keygen', ['-q', '-Y', 'sign', '-f', keyFile, '-n', namespace, path.join(site, 'latest.txt')]);
  };

  const home = path.join(tmp, 'home');
  fs.mkdirSync(home);
  const base = process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Read Free') : path.join(home, '.local', 'share', 'read-free');
  const env = { ...process.env, HOME: home, XDG_DATA_HOME: '', CURL_CA_BUNDLE: path.join(tmp, 'tls.crt'), SSL_CERT_FILE: path.join(tmp, 'tls.crt') };
  delete env.XDG_DATA_HOME;
  const sh = (...args) => spawnSync('/bin/sh', [script, ...args], { encoding: 'utf8', env, timeout: 60000 });
  const installed = () => JSON.parse(fs.readFileSync(path.join(base, 'extension', 'manifest.json'), 'utf8')).version;
  const leftovers = () => fs.readdirSync(base).filter(f => f.startsWith('.update'));
  // A release that must be refused: the installed version stays, exit 1, nothing left behind
  const refused = (label, version) => {
    const res = sh('update');
    assert.equal(res.status, 1, `${label}: exit ${res.status}\n${res.stdout}${res.stderr}`);
    assert.equal(installed(), version, label);
    assert.deepEqual(leftovers(), [], `${label}: leftovers`);
    return res.stdout;
  };

  await t.test('a copy without its address or key refuses to run, before fetching anything', () => {
    try {
      writeScript('', signer);
      let res = sh('update');
      assert.equal(res.status, 1);
      assert.match(res.stderr, /no release address/);
      writeScript(url, '');
      res = sh('update');
      assert.equal(res.status, 1);
      assert.match(res.stderr, /no signing key/);
    } finally {
      writeScript(url, signer);
    }
  });

  await t.test('install: the newest release, unpacked and kept with a copy of the script', () => {
    const one = release('1.0.0');
    assert.match(one.latest, /^read-free-release 1\nversion=1\.0\.0\nzip=read-free-1\.0\.0\.zip\nsha256=[0-9a-f]{64}\nsize=\d+\ndate=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\n$/);
    const listing = run('zipinfo', ['-1', path.join(dist, one.zip)]);
    assert.ok(listing.split('\n').includes('manifest.json'), 'the extension at the top of the zip');
    assert.doesNotMatch(listing, /\.\.\/|^\//m);
    // The local-time field in UTC too, so the two can't tell the maintainer's time zone (DOS
    // times count in 2 seconds)
    const times = run('zipinfo', ['-v', path.join(dist, one.zip)], { env: { ...process.env, TZ: 'UTC' } });
    const at = re => Date.parse(`${times.match(re)?.[1].trim()} UTC`);
    const dos = at(/last modified on \(DOS date\/time\):\s+(.+)/);
    const ut = at(/last modified on \(UT extra field modtime\):\s+(.+?)\s+local/);
    assert.ok(Number.isFinite(dos), 'a DOS time');
    if (Number.isFinite(ut)) assert.ok(Math.abs(dos - ut) <= 2000, `DOS ${new Date(dos).toISOString()} vs UT ${new Date(ut).toISOString()}`);
    // The front page, with the release and the site's address written in
    const page = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    const field = name => one.latest.match(new RegExp(`^${name}=(.*)$`, 'm'))[1];
    assert.doesNotMatch(page, /\{\{/);
    assert.ok(page.includes(`href="${one.zip}"`) && fs.existsSync(path.join(dist, one.zip)), 'links the zip');
    assert.ok(page.includes(`Version 1.0.0, released ${field('date').slice(0, 10)}`), 'the version and date');
    assert.ok(page.includes(`curl -fsSLO ${url}install.sh &amp;&amp; sh install.sh`), 'the install command');
    assert.ok(page.includes(field('sha256')), "the zip's SHA-256");
    // The Windows installer, with this release's key and addresses written in
    const ps1 = fs.readFileSync(path.join(dist, 'install.ps1'), 'utf8');
    assert.ok(ps1.split('\n').includes(`$SIGNER = '${signer}'`), 'install.ps1: the release key');
    assert.ok(ps1.split('\n').includes(`$RELEASE_URLS = '${url}'`), 'install.ps1: the addresses');
    publish();
    const res = sh('install', '--no-schedule');
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.equal(installed(), '1.0.0');
    // The kept copy: on macOS its name is what Login Items lists the LaunchAgent as, so the
    // LaunchAgent runs it directly (executable), not through /bin/sh
    const self = path.join(base, process.platform === 'darwin' ? 'Read Free updater' : 'update.sh');
    assert.equal(fs.readFileSync(self, 'utf8'), fs.readFileSync(script, 'utf8'));
    assert.ok(fs.statSync(self).mode & 0o100, 'the kept copy is executable');
    const plist = fs.readFileSync(INSTALLER, 'utf8').match(/<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]*)<\/string>/);
    assert.equal(plist?.[1], '$(xml "$SELF")', 'the LaunchAgent runs the kept copy itself');
    assert.match(res.stdout, /Load unpacked/);
    // Afterwards: the installed copy, for status and uninstall; the copy that was run can go
    assert.ok(res.stdout.includes(`sh '${self}' uninstall`), `how to stop the updates:\n${res.stdout}`);
    assert.ok(res.stdout.includes(`You can delete ${script}: Read Free keeps its own copy`), 'the copy that was run can go');
    assert.deepEqual(leftovers(), []);
    const again = sh('update');
    assert.equal(again.status, 0);
    assert.equal(again.stdout, '', 'up to date: nothing to log');
  });

  await t.test('update: a newer release replaces the folder', () => {
    release('1.0.10');
    publish();
    const res = sh('update');
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.equal(installed(), '1.0.10');
    assert.match(res.stdout, /updated: 1\.0\.0 -> 1\.0\.10/);
    assert.deepEqual(leftovers(), []);
  });

  await t.test('an older release (1.0.9 after 1.0.10), or the same one, is not installed', () => {
    release('1.0.9');
    publish();
    assert.equal(sh('update').status, 0);
    assert.equal(installed(), '1.0.10');
  });

  const good = release('1.1.0');
  const edit = (file, fn) => fs.writeFileSync(path.join(site, file), fn(fs.readFileSync(path.join(site, file))));

  await t.test('latest.txt changed after signing', () => {
    publish();
    edit('latest.txt', text => String(text).replace('version=1.1.0', 'version=1.1.1').replace(good.zip, 'read-free-1.1.1.zip'));
    fs.copyFileSync(path.join(site, good.zip), path.join(site, 'read-free-1.1.1.zip'));
    assert.match(refused('edited', '1.0.10'), /isn't signed with the Read Free key/);
  });

  await t.test('signed with another key', () => {
    publish();
    sign(other);
    assert.match(refused('other key', '1.0.10'), /isn't signed/);
  });

  await t.test('the right key, for something else (another namespace)', () => {
    publish();
    sign(key, 'file');
    assert.match(refused('namespace', '1.0.10'), /isn't signed/);
  });

  await t.test('a signed latest.txt with another zip behind it', () => {
    publish();
    const zip = path.join(site, good.zip);
    const bytes = fs.readFileSync(zip);
    bytes[bytes.length - 30] ^= 0xff; // same size, other contents
    fs.writeFileSync(zip, bytes);
    assert.match(refused('swapped zip', '1.0.10'), /isn't the file that was signed/);
  });

  await t.test('a truncated download', () => {
    publish();
    fs.writeFileSync(path.join(site, '.truncate'), '');
    try {
      assert.match(refused('truncated', '1.0.10'), /no answer|isn't the file that was signed/);
    } finally {
      fs.rmSync(path.join(site, '.truncate'));
    }
  });

  await t.test('a signed release whose zip holds another version', () => {
    publish();
    // 1.2.0's description, signed, pointing at 1.1.0's zip renamed
    fs.renameSync(path.join(site, good.zip), path.join(site, 'read-free-1.2.0.zip'));
    edit('latest.txt', text => String(text).replace('version=1.1.0', 'version=1.2.0').replace(good.zip, 'read-free-1.2.0.zip'));
    sign(key);
    assert.match(refused('wrong version inside', '1.0.10'), /doesn't hold Read Free 1\.2\.0/);
  });

  await t.test('a signed description that isn’t a release this script knows', () => {
    publish();
    edit('latest.txt', text => String(text).replace(`zip=${good.zip}`, 'zip=../../evil.zip'));
    sign(key);
    assert.match(refused('bad zip name', '1.0.10'), /isn't a release this script knows/);
  });

  await t.test('a mirror that fails, then one that works', () => {
    publish();
    writeScript(`https://localhost:1/ ${url}`, signer);
    const res = sh('update');
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.equal(installed(), '1.1.0');
    assert.match(res.stdout, /localhost:1\/: no answer[\s\S]*updated: 1\.0\.10 -> 1\.1\.0/, 'the failure is logged with the update');
  });

  await t.test('plain http, or no key, is refused before anything is fetched', () => {
    writeScript(url.replace('https:', 'http:'), signer);
    assert.match(sh('update').stderr, /not an https address/);
    writeScript(url, '');
    assert.match(sh('update').stderr, /no signing key/);
    writeScript(url, signer);
  });

  await t.test('build: refuses without a release address, or with one that isn’t plain', () => {
    const build = () => spawnSync('sh', [path.join(ROOT, 'tools', 'release.sh'), 'build'], { encoding: 'utf8', env: { ...process.env, READFREE_FIREFOX: 'no', READFREE_REPO: repo, READFREE_DIST: dist, READFREE_RELEASE_KEY: key, READFREE_INSTALLER: script } });
    try {
      writeScript('', signer);
      assert.match(build().stderr, /no release address yet/);
      writeScript('https://localhost/a;sh/', signer);
      assert.match(build().stderr, /isn't a plain https address/);
    } finally {
      writeScript(url, signer);
    }
  });

  await t.test('status', () => {
    const res = sh('status');
    assert.equal(res.status, 0);
    assert.match(res.stdout, /version: 1\.1\.0/);
  });
});
