#!/usr/bin/env node
// The signed Firefox file of a release (docs/firefox.md), for tools/release.sh build.
//
//   node tools/firefox-release.mjs <repository> <site address> <folder>
//   node tools/firefox-release.mjs check       tools/release.sh amo-check: does Mozilla take the
//                                              API key? Signs in, and sends nothing else.
//   node tools/firefox-release.mjs test <file> tools/release.sh amo-test: has Mozilla sign a tiny
//                                              add-on that isn't Read Free, and checks it.
//
// Writes <folder>/read-free-<version>.xpi and <folder>/updates.json, from the repository's committed
// extension/ (HEAD). Firefox only keeps add-ons Mozilla has signed, so the package goes to Mozilla
// (web-ext sign, channel "unlisted": signed, not listed on its store), with the API key kept in the
// macOS Keychain by `tools/release.sh amo-key`; macOS asks before handing it over.
//
// Mozilla signs a version number once. So a signed file is kept (READFREE_FIREFOX_CACHE, by default
// ~/.cache/read-free/firefox), by version and what's in it: building the same extension again uses
// it, and a changed extension with a version already signed is refused. READFREE_FIREFOX_XPI: a
// signed file to use instead, downloaded by hand from Mozilla's developer pages (its review took
// long, or the kept one is gone). Whichever it is, it must hold exactly the package, plus Mozilla's
// signature (META-INF/).
// For tests: READFREE_FIREFOX_SIGN, a command run instead of web-ext with the package's folder and
// the folder for the signed file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { ID, MIN_VERSION, build } from './firefox.mjs';

const WEB_EXT = 'web-ext@10.8.0';
const KEYCHAIN = 'read-free-amo'; // the same as tools/release.sh's AMO_SERVICE
const SIGNATURE = ['META-INF/manifest.mf', 'META-INF/mozilla.sf', 'META-INF/mozilla.rsa'];

const sha256 = data => createHash('sha256').update(data).digest('hex');

// Every file under dir, as 'a/b.js', sorted
export function filesIn(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? filesIn(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  }).sort();
}

// What's in a package, as one hash
export const digest = dir => sha256(filesIn(dir).map(f => `${f}\0${sha256(fs.readFileSync(path.join(dir, f)))}\n`).join(''));

// Mozilla writes manifest.json anew when it signs (seen 2026-11-24: the same but for the line break
// at its end), so that one is compared by what it says.
const sameJson = (a, b) => {
  try { return isDeepStrictEqual(JSON.parse(a), JSON.parse(b)); } catch { return false; }
};

// Throws unless the .xpi is the package in dir, signed by Mozilla: the same files with the same
// bytes (manifest.json: the same content), and the signature's.
export function checkSigned(xpi, dir) {
  const listing = spawnSync('unzip', ['-Z1', xpi], { encoding: 'utf8' });
  if (listing.status !== 0) throw new Error(`${path.basename(xpi)} isn't a zip file`);
  const names = listing.stdout.split('\n').filter(n => n && !n.endsWith('/'));
  for (const name of SIGNATURE) if (!names.includes(name)) throw new Error(`${path.basename(xpi)} isn't signed by Mozilla (no ${name})`);
  const own = names.filter(n => !n.startsWith('META-INF/')).sort();
  const wanted = filesIn(dir);
  const odd = [...own.filter(n => !wanted.includes(n)), ...wanted.filter(n => !own.includes(n))];
  if (odd.length || own.length !== wanted.length) throw new Error(`${path.basename(xpi)} doesn't hold this release's files (${odd.slice(0, 3).join(', ') || 'one twice'})`);
  for (const name of wanted) {
    // unzip takes names as patterns: escape what it would expand
    const out = spawnSync('unzip', ['-p', xpi, name.replace(/[[\]*?\\]/g, '\\$&')], { maxBuffer: 1 << 27 });
    const sent = fs.readFileSync(path.join(dir, name));
    const same = out.status === 0 && (out.stdout.equals(sent) || (name === 'manifest.json' && sameJson(out.stdout, sent)));
    if (!same) throw new Error(`${path.basename(xpi)} has another ${name} than this release`);
  }
}

// Firefox's update manifest: where the newest version is, and its hash. Here the minimum version
// goes under "applications": Firefox 160 passes over "browser_specific_settings" in this file.
export function updates({ version, site, file, hash }) {
  const update = { version, update_link: `${site}${file}`, update_hash: `sha256:${hash}`, applications: { gecko: { strict_min_version: MIN_VERSION } } };
  return `${JSON.stringify({ addons: { [ID]: { updates: [update] } } }, null, 2)}\n`;
}

function apiKey() {
  const read = account => {
    const found = spawnSync('security', ['find-generic-password', '-s', KEYCHAIN, '-a', account, '-w'], { encoding: 'utf8' });
    return found.status === 0 ? found.stdout.trim() : '';
  };
  const issuer = read('issuer');
  const secret = issuer && read('secret');
  if (!issuer || !secret) throw new Error("no Mozilla API key (tools/release.sh amo-key), or macOS wasn't allowed to hand it over. READFREE_FIREFOX=no releases for Chrome alone");
  return { issuer, secret };
}

// Has Mozilla sign the package in dir; returns the signed file, in the folder out. A copy is sent:
// web-ext leaves a file of its own in the folder it signs (.amo-upload-uuid), and dir is what the
// signed file is checked against.
function sign(dir, out) {
  fs.mkdirSync(out, { recursive: true });
  const sending = path.join(path.dirname(dir), 'sending');
  fs.cpSync(dir, sending, { recursive: true });
  const stand = process.env.READFREE_FIREFOX_SIGN;
  let done;
  if (stand) {
    done = spawnSync(stand, [sending, out], { stdio: 'inherit' });
  } else {
    const { issuer, secret } = apiKey();
    console.error('firefox: sending the package to Mozilla to sign (a few minutes)');
    // Only what it needs; in UTC, as a zip keeps local times. The key goes in the environment, not
    // on the command line, where other programs could read it.
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR || os.tmpdir(), TZ: 'UTC', WEB_EXT_API_KEY: issuer, WEB_EXT_API_SECRET: secret };
    done = spawnSync('npx', ['--yes', WEB_EXT, 'sign', '--source-dir', sending, '--artifacts-dir', out, '--channel', 'unlisted', '--no-input', '--no-config-discovery', '--approval-timeout', '900000'],
      { stdio: ['ignore', process.stderr, process.stderr], env, cwd: path.dirname(dir) });
  }
  const signed = fs.readdirSync(out).filter(f => f.endsWith('.xpi'));
  if (done.status !== 0 || signed.length !== 1) {
    throw new Error("Mozilla didn't return a signed file. If it's still reviewing this version, download the file from its developer pages once it's there and build again with READFREE_FIREFOX_XPI=<file>; READFREE_FIREFOX=no releases for Chrome alone");
  }
  return path.join(out, signed[0]);
}

// Mozilla's API, signed in with the key: what web-ext sends (a JWT, good for a minute).
const AMO = 'https://addons.mozilla.org/api/v5/';
function jwt({ issuer, secret }, now = Date.now()) {
  const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const iat = Math.floor(now / 1000);
  const body = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ iss: issuer, jti: randomUUID(), iat, exp: iat + 60 })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

// Does Mozilla take the key? Returns what to say: the account's public name, so a personal one is
// noticed, and whether Read Free's id is free. Reads only; nothing is uploaded.
export async function checkKey(key, { base = AMO, fetch = globalThis.fetch } = {}) {
  const get = async where => fetch(new URL(where, base), { headers: { Authorization: `JWT ${jwt(key)}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  const profile = await get('accounts/profile/');
  if (profile.status === 401 || profile.status === 403) {
    throw new Error("Mozilla doesn't take this key: the two parts may be swapped, or one pasted short. Run tools/release.sh amo-key again");
  }
  if (!profile.ok) throw new Error(`Mozilla answered ${profile.status}`);
  const { display_name: shown } = await profile.json();
  const lines = [`Mozilla takes the key. The account's public name: ${shown ? `"${shown}"` : 'none set (set it to Read Free on its developer pages)'}`];
  const addon = await get(`addons/addon/${encodeURIComponent(ID)}/`);
  lines.push(addon.status === 404 ? `${ID}: not taken yet` : addon.ok ? `${ID}: already this account's, or public` : `${ID}: Mozilla answered ${addon.status}; someone may have it`);
  return lines;
}

// A tiny add-on that does nothing, under an id of its own and a version of the minute, signed like a
// release and checked like one.
export const TEST_ID = 'read-free-signing-test@readfree.xyz';
export function testSigning(file, now = Date.now()) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readfree-firefox-test-'));
  try {
    const dir = path.join(tmp, 'package');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify({
      manifest_version: 3, name: 'Signing test', version: `1.${Math.floor(now / 60000)}`, description: 'Checks that signing works. It does nothing.',
      background: { scripts: ['background.js'] },
      browser_specific_settings: { gecko: { id: TEST_ID, strict_min_version: MIN_VERSION, data_collection_permissions: { required: ['none'] } } },
    }, null, 2)}\n`);
    fs.writeFileSync(path.join(dir, 'background.js'), '// Does nothing.\n');
    const signed = sign(dir, path.join(tmp, 'signed'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(signed, file); // kept even if the check refuses it
    checkSigned(signed, dir);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function release({ repo, site, dist, cache = process.env.READFREE_FIREFOX_CACHE || path.join(os.homedir(), '.cache', 'read-free', 'firefox'), given = process.env.READFREE_FIREFOX_XPI }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readfree-firefox-'));
  try {
    const dir = path.join(tmp, 'package');
    const { version } = build({ repo, from: 'HEAD', out: dir, site });
    if (!/^\d{1,5}(\.\d{1,5}){0,3}$/.test(version)) throw new Error(`not a version: ${version}`);
    fs.mkdirSync(cache, { recursive: true });
    const kept = path.join(cache, `${version}-${digest(dir).slice(0, 16)}.xpi`);
    let signed = kept;
    if (given) {
      checkSigned(given, dir);
      signed = given;
    } else if (!fs.existsSync(kept)) {
      if (fs.readdirSync(cache).some(f => f.startsWith(`${version}-`) && f.endsWith('.xpi'))) {
        throw new Error(`Mozilla has signed ${version} already, with another extension in it, and signs a version once: bump the version`);
      }
      signed = sign(dir, path.join(tmp, 'signed'));
      // Mozilla won't sign this version again: if the check refuses the file, it's kept to look at
      try {
        checkSigned(signed, dir);
      } catch (e) {
        const refused = path.join(cache, `refused-${version}.xpi`);
        fs.copyFileSync(signed, refused);
        throw new Error(`${e.message}. Mozilla has signed ${version} now; its file is kept at ${refused}`);
      }
    }
    checkSigned(signed, dir);
    if (signed !== kept) fs.copyFileSync(signed, kept);
    const file = `read-free-${version}.xpi`;
    const data = fs.readFileSync(kept);
    for (const old of fs.existsSync(dist) ? fs.readdirSync(dist) : []) if (/^read-free-.*\.xpi$/.test(old)) fs.rmSync(path.join(dist, old));
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, file), data);
    fs.writeFileSync(path.join(dist, 'updates.json'), updates({ version, site, file, hash: sha256(data) }));
    return file;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [repo, site, dist] = process.argv.slice(2);
  if (repo === 'check' && !site) {
    try {
      for (const line of await checkKey(apiKey())) console.log(line);
    } catch (e) {
      console.error(`firefox: ${e.message}`);
      process.exit(1);
    }
    process.exit(0);
  }
  if (repo === 'test' && site && !dist) {
    try {
      testSigning(path.resolve(site));
      console.log(`Mozilla signed the test add-on, and it's what was sent: ${site}`);
    } catch (e) {
      console.error(`firefox: ${e.message}`);
      process.exit(1);
    }
    process.exit(0);
  }
  if (!dist) {
    console.error('usage: node tools/firefox-release.mjs <repository> <site address> <folder>');
    process.exit(2);
  }
  try {
    console.log(release({ repo, site, dist }));
  } catch (e) {
    console.error(`firefox: ${e.message}`);
    process.exit(1);
  }
}
