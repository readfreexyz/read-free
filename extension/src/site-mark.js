// On Read Free's own site (readfree.xyz and its mirror, the release addresses): says on the front
// page that Read Free is installed in this browser, and which version, so a reader who just
// loaded it sees that it worked. It writes plain text into the page's #installed placeholder, and
// does nothing on a page without one. It reads nothing from the page and sends nothing anywhere.
(function () {
  'use strict';

  const note = document.getElementById('installed');
  if (!note || !note.classList.contains('installed')) return;
  note.textContent = `✓ Read Free ${chrome.runtime.getManifest().version} is installed in this browser.`;
  note.hidden = false;
})();
