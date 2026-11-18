#!/usr/bin/env node
// End-to-end check of updating itself (docs/auto-update.md), in a real Chrome, offline.
//
//   node tools/auto-update-check.mjs [--source <git work tree>] [--chromium <binary>]
//
// --source: a repository whose committed HEAD has the updater (default: this one).
// --chromium: the browser (default: Google Chrome, else Chrome for Testing from Playwright's
// cache). It runs headless, with a profile of its own, deleted afterwards.
//
// In a temporary folder: a bare repository stands in for GitHub, a clone of it is the release
// copy, and a second clone makes releases. The release copy is loaded as "Load unpacked" loads
// it (DevTools' Extensions.loadUnpacked), with Developer mode on, as in the reader's Chrome:
// with it off, Chrome turns unpacked extensions off when they reload
// (DISABLE_UNSUPPORTED_DEVELOPER_EXTENSION). Each release is committed, pushed, then pulled into
// the release copy with the LaunchAgent's own command. Then it waits for the extension to reload
// itself:
//   1-2. two releases in a row, each changing the service worker as well as the version, with
//        the worker left to stop before each: the new code must be running after each;
//   3.   a release whose manifest names a missing file: it must not be loaded;
//   4.   the release that adds the file: it must be.
// The running version is read from the extension's service worker (attached only to read, so it
// still stops when idle; the update alarm wakes it every minute), with a mark each release sets
// in it, so the new code is checked as well as the new manifest.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []));
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SOURCE = path.resolve(args.source || ROOT);
const CHROMIUM = args.chromium || findChromium();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = msg => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

function findChromium() {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (fs.existsSync(chrome)) return chrome;
  const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const builds = fs.existsSync(cache) ? fs.readdirSync(cache).filter(d => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const build of builds) {
    for (const app of ['Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'Chromium.app/Contents/MacOS/Chromium']) {
      for (const arch of ['chrome-mac-arm64', 'chrome-mac', 'chrome-mac-x64']) {
        const bin = path.join(cache, build, arch, app);
        if (fs.existsSync(bin)) return bin;
      }
    }
  }
  throw new Error('No Chrome found: pass --chromium <binary>.');
}

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
// What the LaunchAgent runs.
const pull = release => git(release, 'pull', '--ff-only', '--no-rebase', '--quiet');

// A minimal DevTools Protocol client over --remote-debugging-pipe: Chrome reads commands from
// file descriptor 3 and writes on 4, each message ending in a NUL.
function connect(browser) {
  let next = 0;
  let buffer = '';
  const pending = new Map();
  browser.stdio[4].on('data', chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} ${msg.error.data || ''}`));
        else resolve(msg.result);
      }
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve, reject });
    browser.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
  });
  return { send };
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nytfix-update-'));
  const origin = path.join(tmp, 'origin.git');
  const release = path.join(tmp, 'release');
  const dev = path.join(tmp, 'dev');
  git(tmp, 'clone', '--quiet', '--bare', SOURCE, origin);
  git(tmp, 'clone', '--quiet', origin, release);
  git(tmp, 'clone', '--quiet', origin, dev);
  for (const repo of [dev]) {
    git(repo, 'config', 'user.name', 'auto-update check');
    git(repo, 'config', 'user.email', 'check@localhost');
  }
  const manifestPath = dir => path.join(dir, 'extension/manifest.json');
  const startVersion = JSON.parse(fs.readFileSync(manifestPath(release), 'utf8')).version;
  log(`release copy at ${startVersion}: ${release}`);
  if (!fs.readFileSync(path.join(release, 'extension/src/update.js'), 'utf8')) throw new Error('no updater in the source');

  const profile = path.join(tmp, 'profile');
  const ext = path.join(release, 'extension');
  log(`browser: ${CHROMIUM}`);
  const browser = spawn(CHROMIUM, [
    '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  let failed = false;
  try {
    const cdp = connect(browser);
    await sleep(1500);

    // Run an expression in a service worker: attach, evaluate, detach (an attached worker
    // doesn't stop).
    async function inWorker(targetId, expression) {
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      try {
        const res = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
        if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
        return res.result.value;
      } finally {
        await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {});
      }
    }
    const workers = async () => (await cdp.send('Target.getTargets')).targetInfos.filter(t => t.type === 'service_worker');

    // Developer mode on, as the toggle on chrome://extensions turns it on.
    const { targetId: extPage } = await cdp.send('Target.createTarget', { url: 'chrome://extensions' });
    await sleep(1500);
    const { sessionId: extSession } = await cdp.send('Target.attachToTarget', { targetId: extPage, flatten: true });
    const devMode = await cdp.send('Runtime.evaluate', {
      expression: 'chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }).then(() => chrome.developerPrivate.getProfileConfiguration()).then(c => c.inDeveloperMode)',
      awaitPromise: true, returnByValue: true,
    }, extSession);
    await cdp.send('Target.closeTarget', { targetId: extPage });
    if (devMode.result.value !== true) throw new Error("couldn't turn Developer mode on");

    // Load unpacked.
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: ext });
    for (let i = 0; i < 50 && !(await workers()).some(t => new URL(t.url).host === id); i++) await sleep(100);
    log(`extension ${id} loaded unpacked, Developer mode on`);
    const worker = async () => (await workers()).find(t => new URL(t.url).host === id);
    const workerRunning = async () => Boolean(await worker());

    // The running version and the service worker's mark, read from the worker. The update
    // alarm wakes it every minute, so wait up to 75 s for it.
    async function read() {
      for (let i = 0; i < 75; i++) {
        const t = await worker();
        if (t) {
          try {
            return await inWorker(t.targetId, '({ version: chrome.runtime.getManifest().version, mark: self.E2E_MARK ?? null })');
          } catch (e) {
            if (i > 70) return { error: e.message }; // stopping or reloading: try again
          }
        }
        await sleep(1000);
      }
      return { error: 'the service worker never came up' };
    }

    // A release from the dev clone: a new version, and a service worker that sets `mark`.
    let counter = 0;
    function publish(version, { mark, extraScript, addFile } = {}) {
      const m = JSON.parse(fs.readFileSync(manifestPath(dev), 'utf8'));
      m.version = version;
      if (extraScript) m.content_scripts[0].js.push(extraScript);
      fs.writeFileSync(manifestPath(dev), `${JSON.stringify(m, null, 2)}\n`);
      if (mark) {
        const sw = path.join(dev, 'extension/background.js');
        const code = fs.readFileSync(sw, 'utf8').split('\n').filter(line => !line.includes('E2E_MARK')).join('\n').trimEnd();
        fs.writeFileSync(sw, `${code}\nself.E2E_MARK = ${JSON.stringify(mark)};\n`);
      }
      if (addFile) fs.writeFileSync(path.join(dev, 'extension', addFile), '// added by the check\n');
      git(dev, 'commit', '--quiet', '-am', `check release ${++counter}: ${version}`);
      if (addFile) { git(dev, 'add', path.join('extension', addFile)); git(dev, 'commit', '--quiet', '--amend', '--no-edit'); }
      git(dev, 'push', '--quiet', 'origin', 'HEAD');
      pull(release);
      log(`released ${version} and pulled it into the release copy`);
    }

    async function idle() {
      for (let i = 0; i < 12 && await workerRunning(); i++) await sleep(5000);
      log(`service worker ${await workerRunning() ? 'still running' : 'stopped'}`);
    }

    async function expectLoaded(version, mark, minutes = 5) {
      const until = Date.now() + minutes * 60_000;
      let state;
      while (Date.now() < until) {
        await sleep(15_000);
        state = await read();
        if (state.version === version) break;
      }
      const ok = state?.version === version && state?.mark === mark;
      log(`${ok ? 'PASS' : 'FAIL'}: running ${state?.version} (mark ${state?.mark}), expected ${version} (mark ${mark})`);
      if (!ok) failed = true;
    }

    async function expectNotLoaded(version, still, minutes = 3) {
      const until = Date.now() + minutes * 60_000;
      let state;
      while (Date.now() < until) {
        await sleep(15_000);
        state = await read();
        if (state.version === version) break;
      }
      const ok = state?.version === still;
      log(`${ok ? 'PASS' : 'FAIL'}: after ${minutes} min, running ${state?.version}; ${version} (incomplete) must not load`);
      if (!ok) failed = true;
    }

    log(`start: ${JSON.stringify(await read())}`);
    const [a, b, c] = startVersion.split('.').map(Number);
    const v = n => `${a}.${b}.${c + n}`;

    await idle();
    publish(v(1), { mark: 'one' });
    await expectLoaded(v(1), 'one');

    await idle();
    publish(v(2), { mark: 'two' });
    await expectLoaded(v(2), 'two');

    await idle();
    publish(v(3), { extraScript: 'src/check-missing.js' });
    await expectNotLoaded(v(3), v(2));

    publish(v(4), { addFile: 'src/check-missing.js' });
    await expectLoaded(v(4), 'two');

  } finally {
    browser.kill();
    await sleep(500);
    if (!args.keep) fs.rmSync(tmp, { recursive: true, force: true });
  }
  log(failed ? 'FAILED' : 'all passed');
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
