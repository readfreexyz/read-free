const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const notices = require('../extension/src/notices.js');
const { LOREM } = require('./fixtures.js');

// Invented wording, in the shape of such notices.
const NOTICE_TEXT = 'Please consider turning off your ad blocker. Allow ads, or subscribe. Already a subscriber? Log in.';
const page = (body, { bodyStyle = '' } = {}) =>
  new JSDOM(`<!doctype html><html><head></head><body style="${bodyStyle}">${body}</body></html>`, { url: 'https://www.latimes.com/x/story/2026-11-13/y', pretendToBeVisual: true }).window.document;
const hiddenNow = el => el.ownerDocument.defaultView.getComputedStyle(el).display === 'none';

test('hides a fixed overlay that asks to turn the ad blocker off, its dimming layer, and unlocks scrolling', () => {
  const doc = page(`<main><article><p>${LOREM}</p></article></main>
    <div id="dim" style="position: fixed; inset: 0"></div>
    <div id="notice" style="position: fixed"><div class="box"><h2>Support us.</h2><p>${NOTICE_TEXT}</p><button>Allow ads</button></div></div>`, { bodyStyle: 'overflow: hidden' });
  const dim = doc.getElementById('dim');
  dim.getBoundingClientRect = () => ({ width: doc.defaultView.innerWidth, height: doc.defaultView.innerHeight });
  const hidden = notices.sweep(doc);
  assert.deepEqual(hidden.map(el => el.id).sort(), ['dim', 'notice']);
  assert.ok(hiddenNow(doc.getElementById('notice')));
  assert.ok(hiddenNow(dim));
  assert.equal(doc.defaultView.getComputedStyle(doc.body).overflowY, 'visible');
  assert.equal(hiddenNow(doc.querySelector('main')), false, 'the article stays');
});

test('hides the outermost fixed container, not just the box with the words', () => {
  const doc = page(`<div id="root" style="position: fixed"><div class="backdrop"></div><div class="dialog"><p>${NOTICE_TEXT}</p></div></div>`);
  assert.deepEqual(notices.sweep(doc).map(el => el.id), ['root']);
});

test('finds a notice a dialog draws in its shadow root, anywhere on the page', () => {
  const doc = page(`<div class="page"><div class="wrap"><div class="deeper"><modal-element role="dialog" id="m"></modal-element></div></div></div>`);
  const host = doc.getElementById('m');
  host.attachShadow({ mode: 'open' }).innerHTML = `<div><p>${NOTICE_TEXT}</p></div>`;
  assert.deepEqual(notices.sweep(doc).map(el => el.id), ['m']);
  assert.ok(hiddenNow(host));
});

test("Google's ad blocking recovery message is hidden by name", () => {
  const doc = page('<div class="fc-ab-root"><div class="fc-dialog">Something else entirely.</div></div>');
  assert.equal(notices.sweep(doc).length, 1);
  assert.ok(hiddenNow(doc.querySelector('.fc-ab-root')));
});

test('leaves alone: an article about ad blockers, a fixed header, a long fixed panel, a hidden notice, its own elements', () => {
  const doc = page(`
    <main><article><p>Ad blockers are popular. ${LOREM}</p></article></main>
    <header style="position: fixed"><nav>Sections, Subscribe, Log in</nav></header>
    <div id="long" style="position: fixed">${`Ad blocker help. ${LOREM} `.repeat(30)}</div>
    <div id="later" style="position: fixed; display: none"><p>${NOTICE_TEXT}</p></div>
    <div id="nytfix-banner" style="position: fixed">Turn off your ad blocker, said the page.</div>`);
  assert.deepEqual(notices.sweep(doc), []);
});

test('watch hides a notice that shows up later, and stops when asked', async () => {
  const doc = page(`<main><p>${LOREM}</p></main>`);
  const seen = [];
  const stop = notices.watch(doc, { onHide: els => seen.push(...els.map(el => el.id)), throttleMs: 20 });
  try {
    doc.body.insertAdjacentHTML('beforeend', `<div id="late" style="position: fixed"><p>${NOTICE_TEXT}</p></div>`);
    for (let i = 0; i < 50 && !seen.length; i++) await new Promise(r => setTimeout(r, 10));
    assert.deepEqual(seen, ['late']);
    assert.ok(hiddenNow(doc.getElementById('late')));
  } finally {
    stop();
  }
  doc.body.insertAdjacentHTML('beforeend', `<div id="after" style="position: fixed"><p>${NOTICE_TEXT}</p></div>`);
  await new Promise(r => setTimeout(r, 60));
  assert.equal(hiddenNow(doc.getElementById('after')), false, 'stopped');
});

test('a pinned <body> is unpinned and scrolled back to where it was', () => {
  const doc = page(`<main><p>${LOREM}</p></main><div id="n" style="position: fixed"><p>${NOTICE_TEXT}</p></div>`, { bodyStyle: 'position: fixed; top: -1234px; width: 100%' });
  const scrolls = [];
  doc.defaultView.scrollTo = opts => scrolls.push(opts.top);
  notices.sweep(doc);
  assert.equal(doc.defaultView.getComputedStyle(doc.body).position, 'static');
  assert.deepEqual(scrolls, [1234]);
});

test('watch asks where the reader is before hiding, and hands it back after', async () => {
  const doc = page(`<main><p>${LOREM}</p></main>`);
  const events = [];
  const stop = notices.watch(doc, {
    throttleMs: 10,
    beforeHide: () => {
      events.push(`before: notice ${doc.getElementById('n') && doc.defaultView.getComputedStyle(doc.getElementById('n')).display !== 'none' ? 'showing' : 'gone'}`);
      return 'place-token';
    },
    onHide: (hidden, place) => events.push(`after: ${hidden.map(el => el.id)} ${place}`),
  });
  try {
    doc.body.insertAdjacentHTML('beforeend', `<div id="n" style="position: fixed"><p>${NOTICE_TEXT}</p></div>`);
    for (let i = 0; i < 50 && events.length < 2; i++) await new Promise(r => setTimeout(r, 10));
    assert.deepEqual(events, ['before: notice showing', 'after: n place-token']);
  } finally {
    stop();
  }
});

test('still works while the extension has a wall lifted (its classes on <html>)', () => {
  const doc = page(`<div id="n" style="position: fixed"><p>${NOTICE_TEXT}</p></div>`);
  doc.documentElement.classList.add('nytfix-active');
  assert.deepEqual(notices.sweep(doc).map(el => el.id), ['n']);
});

test('notices in the sites\' other languages count too; an article that merely mentions advertising does not', () => {
  for (const wording of [
    'Per continuare a leggere non usare il blocco della pubblicità con Corriere',
    'Bitte deaktivieren Sie Ihren Werbeblocker',
    'Désactivez votre bloqueur de publicité',
    'Schakel je advertentieblokker uit',
    'Desactiva tu bloqueador de anuncios',
  ]) {
    const doc = page(`<div id="n" style="position: fixed"><p>${wording}</p><button>OK</button></div>`);
    assert.deepEqual(notices.sweep(doc).map(el => el.id), ['n'], wording);
  }
  const article = page('<div id="n" style="position: fixed"><p>La pubblicità in televisione è cambiata.</p></div>');
  assert.deepEqual(notices.sweep(article), []);
});
