// Ynet: keep its script from emptying a ynet+ article.
//
// Runs in the page's own JavaScript world (manifest: "world": "MAIN"), at document_start, before
// any of the site's scripts. See page/nine.js for how page-world guards talk to the content
// script (<html data-nytfix-held>, 'nytfix:release', 'nytfix:hold').
//
// The page carries the whole article. When the site's React code has drawn the wall
// (.paywall-wrapper) in the paragraph where the free part ends, cutArticlePremiumContent() (in its
// widgets bundle, read 2026-11-25) does
//   container = document.querySelector('.public-DraftEditor-content [data-contents="true"]')
//   container.innerHTML = ''; container.appendChild(<the wall's own paragraph>)
// So setting innerHTML to '' does nothing on that container while the wall is in one of its
// paragraphs. The appendChild then only moves the wall below the article. Every other use of
// innerHTML goes as before.
(function () {
  'use strict';

  const HELD_ATTR = 'data-nytfix-held';
  const CONTAINER = '.public-DraftEditor-content [data-contents="true"]';
  const WALL = '.paywall-wrapper';
  const { get, set, configurable, enumerable } = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');

  let holding = true;
  let held = null;  // the container the site meant to empty
  let taken = null; // what's out of it, in the site's version

  function mark() {
    const root = document.documentElement;
    if (!root) return;
    if (holding && held && held.isConnected) root.setAttribute(HELD_ATTR, 'cut');
    else root.removeAttribute(HELD_ATTR);
  }

  Object.defineProperty(Element.prototype, 'innerHTML', {
    configurable,
    enumerable,
    get,
    set(value) {
      if (value !== '' || !this.matches(CONTAINER) || !this.querySelector(`.text_editor_paragraph ${WALL}`)) {
        set.call(this, value);
        return;
      }
      held = this;
      if (!holding) {
        taken = [...this.childNodes]; // the reader has the site's version: cut, but kept aside
        set.call(this, value);
        return;
      }
      mark();
      console.info("[Read Free] kept Ynet's script from cutting the article");
    },
  });

  // The site's version: the wall alone.
  document.addEventListener('nytfix:release', () => {
    holding = false;
    if (held && held.isConnected && !taken) {
      taken = [...held.childNodes].filter(node => node.nodeType !== 1 || !(node.matches(WALL) || node.querySelector(WALL)));
      for (const node of taken) node.remove();
    }
    mark();
  });

  // Holding again: the article comes back above the wall.
  document.addEventListener('nytfix:hold', () => {
    holding = true;
    if (held && held.isConnected && taken) held.prepend(...taken);
    taken = null;
    if (held && !held.isConnected) held = null; // the page before's
    mark();
  });
})();
