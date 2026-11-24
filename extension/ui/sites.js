// The supported sites, for the extension's own pages (the toolbar menu, the settings page): the
// adapters (sites/*.js) that the manifest's content scripts list, loaded into the page, so a new
// site needs no change here.
(function (root) {
  'use strict';

  // hosts may hold '*.example.com' for every subdomain (Corriere's local editions), as in
  // src/content.js.
  const onHost = (host, hostname) => host === hostname || (host.startsWith('*.') && hostname.endsWith(host.slice(1)));

  // The site for a page's hostname, or null.
  function siteForHost(sites, hostname) {
    return Object.values(sites).find(s => s.live && s.hosts.some(h => onHost(h, hostname))) || null;
  }

  // The adapter files, in the manifest's order, each once. Firefox's getManifest() gives them as
  // whole addresses (moz-extension://<id>/sites/nyt.js), Chrome's as written (sites/nyt.js).
  function adapterFiles(manifest) {
    const files = (manifest.content_scripts || []).flatMap(cs => cs.js || [])
      .map(f => f.replace(/^[a-z-]+:\/\/[^/]+\//, '')).filter(f => /^sites\/[^/]+\.js$/.test(f));
    return [...new Set(files)];
  }

  // Loads src/adapter.js and the adapters; resolves to NYTFix.sites ({ id: site }).
  function loadSites(doc = document, runtime = chrome.runtime) {
    const files = ['src/adapter.js', ...adapterFiles(runtime.getManifest())];
    return Promise.all(files.map(file => new Promise((resolve, reject) => {
      const script = doc.createElement('script');
      script.src = runtime.getURL(file);
      script.async = false; // run in order: adapter.js first
      script.onload = resolve;
      script.onerror = () => reject(new Error(`couldn't load ${file}`));
      doc.head.append(script);
    }))).then(() => root.NYTFix.sites || {});
  }

  // Sites for a list: by name, ignoring a leading "The".
  const byName = (a, b) => a.name.replace(/^The /, '').localeCompare(b.name.replace(/^The /, ''));

  const ui = { siteForHost, adapterFiles, loadSites, byName };
  root.NYTFix = Object.assign(root.NYTFix || {}, { ui });
  if (typeof module === 'object' && module.exports) module.exports = ui;
})(globalThis);
