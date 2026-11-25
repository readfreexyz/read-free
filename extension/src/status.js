// A small floating status bar shown while the extension works, so progress is visible
// wherever the reader has scrolled.
//
// archive.today sends nothing for ~8–9 s and then the whole snapshot in under half a
// second (measured; gzip, no Content-Length), so downloaded bytes can't drive the bar.
// Instead each stage eases toward its end over its expected duration and never quite
// gets there, next to an honest elapsed-seconds counter.
(function (root) {
  'use strict';

  const HOST_ID = 'nytfix-status';
  // Share of the bar each stage covers: [start, end].
  const STAGES = {
    find: [0, 0.12],
    download: [0.12, 0.9],
    extract: [0.9, 0.97],
  };

  // Colors from the active theme: content.css sets them on the host element (#nytfix-status) and
  // custom properties reach into the shadow root (`all: initial` leaves them alone).
  const CSS = `
    :host { all: initial; direction: ltr; } /* all leaves direction alone, and the bar is in English on Hebrew pages too */
    .bar {
      position: fixed;
      left: 20px;
      bottom: 20px;
      z-index: 2147483647;
      box-sizing: border-box;
      width: min(400px, calc(100vw - 40px));
      padding: calc(10px + var(--nf-bar-band-height, 0px)) 14px 12px;
      overflow: hidden;
      border-radius: 10px;
      background: var(--nf-bar-bg, #141414);
      color: var(--nf-bar-text, #fff);
      font: 13px/1.4 var(--nf-font, system-ui, sans-serif);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.28);
      transition: opacity 0.3s;
    }
    /* The theme's band along the top (the keffiyeh's edge), if it has one */
    .bar::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: var(--nf-bar-band-height, 0px);
      background: var(--nf-bar-band-color, transparent);
      -webkit-mask: var(--nf-bar-band, none) 0 0 / auto 100% repeat-x;
      mask: var(--nf-bar-band, none) 0 0 / auto 100% repeat-x;
    }
    .bar.hide { opacity: 0; }
    /* Made, but nothing to show yet (a saved copy may make it unneeded) */
    .bar.pending { visibility: hidden; }
    .row { display: flex; gap: 10px; align-items: baseline; margin-bottom: 8px; }
    .mark { flex: none; align-self: center; width: 16px; height: 16px; background: var(--nf-mark, none) center / contain no-repeat; }
    .label { flex: 1; }
    .time { color: var(--nf-bar-muted, #a3a3a3); font-variant-numeric: tabular-nums; }
    .track { height: 4px; border-radius: 2px; background: var(--nf-bar-track, rgba(255, 255, 255, 0.18)); overflow: hidden; }
    .fill { height: 100%; width: 0; background: var(--nf-bar-fill, #5aa0e6); transition: width 0.25s linear; }
    .bar[data-kind="done"] .fill { background: var(--nf-bar-done, #4caf7a); }
    .bar[data-kind="info"] .fill { background: var(--nf-bar-info, #9e9e9e); }
    .bar[data-kind="error"] .fill { background: var(--nf-bar-error, #e5534b); }
    .bar[data-kind="done"], .bar[data-kind="info"], .bar[data-kind="error"] { cursor: pointer; }
    .link { color: var(--nf-bar-link, #9ec5f0); text-decoration: underline; text-underline-offset: 2px; white-space: nowrap; }
    .link:hover { color: var(--nf-bar-link-hover, #c4dcf6); }
    /* Once a wall is off: why this outlet is boycotted, and now and then the donation link */
    .toggle, .later, .close {
      padding: 0;
      border: 0;
      background: none;
      color: var(--nf-bar-link, #9ec5f0);
      font: inherit;
      cursor: pointer;
    }
    .toggle { flex: none; text-decoration: underline; text-underline-offset: 2px; white-space: nowrap; }
    .close { flex: none; align-self: flex-start; width: 20px; height: 20px; margin: -2px -6px 0 0; border-radius: 4px; color: var(--nf-bar-muted, #a3a3a3); font-size: 17px; line-height: 20px; }
    .close:hover, .toggle:hover, .later:hover { color: var(--nf-bar-link-hover, #c4dcf6); }
    .why { margin: -2px 0 10px 26px; }
    .why[hidden], .ask[hidden] { display: none; }
    .why-head { margin: 0 0 2px; color: var(--nf-bar-muted, #a3a3a3); font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; }
    .why-text { margin: 0; }
    .source { color: var(--nf-bar-link, #9ec5f0); white-space: nowrap; }
    .ask { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin: 0 0 10px 26px; padding-top: 9px; border-top: 1px solid var(--nf-bar-track, rgba(255, 255, 255, 0.18)); }
    .ask-text { flex: 1 0 100%; margin: 0; color: var(--nf-bar-muted, #a3a3a3); }
    .fill { transform-origin: left center; }
    .give { flex: none; padding: 2px 10px; border: 1px solid var(--nf-bar-give-bg, #c2415b); border-radius: 999px; color: var(--nf-bar-text, #fff); font-weight: 600; text-decoration: none; white-space: nowrap; }
    .accept { background: none; font: inherit; font-weight: 600; cursor: pointer; }
    .give:hover { background: var(--nf-bar-give-bg, #c2415b); color: var(--nf-bar-give-text, #fff); }
    .later { flex: none; color: var(--nf-bar-muted, #a3a3a3); text-decoration: underline; text-underline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { .bar, .fill { transition: none; } }
  `;

  // Constructable stylesheets aren't subject to the page's CSP; fall back to <style>.
  function addStyles(win, shadow, doc) {
    try {
      const sheet = new win.CSSStyleSheet();
      sheet.replaceSync(CSS);
      shadow.adoptedStyleSheets = [sheet];
    } catch {
      const style = doc.createElement('style');
      style.textContent = CSS;
      shadow.append(style);
    }
  }

  function el(doc, tag, className) {
    const node = doc.createElement(tag);
    node.className = className;
    return node;
  }

  // Removes the status bar, if one is showing.
  function removeShowing(doc) {
    const host = doc.getElementById(HOST_ID);
    if (host) (host.nytfixRemove || (() => host.remove()))();
  }

  // Shows the bar and returns a controller:
  //   stage(name, text, { expectedMs, slowAfterMs, slowLabel })  name: 'find' | 'download' | 'extract'
  //   finish(kind, text, { hideAfterMs, link })                   kind: 'done' | 'info' | 'error'
  //     link: optional { text, href } shown after the message (https only)
  //   remove()
  function create(doc, { clock = Date.now } = {}) {
    removeShowing(doc);

    const win = doc.defaultView;
    const host = el(doc, 'div', '');
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' });
    addStyles(win, shadow, doc);
    const bar = el(doc, 'div', 'bar');
    bar.setAttribute('role', 'status');
    bar.dataset.kind = 'working';
    bar.classList.add('pending');
    const row = el(doc, 'div', 'row');
    const mark = el(doc, 'span', 'mark');
    mark.setAttribute('aria-hidden', 'true');
    const label = el(doc, 'span', 'label');
    const time = el(doc, 'span', 'time');
    const track = el(doc, 'div', 'track');
    const fill = el(doc, 'div', 'fill');
    row.append(mark, label, time);
    track.append(fill);
    bar.append(row, track);
    shadow.append(bar);
    doc.documentElement.append(host);

    const started = clock();
    let current = null;
    let progress = 0;
    let finished = false;
    let hideTimer = null;
    const ticker = win.setInterval(update, 250);

    function update() {
      const now = clock();
      if (!finished && current) {
        const t = now - current.start;
        progress = current.from + (current.to - current.from) * (1 - Math.exp(-t / (current.expectedMs / 2)));
        label.textContent = current.slowLabel && t >= current.slowAfterMs ? current.slowLabel : current.text;
      }
      fill.style.width = `${(progress * 100).toFixed(1)}%`;
      const secs = Math.floor((now - started) / 1000);
      time.textContent = !finished && secs >= 1 ? `${secs} s` : '';
    }

    // Never moves backwards: re-entering an earlier stage (a retry with an older snapshot)
    // starts from where the bar already is and eases toward halfway to the end.
    function stage(name, text, { expectedMs = 1000, slowAfterMs = Infinity, slowLabel = null } = {}) {
      const from = Math.max(STAGES[name][0], progress);
      const to = Math.max(STAGES[name][1], from + (1 - from) / 2);
      current = { from, to, start: clock(), expectedMs, slowAfterMs, slowLabel, text };
      bar.classList.remove('pending');
      update();
    }

    // Fades out after a while. Hovering the bar holds it, so a link in it can be clicked. Once
    // finished, the line along the bottom shrinks as the time runs out.
    let countdown = null;
    let resumeMs = 2000; // after the pointer leaves
    function hideIn(ms) {
      win.clearTimeout(hideTimer);
      countdown?.cancel();
      const still = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (finished && !still && typeof fill.animate === 'function') {
        countdown = fill.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: ms, easing: 'linear', fill: 'forwards' });
      }
      hideTimer = win.setTimeout(() => {
        bar.classList.add('hide');
        hideTimer = win.setTimeout(remove, 300);
      }, ms);
    }

    // Holds the bar while the reader is looking at it (pointer over it, or focus in it).
    function hold() {
      win.clearTimeout(hideTimer);
      countdown?.cancel();
      bar.classList.remove('hide');
    }

    function a11yButton(className, label, onClick) {
      const b = el(doc, 'button', className);
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', event => { event.stopPropagation(); onClick(event); });
      return b;
    }

    function outLink(className, text, href, onClick) {
      const a = el(doc, 'a', className);
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = text;
      a.addEventListener('click', event => { event.stopPropagation(); onClick?.(event); });
      return a;
    }

    // Why this outlet is boycotted, under the message: { heading, text, source: { name, year,
    // href } }. Shown open, or hidden until "Why?" is clicked. Can come while the bar is still
    // working (the wait for archive.today is a good time to read it).
    let whyBlock = null;
    function why(reason, { open = true } = {}) {
      if (whyBlock) return;
      whyBlock = el(doc, 'div', 'why');
      const head = el(doc, 'p', 'why-head');
      head.textContent = reason.heading;
      const body = el(doc, 'p', 'why-text');
      body.append(`${reason.text} `);
      if (/^https:\/\//i.test(reason.source?.href)) body.append(outLink('source', `${reason.source.name}, ${reason.source.year} \u2197`, reason.source.href));
      whyBlock.append(head, body);
      whyBlock.hidden = !open;
      row.after(whyBlock);
    }

    // kind: 'done' | 'info' | 'error'. Options:
    //   link     { text, short, href }: a link after the message (https only)
    //   reason   { heading, text, source: { name, year, href } }: why this outlet is boycotted,
    //            shown open (explain: true) or behind a "Why?" link
    //   donate   { text, href, open, onGive, onLater }: the donation link, with "Not now"; open,
    //            if given, is called instead of following href
    //   newer    { text, button, href }: a newer version is out, with a link to how to update
    //            (https only)
    //   offer    { button, onAccept, report: { text, href, title } }: something the reader can have
    //            done here, and an email link (mailto: only)
    // A bar with a reason, a donation link, a newer version or an offer closes with its × only, so
    // its links can be used; any other finished bar closes on a click anywhere.
    function finish(kind, text, { link = null, reason = null, explain = false, donate = null, newer = null, offer = null, hideAfterMs = kind === 'error' ? 8000 : link ? 6000 : 3000 } = {}) {
      finished = true;
      win.clearInterval(ticker);
      bar.classList.remove('pending');
      progress = 1;
      bar.dataset.kind = kind;
      label.textContent = text;
      if (link && /^https:\/\//i.test(link.href)) time.replaceWith(outLink('link', link.short || link.text, link.href));
      const showNewer = Boolean(newer && /^https:\/\//i.test(newer.href));
      const extras = Boolean(reason || donate || showNewer || offer || whyBlock);
      if (reason && !whyBlock) {
        why(reason, { open: explain });
        if (!explain) {
          const toggle = a11yButton('toggle', 'Why?', () => {
            whyBlock.hidden = false;
            toggle.remove();
            resumeMs = 12000; // time to read it
            hold();
          });
          time.after(toggle);
        }
      }
      if (donate && /^https:\/\//i.test(donate.href)) {
        const ask = el(doc, 'div', 'ask');
        const words = el(doc, 'p', 'ask-text');
        words.textContent = donate.text;
        // open: the extension's own donation page instead of following the link
        const give = outLink('give', donate.button || 'Donate', donate.href, event => {
          if (donate.open) {
            event.preventDefault();
            donate.open();
          }
          donate.onGive?.();
          ask.hidden = true;
        });
        const later = a11yButton('later', 'Not now', () => { donate.onLater?.(); ask.hidden = true; });
        ask.append(words, give, later);
        track.before(ask);
      }
      if (showNewer) {
        const note = el(doc, 'div', 'ask newer');
        const words = el(doc, 'p', 'ask-text');
        words.textContent = newer.text;
        note.append(words, outLink('link', `${newer.button || 'How to update'} ↗`, newer.href));
        track.before(note);
      }
      if (offer) {
        const note = el(doc, 'div', 'ask offer');
        if (offer.button) note.append(a11yButton('give accept', offer.button, () => { remove(); offer.onAccept(); }));
        if (/^mailto:/i.test(offer.report?.href)) {
          const mail = el(doc, 'a', 'later');
          mail.href = offer.report.href;
          mail.textContent = offer.report.text;
          if (offer.report.title) mail.title = offer.report.title;
          mail.addEventListener('click', event => event.stopPropagation());
          note.append(mail);
        }
        track.before(note);
      }
      if (extras) {
        bar.dataset.extras = '';
        resumeMs = Math.max(resumeMs, 8000);
        row.append(a11yButton('close', '\u00d7', remove));
        row.lastChild.setAttribute('aria-label', 'Close');
      }
      update();
      hideIn(hideAfterMs);
      bar.addEventListener('mouseenter', hold);
      bar.addEventListener('mouseleave', () => hideIn(resumeMs));
      bar.addEventListener('focusin', hold);
    }

    function remove() {
      win.clearInterval(ticker);
      win.clearTimeout(hideTimer);
      countdown?.cancel();
      host.remove();
    }

    bar.addEventListener('click', () => { if (finished && !('extras' in bar.dataset)) remove(); });
    host.nytfixRemove = remove;
    return { stage, why, finish, remove, update, host, shadow, get progress() { return progress; } };
  }

  const status = { create, remove: removeShowing };
  root.NYTFix = Object.assign(root.NYTFix || {}, { status });
  if (typeof module === 'object' && module.exports) module.exports = status;
})(globalThis);
