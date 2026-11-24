#!/usr/bin/env node
// The Firefox package (docs/firefox.md): the extension's files, with a manifest for Firefox.
//
//   node tools/firefox.mjs [--out <folder>] [--from <commit>] [--site <address>]
//
// Writes <folder> (default build/firefox/): extension/'s files, from the working folder or, with
// --from, as committed there (git archive <commit>:extension, as tools/release.sh does), and a
// manifest.json made from Chrome's by firefoxManifest() below. extension/manifest.json stays
// Chrome's own, so Chrome never sees keys it doesn't know. --site: the address Firefox checks for
// updates (<site>updates.json); by default the first of settings.RELEASE_URLS.
//
// To try it: about:debugging > This Firefox > Load Temporary Add-on, and pick
// build/firefox/manifest.json. Firefox keeps a temporary add-on until it quits.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { importedScripts } = require('../extension/src/update.js');

// Read Free's id with Mozilla. Permanent: installed copies, their storage.sync and Mozilla's
// signing all go by it.
export const ID = 'read-free@readfree.xyz';
// The oldest Firefox it's for: 140 has Firefox's own consent for data that leaves the browser
// (data_collection_permissions below); scripts in the page's world (page/*.js) need 128.
export const MIN_VERSION = '140.0';
// What leaves the browser: the article's address, sent to archive.today to find its snapshot.
// Mozilla's name for it is browsingActivity ("specific URLs"); Firefox lists it when installing.
export const DATA = Object.freeze({ required: Object.freeze(['browsingActivity']) });

// Firefox's manifest from Chrome's. backgroundSource: the service worker's code, whose
// importScripts(...) calls give the files Firefox loads before it (a background page has no
// importScripts). site: Read Free's site, ending in /, where updates.json is.
export function firefoxManifest(manifest, backgroundSource, site) {
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?\/(?:[A-Za-z0-9._~-]+\/)*$/.test(String(site))) {
    throw new Error(`not a plain https address ending in /: ${site}`);
  }
  const worker = manifest?.background?.service_worker;
  if (typeof worker !== 'string' || !worker) throw new Error('the manifest has no background.service_worker');
  const { service_worker: _, ...background } = manifest.background;
  return {
    ...manifest,
    background: { ...background, scripts: [...importedScripts(backgroundSource), worker] },
    browser_specific_settings: {
      gecko: {
        id: ID,
        strict_min_version: MIN_VERSION,
        update_url: `${site}updates.json`,
        data_collection_permissions: { required: [...DATA.required] },
      },
    },
  };
}

// Makes the package in the folder `out` (emptied first) and returns its manifest. from: a commit of
// the repository `repo`, or null for its working folder.
export function build({ repo = ROOT, from = null, out, site }) {
  const ext = path.join(repo, 'extension');
  const target = path.resolve(out);
  // Never the repository, the extension, or a folder holding them: the folder is emptied first
  for (const kept of [path.resolve(repo), path.resolve(ext), ROOT]) {
    if (target === kept || kept.startsWith(target + path.sep)) throw new Error(`won't write into ${target}`);
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  if (from) {
    if (!/^[A-Za-z0-9._/~^-]+$/.test(from) || from.startsWith('-')) throw new Error(`not a commit: ${from}`);
    const tar = execFileSync('git', ['-C', repo, 'archive', '--format=tar', `${from}:extension`], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'inherit'] });
    execFileSync('tar', ['-x', '-C', target], { input: tar, stdio: ['pipe', 'ignore', 'inherit'] });
  } else {
    // The working folder, without the Finder's .DS_Store and other hidden files
    fs.cpSync(ext, target, { recursive: true, filter: file => file === ext || !path.basename(file).startsWith('.') });
  }
  const chromeManifest = JSON.parse(fs.readFileSync(path.join(target, 'manifest.json'), 'utf8'));
  const worker = chromeManifest.background?.service_worker;
  if (typeof worker !== 'string') throw new Error('the manifest has no background.service_worker');
  const manifest = firefoxManifest(chromeManifest, fs.readFileSync(path.join(target, worker), 'utf8'), site);
  for (const file of manifest.background.scripts) {
    if (!fs.existsSync(path.join(target, file))) throw new Error(`the background script ${file} isn't there`);
  }
  fs.writeFileSync(path.join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function fail(message) {
  console.error(`firefox: ${message}`);
  process.exit(1);
}

function main(argv) {
  const options = { out: path.join(ROOT, 'build', 'firefox'), from: null, site: null };
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (!['--out', '--from', '--site'].includes(flag) || value === undefined) {
      fail('usage: node tools/firefox.mjs [--out <folder>] [--from <commit>] [--site <address>]');
    }
    options[flag.slice(2)] = value;
  }
  const site = options.site ?? require('../extension/src/settings.js').RELEASE_URLS[0];
  let manifest;
  try { manifest = build({ out: options.out, from: options.from, site }); } catch (e) { fail(e.message); }
  console.log(`firefox: Read Free ${manifest.version} for Firefox in ${path.relative(process.cwd(), path.resolve(options.out)) || '.'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
