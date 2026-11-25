// The reader's settings, kept in chrome.storage.sync, plus the donation links: UNRWA's, and the
// project's.
// Used by the content script, the toolbar menu (popup/), the options page and the service worker.
//   mirror         which archive.today address to use
//   enabled        false: the extension is off everywhere
//   disabledSites  adapter ids (sites/*.js) the reader turned it off on, e.g. ['nyt', 'smh']
//   quiet          no notification when a wall comes off unless there's something new to say
//                  (notify.js; up to 0.26.1 that was the rule, with alwaysConfirm to opt out)
//   donated        the reader says they donated: the donation link is never offered again
//                  (taken on trust; the toolbar menu and settings page still have it)
(function (root) {
  'use strict';

  const archive = (root.NYTFix && root.NYTFix.archive) || (typeof require === 'function' ? require('./archive.js') : null);
  const KEY = 'settings';
  const DEFAULTS = Object.freeze({ mirror: archive.DEFAULT_MIRROR, enabled: true, disabledSites: Object.freeze([]), quiet: false, donated: false });
  const SITE_ID = /^[a-z0-9-]{1,40}$/;
  // Where the donation link goes. Leave empty to show no donation link anywhere.
  const TIP_URL = 'https://ko-fi.com/readfree';
  // Where the donation page gets the current ways to give (src/donations.js), tried in order:
  // the project's own site, then mirrors, e.g. 'https://readfree.example/donate.json'. Each must
  // send Access-Control-Allow-Origin: * (GitHub Pages does; check others with curl -I). Empty:
  // TIP_URL only.
  const DONATIONS_URLS = Object.freeze(['https://readfree.xyz/donate.json', 'https://readfreexyz.github.io/donate.json']);
  // Where releases are published (tools/release.sh), tried in order: the site, then mirrors,
  // each ending in /, e.g. 'https://readfree.example/'. website/install.sh has the same list
  // (a test checks); the toolbar menu reads latest.txt there to say a new version is out, and
  // links to the first (src/release.js). Empty: no notice.
  const RELEASE_URLS = Object.freeze(['https://readfree.xyz/', 'https://readfreexyz.github.io/']);
  // The extension's own page for it (give/): Ko-fi's donation panel, inside the extension.
  const GIVE_PAGE = 'give/give.html';
  // Where the money a reader withheld can go instead: UNRWA's own donation page (it sends each
  // reader on to their region's page). Nothing is added to the address: the reader chooses the
  // amount there, so their tally never leaves the browser.
  const AID_URL = 'https://www.unrwa.org/donate';

  // Fill in defaults and drop anything invalid (an unknown mirror falls back to the default).
  function normalize(saved) {
    const s = saved && typeof saved === 'object' ? saved : {};
    const ids = Array.isArray(s.disabledSites) ? s.disabledSites.filter(id => typeof id === 'string' && SITE_ID.test(id)) : [];
    return {
      mirror: archive.MIRRORS.includes(s.mirror) ? s.mirror : DEFAULTS.mirror,
      enabled: s.enabled !== false,
      disabledSites: [...new Set(ids)].sort(),
      quiet: s.quiet === true,
      donated: s.donated === true,
    };
  }

  async function load(area) {
    try {
      const { [KEY]: saved } = await area.get(KEY);
      return normalize(saved);
    } catch {
      return normalize(null);
    }
  }

  async function save(area, changes) {
    const next = normalize({ ...(await load(area)), ...changes });
    await area.set({ [KEY]: next });
    return next;
  }

  // Whether the extension acts on a site (its adapter id).
  function isOn(prefs, siteId) {
    return prefs.enabled && !prefs.disabledSites.includes(siteId);
  }

  // Turn one site on or off, e.g. setSite(chrome.storage.sync, 'nyt', false).
  async function setSite(area, siteId, on) {
    const { disabledSites } = await load(area);
    const rest = disabledSites.filter(id => id !== siteId);
    return save(area, { disabledSites: on ? rest : [...rest, siteId] });
  }

  // The settings as they change (chrome.storage.onChanged), normalized: fn(prefs).
  function onChange(storage, fn) {
    storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName === 'sync' && changes[KEY]) fn(normalize(changes[KEY].newValue));
    });
  }

  // The donation link for the toolbar menu, the options page and the status bar, or null when
  // TIP_URL isn't set.
  // embed: Ko-fi's donation panel for a Ko-fi page (the only form of it another page may frame),
  // or null.
  function tipLink(url = TIP_URL) {
    if (!/^https:\/\//i.test(url)) return null;
    const kofi = url.match(/^https:\/\/ko-fi\.com\/([A-Za-z0-9_]+)\/?$/i);
    const embed = kofi ? `https://ko-fi.com/${kofi[1]}/?hidefeed=true&widget=true&embed=true&preview=true` : null;
    return { text: 'Support the project', short: 'Donate', href: url, embed };
  }

  // The UNRWA link, for the toolbar menu and the settings page.
  function aidLink(url = AID_URL) {
    return /^https:\/\//i.test(url) ? { name: 'UNRWA', href: url } : null;
  }

  // "Report a problem": an email to Read Free that the reader writes and sends themself, from
  // the error banner on an article and from the toolbar menu. Filled in with the outlet, what
  // happened, and the versions of Read Free and the browser. Never the article's address: the
  // email asks the reader to paste it if they want that page looked at. Nothing is sent by
  // Read Free itself.
  const REPORT_TO = 'hello@readfree.xyz';

  // Running in Firefox: the package tools/firefox.mjs makes, whose manifest has a
  // browser_specific_settings.gecko block (Chrome's has none). Firefox updates it by itself
  // from Read Free's site (docs/firefox.md).
  function isFirefox(manifest = root.chrome?.runtime?.getManifest?.()) {
    return Boolean(manifest?.browser_specific_settings?.gecko);
  }

  // "Chrome 157" or "Firefox 160" from a user agent string, or '' (Edge says so; Dia, Brave and
  // others say Chrome).
  function browserName(userAgent = '') {
    const edge = /\bEdg\/(\d+)/.exec(userAgent);
    if (edge) return `Edge ${edge[1]}`;
    const firefox = /\bFirefox\/(\d+)/.exec(userAgent);
    if (firefox) return `Firefox ${firefox[1]}`;
    const chrome = /\bChrome\/(\d+)/.exec(userAgent);
    return chrome ? `Chrome ${chrome[1]}` : '';
  }

  function reportLink({ outlet = '', what = '', version = '', browser = '' } = {}) {
    const subject = `Read Free ${version}: a problem${outlet ? ` on ${outlet}` : ''}`.replace(/\s+/g, ' ');
    const lines = [];
    if (what) lines.push(`What happened: ${what}`);
    if (outlet) lines.push(`Outlet: ${outlet}`);
    lines.push(`Read Free ${version}${browser ? ` in ${browser}` : ''}`);
    lines.push('', "Anything else? If you'd like us to look at the article itself, paste its address here.", '');
    const query = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\r\n'))}`;
    return { address: REPORT_TO, href: `mailto:${REPORT_TO}?${query}` };
  }

  const settings = { KEY, DEFAULTS, TIP_URL, DONATIONS_URLS, RELEASE_URLS, GIVE_PAGE, AID_URL, REPORT_TO, normalize, load, save, isOn, setSite, onChange, tipLink, aidLink, isFirefox, browserName, reportLink };
  root.NYTFix = Object.assign(root.NYTFix || {}, { settings });
  if (typeof module === 'object' && module.exports) module.exports = settings;
})(globalThis);
