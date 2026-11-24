// Firefox: the addresses Read Free is for that Firefox hasn't let it work on. Firefox asks about
// the manifest's addresses when Read Free is installed, and never about those an update adds: they
// stay off, silently, until the reader allows them (tested in Firefox 160: an update that added
// cooking.nytimes.com and archive.fo got neither). The reader can also turn any of them off, in
// Firefox's own add-on settings.
// - The settings page names them, with a button that asks Firefox (it has to be a click).
// - The toolbar menu says so, and links there.
// - The toolbar icon carries a ! until the reader has seen them on the settings page (SEEN_KEY, in
//   chrome.storage.local), so addresses turned off on purpose don't keep asking.
// Chrome asks for nothing here: it gives an unpacked extension every address in its manifest.
(function (root) {
  'use strict';

  const settings = (root.NYTFix && root.NYTFix.settings) || (typeof require === 'function' ? require('./settings.js') : null);
  const SEEN_KEY = 'accessSeen'; // the addresses the reader has been told about

  // The addresses in the manifest, each once, but Read Free's own sites (src/site-mark.js only says
  // there that it's installed).
  function wanted(manifest) {
    const own = new Set(settings.RELEASE_URLS.map(url => `${url}*`));
    const all = [...(manifest.host_permissions || []), ...(manifest.content_scripts || []).flatMap(cs => cs.matches || [])];
    return [...new Set(all)].filter(origin => !own.has(origin));
  }

  // The ones Firefox hasn't granted; none in Chrome, or if it can't say.
  async function missing(api = root.chrome) {
    const manifest = api.runtime.getManifest();
    if (!settings.isFirefox(manifest) || !api.permissions?.contains) return [];
    const origins = wanted(manifest);
    try {
      if (await api.permissions.contains({ origins })) return [];
      const granted = await Promise.all(origins.map(origin => api.permissions.contains({ origins: [origin] })));
      return origins.filter((_, i) => !granted[i]);
    } catch {
      return [];
    }
  }

  // Those the reader hasn't been told about yet.
  async function unseen(list, area) {
    if (!list.length) return [];
    const saved = (await area.get(SEEN_KEY))[SEEN_KEY];
    const seen = new Set(Array.isArray(saved) ? saved : []);
    return list.filter(origin => !seen.has(origin));
  }

  const see = (list, area) => area.set({ [SEEN_KEY]: list });

  // "cooking.nytimes.com, archive.fo and 3 more"
  function names(list, most = 3) {
    const hosts = list.map(origin => origin.replace(/^https:\/\//, '').replace(/\/\*$/, '').replace(/^(\*|www)\./, ''));
    const shown = hosts.length > most + 1 ? hosts.slice(0, most) : hosts;
    const rest = hosts.length - shown.length;
    if (rest) return `${shown.join(', ')} and ${rest} more`;
    return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : shown.join('');
  }

  const access = { SEEN_KEY, wanted, missing, unseen, see, names };
  root.NYTFix = Object.assign(root.NYTFix || {}, { access });
  if (typeof module === 'object' && module.exports) module.exports = access;
})(globalThis);
