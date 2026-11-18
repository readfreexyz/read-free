// What the toolbar menu says about the current tab: the content script's answer to
// 'nytfix:state' (src/content.js), the settings, and the tab's site, turned into words.
//   describe({ url, site, page, prefs, reloading }) -> { title, sub, tone, text, action }
//     page    { state: 'off' | 'not-article' | 'idle' | 'loading' | 'applied', mark, restored },
//             or null when no content script answered
//     reloading  the menu reloaded the tab (a switch changed) and it hasn't finished loading
//     tone    the status dot: 'ok' | 'working' | 'off' | 'neutral'
//     action  the button: { id: 'toggle' | 'reload', label, primary } or null
(function (root) {
  'use strict';

  const OFF_EVERYWHERE = 'Off on all sites. Turn it back on below.';

  function describe({ url, site, page, prefs, reloading = false }) {
    const host = url && /^https?:$/.test(url.protocol) ? url.hostname.replace(/^www\./, '') : null;
    if (!site) {
      return {
        title: host || 'This page',
        sub: null,
        tone: 'neutral',
        text: host ? "Not one of the news sites Read Free works on." : 'Read Free works on news sites.',
        action: null,
      };
    }
    const base = { title: site.name, sub: host };
    if (reloading) return { ...base, tone: 'working', text: 'Reloading the page…', action: null };
    if (!prefs.enabled) return { ...base, tone: 'off', text: OFF_EVERYWHERE, action: null };
    if (prefs.disabledSites.includes(site.id)) return { ...base, tone: 'off', text: 'Off on this site. Walls are left as they are.', action: null };
    // Supported and on, but nothing answered: the tab was open before the extension was
    // installed or reloaded, or the page is still loading.
    if (!page) return { ...base, tone: 'neutral', text: 'Reload the page to start.', action: { id: 'reload', label: 'Reload page', primary: true } };
    switch (page.state) {
      case 'off': // turned on again elsewhere since this page loaded
        return { ...base, tone: 'off', text: 'Reload the page to turn it on here.', action: { id: 'reload', label: 'Reload page', primary: true } };
      case 'not-article':
        return { ...base, tone: 'neutral', text: 'No article on this page. Open one and any wall comes off.', action: null };
      case 'loading':
        return { ...base, tone: 'working', text: 'Loading the article from archive.today…', action: null };
      case 'applied':
        return {
          ...base,
          tone: 'ok',
          text: page.mark === 'swapped' ? 'Wall removed. Showing the article from archive.today.' : 'Wall removed. The whole article was already on the page.',
          action: { id: 'toggle', label: "Show the site's version", primary: false },
        };
      default: // 'idle'
        if (page.restored) return { ...base, tone: 'neutral', text: "Showing the site's version, wall and all.", action: { id: 'toggle', label: 'Remove the wall', primary: true } };
        return { ...base, tone: 'neutral', text: 'No wall on this page.', action: { id: 'toggle', label: 'Load from archive.today', primary: false } };
    }
  }

  const view = { describe };
  root.NYTFix = Object.assign(root.NYTFix || {}, { popupView: view });
  if (typeof module === 'object' && module.exports) module.exports = view;
})(globalThis);
