// Updating itself: reload the extension when a newer version is on disk (docs/auto-update.md).
// - The copy Chrome runs is a git clone that a macOS LaunchAgent fast-forwards from GitHub every
//   hour. Chrome reads an unpacked extension's files when it loads it, so after a pull the copy
//   that's running is out of date until it's reloaded. chrome.runtime.reload() reloads it from
//   the folder.
// - Every minute (an alarm: the service worker stops after ~30 s idle) this reads manifest.json
//   from disk. If its version is newer than the running one, it reloads, but:
//   - not the first time it sees it: the same version must be there a minute later, so a pull
//     still writing files isn't loaded halfway;
//   - not if a file the new version needs is missing: an unpacked extension that fails to load
//     stays off, this check with it, until someone reloads it by hand;
//   - not while it would cut the reader off (an archive.today download in flight, the toolbar
//     menu or an extension page open), for up to 30 minutes; then it reloads anyway.
// - Open tabs keep the old content scripts; the new version applies to pages loaded after.
// - Releasing is bumping the manifest version and pushing: a change without a new version isn't
//   picked up.
(function (root) {
  'use strict';

  const ALARM = 'nytfix:update';
  const PERIOD_MINUTES = 1;
  const MAX_WAIT_MS = 30 * 60 * 1000;
  const FETCH_MARGIN_MS = 5000; // after an archive.today download's own timeout
  const SEEN_KEY = 'nytfix:update'; // in storage.session: { version, since }
  const ignore = () => {};
  const log = msg => console.info(`[Read Free] update: ${msg}`);

  // Chrome's versions: one to four dot-separated integers. '0.14.10' is newer than '0.14.9'.
  const VERSION = /^\d+(?:\.\d+){0,3}$/;
  function compareVersions(a, b) {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return Math.sign(d);
    }
    return 0;
  }
  const isNewer = (candidate, current) => VERSION.test(String(candidate)) && compareVersions(candidate, current) > 0;

  // The files Chrome needs to load this manifest: the service worker, content scripts and styles,
  // pages and icons.
  function manifestFiles(m) {
    const files = new Set();
    const add = f => { if (typeof f === 'string' && f) files.add(f.replace(/^\//, '')); };
    const addIcons = icons => { if (typeof icons === 'string') add(icons); else if (icons) Object.values(icons).forEach(add); };
    add(m?.background?.service_worker);
    for (const cs of m?.content_scripts || []) {
      (cs.js || []).forEach(add);
      (cs.css || []).forEach(add);
    }
    add(m?.action?.default_popup);
    addIcons(m?.action?.default_icon);
    addIcons(m?.icons);
    add(m?.options_ui?.page);
    add(m?.options_page);
    return [...files];
  }

  // The files a service worker loads with importScripts('a.js', 'b.js').
  function importedScripts(source) {
    const files = [];
    for (const call of String(source).matchAll(/importScripts\(([^)]*)\)/g)) {
      for (const lit of call[1].matchAll(/(['"])([^'"]+)\1/g)) files.push(lit[2].replace(/^\//, ''));
    }
    return files;
  }

  // chrome: the extension API; fetch: reads the extension's own files; now: the clock.
  function createUpdater({ chrome, fetch, now = Date.now }) {
    const url = file => chrome.runtime.getURL(file);
    const read = file => fetch(url(file), { cache: 'no-store' });
    // Kept in storage.session: the service worker stops between ticks. Cleared on reload.
    const session = chrome.storage?.session;
    let memory = null;
    const recall = async () => (session ? (await session.get(SEEN_KEY))[SEEN_KEY] || null : memory);
    const remember = async value => { if (session) await session.set({ [SEEN_KEY]: value }); else memory = value; };
    const forget = async () => { if (session) await session.remove(SEEN_KEY); else memory = null; };

    // A content script's archive.today download: busy until its timeout has passed.
    let fetchesUntil = 0;
    function noteMessage(msg, sender) {
      if (sender?.id !== chrome.runtime.id || msg?.type !== 'nytfix:fetch') return;
      noteFetch(msg.timeoutMs);
    }

    // A download started (or was asked for): it has this long.
    function noteFetch(ms) {
      const timeoutMs = Number(ms) > 0 ? Number(ms) : 20000;
      fetchesUntil = Math.max(fetchesUntil, now() + timeoutMs + FETCH_MARGIN_MS);
    }

    async function busy() {
      if (now() < fetchesUntil) return 'an archive.today download is in flight';
      try {
        const open = await chrome.runtime.getContexts?.({ contextTypes: ['POPUP', 'TAB'] });
        if (open?.length) return 'the toolbar menu or an extension page is open';
      } catch {
        // Chrome before 116: no getContexts.
      }
      return '';
    }

    async function missingFiles(manifest) {
      const files = manifestFiles(manifest);
      const sw = manifest?.background?.service_worker;
      if (sw) {
        try {
          const res = await read(sw);
          if (res.ok) files.push(...importedScripts(await res.text()));
        } catch {
          // Missing: counted below.
        }
      }
      const missing = [];
      for (const file of new Set(files)) {
        try {
          const res = await read(file);
          if (!res.ok) missing.push(file);
        } catch {
          missing.push(file);
        }
      }
      return missing;
    }

    // One check. Returns what it did: 'current', 'unreadable', 'seen', 'incomplete', 'busy' or
    // 'reloaded'.
    async function tick() {
      const running = chrome.runtime.getManifest().version;
      let disk;
      try {
        disk = await (await read('manifest.json')).json();
      } catch {
        return 'unreadable'; // being written: next time
      }
      if (!isNewer(disk?.version, running)) {
        await forget();
        return 'current';
      }
      const seen = await recall();
      if (seen?.version !== disk.version) {
        await remember({ version: disk.version, since: now() });
        log(`${disk.version} is on disk (running ${running}); reloading at the next check`);
        return 'seen';
      }
      const missing = await missingFiles(disk);
      if (missing.length) {
        log(`${disk.version} is on disk but not whole (missing ${missing.join(', ')}); waiting`);
        return 'incomplete';
      }
      if (now() - seen.since < MAX_WAIT_MS) {
        const why = await busy();
        if (why) {
          log(`${disk.version} is ready; waiting: ${why}`);
          return 'busy';
        }
      }
      log(`reloading: ${running} → ${disk.version}`);
      chrome.runtime.reload();
      return 'reloaded';
    }

    function start() {
      chrome.runtime.onMessage.addListener(noteMessage);
      chrome.alarms.onAlarm.addListener(alarm => {
        if (alarm.name === ALARM) tick().catch(e => log(`check failed: ${e.message}`));
      });
      // Only if it isn't there: creating it again would restart its period at every wake-up.
      Promise.resolve(chrome.alarms.get(ALARM))
        .then(alarm => alarm || chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MINUTES }))
        .catch(ignore);
    }

    return { tick, start, noteMessage, noteFetch, missingFiles };
  }

  const api = { ALARM, PERIOD_MINUTES, MAX_WAIT_MS, compareVersions, isNewer, manifestFiles, importedScripts, createUpdater };
  root.NYTFix = root.NYTFix || {};
  root.NYTFix.update = api;
  if (typeof module === 'object' && module.exports) module.exports = api;

  // In the service worker (background.js imports this file), start checking.
  if (typeof ServiceWorkerGlobalScope !== 'undefined' && root instanceof ServiceWorkerGlobalScope && root.chrome?.alarms) {
    const updater = createUpdater({ chrome: root.chrome, fetch: root.fetch.bind(root) });
    api.noteFetch = updater.noteFetch;
    updater.start();
  }
})(globalThis);
