// Helpers for talking to archive.today. No DOM, no chrome.* APIs, nothing site-specific (each
// site's URL rules are in its adapter, sites/*.js).
// Loaded as a classic script by the content script, the options page and the service worker,
// and with require() by the tests.
(function (root) {
  'use strict';

  const MIRRORS = ['archive.ph', 'archive.is', 'archive.today', 'archive.md', 'archive.li', 'archive.vn', 'archive.fo'];
  const DEFAULT_MIRROR = 'archive.ph';

  // The address to ask when `mirror` can't be connected to. archive.today only redirects to
  // archive.ph, so archive.is stands in for both; archive.ph stands in for the others.
  function secondMirror(mirror = DEFAULT_MIRROR) {
    return mirror === 'archive.ph' || mirror === 'archive.today' ? 'archive.is' : 'archive.ph';
  }

  // The newest snapshot itself: archive.today looks the article up and redirects to it
  // (https://archive.ph/20261112214313/<article>), or answers 404 if it has none. One request
  // instead of the timemap plus the snapshot.
  function newestUrl(articleUrl, mirror = DEFAULT_MIRROR) {
    return `https://${mirror}/newest/${articleUrl}`;
  }

  // The list of every snapshot, with dates. Usually 0.3–3.5 s, but now and then it hangs for a
  // minute or more (90 s and then a 504 was seen), even for an article it answered quickly
  // before. So it's only asked for when the newest snapshot isn't enough.
  function timemapUrl(articleUrl, mirror = DEFAULT_MIRROR) {
    return `https://${mirror}/timemap/${articleUrl}`;
  }

  // A snapshot's own address (https://archive.ph/20261112214313/<article>) as a memento
  // { url, time }, or null if it isn't one.
  function mementoAt(url) {
    if (!isArchiveUrl(url)) return null;
    const u = new URL(url);
    const match = /^\/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\/(https?:\/\/.+)$/.exec(u.pathname + u.search);
    if (!match) return null;
    const [y, mo, d, h, mi, sec] = match.slice(1, 7).map(Number);
    const time = Date.UTC(y, mo - 1, d, h, mi, sec);
    return Number.isNaN(time) ? null : { url, time };
  }

  // archive.today's human-facing page for a URL: lists snapshots, or offers to archive it.
  function searchUrl(articleUrl, mirror = DEFAULT_MIRROR) {
    return `https://${mirror}/${articleUrl}`;
  }

  // The page for the reader to complete a CAPTCHA that archive.today asked Read Free for. A snapshot
  // is opened as it is. A lookup (/newest/, /timemap/) gives way to the search page for the article:
  // for one with no snapshot yet, /newest/ answers a visit with "No results" and no check, while the
  // search page asks for one (archive.ph, 2026-11-27, the same browser minutes apart). The search page
  // lists the snapshots there are, or offers to archive it. Anything else is left as it is.
  function checkPage(url) {
    if (!isArchiveUrl(url)) return url;
    const u = new URL(url);
    const lookup = /^\/(?:newest|timemap)\/(https?:\/\/.+)$/.exec(u.pathname + u.search);
    return lookup ? searchUrl(lookup[1], u.hostname) : url;
  }

  // Parse an application/link-format timemap. Returns mementos oldest first:
  // [{ url, time }] where time is epoch ms.
  function parseTimemap(text) {
    const mementos = [];
    const entry = /<([^>]+)>\s*;\s*rel="([^"]+)"(?:[^,<]*?datetime="([^"]+)")?/g;
    for (const [, url, rel, datetime] of text.matchAll(entry)) {
      if (!/\bmemento\b/.test(rel) || !datetime) continue;
      const time = Date.parse(datetime);
      if (!Number.isNaN(time)) mementos.push({ url, time });
    }
    return mementos.sort((a, b) => a.time - b.time);
  }

  // Up to `max` mementos, newest first.
  function newestFirst(mementos, max) {
    return mementos.slice(-max).reverse();
  }

  // Timemap entries point at http://archive.md/...; fetch them from our mirror over https.
  function toMirror(mementoUrl, mirror = DEFAULT_MIRROR) {
    return mementoUrl.replace(/^https?:\/\/[^/]+/, `https://${mirror}`);
  }

  function isArchiveUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && MIRRORS.includes(u.hostname);
    } catch {
      return false;
    }
  }

  // archive.today's CAPTCHA and rate-limit pages are small; real snapshots are megabytes. The word
  // alone doesn't make one (an article's address or title can hold it): its parts do.
  const CAPTCHA_PARTS = /<[^>]+\s(?:class|id)=["']?[^"'>]*captcha|<(?:script|iframe)[^>]*\ssrc=["']?[^"'>]*(?:captcha|cf-chl|challenge-platform)|\bsendCaptcha\b|\bcf-chl-/i;
  function looksBlocked(status, body) {
    if (status === 429) return 'rate-limited';
    if (body && body.length < 200000 && CAPTCHA_PARTS.test(body)) {
      return 'captcha';
    }
    return null;
  }

  const archive = {
    MIRRORS, DEFAULT_MIRROR, secondMirror,
    newestUrl, timemapUrl, mementoAt, searchUrl, checkPage, parseTimemap, newestFirst, toMirror, isArchiveUrl, looksBlocked,
  };
  root.NYTFix = Object.assign(root.NYTFix || {}, { archive });
  if (typeof module === 'object' && module.exports) module.exports = archive;
})(globalThis);
