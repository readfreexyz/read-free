// Copy page details (the toolbar menu): the structure of the page a reader is on, as text to paste
// in an email when a wall isn't recognized, so it doesn't take developer tools. Sites change their
// walls without warning, and refuse scripted visits, so readers' pages are where it shows.
//
// What's in it: which of the adapter's own selectors are on the page, with counts, sizes and how
// they're laid out; what's inert, pinned or over the page; which fixed phrases a wall uses. What
// isn't: the article's text or address, the wall's own text (it can hold the reader's name or email
// address), names or ids the site made up, or anything from the page's data or cookies. Nothing is
// sent: the menu puts it on the clipboard.
(function (root) {
  'use strict';

  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  // What walls say, by name. Only whether each is there.
  const PHRASES = {
    subscribeTo: /\bsubscribe to\b/i,
    subscribe: /\bsubscribe\b/i,
    logIn: /\b(?:log|sign)(?:ging|ing)? in\b/i,
    withoutLoggingIn: /without logging in/i,
    withoutSigningIn: /without signing in/i,
    createAccount: /\b(?:create|creating) (?:an|a|your)(?: free)? account\b/i,
    freeToRead: /free to read/i,
    keepReading: /\b(?:keep|continue) reading\b/i,
    verify: /\bverify(?:ing)? access\b/i,
    adBlocker: /\bad[\s-]?block/i,
    trouble: /having trouble/i,
  };
  // A part's name is kept only if it's one of these words (a site's other ids can hold a story's
  // title or a reader's number)
  const WORDS = /^(?:app|root|main|site|content|page|body|story|article|container|wrapper|overlay|backdrop|modal|dialog|popup|gate|gateway|paywall|regiwall|wall|barrier|meter|offer|messaging|message|onsite|unit|login|auth|subscribe|subscription|upsell|truncator|truncated|banner|bar|bottom|top|vi|cx|tp|piano|scrim|masthead|header|footer|nav|lock|scroll|fixed|advisory|exit|close|iframe|frame|user|profile)$/i;
  const known = name => {
    const parts = String(name || '').split(/[-_\s]+/).filter(Boolean);
    return parts.length > 0 && parts.length <= 6 && parts.every(p => WORDS.test(p)) ? parts.join('-') : '';
  };
  const ours = el => Boolean(el.closest('[id^="nytfix"], [class*="nytfix-"]:not(html):not(body)'));

  function describe(doc, site, { version = '', browser = '', state = '', missed = null } = {}) {
    const win = doc.defaultView;
    const lib = root.NYTFix || {};
    const wall = site.live?.wall || {};
    const all = selector => {
      try { return [...doc.querySelectorAll(selector)].filter(el => !ours(el)); } catch { return []; }
    };
    const name = el => {
      const id = known(el.id);
      const test = known(el.getAttribute('data-testid'));
      return `${el.tagName.toLowerCase()}${id ? `#${id}` : el.id ? '#?' : ''}${test ? `[${test}]` : ''}`;
    };
    const box = el => {
      const r = el.getBoundingClientRect();
      return `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.top)}`;
    };
    const look = el => {
      const c = win.getComputedStyle(el);
      return `${name(el)} kids:${el.childElementCount} chars:${clean(el.textContent).length} ${box(el)} ${c.position} ${c.display} ov:${c.overflowX}/${c.overflowY}${el.hasAttribute('inert') ? ' inert' : ''}${el.getAttribute('aria-hidden') === 'true' ? ' aria-hidden' : ''}`;
    };
    const lines = [];
    const add = (label, value) => lines.push(`${label}: ${value}`);

    // The address, as a shape: numbers as N, the rest as w
    const shape = doc.defaultView.location.pathname.split('/').filter(Boolean).map(s => (/^\d+$/.test(s) ? 'N' : 'w')).join('/');
    add('Read Free', `${version} ${browser} on ${site.id}; ${state}${missed ? `, missed: ${missed}` : ''}`);
    add('page', `/${shape}; article:${Boolean(site.isArticle?.(win.location.pathname))} live:${Boolean(site.isLive?.(win.location.pathname))}; ${win.innerWidth}x${win.innerHeight}, at ${Math.round(win.scrollY)} of ${(doc.scrollingElement || doc.documentElement).scrollHeight}; ${Math.round(win.performance?.now?.() / 1000) || 0} s`);
    add('html', [...doc.documentElement.classList].filter(c => c.startsWith('nytfix-')).join(' ') || '-');

    // The adapter's own selectors, so nothing here is the site's words
    const hide = lib.adapter?.selectorsFor ? lib.adapter.selectorsFor(wall, 'hide') : [];
    const selectors = { body: site.live?.body, story: site.live?.story, main: site.live?.main || 'main', popup: wall.popup, container: wall.container, held: wall.inert, pinned: wall.pinned };
    for (const [label, selector] of Object.entries(selectors)) {
      if (!selector || typeof selector !== 'string') continue;
      const found = all(selector);
      add(label, found.length ? `${found.length} ${found.slice(0, 2).map(look).join(' | ')}` : 'none');
    }
    if (hide.length) add('wall parts', hide.map((s, i) => [i, all(s).length]).filter(([, n]) => n).map(([i, n]) => `#${i}:${n}`).join(' ') || 'none');
    if (lib.paywall) {
      add('wall', `seen:${lib.paywall.isActive(doc, site)} type:${lib.paywall.wallType(doc, site)} hidden popup shows:${wall.popup ? lib.paywall.hiddenPopupShows(doc, site) : '-'}`);
    }
    if (lib.render?.frozen) add('scrolling', lib.render.frozen(doc, site) ? 'frozen' : 'free');

    const bodies = all(site.live?.body || ':not(*)');
    const ps = bodies.flatMap(b => [...b.querySelectorAll('p')]).filter(p => !p.closest('figure, aside'));
    add('text', `${ps.length} paragraphs, ${ps.reduce((n, p) => n + clean(p.textContent).length, 0)} characters, last ${ps.slice(-3).map(p => clean(p.textContent).length).join(',') || '-'}`);
    const says = el => (el ? Object.keys(PHRASES).filter(p => PHRASES[p].test(el.textContent)).join(' ') || '-' : 'none');
    if (wall.popup) add('popup says', says(all(wall.popup)[0]));
    add('text ends', ps.length ? says(ps[ps.length - 1]) : '-');

    add('inert', all('[inert]').slice(0, 14).map(el => `${name(el)}${el.closest('main') ? ' in main' : ''}`).join(', ') || 'none');
    const chain = [];
    for (let n = all(site.live?.main || 'main')[0] || doc.body; n; n = n.parentElement) {
      const c = win.getComputedStyle(n);
      chain.push(`${name(n)} ${c.position} ov:${c.overflowX}/${c.overflowY} h:${Math.round(n.getBoundingClientRect().height)}/${n.scrollHeight} max:${c.maxHeight}${n.style?.position ? ` inline:${n.style.position}` : ''}`);
    }
    add('around the page', chain.join(' < '));
    const over = all('body *').filter(el => {
      const { position } = win.getComputedStyle(el);
      if (position !== 'fixed' && position !== 'sticky') return false;
      const r = el.getBoundingClientRect();
      return r.width > win.innerWidth * 0.4 && r.height > win.innerHeight * 0.2;
    });
    add('over the page', over.slice(0, 6).map(look).join(' | ') || 'none');
    return lines.join('\n');
  }

  const details = { describe };
  root.NYTFix = Object.assign(root.NYTFix || {}, { details });
  if (typeof module === 'object' && module.exports) module.exports = details;
})(globalThis);
