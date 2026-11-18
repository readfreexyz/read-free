// Fixtures for batch 6 (docs/outlet-coverage.md), shaped like what was observed on 2026-11-16.
// Shared by test/batch6.test.js and the content-script tests.
const { LOREM } = require('./fixtures.js');

const text = i => `Paragraph ${i + 1}. ${LOREM}`;
const paras = (n, cls = '', from = 0) => Array.from({ length: n }, (_, i) => `<p${cls ? ` class="${cls}"` : ''}>${text(from + i)}</p>`);
const bodyText = n => Array.from({ length: n }, (_, i) => text(i)).join(' ');
const ldScript = ld => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'NewsArticle', ...ld })}</script>`;

// ABC: the first paragraph, then div.paywall[hidden] with the rest, both kinds of marked nodes
// (random attribute names, as on the page), and the consent popup's lock on <body>.
//   state 'sent'     as the server sends it (the paid part hidden, until Evolok answers)
//         'allowed'  Evolok said ALLOW_ACCESS: shown, the placeholders removed
//         'denied'   anything else: the paid part deleted, the placeholders shown
const ABC_PAID = 'data-0f4d396afa946b14d21';
const ABC_FREE = 'data-ffdb2e6afa946b14d2f';
function abcLivePageHtml({ state = 'sent', consent = false, total = 12 } = {}) {
  const paid = state === 'denied' ? '' : `<div class="paywall"${state === 'sent' ? ` ${ABC_PAID} hidden` : ''}>${paras(total - 1, 'v-d-p', 1).join('')}</div>`;
  const firstRest = state === 'denied' ? '' : `<span class="paywall"${state === 'sent' ? ` ${ABC_PAID}` : ''}> and the rest of the first paragraph.</span>`;
  const placeholders = state === 'allowed' ? ['', ''] : [`<span class="c-text"${state === 'sent' ? ` ${ABC_FREE}` : ''}>...</span>`, `<div${state === 'sent' ? ` ${ABC_FREE}` : ''} data-voc26-rtim><ev-engagement></ev-engagement></div>`];
  return `<!doctype html><html><head>${ldScript({ isAccessibleForFree: false, hasPart: [{ '@type': 'WebPageElement', isAccessibleForFree: 'False', cssSelector: '.paywall' }], articleBody: bodyText(total) })}</head>
<body class="abc${consent ? ' didomi-popup-open' : ''}"${consent ? ' style="overflow: hidden"' : ''}><main class="v-g__c v-g__c--1"><article class="v-d-w"><h1>Titular</h1>
<div class="v-d v-d--1 v-d--b v-d--ab-c"><div class="v-ath">Autor</div><p class="v-d-p">${text(0)}${firstRest}${placeholders[0]}</p>${paid}${placeholders[1]}<div class="v-d-n">Nota</div></div>
</article></main></body></html>`;
}
// The page's inline script, for a reader without access.
function abcDeny(doc) {
  for (const el of doc.querySelectorAll(`[${ABC_PAID}]`)) el.remove();
  for (const el of doc.querySelectorAll(`[${ABC_FREE}]`)) { el.removeAttribute('hidden'); el.removeAttribute(ABC_FREE); }
}

// NRC: the dormant block is a child of <body>, outside the article, on every article without
// the wall. hard: the wall as seen, the hard block in its place, <html> locked, <body> marked.
function nrcLivePageHtml({ paragraphs = 10, hideFrom = null, hard = false } = {}) {
  const ps = paras(paragraphs).map((p, i) => (hideFrom !== null && i >= hideFrom ? p.replace('<p>', '<p style="display: none">') : p));
  const block = hard
    ? '<div class="paywall paywall--hard" style="position: fixed"><div class="paywall__mask"></div><div class="paywall__container"><h3 class="paywall__title">Lees verder</h3></div></div>'
    : '<div class="paywall hidden paywall--inline"><form id="paywall-form"><h3 class="paywall__title">Al abonnee?</h3></form></div>';
  // NRC's paywall.css pins <html> with this class.
  return `<!doctype html><html${hard ? ' class="disable-overflow-fixed"' : ''}><head><style>html.disable-overflow-fixed { position: fixed; left: 0; right: 0; overflow: hidden }</style>${ldScript({ isAccessibleForFree: false, hasPart: [{ '@type': 'WebPageElement', isAccessibleForFree: false, cssSelector: '.googlebot-article-content' }] })}</head>
<body class="body-vorm${hard ? ' has-paywall' : ''}"><main class="vorm"><article class="vorm__article"><h1>Kop</h1>
<div class="vorm__article-content dmt-grid-center-s googlebot-article-content">${ps.join('')}</div></article></main>
${block}</body></html>`;
}

// NRC's script once Zephr and Sophi decide on the wall (Paywall.show() and clipArticleContent()
// in its main.js): <html> locked, <body> marked, the block shown as the hard wall, and every
// child of the article after the first removed, from the last one back.
function nrcShowWall(doc) {
  doc.documentElement.classList.add('disable-overflow-fixed');
  doc.body.classList.add('has-paywall');
  const block = doc.querySelector('body > .paywall');
  block.classList.remove('hidden', 'paywall--inline');
  block.classList.add('paywall--hard');
  block.style.position = 'fixed';
  const children = doc.querySelector('.vorm__article-content').children;
  for (let j = children.length - 1; j >= 1; j--) children[j].remove();
}

module.exports = { text, paras, bodyText, ldScript, ABC_PAID, ABC_FREE, abcLivePageHtml, abcDeny, nrcLivePageHtml, nrcShowWall };
