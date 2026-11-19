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
importScripts('src/archive.js', 'src/settings.js');
importScripts('src/update.js'); // reloads the extension when a newer version is on disk (docs/auto-update.md)
importScripts('src/release.js');

const { archive, settings, release } = self.NYTFix;
const NAME = 'Read Free';
const ICON = { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' };
const ICON_OFF = { 16: 'icons/off-16.png', 32: 'icons/off-32.png' };
// The badge's colors: the wall is off on this page; a newer version is out.
const BADGE = { done: '#2e7d4f', newer: '#c2415b' };
const NEWER_MARK = '↑';
// release.refresh() asks the site at most once a day (an hour after a failure); the alarm only
// wakes it. Created once, so a service worker waking up doesn't restart its period.
const RELEASE_ALARM = 'nytfix:release';
const RELEASE_ALARM_MINUTES = 60;
const ignore = () => {};
const running = chrome.runtime.getManifest().version;
let enabled = true;
let newer = null; // release.notice(): { version, href, text } while a newer version is out

// The tooltip of a tab without its own
const restingTitle = () => (!enabled ? `${NAME}: off on all sites` : newer ? `${NAME}: version ${newer.version} is out` : NAME);

// On or off everywhere: the icon and its tooltip for every tab without its own.
function showEnabled(on) {
  enabled = on;
  chrome.action.setIcon({ path: on ? ICON : ICON_OFF }).catch(ignore);
  chrome.action.setTitle({ title: restingTitle() }).catch(ignore);
}

// A newer version or not, from the saved release record: the arrow on every tab without a mark
// of its own (a tab's ✓ wins while its wall is off).
function showNewer(record) {
  newer = release.notice(record, running);
  if (newer) {
    chrome.action.setBadgeBackgroundColor({ color: BADGE.newer }).catch(ignore);
    chrome.action.setBadgeTextColor?.({ color: '#ffffff' })?.catch(ignore);
  }
  chrome.action.setBadgeText({ text: newer ? NEWER_MARK : '' }).catch(ignore);
  chrome.action.setTitle({ title: restingTitle() }).catch(ignore);
}
const checkRelease = () => release.refresh(chrome.storage.local).then(showNewer).catch(ignore);
release.load(chrome.storage.local).then(showNewer).catch(ignore);
chrome.alarms?.onAlarm.addListener(alarm => { if (alarm.name === RELEASE_ALARM) checkRelease(); });
Promise.resolve(chrome.alarms?.get(RELEASE_ALARM))
  .then(alarm => alarm || chrome.alarms?.create(RELEASE_ALARM, { delayInMinutes: 1, periodInMinutes: RELEASE_ALARM_MINUTES }))
  .catch(ignore);
// The menu checks too when it opens: follow its answer.
chrome.storage.onChanged?.addListener((changes, area) => {
  if (area === 'local' && changes[release.KEY]) showNewer(changes[release.KEY].newValue);
});
const syncEnabled = () => settings.load(chrome.storage.sync).then(p => showEnabled(p.enabled)).catch(ignore);
syncEnabled();
chrome.runtime.onStartup?.addListener(syncEnabled);
settings.onChange(chrome.storage, p => { if (p.enabled !== enabled) showEnabled(p.enabled); });

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (msg?.type === 'nytfix:mark') {
    if (sender.tab?.id !== undefined) markTab(sender.tab.id, msg.state, msg.title);
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
    if (newer) chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE.newer }).catch(ignore);
    chrome.action.setBadgeText({ tabId, text: newer ? NEWER_MARK : '' }).catch(ignore);
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

async function fetchArchive(url, timeoutMs = 20000) {
  if (!archive.isArchiveUrl(url)) return { ok: false, error: `not an archive.today URL: ${url}` };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  // Chrome stops an idle service worker after ~30 s. Calling an extension API resets
  // that timer, so keep pinging while a slow snapshot download is in flight.
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo().catch(ignore), 20000);
  try {
    // credentials: send archive.today cookies, e.g. from a CAPTCHA solved in a tab.
    const res = await fetch(url, { credentials: 'include', signal: ctrl.signal });
    const body = await res.text();
    return { ok: true, status: res.status, url: res.url, body };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? `timed out after ${Math.round(timeoutMs / 1000)} s` : e.message };
  } finally {
    clearTimeout(timer);
    clearInterval(keepAlive);
  }
}
