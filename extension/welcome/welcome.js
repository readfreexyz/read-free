// The welcome page (welcome.html): the outlets, from the adapters the manifest lists (as on the
// settings page), and its two buttons. In Firefox, the Developer mode tip (Chrome's alone) gives
// way to one about updates.
(async function () {
  'use strict';

  const { ui, settings } = globalThis.NYTFix;
  const $ = id => document.getElementById(id);

  if (settings.isFirefox()) {
    $('tip-chrome').hidden = true;
    $('tip-firefox').hidden = false;
  }

  $('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('done').addEventListener('click', () => window.close());

  const sites = Object.values(await ui.loadSites().catch(() => ({}))).filter(s => s.live).sort(ui.byName);
  for (const site of sites) {
    const li = document.createElement('li');
    li.textContent = site.name;
    $('outlets').append(li);
  }
  $('outlets-card').hidden = sites.length === 0;
})();
