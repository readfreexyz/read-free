// "Read Free 0.20.0 is out", in the toolbar menu, for those who loaded the folder by hand. Those
// who installed with website/install.sh get new versions by themselves (docs/auto-update.md),
// so it waits until a release is a day old: by then theirs has updated, and they never see it.
// The menu reads latest.txt from the release addresses (settings.RELEASE_URLS) when it opens, at
// most once a day: never from article pages or on a timer. Only the version and date are taken
// from it; the link is the first release address, built in. Kept in chrome.storage.local:
//   { version, date, checkedAt, retryAt }
(function (root) {
  'use strict';

  const settings = (root.NYTFix && root.NYTFix.settings) || (typeof require === 'function' ? require('./settings.js') : null);
  const updateLib = (root.NYTFix && root.NYTFix.update) || (typeof require === 'function' ? require('./update.js') : null);
  const KEY = 'release';
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  const LIMITS = Object.freeze({ bytes: 4096, timeoutMs: 4000 });

  // latest.txt (tools/release.sh): its version and date, or null.
  function parse(text) {
    if (typeof text !== 'string' || text.length > LIMITS.bytes) return null;
    const lines = text.split('\n');
    if (lines[0] !== 'read-free-release 1') return null;
    const value = name => lines.find(line => line.startsWith(`${name}=`))?.slice(name.length + 1);
    const version = value('version');
    if (!/^\d{1,5}(\.\d{1,5}){0,3}$/.test(version || '')) return null;
    const stamp = value('date');
    const date = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(stamp || '') ? Date.parse(stamp) : NaN;
    return { version, date: Number.isFinite(date) ? date : null };
  }

  async function load(area) {
    try {
      const { [KEY]: saved } = await area.get(KEY);
      return saved && typeof saved === 'object' ? saved : {};
    } catch {
      return {};
    }
  }

  // Ask the release addresses, if a day has passed since the last answer (an hour, after none).
  // Returns the record, saved.
  async function refresh(area, urls = settings.RELEASE_URLS, { fetch = root.fetch, now = Date.now(), timeoutMs = LIMITS.timeoutMs } = {}) {
    const record = await load(area);
    if (!urls?.length || now - (record.checkedAt || 0) < DAY || now < (record.retryAt || 0)) return record;
    let next = { ...record, retryAt: now + HOUR };
    for (const base of urls) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(new URL('latest.txt', base).href, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: ctrl.signal });
        const latest = res.ok ? parse(await res.text()) : null;
        if (!latest) continue;
        // A version seen without a date counts from now
        const date = latest.date ?? (latest.version === record.version ? record.date : null) ?? now;
        next = { version: latest.version, date, checkedAt: now, retryAt: 0 };
        break;
      } catch {
        // Unreachable or too slow: the next address
      } finally {
        clearTimeout(timer);
      }
    }
    try { await area.set({ [KEY]: next }); } catch { /* storage gone */ }
    return next;
  }

  // What the menu says, or null: a version newer than the one running, out for a day.
  function notice(record, running, { urls = settings.RELEASE_URLS, now = Date.now() } = {}) {
    if (!urls?.length || !record?.version || !updateLib.isNewer(record.version, running)) return null;
    if (!Number.isFinite(record.date) || now - record.date < DAY) return null;
    return { version: record.version, href: urls[0], text: `Read Free ${record.version} is out` };
  }

  const release = { KEY, LIMITS, parse, load, refresh, notice };
  root.NYTFix = Object.assign(root.NYTFix || {}, { release });
  if (typeof module === 'object' && module.exports) module.exports = release;
})(globalThis);
