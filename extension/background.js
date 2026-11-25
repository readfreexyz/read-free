// Read Free service worker.
// - Toolbar icon: a click opens the menu (popup/). The icon is grey while the extension is off
//   everywhere, and on a tab whose site the reader turned it off on (its content script says so).
// - Toolbar mark: a green check on the icon while a page's wall is off (the content script says
//   when, and when the reader leaves the page), so it shows which pages had one after the status
//   bar has faded. Chrome clears a tab's marks when it loads another page.
// - Fetch proxy: content scripts can't fetch archive.today cross-origin, so they ask
//   here. Only https archive.today URLs are allowed.
// - The donation page: the status bar's donation link asks here to open give/ (a web page can't
//   link to an extension page itself).
// - A newer version (src/release.js), for copies loaded by hand: checked once a day here (an
//   alarm), from Read Free's own site only. While one is out, the toolbar icon carries an arrow,
//   and content scripts ask here for it, so the status bar can say so (src/notify.js).
// - In Firefox this runs as a background page, which has no importScripts: the manifest that
//   tools/firefox.mjs writes loads the same files first (background.scripts). Firefox updates
//   the package it installed from Read Free's site by itself (docs/firefox.md), so there's no
//   newer-version check or arrow there.
if (typeof importScripts === 'function') {
  importScripts('src/archive.js', 'src/settings.js');
  importScripts('src/update.js'); // reloads the extension when a newer version is on disk (docs/auto-update.md)
  importScripts('src/release.js', 'src/access.js');
}

const { archive, settings, release, access } = self.NYTFix;
const selfUpdating = settings.isFirefox();
const NAME = 'Read Free';
const ICON = { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' };
const ICON_OFF = { 16: 'icons/off-16.png', 32: 'icons/off-32.png' };
// The badge's colors: the wall is off on this page; a newer version is out.
const BADGE = { done: '#2e7d4f', newer: '#c2415b' };
const NEWER_MARK = '↑';
const ACCESS_MARK = '!'; // Firefox: addresses it hasn't let Read Free work on (src/access.js)
// release.refresh() asks the site at most once a day (an hour after a failure); the alarm only
// wakes it. Created once, so a service worker waking up doesn't restart its period.
const RELEASE_ALARM = 'nytfix:release';
const RELEASE_ALARM_MINUTES = 60;
const ignore = () => {};
const running = chrome.runtime.getManifest().version;
let enabled = true;
let newer = null; // release.notice(): { version, href, text } while a newer version is out
let needsAccess = false; // Firefox: there are addresses to allow that the reader hasn't seen

// The tooltip of a tab without its own
const restingTitle = () => (!enabled ? `${NAME}: off on all sites` : newer ? `${NAME}: version ${newer.version} is out` : needsAccess ? `${NAME}: new sites need your OK` : NAME);
// What a tab without a ✓ shows: the arrow while a newer version is out (Chrome), the ! while
// there are addresses to allow (Firefox), or nothing.
const restingMark = () => (newer ? NEWER_MARK : needsAccess ? ACCESS_MARK : '');

// On or off everywhere: the icon and its tooltip for every tab without its own.
function showEnabled(on) {
  enabled = on;
  chrome.action.setIcon({ path: on ? ICON : ICON_OFF }).catch(ignore);
  chrome.action.setTitle({ title: restingTitle() }).catch(ignore);
}

// A newer version or not, from the saved release record: the arrow on every tab without a mark
// of its own (a tab's ✓ wins while its wall is off).
function showNewer(record) {
  newer = selfUpdating ? null : release.notice(record, running);
  showResting();
}
function showResting() {
  if (restingMark()) {
    chrome.action.setBadgeBackgroundColor({ color: BADGE.newer }).catch(ignore);
    chrome.action.setBadgeTextColor?.({ color: '#ffffff' })?.catch(ignore);
  }
  chrome.action.setBadgeText({ text: restingMark() }).catch(ignore);
  chrome.action.setTitle({ title: restingTitle() }).catch(ignore);
}
// Firefox: are there addresses to allow? At start, and when the reader allows or turns off some,
// or has seen them on the settings page.
const checkAccess = async () => {
  needsAccess = (await access.unseen(await access.missing(chrome), chrome.storage.local)).length > 0;
  showResting();
};
const checkRelease = () => release.refresh(chrome.storage.local).then(showNewer).catch(ignore);
const newerLoaded = selfUpdating ? checkAccess().catch(ignore) : release.load(chrome.storage.local).then(showNewer).catch(ignore);
if (selfUpdating) {
  chrome.permissions?.onAdded?.addListener(() => { checkAccess().catch(ignore); });
  chrome.permissions?.onRemoved?.addListener(() => { checkAccess().catch(ignore); });
} else {
  chrome.alarms?.onAlarm.addListener(alarm => { if (alarm.name === RELEASE_ALARM) checkRelease(); });
  Promise.resolve(chrome.alarms?.get(RELEASE_ALARM))
    .then(alarm => alarm || chrome.alarms?.create(RELEASE_ALARM, { delayInMinutes: 1, periodInMinutes: RELEASE_ALARM_MINUTES }))
    .catch(ignore);
}
// The welcome page (welcome/), once: when Read Free is first loaded, never on an update or a
// reload (Chrome says "update" for those), and never twice (a flag in chrome.storage.local, in
// case a reload is ever reported as an install).
const WELCOMED = 'welcomed';
chrome.runtime.onInstalled?.addListener(({ reason }) => {
  if (reason !== 'install') return;
  chrome.storage.local.get(WELCOMED).then(saved => {
    if (saved?.[WELCOMED]) return;
    chrome.storage.local.set({ [WELCOMED]: Date.now() }).catch(ignore);
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome/welcome.html') }).catch(ignore);
  }).catch(ignore);
});
// The menu checks too when it opens: follow its answer.
chrome.storage.onChanged?.addListener((changes, area) => {
  if (area === 'local' && changes[release.KEY]) showNewer(changes[release.KEY].newValue);
  if (area === 'local' && selfUpdating && changes[access.SEEN_KEY]) checkAccess().catch(ignore);
});
const syncEnabled = () => settings.load(chrome.storage.sync).then(p => showEnabled(p.enabled)).catch(ignore);
// What a tab without a mark of its own shows (off everywhere, a newer version) is read from
// storage each time the service worker starts. A content script's message can be what starts it,
// so tab marks wait for that, or they'd go by the defaults above.
const loaded = Promise.all([newerLoaded, syncEnabled()]);
chrome.runtime.onStartup?.addListener(syncEnabled);
settings.onChange(chrome.storage, p => { if (p.enabled !== enabled) showEnabled(p.enabled); });

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (msg?.type === 'nytfix:mark') {
    const tabId = sender.tab?.id;
    if (tabId !== undefined) loaded.then(() => markTab(tabId, msg.state, msg.title));
    return false;
  }
  // The status bar's donation link: the extension's own page, next to the reader's tab
  if (msg?.type === 'nytfix:give') {
    const tab = sender.tab;
    chrome.tabs.create({ url: chrome.runtime.getURL(settings.GIVE_PAGE), ...(tab ? { index: tab.index + 1, openerTabId: tab.id } : {}) }).catch(ignore);
    return false;
  }
  // A content script asks whether a newer version is out (for the status bar), from the saved
  // record: no request to the site from an article page.
  if (msg?.type === 'nytfix:newer') {
    if (selfUpdating) { sendResponse(null); return false; }
    release.load(chrome.storage.local).then(record => sendResponse(release.notice(record, running)), () => sendResponse(null));
    return true;
  }
  if (msg?.type !== 'nytfix:fetch') return false;
  fetchArchive(msg.url, msg.timeoutMs).then(sendResponse);
  return true; // respond asynchronously
});

// state: 'lifted' (the text was on the page) or 'swapped' (archived text), 'off' (the reader
// turned the extension off on this site), or null to clear the badge.
function markTab(tabId, state, title) {
  const tooltip = title ? `${NAME}: ${title}` : restingTitle();
  // No ✓ on this tab: what every tab shows (the arrow while a newer version is out)
  const resting = () => {
    if (restingMark()) chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE.newer }).catch(ignore);
    chrome.action.setBadgeText({ tabId, text: restingMark() }).catch(ignore);
  };
  if (state === 'off') {
    chrome.action.setIcon({ tabId, path: ICON_OFF }).catch(ignore);
    resting();
    chrome.action.setTitle({ tabId, title: tooltip }).catch(ignore);
    return;
  }
  if (!state) {
    resting();
    chrome.action.setTitle({ tabId, title: tooltip }).catch(ignore);
    return;
  }
  chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE.done }).catch(ignore);
  chrome.action.setBadgeTextColor?.({ tabId, color: '#ffffff' })?.catch(ignore); // Chrome 110+
  chrome.action.setBadgeText({ tabId, text: '✓' }).catch(ignore);
  chrome.action.setTitle({ tabId, title: `${NAME}: ${title || 'removed the wall on this page.'}` }).catch(ignore);
}

// A failure's reason: 'unreachable' (no answer at all: the connection was dropped, refused or
// blocked) or 'cut-off' (the answer broke off partway). None for a timeout: it's just slow. fetch()
// says no more than "Failed to fetch" for any of them.
// Firefox retries a dropped connection about ten times before fetch() fails (Chrome once, so it
// says so in time), and drops that take 10 s each would look like a slow answer until the time is
// up. So in Firefox, after PROBE_AFTER_MS without one, the address is asked for its icon: if that
// doesn't come either, it's unreachable; if it does, the page is only slow (a snapshot being
// rendered: 8-15 s, 73 s seen).
const PROBE_AFTER_MS = 25000;
const PROBE_TIMEOUT_MS = 10000;
async function answersAtAll(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    await fetch(new URL('/favicon.ico', url).href, { credentials: 'omit', cache: 'no-store', signal: ctrl.signal });
    return true; // whatever it says
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
async function fetchArchive(url, timeoutMs = 20000) {
  if (!archive.isArchiveUrl(url)) return { ok: false, error: `not an archive.today URL: ${url}` };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  // Chrome stops an idle service worker after ~30 s. Calling an extension API resets
  // that timer, so keep pinging while a slow snapshot download is in flight.
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo().catch(ignore), 20000);
  let answered = false;
  let done = false;
  let silent = false;
  const probe = selfUpdating && timeoutMs > PROBE_AFTER_MS + PROBE_TIMEOUT_MS && setTimeout(async () => {
    if (answered || await answersAtAll(url) || answered || done) return;
    silent = true;
    ctrl.abort();
  }, PROBE_AFTER_MS);
  try {
    // credentials: send archive.today cookies, e.g. from a CAPTCHA solved in a tab.
    const res = await fetch(url, { credentials: 'include', signal: ctrl.signal });
    answered = true;
    const body = await res.text();
    return { ok: true, status: res.status, url: res.url, body };
  } catch (e) {
    if (silent) return { ok: false, error: `no answer in ${Math.round((PROBE_AFTER_MS + PROBE_TIMEOUT_MS) / 1000)} s`, reason: 'unreachable' };
    if (e.name === 'AbortError') return { ok: false, error: `timed out after ${Math.round(timeoutMs / 1000)} s` };
    return { ok: false, error: e.message, reason: answered ? 'cut-off' : 'unreachable' };
  } finally {
    done = true;
    clearTimeout(timer);
    clearTimeout(probe);
    clearInterval(keepAlive);
  }
}
