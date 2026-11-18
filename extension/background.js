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
importScripts('src/archive.js', 'src/settings.js');
importScripts('src/update.js'); // reloads the extension when a newer version is on disk (docs/auto-update.md)

const { archive, settings } = self.NYTFix;
const NAME = 'Read Free';
const ICON = { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' };
const ICON_OFF = { 16: 'icons/off-16.png', 32: 'icons/off-32.png' };
// The badge's colors: the wall is off on this page.
const BADGE = { done: '#2e7d4f' };
const ignore = () => {};
let enabled = true;

// On or off everywhere: the icon and its tooltip for every tab without its own.
function showEnabled(on) {
  enabled = on;
  chrome.action.setIcon({ path: on ? ICON : ICON_OFF }).catch(ignore);
  chrome.action.setTitle({ title: on ? NAME : `${NAME}: off on all sites` }).catch(ignore);
}
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
  if (msg?.type !== 'nytfix:fetch') return false;
  fetchArchive(msg.url, msg.timeoutMs).then(sendResponse);
  return true; // respond asynchronously
});

// state: 'lifted' (the text was on the page) or 'swapped' (archived text), 'off' (the reader
// turned the extension off on this site), or null to clear the badge.
function markTab(tabId, state, title) {
  const tooltip = title ? `${NAME}: ${title}` : enabled ? NAME : `${NAME}: off on all sites`;
  if (state === 'off') {
    chrome.action.setIcon({ tabId, path: ICON_OFF }).catch(ignore);
    chrome.action.setBadgeText({ tabId, text: '' }).catch(ignore);
    chrome.action.setTitle({ tabId, title: tooltip }).catch(ignore);
    return;
  }
  if (!state) {
    chrome.action.setBadgeText({ tabId, text: '' }).catch(ignore);
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
