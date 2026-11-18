// The ways to give to Read Free, as a list the project publishes on its own site
// (settings.DONATIONS_URLS; a sample is website/donate.json), so Ko-fi can be swapped for another
// service, or donations paused, without shipping a new version:
//   { "v": 1, "ways": [ { "name": "Ko-fi", "href": "https://ko-fi.com/readfree", "note": "Card or PayPal" } ] }
// Only the donation page (give/) asks for it, when it opens: never article pages, never on a
// timer, so the site doesn't learn who reads what or when. The last good list is kept in
// chrome.storage.local and shown at once; without one, or without an address, the built-in link
// (settings.TIP_URL).
//
// The file is treated as hostile (a lost or seized domain is what this is for): plain text
// only, a few ways, https links to known donation services (HOSTS) and nothing else. Nothing
// from it is framed: a Ko-fi link gets Ko-fi's panel, built here (settings.tipLink). The UNRWA
// link isn't in it at all.
(function (root) {
  'use strict';

  const settings = (root.NYTFix && root.NYTFix.settings) || (typeof require === 'function' ? require('./settings.js') : null);
  const KEY = 'donations';
  const LIMITS = Object.freeze({ ways: 5, name: 32, note: 90, href: 300, bytes: 16384, timeoutMs: 5000 });
  // Donation services a way may link to, and which addresses on each.
  const HOSTS = Object.freeze({
    'ko-fi.com': { name: 'Ko-fi', path: /^\// },
    'liberapay.com': { name: 'Liberapay', path: /^\// },
    'opencollective.com': { name: 'Open Collective', path: /^\// },
    'buymeacoffee.com': { name: 'Buy Me a Coffee', path: /^\// },
    'www.buymeacoffee.com': { name: 'Buy Me a Coffee', path: /^\// },
    'patreon.com': { name: 'Patreon', path: /^\// },
    'www.patreon.com': { name: 'Patreon', path: /^\// },
    'paypal.me': { name: 'PayPal', path: /^\// },
    'www.paypal.com': { name: 'PayPal', path: /^\/(donate|paypalme)(\/|\?|$)/ },
    'github.com': { name: 'GitHub Sponsors', path: /^\/sponsors\// },
    'donate.stripe.com': { name: 'Stripe', path: /^\// },
    'buy.stripe.com': { name: 'Stripe', path: /^\// },
  });

  // An https link to a known donation service, or null.
  function service(href) {
    if (typeof href !== 'string' || href.length > LIMITS.href) return null;
    let url;
    try { url = new URL(href); } catch { return null; }
    const host = Object.hasOwn(HOSTS, url.hostname) ? HOSTS[url.hostname] : null;
    if (url.protocol !== 'https:'|| url.username || url.password || url.port || !host || !host.path.test(url.pathname)) return null;
    return { href: url.href, name: host.name };
  }

  // Text from the file: one line, no control characters, within max; '' if none, null if too long.
  function line(text, max) {
    if (text === undefined || text === null) return '';
    if (typeof text !== 'string') return null;
    const clean = text.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim();
    return clean.length > max ? null : clean;
  }

  // The list, checked: { ways: [{ name, href, note }] }, or null when it isn't one. Ways that
  // aren't usable are dropped. An empty ways is a list: donations are paused.
  function normalize(raw) {
    if (!raw || typeof raw !== 'object' || raw.v !== 1 || !Array.isArray(raw.ways)) return null;
    const ways = [];
    for (const way of raw.ways) {
      if (ways.length === LIMITS.ways) break;
      if (!way || typeof way !== 'object') continue;
      const link = service(way.href);
      const name = line(way.name, LIMITS.name);
      const note = line(way.note, LIMITS.note);
      if (!link || !name || note === null || ways.some(w => w.href === link.href)) continue;
      ways.push({ name, href: link.href, note });
    }
    // Ways listed but none usable is a broken list, not a pause
    return raw.ways.length && !ways.length ? null : { ways };
  }

  // The list built into this version: settings.TIP_URL, if it's set and a known service.
  function builtIn(url = settings.TIP_URL) {
    const link = service(url);
    return { ways: link ? [{ name: link.name, href: link.href, note: '' }] : [] };
  }

  // The last good list this browser got, or null; null too when this version has no address to
  // get one from (urls), so a release can go back to the built-in link.
  async function load(area, urls = settings.DONATIONS_URLS) {
    if (!urls?.length) return null;
    try {
      const { [KEY]: saved } = await area.get(KEY);
      return saved ? normalize({ v: 1, ways: saved.ways }) : null;
    } catch {
      return null;
    }
  }

  // Ask each address in turn; the first good list wins, and is kept. null when none answered
  // with one (the kept list stays as it was). The request carries nothing: no cookies, no
  // referrer, no query.
  async function refresh(area, urls = settings.DONATIONS_URLS, { fetch = root.fetch, timeoutMs = LIMITS.timeoutMs, now = Date.now() } = {}) {
    for (const url of urls || []) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: ctrl.signal });
        if (!res.ok) continue;
        const text = await res.text();
        if (text.length > LIMITS.bytes) continue;
        const list = normalize(JSON.parse(text));
        if (!list) continue;
        try { await area.set({ [KEY]: { ways: list.ways, at: now } }); } catch { /* storage gone: still show it */ }
        return list;
      } catch {
        // Unreachable, too slow, not JSON: try the next address.
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  }

  // What the donation page shows: the first way, in a panel, when it can be framed (a Ko-fi
  // page: the panel is Ko-fi's own embed); the rest as links. none: donations are paused.
  function view(list) {
    const ways = list?.ways || [];
    const embed = ways.length ? settings.tipLink(ways[0].href)?.embed : null;
    return {
      panel: embed ? { ...ways[0], embed } : null,
      links: embed ? ways.slice(1) : ways,
      none: ways.length === 0,
    };
  }

  const same = (a, b) => JSON.stringify(a?.ways || []) === JSON.stringify(b?.ways || []);

  const donations = { KEY, LIMITS, HOSTS, service, normalize, builtIn, load, refresh, view, same };
  root.NYTFix = Object.assign(root.NYTFix || {}, { donations });
  if (typeof module === 'object' && module.exports) module.exports = donations;
})(globalThis);
