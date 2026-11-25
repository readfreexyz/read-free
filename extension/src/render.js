// Put extracted snapshot text into the live page, and take it out again. Site-independent:
// every selector comes from the site adapter (sites/*.js), passed in as `site`.
//
// The original article nodes are hidden, not removed: the site's framework (React, on NYT)
// owns them and can throw if nodes it manages disappear. Our text goes in a copy of the site's
// own paragraph wrappers and classes, so it picks up the column width and typography.
(function (root) {
  'use strict';

  const BANNER_ID = 'nytfix-banner';
  const HIDDEN_ATTR = 'data-nytfix-hidden';
  const REVEAL_ATTR = 'data-nytfix-reveal'; // text a site sends but hides behind its wall (content.css shows it)
  const UNLOCK_ATTR = 'data-nytfix-unlock'; // on <html> / <body> when a wall had locked scrolling
  const SWAPPED_ATTR = 'data-nytfix-swapped'; // on the article body while it holds the archived text (content.css)
  // Shared adapter helpers (paywall services' selectors), there once the adapters have loaded.
  const adapterLib = () => (root.NYTFix && root.NYTFix.adapter) || (typeof require === 'function' ? require('./adapter.js') : null);
  const ACTIVE_CLASS = 'nytfix-active'; // on <html> while the extension has a wall lifted
  const OFF_CLASS = 'nytfix-off'; // on <html> when the reader asked for the site's version: site CSS then shows the wall

  const clean = s => s.replace(/\s+/g, ' ').trim();

  // The live article body: every element matching site.live.body (The New Yorker splits it into
  // several chunks with ads in between), or none (FT's barrier page has no article).
  function liveBodies(doc, site) {
    return site.live.body ? [...doc.querySelectorAll(site.live.body)].filter(el => !el.closest('.nytfix-body')) : [];
  }

  // The first chunk: where the banner goes and the archived text is put.
  // Is the archived text still where apply() put it? Not once the site has redrawn the article
  // (React sites like The Age): the archived text gone, outside the article body now on the page
  // (it went in before the body was there), or the body showing its own paragraphs again.
  function swapIntact(doc, site) {
    const body = doc.querySelector('.nytfix-body');
    if (!body) return false;
    const sections = liveBodies(doc, site);
    if (!sections.length) return true; // nothing to compare with (FT's barrier page)
    if (!sections.some(section => section.contains(body))) return false;
    return !sections.some(section => liveParagraphs(section, site).some(p => !p.closest('.nytfix-body') && !p.closest(`[${HIDDEN_ATTR}]`)));
  }

  function liveArticleBody(doc, site) {
    return liveBodies(doc, site)[0] || null;
  }

  // Where the banner and swapped-in text go when there's no article body to replace.
  function fallbackContainer(doc, site) {
    return (site.live.story && doc.querySelector(site.live.story)) || doc.querySelector('main') || doc.body;
  }

  // Put `el` where the article belongs on a page with no article body: right after
  // site.live.insertAfter (FT: the barrier page, which site CSS trims to just the headline),
  // or else at the top (first) or end of the fallback container. Inserting right after the
  // same anchor puts later elements before earlier ones, so the banner, inserted last, lands
  // above the text.
  function placeWithoutBody(doc, site, el, { first = false } = {}) {
    const after = site.live.insertAfter && doc.querySelector(site.live.insertAfter);
    if (after) after.after(el);
    else if (first) fallbackContainer(doc, site).prepend(el);
    else fallbackContainer(doc, site).append(el);
  }

  // The article's own paragraphs: not captions, asides, or the site's subscription line.
  // Paragraphs that aren't the article's: a wall's own (the adapter's wall.hide and its paywall
  // services: Der Spiegel's offer block sits inside the article body) and the adapter's
  // live.exclude.
  function notArticleSelector(site) {
    const lib = adapterLib();
    const wall = (site.live && site.live.wall) || null;
    return [...(lib ? lib.selectorsFor(wall, 'hide') : []), ...[].concat(site.live.exclude || [])].join(', ');
  }

  function liveParagraphs(section, site) {
    const upsell = site.live.upsellLink;
    const exclude = notArticleSelector(site);
    return [...section.querySelectorAll('p')].filter(p => !p.closest('figure, aside') && !(upsell && p.querySelector(upsell)) && !(exclude && p.closest(exclude)));
  }

  // The article's own paragraphs across every chunk of the body.
  function allLiveParagraphs(doc, site) {
    return liveBodies(doc, site).flatMap(section => liveParagraphs(section, site));
  }

  // The "subscribe to keep reading" line under the cut-off text: short lines holding the site's
  // subscription link, inside or after the article body (on NYT: not the masthead's subscribe
  // button above the article, nor the paywall popup outside main).
  function upsellLines(doc, site) {
    const section = liveArticleBody(doc, site);
    const scope = doc.querySelector(site.live.main) || doc.querySelector('main');
    if (!section || !scope || !site.live.upsellLink) return [];
    const lines = new Set();
    for (const a of scope.querySelectorAll(site.live.upsellLink)) {
      const line = a.closest('p, div');
      if (!line || line.contains(section)) continue;
      const inOrAfter = section.contains(line) || (section.compareDocumentPosition(line) & 4); // 4: FOLLOWING
      if (inOrAfter && clean(line.textContent).length < 200) lines.add(line);
    }
    return [...lines];
  }

  // While archive.today loads: a placeholder where the cut-off text ends, so readers who get
  // there know the rest is on its way. It takes the place of the site's subscription line.
  // Returns { finish(kind, message, { action }), remove() }. finish turns it into a short note
  // (when archive.today can't help), with an optional button ({ text, onClick }), and brings the
  // subscription line back.
  function showLoadingPlaceholder(doc, site, message = 'Loading the rest of this article from archive.today…') {
    const section = liveArticleBody(doc, site);
    const lines = section ? upsellLines(doc, site) : [];
    const box = doc.createElement('div');
    box.className = 'nytfix-loading';
    box.dataset.kind = 'loading';
    box.setAttribute('role', 'status');
    const spinner = doc.createElement('span');
    spinner.className = 'nytfix-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const text = doc.createElement('span');
    text.textContent = message;
    box.append(spinner, text);

    // Inside the body, the box sits in a row with the site's paragraph class, so it lines up
    // with the text column instead of spanning the whole body (The Atlantic's body is
    // full-width; each paragraph sets its own width). A div, so it's never counted as text.
    let node = box;
    const template = section && paragraphTemplate(section, site);
    if (template) {
      node = doc.createElement('div');
      node.className = template.paragraphClass;
      node.classList.add('nytfix-loading-row');
      node.append(box);
    }

    const lastParagraph = section && allLiveParagraphs(doc, site).at(-1);
    if (!section) {
      box.classList.add('nytfix-loading-standalone');
      text.textContent = message.replace('the rest of this article', 'this article');
      placeWithoutBody(doc, site, node, { first: true });
    } else if (lines.length) lines[0].before(node);
    else if (lastParagraph) lastParagraph.after(node);
    else section.append(node);
    for (const line of lines) line.setAttribute(HIDDEN_ATTR, '');
    const unhide = () => { for (const line of lines) line.removeAttribute(HIDDEN_ATTR); };

    return {
      finish(kind, note, { action } = {}) {
        box.dataset.kind = kind;
        box.setAttribute('role', kind === 'error' ? 'alert' : 'status');
        spinner.remove();
        text.textContent = note;
        if (action) {
          const button = doc.createElement('button');
          button.type = 'button';
          button.className = 'nytfix-loading-action';
          button.textContent = action.text;
          button.addEventListener('click', action.onClick);
          box.append(button);
        }
        unhide();
      },
      remove() {
        node.remove();
        unhide();
      },
    };
  }

  // site.live.textTemplate: HTML for the wrappers a paragraph sits in, with an empty <p> where
  // the text goes (and the paragraph class on it). Null without one.
  function templateFromHtml(doc, html) {
    if (!html) return null;
    const holder = doc.createElement('template');
    holder.innerHTML = html;
    const p = holder.content.querySelector('p');
    if (!p) return null;
    const chain = [];
    for (let n = p.parentElement; n; n = n.parentElement) chain.unshift(n);
    return { paragraphClass: p.className, headingClass: '', linkClass: '', chain };
  }

  function liveStats(doc, site) {
    const ps = allLiveParagraphs(doc, site);
    return { paragraphs: ps.length, chars: ps.reduce((n, p) => n + clean(p.textContent).length, 0) };
  }

  // The most common paragraph class in the live article, plus the wrapper elements
  // between the section and such a paragraph (they set the column width and centering).
  // What the archived paragraphs are dressed in: the class of the site's own paragraphs and the
  // wrappers between them and the body. A page that kept no paragraphs at all (Der Spiegel's
  // Spiegel+ articles) can be given one by its adapter (live.textTemplate, see below).
  function paragraphTemplate(section, site) {
    const ps = liveParagraphs(section, site);
    if (!ps.length) return templateFromHtml(section.ownerDocument, site.live.textTemplate);
    const counts = new Map();
    for (const p of ps) counts.set(p.className, (counts.get(p.className) || 0) + 1);
    const [paragraphClass] = [...counts].sort((a, b) => b[1] - a[1])[0];
    const sample = ps.find(p => p.className === paragraphClass);
    const chain = [];
    for (let n = sample.parentElement; n && n !== section; n = n.parentElement) chain.unshift(n);
    const link = ps.map(p => p.querySelector('a[href]')).find(Boolean);
    return { paragraphClass, headingClass: section.querySelector('h2')?.className || '', linkClass: link?.className || '', chain };
  }

  const safeHref = href => (typeof href === 'string' && /^https?:\/\//i.test(href) ? href : null);
  const safeSrc = src => (typeof src === 'string' && /^https:\/\//i.test(src) ? src : null);

  // A paragraph from its runs of text: links, emphasis, and plain text. Built with DOM calls
  // only, so nothing from the snapshot is ever parsed as HTML.
  function buildParagraph(doc, block, template) {
    const p = doc.createElement('p');
    if (template?.paragraphClass) p.className = template.paragraphClass;
    let link = null; // consecutive runs with the same link share one <a>
    for (const run of block.inlines || [{ text: block.text }]) {
      let node = doc.createTextNode(run.text);
      if (run.em) {
        const em = doc.createElement('em');
        em.append(node);
        node = em;
      }
      if (run.strong) {
        const strong = doc.createElement('strong');
        strong.append(node);
        node = strong;
      }
      const href = safeHref(run.href);
      if (!href) {
        link = null;
        p.append(node);
        continue;
      }
      if (!link || link.getAttribute('href') !== href) {
        link = doc.createElement('a');
        link.href = href;
        if (template?.linkClass) link.className = template.linkClass;
        p.append(link);
      }
      link.append(node);
    }
    return p;
  }

  function buildFigure(doc, block) {
    const src = safeSrc(block.src);
    if (!src) return null;
    const figure = doc.createElement('figure');
    figure.className = 'nytfix-figure';
    const img = doc.createElement('img');
    // A sharper copy for 2x screens, if the site has one. Should it fail to load, fall back to
    // the size the snapshot had.
    const hires = safeSrc(block.hires);
    if (hires && !/[\s,]/.test(src + hires)) {
      img.srcset = `${src} 1x, ${hires} 2x`;
      img.addEventListener('error', () => img.removeAttribute('srcset'), { once: true });
    }
    img.src = src;
    img.alt = block.alt || '';
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
    figure.append(img);
    if (block.caption) {
      const caption = doc.createElement('figcaption');
      caption.textContent = block.caption;
      figure.append(caption);
    }
    return figure;
  }

  function buildBlock(doc, block, template) {
    if (block.type === 'figure') return buildFigure(doc, block);
    if (block.type === 'heading') {
      const h2 = doc.createElement('h2');
      h2.textContent = block.text;
      if (template?.headingClass) h2.className = template.headingClass;
      return h2;
    }
    return buildParagraph(doc, block, template);
  }

  function buildBody(doc, blocks, template) {
    let outer = null;
    let inner = null;
    for (const wrapper of template ? template.chain : []) {
      const copy = wrapper.cloneNode(false);
      copy.removeAttribute('id');
      copy.removeAttribute(HIDDEN_ATTR);
      if (inner) inner.append(copy);
      else outer = copy;
      inner = copy;
    }
    // No wrappers to copy: a plain div, so the paragraphs inherit the body's own styling (The
    // Age's sit straight in the body, unclassed). Only without any template at all is the
    // fallback styling used.
    if (!inner) {
      outer = inner = doc.createElement('div');
      if (!template) inner.className = 'nytfix-fallback';
    }
    outer.classList.add('nytfix-body');
    for (const block of blocks) {
      const el = buildBlock(doc, block, template);
      if (el) inner.append(el);
    }
    return outer;
  }

  // "5 minutes ago", "3 hours ago", "2 days ago"
  function relativeTime(ms, now = Date.now()) {
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    const mins = Math.round((now - ms) / 60000);
    const hours = Math.round(mins / 60);
    return Math.abs(mins) < 60 ? rtf.format(-mins, 'minute')
      : Math.abs(hours) < 48 ? rtf.format(-hours, 'hour')
      : rtf.format(-Math.round(hours / 24), 'day');
  }

  function describeTime(ms, now = Date.now()) {
    const when = new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    return `${when} (${relativeTime(ms, now)})`;
  }

  function removeBanner(doc) {
    doc.getElementById(BANNER_ID)?.remove();
  }

  // kind: 'loading' | 'done' | 'info' | 'error'
  function showBanner(doc, site, { kind, message, links = [], actions = [] }) {
    removeBanner(doc);
    const banner = doc.createElement('div');
    banner.id = BANNER_ID;
    banner.className = 'nytfix-banner';
    banner.dataset.kind = kind;
    banner.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    const text = doc.createElement('span');
    text.textContent = message;
    banner.append(text);
    for (const { text: label, href, title } of links) {
      const a = doc.createElement('a');
      a.href = href;
      // An email (Report a problem) opens the reader's mail app, not a tab
      if (!/^mailto:/i.test(href)) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
      if (title) a.title = title;
      a.textContent = label;
      banner.append(a);
    }
    for (const { text: label, onClick } of actions) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', onClick);
      banner.append(b);
    }
    const section = liveArticleBody(doc, site);
    if (section) section.before(banner);
    else placeWithoutBody(doc, site, banner, { first: true });
    return banner;
  }

  // What site CSS can't do about a wall (on NYT, per the incognito diagnostics: the popup and
  // the pinned container are handled by nyt.css):
  // - hide positioned children of the wall container (NYT's gradient scrim);
  // - remove `inert` / aria-hidden="true" from the article's ancestors and from anything inert
  //   inside the page content or next to it, which otherwise makes every link and button
  //   unclickable;
  // - hide the wall's own elements (wall.hide, and those of the paywall services in
  //   wall.services), for sites without CSS of their own;
  // - show text the site sent but hid (wall.reveal: cut to a few lines, faded, display: none);
  // - give elements the classes the site gives readers allowed to read (wall.classes:
  //   { selector: class or [classes] }), where its CSS hides the text until they're there
  //   (the Daily Mail: body.is-paywall-processed);
  // - unlock scrolling (wall.unlockScroll), if the wall set overflow: hidden on <html> or <body>
  //   or pinned <body> in place.
  // - let go of an element the wall pinned with inline styles (wall.pinned: NYT's interactive pages).
  // Keeps doing so if the site re-applies them or draws its wall again. Returns an undo function.
  function liftPaywall(doc, site) {
    const win = doc.defaultView;
    const wall = site.live.wall || {};
    const container = wall.container ? doc.querySelector(wall.container) : null;
    const anchor = liveArticleBody(doc, site) || fallbackContainer(doc, site);
    const mainSelector = site.live.main || 'main';
    const hidden = [];
    const changed = []; // [element, attribute, original value]
    const marked = []; // [element, attribute] added here
    const lib = adapterLib();
    const hideSelector = lib ? lib.selectorsFor(wall, 'hide').join(', ') : '';
    const revealSelector = lib ? lib.selectorsFor(wall, 'reveal').join(', ') : '';
    const mark = (el, name, value = '') => {
      if (el.hasAttribute(name)) return;
      el.setAttribute(name, value);
      marked.push([el, name]);
    };
    // An inline !important style outranks every stylesheet rule, the site's own !important ones
    // included: LA Times hides its subscriber text with `display: none !important`, which beat
    // content.css. Each change is recorded so undo puts the old inline value back.
    const forced = []; // [element, property, old value, old priority]
    const classEntries = Object.entries(wall.classes || {}); // [[selector, class or [classes]]]
    const classesAdded = []; // [element, class] added here
    const force = (el, property, value) => {
      forced.push([el, property, el.style.getPropertyValue(property), el.style.getPropertyPriority(property)]);
      el.style.setProperty(property, value, 'important');
    };

    const unset = (el, name) => {
      if (!el.hasAttribute(name)) return;
      if (!changed.some(([e, n]) => e === el && n === name)) changed.push([el, name, el.getAttribute(name)]);
      el.removeAttribute(name);
    };

    const PIN_PROPERTIES = ['position', 'width', 'top', 'margin-top'];
    const unpinned = []; // [element, [[property, value, priority]]], as it was first pinned
    const unpin = el => {
      if (el.style.position !== 'fixed') return;
      const was = PIN_PROPERTIES.map(p => [p, el.style.getPropertyValue(p), el.style.getPropertyPriority(p)]);
      if (!unpinned.some(([e]) => e === el)) unpinned.push([el, was]);
      const offset = parseFloat(el.style.marginTop || el.style.top) || 0;
      for (const p of PIN_PROPERTIES) el.style.removeProperty(p);
      // Pinned at minus how far the reader had scrolled: if the page was sent to the top, go back
      if (offset < 0 && win.scrollY === 0) win.scrollTo({ top: -offset, behavior: 'instant' });
    };

    const sweep = () => {
      if (wall.pinned) for (const el of doc.querySelectorAll(wall.pinned)) unpin(el);
      // Positioned children of the wall container are overlays (the scrim). The masthead and
      // the page content are static children and are left alone.
      for (const child of container ? container.children : []) {
        if (child.hasAttribute(HIDDEN_ATTR) || child.matches('main') || child.querySelector('main, article')) continue;
        const { position } = win.getComputedStyle(child);
        if (position === 'absolute' || position === 'fixed') {
          child.setAttribute(HIDDEN_ATTR, '');
          hidden.push(child);
        }
      }
      for (let n = anchor; n; n = n.parentElement) {
        unset(n, 'inert');
        if (n.getAttribute('aria-hidden') === 'true') unset(n, 'aria-hidden');
      }
      const setFree = el => {
        unset(el, 'inert');
        // On a site whose wall makes the page inert, aria-hidden comes with it
        if (wall.inert && el.getAttribute('aria-hidden') === 'true') unset(el, 'aria-hidden');
      };
      for (const el of doc.querySelectorAll(`${mainSelector} [inert]`)) setFree(el);
      const popup = wall.popup ? doc.querySelector(wall.popup) : null;
      for (const child of container ? container.children : []) {
        if (child.hasAttribute('inert') && !child.contains(popup)) setFree(child); // NYT's masthead
      }
      if (hideSelector) for (const el of doc.querySelectorAll(hideSelector)) mark(el, HIDDEN_ATTR);
      if (revealSelector) {
        for (const el of doc.querySelectorAll(revealSelector)) {
          if (el.hasAttribute(REVEAL_ATTR)) continue;
          const undisplayed = win.getComputedStyle(el).display === 'none';
          mark(el, REVEAL_ATTR, undisplayed ? 'display' : '');
          if (undisplayed) force(el, 'display', 'block');
        }
      }
      for (const [selector, names] of classEntries) {
        for (const el of doc.querySelectorAll(selector)) {
          for (const name of [].concat(names)) {
            if (el.classList.contains(name)) continue;
            el.classList.add(name);
            classesAdded.push([el, name]);
          }
        }
      }
      if (wall.unlockScroll) {
        for (const el of [doc.documentElement, doc.body]) {
          if (!el || el.hasAttribute(UNLOCK_ATTR)) continue;
          const style = win.getComputedStyle(el);
          // Pinned in place: <body>, or <html> itself (NRC: position: fixed with overflow: hidden;
          // overflow alone set free leaves a page that still can't scroll).
          const pinned = style.position === 'fixed';
          if (!pinned && style.overflow !== 'hidden' && style.overflowY !== 'hidden') continue;
          mark(el, UNLOCK_ATTR, pinned ? 'fixed' : '');
          force(el, 'overflow', 'visible');
          if (pinned) {
            // A pinned element sits at top: -<how far the reader had scrolled>, with the scroll
            // position at 0. Scroll back there once it's unpinned, or the reader lands at the top.
            const offset = parseFloat(style.top) || 0;
            force(el, 'position', 'static');
            force(el, 'top', 'auto');
            if (offset < 0) win.scrollTo({ top: -offset, behavior: 'instant' });
          }
        }
      }
    };

    sweep();
    const observers = [];
    if (container) {
      const o = new win.MutationObserver(sweep);
      o.observe(container, { childList: true });
      observers.push(o);
    }
    const attrs = new win.MutationObserver(sweep);
    attrs.observe(doc.documentElement, { subtree: true, attributes: true, attributeFilter: ['inert', 'aria-hidden'] });
    observers.push(attrs);
    if ((hideSelector || revealSelector) && doc.body) {
      // The wall may be drawn (again) later: paywall services load their templates late.
      const added = new win.MutationObserver(sweep);
      added.observe(doc.body, { childList: true, subtree: true });
      observers.push(added);
    }
    if (wall.pinned) {
      const pins = new win.MutationObserver(sweep);
      for (const el of doc.querySelectorAll(wall.pinned)) pins.observe(el, { attributes: true, attributeFilter: ['style'] });
      observers.push(pins);
    }
    if (classEntries.length) {
      // The site may take the classes off again.
      const classes = new win.MutationObserver(sweep);
      for (const [selector] of classEntries) for (const el of doc.querySelectorAll(selector)) classes.observe(el, { attributes: true, attributeFilter: ['class'] });
      observers.push(classes);
    }
    if (wall.unlockScroll) {
      const locks = new win.MutationObserver(sweep);
      for (const el of [doc.documentElement, doc.body]) if (el) locks.observe(el, { attributes: true, attributeFilter: ['class', 'style'] });
      observers.push(locks);
    }
    if (hidden.length || changed.length || marked.length || forced.length || classesAdded.length || unpinned.length) {
      const name = e => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}`;
      console.info('[Read Free] lifted paywall:', {
        overlaysHidden: hidden.length,
        attributesRemoved: changed.map(([e, n]) => `${name(e)} ${n}`),
        marked: marked.map(([e, n]) => `${name(e)} ${n}`),
        classesAdded: classesAdded.map(([e, c]) => `${name(e)} .${c}`),
        unpinned: unpinned.map(([e]) => name(e)),
      });
    }

    // restoreAttributes: false when leaving the page via in-page navigation. Putting `inert`
    // back then could leave the next article unclickable; the site sets what it needs.
    return ({ restoreAttributes = true } = {}) => {
      for (const o of observers) o.disconnect();
      for (const el of hidden) el.removeAttribute(HIDDEN_ATTR);
      for (const [el, property, value, priority] of forced.reverse()) {
        if (value) el.style.setProperty(property, value, priority);
        else el.style.removeProperty(property);
      }
      for (const [el, name] of marked) el.removeAttribute(name);
      for (const [el, name] of classesAdded) el.classList.remove(name);
      if (restoreAttributes) {
        for (const [el, name, value] of changed) el.setAttribute(name, value);
        for (const [el, was] of unpinned) for (const [p, value, priority] of was) if (value) el.style.setProperty(p, value, priority);
      }
    };
  }

  // Keeping the reader's place. When a wall appears the page can land back at the top, and stay
  // there once the wall is lifted. scroll.js remembers where the page content's top edge sat
  // while the reader scrolled; these put it back there.
  function contentAnchor(doc, site) {
    return (site.live.main && doc.querySelector(site.live.main)) || doc.querySelector('main') || doc.body;
  }

  // Where the page content's top edge is, in viewport pixels (negative once scrolled past).
  function anchorTop(doc, site) {
    return contentAnchor(doc, site).getBoundingClientRect().top;
  }

  // Whatever actually scrolls this page: usually the document, but NYT pages have also used <body>.
  function scrollerFor(doc, el) {
    const win = doc.defaultView;
    for (let n = el.parentElement; n && n !== doc.documentElement; n = n.parentElement) {
      const { overflowY } = win.getComputedStyle(n);
      if ((overflowY === 'auto' || overflowY === 'scroll') && n.scrollHeight > n.clientHeight) return n;
    }
    return doc.scrollingElement || doc.documentElement;
  }

  // Scroll so the page content's top edge is at `top` (an anchorTop() value).
  function scrollAnchorTo(doc, site, top) {
    return scrollElementTo(doc, contentAnchor(doc, site), top);
  }

  // Scroll so `anchor`'s top edge is at `top` px down the viewport. Tries the likely scroller
  // first, checks that the element actually moved, and falls back to the window and then
  // <body>. Returns what happened, for the debug log.
  function scrollElementTo(doc, anchor, top) {
    const current = () => anchor.getBoundingClientRect().top;
    const off = () => current() - top;
    const valid = typeof top === 'number' && Number.isFinite(top);
    const result = { target: valid ? Math.round(top) : null, before: Math.round(current()), after: null, via: 'none' };
    if (valid && Math.abs(off()) >= 2) {
      const scroller = scrollerFor(doc, anchor);
      const attempts = [
        [scroller === doc.scrollingElement ? 'document' : scroller.tagName.toLowerCase(), () => {
          if (typeof scroller.scrollTo === 'function') scroller.scrollTo({ top: scroller.scrollTop + off(), behavior: 'instant' });
          else scroller.scrollTop += off();
        }],
        ['window', () => doc.defaultView.scrollBy({ top: off(), behavior: 'instant' })],
        ['body', () => { doc.body.scrollTop += off(); }],
      ];
      for (const [via, attempt] of attempts) {
        attempt();
        if (Math.abs(off()) < 2) {
          result.via = via;
          break;
        }
      }
    }
    result.after = Math.round(current());
    return result;
  }

  // Take the site's wall off: the popup and the pinned container (site CSS, from the start),
  // `inert` and the scrim (liftPaywall). The page's own text is left alone; apply() swaps it.
  // Returns undo({ putBackPaywall = true }). Putting the wall back means showing it again, so
  // undo adds .nytfix-off; pass putBackPaywall: false when the site navigates to another page.
  function liftWall(doc, site) {
    const html = doc.documentElement;
    html.classList.remove(OFF_CLASS);
    html.classList.add(ACTIVE_CLASS);
    const undoPaywall = liftPaywall(doc, site);
    return ({ putBackPaywall = true } = {}) => {
      undoPaywall({ restoreAttributes: putBackPaywall });
      html.classList.remove(ACTIVE_CLASS);
      if (putBackPaywall) html.classList.add(OFF_CLASS);
    };
  }

  // The page can't be scrolled, though there's more of it than fits the window: something the
  // wall did is still in place.
  function frozen(doc, site) {
    const win = doc.defaultView;
    const main = doc.querySelector(site.live.main || 'main');
    const scroller = doc.scrollingElement || doc.documentElement;
    if (!main || main.scrollHeight <= win.innerHeight * 1.2) return false;
    // Scrolled inside an element of its own (a full-window page), not by the window
    for (let n = main; n && n !== doc.body && n !== doc.documentElement; n = n.parentElement) {
      if (/auto|scroll/.test(win.getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 2) return false;
    }
    if (scroller.scrollHeight <= win.innerHeight + 2) return true;
    // <html>'s overflow is the window's; <body>'s is, if <html> has none of its own
    const html = win.getComputedStyle(doc.documentElement).overflowY;
    const body = doc.body ? win.getComputedStyle(doc.body).overflowY : 'visible';
    const own = html && html !== 'visible' ? html : body;
    return own === 'hidden' || own === 'clip';
  }

  // Show the wall the way the site draws it (a paywalled page the extension can't fix, or
  // where archive.today couldn't help and there's no article on the page at all).
  function showWall(doc) {
    doc.documentElement.classList.add(OFF_CLASS);
  }

  // Undo showWall: let site CSS hide the wall again (before swapping text in after all).
  function hideWall(doc) {
    doc.documentElement.classList.remove(OFF_CLASS);
  }

  // Keeping the reader's paragraph in place across the swap. The archived text arrives while the
  // reader may be partway through the paragraphs the site showed. Everything above them changes
  // (photos, ads and column wrappers go, the banner arrives), so anchor on the paragraph itself
  // rather than on the page.
  const textKey = s => s.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60);

  // The paragraph the reader is on: the topmost live article paragraph still (partly) on
  // screen, or the last one if they've scrolled past them all. Null if they're above the text.
  function readingAnchor(doc, site) {
    let anchor = null;
    for (const [index, p] of allLiveParagraphs(doc, site).entries()) {
      const r = p.getBoundingClientRect();
      if (!r.height) continue;
      anchor = { index, key: textKey(p.textContent), top: r.top };
      if (r.bottom > 0) break;
    }
    return anchor && anchor.top < doc.defaultView.innerHeight ? anchor : null;
  }

  // Put the same paragraph of the new text back where the reader had it: matched by its
  // opening words, or by position if the wording changed.
  function keepReading(doc, body, anchor) {
    if (!anchor) return null;
    const ps = [...body.querySelectorAll('p')];
    const byText = ps.find(p => textKey(p.textContent) === anchor.key);
    const target = byText || ps[anchor.index];
    if (!target) return null;
    return { paragraph: ps.indexOf(target), matchedBy: byText ? 'text' : 'position', ...scrollElementTo(doc, target, anchor.top) };
  }

  // Chrome's own scroll anchoring would adjust the page too when we hide the old text, so turn
  // it off until the swap has settled. Returns a function that turns it back on.
  function pauseScrollAnchoring(doc) {
    const win = doc.defaultView;
    const els = [doc.documentElement, doc.body];
    const before = els.map(el => el.style.overflowAnchor);
    for (const el of els) el.style.overflowAnchor = 'none';
    const frame = win.requestAnimationFrame ? cb => win.requestAnimationFrame(cb) : cb => win.setTimeout(cb, 16);
    return () => frame(() => frame(() => els.forEach((el, i) => { el.style.overflowAnchor = before[i]; })));
  }

  // Swap in the snapshot text and the banner, keeping the reader's paragraph where it was.
  // Returns a function that takes them out again. The banner's "Show <site>'s version" button
  // calls onRestore, which should undo everything.
  function apply(doc, site, { blocks, snapshotUrl, snapshotTime, onRestore }) {
    const reading = readingAnchor(doc, site); // before anything moves
    const resumeAnchoring = pauseScrollAnchoring(doc);
    const section = liveArticleBody(doc, site);
    const body = buildBody(doc, blocks, section ? paragraphTemplate(section, site) : null);
    const chunks = liveBodies(doc, site);
    const hidden = chunks.flatMap(chunk => [...chunk.children]);
    // The subscription line goes too, even when it sits after the article body.
    for (const line of upsellLines(doc, site)) if (!hidden.some(el => el.contains(line))) hidden.push(line);
    for (const el of hidden) el.setAttribute(HIDDEN_ATTR, '');
    // The site's CSS for its cut text no longer applies (content.css): WSJ hides every paragraph
    // in the body after the second and fades out the body's end.
    for (const chunk of chunks) chunk.setAttribute(SWAPPED_ATTR, '');
    if (section) section.append(body);
    else placeWithoutBody(doc, site, body);
    showBanner(doc, site, {
      kind: 'done',
      message: `Full text from the archive.today snapshot of ${describeTime(snapshotTime)}.`,
      links: [{ text: 'View snapshot', href: snapshotUrl }],
      actions: [{ text: `Show ${site.shortName}'s version`, onClick: () => onRestore?.() }],
    });
    const kept = keepReading(doc, body, reading);
    resumeAnchoring();
    if (kept) console.info(`[Read Free] keeping your reading place: ${JSON.stringify(kept)}`);
    return () => {
      body.remove();
      for (const el of hidden) el.removeAttribute(HIDDEN_ATTR);
      for (const chunk of chunks) chunk.removeAttribute(SWAPPED_ATTR);
      removeBanner(doc);
    };
  }

  // site.live.keep: parts of the article a site's wall deletes from the page (Corriere's
  // private-browsing wall removes #content-to-read, then the section around it, then the
  // container around that, all at once). The elements matching it when this starts are kept:
  // anything removed that is one of them or holds one is put back where it was, in the same
  // MutationObserver round, before the browser paints. Records are handled in order, so a
  // nested removal is undone inside its (detached) parent before the parent goes back. Nodes
  // moved elsewhere on the page are left alone. A node the site keeps removing is put back at
  // most maxPutBacks times, so the two never loop. Calls onPutBack(nodes); returns stop().
  function keepOnPage(doc, selector, onPutBack = () => {}, { maxPutBacks = 5 } = {}) {
    const win = doc.defaultView;
    const kept = [...doc.querySelectorAll(selector)];
    if (!kept.length) return () => {};
    // What held each kept element at the start: a container removed after the article it held,
    // in the same go (Corriere removes the article, then its section), still counts, though the
    // article only goes back into it afterwards.
    const heldBy = new Map(kept.map(el => {
      const ancestors = new Set();
      for (let n = el.parentNode; n; n = n.parentNode) ancestors.add(n);
      return [el, ancestors];
    }));
    const putBacks = new WeakMap();
    const observer = new win.MutationObserver(records => {
      // The kept elements removed this time, on their own or inside something removed.
      const removedNow = new Set();
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (node.nodeType === 1) for (const el of kept) if (el === node || node.contains(el)) removedNow.add(el);
        }
      }
      if (!removedNow.size) return;
      const holdsKept = node => node.nodeType === 1
        && kept.some(el => el === node || node.contains(el) || (removedNow.has(el) && !el.isConnected && heldBy.get(el).has(node)));
      const back = [];
      // Last removal first: by then a node's neighbours at the time are back (or never left), so
      // it goes back next to them, after the one before it if that's there. A run removed from
      // the end backwards (NRC's clip) comes back in order, as does one removed from the front.
      for (const record of [...records].reverse()) {
        const target = record.target;
        const nodes = [];
        for (const node of record.removedNodes) {
          if (node.isConnected || node.parentNode || !holdsKept(node)) continue;
          const times = (putBacks.get(node) || 0) + 1;
          if (times > maxPutBacks) continue;
          putBacks.set(node, times);
          nodes.push(node);
        }
        if (!nodes.length) continue;
        const after = record.previousSibling?.parentNode === target ? record.previousSibling : null;
        const before = after ? after.nextSibling : record.nextSibling?.parentNode === target ? record.nextSibling : null;
        for (const node of nodes) target.insertBefore(node, before);
        back.unshift(...nodes); // reported in the order they were removed
      }
      if (back.length) onPutBack(back);
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true });
    return () => observer.disconnect();
  }

  const render = { swapIntact, keepOnPage,
    liveArticleBody, liveStats, paragraphTemplate, relativeTime, describeTime, showBanner, removeBanner,
    liftPaywall, frozen, anchorTop, scrollAnchorTo, readingAnchor, liftWall, showWall, hideWall, upsellLines, showLoadingPlaceholder, apply,
  };
  root.NYTFix = Object.assign(root.NYTFix || {}, { render });
  if (typeof module === 'object' && module.exports) module.exports = render;
})(globalThis);
