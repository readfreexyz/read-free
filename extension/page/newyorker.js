// The New Yorker: keep its subscription engine from cutting the article.
//
// Runs in the page's own JavaScript world (manifest: "world": "MAIN"), at document_start, before
// any of the site's scripts. See page/nine.js for how page-world guards talk to the content
// script (<html data-nytfix-held>, 'nytfix:release', 'nytfix:hold').
//
// The page carries the whole article. Some seconds after it's drawn (6.6 s, seen 2026-11-24),
// Condé Nast's "journey" engine decides the reader gets the wall, puts an offer in the article and
// runs truncateMarkedContent: elements matching a selector, past the first, are removed with
// element.remove(). Its selectors for articles are '[class*="ArticlePageChunks-"] > *' (the
// article's sections) and '.body__inner-container > *' (the paragraphs in each). A MutationObserver
// of its own removes them again whenever something is added, so putting them back (live.keep)
// loses: it gave up after five rounds in 3 ms.
//
// So those removals don't happen: element.remove() does nothing on a piece of the article while
// this holds. Ads and offers go as the site likes. React takes elements off the page with
// removeChild, which isn't touched, so moving between pages works as before.
(function () {
  'use strict';

  const HELD_ATTR = 'data-nytfix-held';
  const SECTION = '[data-testid="ArticlePageChunks"] > [data-journey-hook="grid-wrapper"]';
  const PIECE = ['p', 'h2', 'h3', 'h4', 'figure', 'blockquote', 'ul', 'ol', 'hr', '.paywall'].map(s => `.body__inner-container > ${s}`).join(', ');
  const remove = Element.prototype.remove;

  let holding = true;
  let said = false;
  const held = new Set(); // pieces kept on the page while holding
  const passed = [];      // [{ piece, place }]: removed on release, a comment left in their place

  const isPiece = el => el.isConnected && (el.matches(SECTION) ? el.querySelector('.body__inner-container p') !== null : el.matches(PIECE));
  function mark() {
    const root = document.documentElement;
    if (!root) return;
    if (held.size) root.setAttribute(HELD_ATTR, 'truncate');
    else root.removeAttribute(HELD_ATTR);
  }
  function letGo(piece) {
    const place = document.createComment('');
    piece.before(place);
    remove.call(piece);
    passed.push({ piece, place });
  }

  Element.prototype.remove = function () {
    if (!isPiece(this)) return remove.call(this);
    if (!holding) return letGo(this);
    held.add(this);
    mark();
    if (!said) console.info("[Read Free] kept The New Yorker's script from cutting the article");
    said = true;
    return undefined;
  };

  document.addEventListener('nytfix:release', () => {
    holding = false;
    const pieces = [...held].filter(el => el.isConnected);
    held.clear();
    mark();
    pieces.forEach(letGo);
  });

  // Holding again: what was let go comes back. The site's own observer then tries to remove it,
  // which is held.
  document.addEventListener('nytfix:hold', () => {
    holding = true;
    for (const { piece, place } of passed.splice(0).reverse()) {
      if (!place.parentNode) continue; // a paragraph's place can be in a section let go too
      place.replaceWith(piece);
      held.add(piece);
    }
    for (const el of held) if (!el.isConnected) held.delete(el); // the page before's
    mark();
  });
})();
