// Ad-blocker notices: popups asking the reader to turn their ad blocker off ("Allow ads",
// "Subscribe", "Already a subscriber? Log in"), drawn over the article with the page dimmed and
// often scrolling locked. Seen on LA Times in the user's incognito window (never in their main
// profile, so its markup is unknown). They're found by what they say, not their markup:
//
// - A candidate is drawn on top of the page: position: fixed (itself or an ancestor), or a
//   dialog (role="dialog", aria-modal="true", <dialog>), including custom elements that draw in
//   a shadow root (LA Times' popups do).
// - Its text, shadow roots included, is short (a notice, not the page or an article) and
//   mentions an ad blocker.
// - Google's ad blocking recovery message (.fc-ab-root) is hidden by name.
//
// Hiding takes the notice's outermost fixed container, plus any dimming layer (fixed, nearly no
// text, covering most of the screen) that sits next to it, and unlocks scrolling, scrolling
// back to where a pinned <body> had been. The content script also puts the reader back where
// they last scrolled to themselves. Everything is
// hidden with inline !important styles, so the site's CSS can't bring it back. This runs on every
// supported page, wall or no wall, and isn't undone: it isn't part of the site's wall.
(function (root) {
  'use strict';

  // English, plus the sites' other languages: Italian ("blocco della pubblicità"), German
  // (Werbeblocker), French (bloqueur de publicité), Dutch (advertentieblokker), Spanish
  // (bloqueador de anuncios).
  const MENTION = /\bad[\s-]?block(?:er|ers|ing)?\b|\badblock|blocc(?:o|hi|are)\s+(?:della\s+|la\s+)?pubblicit|werbeblocker|bloqueurs?\s+de\s+pub|advertentieblokker|bloqueador(?:es)?\s+de\s+(?:anuncios|publicidad)/i;
  const KNOWN = '.fc-ab-root'; // Google's ad blocking recovery message
  const MAX_NOTICE_CHARS = 2000;
  const HIDDEN_ATTR = 'data-nytfix-notice';
  const CANDIDATES = '[role="dialog"], [aria-modal="true"], dialog';

  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

  // An element's text, open shadow roots included (one level of nesting inside it too).
  function textOf(el) {
    const parts = [el.textContent];
    if (el.shadowRoot) parts.push(el.shadowRoot.textContent);
    for (const inner of el.querySelectorAll('*')) if (inner.shadowRoot) parts.push(inner.shadowRoot.textContent);
    return clean(parts.join(' '));
  }

  function shown(el) {
    if (typeof el.checkVisibility === 'function') return el.checkVisibility({ visibilityProperty: true });
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  const fixed = el => el.ownerDocument.defaultView.getComputedStyle(el).position === 'fixed';

  // The extension's own elements (banner, status bar, loading box). Checked below <body> only:
  // <html> carries the extension's state classes (nytfix-active) while a wall is lifted.
  function ours(el) {
    for (let n = el; n && n !== el.ownerDocument.body && n !== el.ownerDocument.documentElement; n = n.parentElement) {
      if ((n.id && n.id.startsWith('nytfix')) || [...n.classList].some(c => c.startsWith('nytfix-'))) return true;
    }
    return false;
  }

  // The outermost fixed element holding `el`, below <body>; or `el` if none is fixed.
  function overlayOf(el) {
    let outer = null;
    for (let n = el; n && n !== el.ownerDocument.body && n !== el.ownerDocument.documentElement; n = n.parentElement) {
      if (fixed(n)) outer = n;
    }
    return outer || el;
  }

  // A dimming layer: fixed, drawn, nearly no text, covering most of the screen.
  function isDimmer(el) {
    if (!fixed(el) || !shown(el) || clean(el.textContent).length > 20) return false;
    const win = el.ownerDocument.defaultView;
    const rect = el.getBoundingClientRect();
    return rect.width * rect.height >= win.innerWidth * win.innerHeight * 0.8;
  }

  // The notices on the page now: [overlay element, …], each the element to hide.
  function find(doc) {
    const body = doc.body;
    if (!body) return [];
    const found = new Set();
    const consider = el => {
      if (el.hasAttribute(HIDDEN_ATTR) || ours(el) || !shown(el)) return;
      const isDialog = el.matches(CANDIDATES);
      if (!isDialog && !fixed(el)) return;
      const text = textOf(el);
      if (text.length > MAX_NOTICE_CHARS || !MENTION.test(text)) return;
      found.add(overlayOf(el));
    };
    // Overlays are usually children (or grandchildren) of <body>; dialogs can be anywhere.
    for (const child of body.children) {
      consider(child);
      for (const grandchild of child.children) consider(grandchild);
    }
    for (const el of doc.querySelectorAll(CANDIDATES)) consider(el);
    for (const el of doc.querySelectorAll(KNOWN)) if (!el.hasAttribute(HIDDEN_ATTR) && shown(el)) found.add(el);
    // A notice inside another one: keep the outer.
    return [...found].filter(el => ![...found].some(other => other !== el && other.contains(el)));
  }

  const force = (el, property, value) => el.style.setProperty(property, value, 'important');

  // Hide the notices on the page now, their dimming layers, and unlock scrolling. Returns
  // what was hidden (for the console).
  function sweep(doc) {
    return hideAll(doc, find(doc));
  }

  function hideAll(doc, notices) {
    if (!notices.length) return [];
    const hidden = [];
    const hide = el => {
      el.setAttribute(HIDDEN_ATTR, '');
      force(el, 'display', 'none');
      hidden.push(el);
    };
    for (const notice of notices) {
      hide(notice);
      const parent = notice.parentElement;
      for (const sibling of parent ? parent.children : []) if (sibling !== notice && !sibling.hasAttribute(HIDDEN_ATTR) && isDimmer(sibling)) hide(sibling);
    }
    const win = doc.defaultView;
    for (const el of [doc.documentElement, doc.body]) {
      const style = win.getComputedStyle(el);
      if (style.overflowY === 'hidden' || style.overflow === 'hidden') force(el, 'overflow', 'visible');
      if (el === doc.body && style.position === 'fixed') unpin(doc);
    }
    return hidden;
  }

  // A popup that pins <body> (position: fixed, top: -<how far the reader had scrolled>) keeps
  // the page looking still while the scroll position drops to 0. Unpinning it without scrolling
  // back would throw the reader to the top.
  function unpin(doc) {
    const win = doc.defaultView;
    const offset = parseFloat(win.getComputedStyle(doc.body).top) || 0;
    force(doc.body, 'position', 'static');
    force(doc.body, 'top', 'auto');
    if (offset < 0) win.scrollTo({ top: -offset, behavior: 'instant' });
  }

  // Keep sweeping as the page changes, at most every `throttleMs`, for `timeoutMs`. When a
  // sweep finds notices it calls beforeHide() first (the content script notes where the reader
  // is), hides them, then calls onHide(elements, whatever beforeHide returned) (and puts the
  // reader back there). Returns a function that stops.
  function watch(doc, { beforeHide = () => null, onHide = () => {}, throttleMs = 100, timeoutMs = 10 * 60 * 1000 } = {}) {
    const win = doc.defaultView;
    let last = 0;
    let pending = null;
    let stopped = false;
    const run = () => {
      pending = null;
      if (stopped) return;
      last = Date.now();
      const found = find(doc);
      if (!found.length) return;
      const before = beforeHide();
      const hidden = hideAll(doc, found);
      if (hidden.length) onHide(hidden, before);
    };
    const schedule = () => {
      if (stopped || pending) return;
      const wait = throttleMs - (Date.now() - last);
      if (wait <= 0) run();
      else pending = win.setTimeout(run, wait);
    };
    const observer = new win.MutationObserver(schedule);
    observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'open', 'hidden'] });
    const limit = win.setTimeout(stop, timeoutMs);
    function stop() {
      stopped = true;
      observer.disconnect();
      if (pending) win.clearTimeout(pending);
      win.clearTimeout(limit);
    }
    run();
    return stop;
  }

  const notices = { MENTION, find, sweep, watch };
  root.NYTFix = Object.assign(root.NYTFix || {}, { notices });
  if (typeof module === 'object' && module.exports) module.exports = notices;
})(globalThis);
