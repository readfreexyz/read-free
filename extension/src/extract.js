// Pull the article out of a parsed archive.today snapshot. Where the article body is, and which
// labels to drop, come from the site adapter (site.snapshot).
//
// What snapshots look like (docs/phase0-findings.md, docs/multi-site-investigation.md):
// - The captured page sits in #CONTENT.
// - Element ids, `name`, `itemprop` and `role` survive; classes and data-* attributes don't.
// - There are no <p> tags. Each paragraph is a <div> with inline styles.
// - Links are rewritten as https://archive.ph/o/<id>/<original URL>.
// - Photos are <figure>s whose <img> keeps the original NYT address in `currentsourceurl`
//   (its src points at a copy on archive.today).
// - Inside the body there are also recommended-article cards (wrapped in <a>) and ad labels.
//
// Blocks:
//   { type: 'paragraph', text, inlines: [{ text, href?, em?, strong? }] }
//   { type: 'heading', text }
//   { type: 'figure', src, hires?, alt, caption }
//   { type: 'break' }  between sections of the article (sites that say where they are)
//   hires: a sharper copy of the same photo (for 2x screens), when the site adapter knows how to
//   ask the site's image server for one (site.snapshot.hiresImage). Snapshots drop srcset, so all
//   that's left is the one size the page happened to load when it was captured.
(function (root) {
  'use strict';

  const INLINE = new Set([
    'A', 'ABBR', 'B', 'BR', 'CITE', 'CODE', 'EM', 'I', 'MARK', 'Q', 'S', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U',
  ]);
  // Nothing inside these is article prose (figures are handled on their own).
  const SKIP_INSIDE = new Set(['A', 'ASIDE', 'BUTTON', 'FIGURE', 'FIGCAPTION', 'FOOTER', 'FORM', 'HEADER', 'NAV']);
  // Nor inside these, on any site: share and save buttons are often divs (The New Yorker), and
  // video players (video.js, seen on The New Yorker and the Sydney Morning Herald). Each adapter
  // can add its own (site.snapshot.skip).
  const SKIP_SELECTOR = '[role="button"], [aria-label^="Video Player"]';
  // Labels every site drops; each adapter adds its own (site.snapshot.junk). The rest are
  // video.js control-bar labels, in case a player isn't marked.
  const JUNK = /^(advertisement|skip advertisement|video player is loading\.?|current time \S+|duration \S+|loaded: \S+|stream type live|remaining time \S+|-?\d{1,2}:\d{2}|\/)$/i;
  // A paragraph or heading that is nothing but a link, and short, is a pointer to another story
  // ("Read more" lines on Le Monde, headline tiles after the article on The Age), not prose.
  const LINK_ONLY_MAX_CHARS = 160;
  const MIN_PARAGRAPHS = 3;
  // A paywalled NYT page keeps roughly the first fifth of the article (Phase 0: 1.6k of 7.5k
  // characters), and a snapshot captured behind the paywall comes out about that long too
  // (the server sends ~1.9k). So on a paywalled page, only trust a snapshot with clearly
  // more text than the page itself.
  const COMPLETE_RATIO = 1.5;

  // site.snapshot.body: selectors to try in order, or a function (content, url) => element.
  // 'auto' in the list stands for guessBody.
  function findArticleBody(doc, site, url) {
    const content = doc.getElementById('CONTENT') || doc.body;
    if (!content) return null;
    const { body } = site.snapshot;
    if (typeof body === 'function') return body(content, url) || null;
    for (const selector of body) {
      const el = selector === 'auto' ? guessBody(content) : content.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  // The element holding a snapshot's biggest block of paragraphs, for sites without a known
  // body marker. Each paragraph counts toward its nearest ancestor that archive.today kept an id,
  // itemprop, name or role on (main#content, article#content-gate, main#Inhalt in the outlet
  // survey). The one with the most text wins. It then narrows to the descendant holding nearly
  // all of that text, since a marker can be as broad as the whole app (div#__next). Paragraphs in
  // headers, footers, navigation, asides, forms and links don't count. Null below MIN_PARAGRAPHS.
  function guessBody(content) {
    const marked = el => Boolean(el.id) || el.hasAttribute('itemprop') || el.hasAttribute('name') || el.hasAttribute('role');
    const groups = new Map();
    for (const el of content.querySelectorAll('div, p')) {
      if (!isParagraph(el) || insideSkipped(el, content)) continue;
      const chars = clean(el.textContent).length;
      if (chars < 40) continue;
      let home = el.parentElement;
      while (home && home !== content && !marked(home)) home = home.parentElement;
      const group = groups.get(home || content) || { chars: 0, paras: [] };
      group.chars += chars;
      group.paras.push([el, chars]);
      groups.set(home || content, group);
    }
    let best = null;
    for (const [home, group] of groups) if (!best || group.chars > best.group.chars) best = { home, group };
    if (!best || best.group.paras.length < MIN_PARAGRAPHS) return null;
    const { paras, chars: total } = best.group;
    let el = best.home;
    for (;;) {
      const next = [...el.children].find(child => paras.reduce((n, [p, c]) => n + (child.contains(p) ? c : 0), 0) >= total * 0.85);
      if (!next || paras.filter(([p]) => next.contains(p)).length < MIN_PARAGRAPHS) return el;
      el = next;
    }
  }

  function insideSkipped(el, stop) {
    for (let n = el; n && n !== stop; n = n.parentElement) {
      if (SKIP_INSIDE.has(n.tagName)) return true;
    }
    return false;
  }

  // A paragraph is a <div>/<p> holding only text and inline elements. A wrapper that
  // contains other blocks (like a card's <a> full of <div>s) is not a paragraph.
  function isParagraph(el) {
    if (el.tagName !== 'DIV' && el.tagName !== 'P') return false;
    for (const c of el.children) if (!INLINE.has(c.tagName)) return false;
    return !el.querySelector('div, p, figure, img, h1, h2, h3, h4, h5, h6, ul, ol, table, section');
  }

  const clean = s => s.replace(/\s+/g, ' ').trim();

  // All of the element's text is inside one link (and it's short): a pointer to another story.
  function linkOnly(el, text) {
    if (text.length > LINK_ONLY_MAX_CHARS) return false;
    const links = el.querySelectorAll('a');
    return links.length === 1 && clean(links[0].textContent) === text;
  }

  // The original address behind an archive.today link, or null for anything that isn't http(s).
  function originalUrl(href, base) {
    if (!href) return null;
    let url;
    try { url = new URL(href, base); } catch { return null; }
    if (/^archive\./.test(url.hostname)) {
      const rewritten = /^\/o\/[^/]+\/(https?:\/\/.+)$/.exec(url.pathname + url.search + url.hash);
      if (rewritten) return originalUrl(rewritten[1]);
    }
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  }

  // A photo's address: NYT's original if the snapshot kept it, else archive.today's copy. https only.
  function imageUrl(img, base) {
    for (const candidate of [img.getAttribute('currentsourceurl'), img.getAttribute('src')]) {
      if (!candidate) continue;
      try {
        const url = new URL(candidate, base);
        if (url.protocol === 'https:') return url.href;
      } catch { /* try the next one */ }
    }
    return null;
  }

  // archive.today inlines every computed style, so emphasis may be a styled <span>.
  const isItalic = el => el.tagName === 'EM' || el.tagName === 'I' || /font-style:\s*italic/i.test(el.getAttribute('style') || '');
  const isBold = el => el.tagName === 'STRONG' || el.tagName === 'B' || /font-weight:\s*(bold|[6-9]00)/i.test(el.getAttribute('style') || '');

  // A paragraph's text as runs of plain, linked or emphasized text, whitespace collapsed.
  function inlinesOf(el, base) {
    const runs = [];
    const add = (text, marks) => {
      const last = runs[runs.length - 1];
      const same = last && last.href === marks.href && Boolean(last.em) === Boolean(marks.em) && Boolean(last.strong) === Boolean(marks.strong);
      if (same) last.text += text;
      else runs.push({ text, ...marks });
    };
    const walk = (node, marks) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) add(child.textContent, marks);
        else if (child.nodeType !== 1) continue;
        else if (child.tagName === 'BR') add(' ', marks);
        else {
          const next = { ...marks };
          if (child.tagName === 'A') {
            const href = originalUrl(child.getAttribute('href'), base);
            if (href) next.href = href;
          }
          if (isItalic(child)) next.em = true;
          if (isBold(child)) next.strong = true;
          walk(child, next);
        }
      }
    };
    walk(el, {});
    // Collapse whitespace across runs, trim the ends, and drop runs left empty.
    let previousEndsInSpace = true;
    for (const run of runs) {
      run.text = run.text.replace(/\s+/g, ' ');
      if (previousEndsInSpace) run.text = run.text.replace(/^ /, '');
      if (run.text) previousEndsInSpace = run.text.endsWith(' ');
    }
    const kept = runs.filter(run => run.text);
    if (kept.length) kept[kept.length - 1].text = kept[kept.length - 1].text.replace(/ $/, '');
    return kept.filter(run => run.text);
  }

  // site.snapshot.hiresImage(src): the same photo at a higher resolution, or null. https only,
  // and only if it's actually a different address.
  function hiresUrl(site, src) {
    if (typeof site.snapshot.hiresImage !== 'function') return null;
    let hires;
    try { hires = site.snapshot.hiresImage(src); } catch { return null; }
    return typeof hires === 'string' && /^https:\/\//i.test(hires) && hires !== src ? hires : null;
  }

  function figureBlock(figure, base, site) {
    const img = figure.querySelector('img');
    // A linked image is a card for another story (The Atlantic's "related" lists put 80-pixel
    // thumbnails in <figure>s mid-article), not one of this article's photos.
    if (!img || (img.closest('a') && figure.contains(img.closest('a')))) return null;
    const src = imageUrl(img, base);
    if (!src) return null;
    const caption = figure.querySelector('figcaption');
    // Caption and credit are separate spans; keep a space between them.
    const captionText = caption
      ? clean([...caption.childNodes].map(n => n.textContent).filter(t => t.trim()).join(' '))
      : '';
    const block = { type: 'figure', src, alt: clean(img.getAttribute('alt') || ''), caption: captionText };
    const hires = hiresUrl(site, src);
    if (hires) block.hires = hires;
    return block;
  }

  // baseUrl: the snapshot's own URL, for resolving relative links and image paths.
  // articleUrl: the article's own URL, for sites whose snapshots hold several articles.
  // Returns { blocks, paragraphs, chars } or null.
  function extractArticle(doc, site, { baseUrl, articleUrl } = {}) {
    const body = findArticleBody(doc, site, articleUrl);
    if (!body) return null;
    const base = baseUrl || doc.baseURI;
    const siteJunk = site.snapshot.junk;
    const isJunk = text => JUNK.test(text) || Boolean(siteJunk && siteJunk.test(text));
    const skipSelector = site.snapshot.skip ? `${SKIP_SELECTOR}, ${site.snapshot.skip}` : SKIP_SELECTOR;
    // Inside an element the site (or every site) says to skip, within the body.
    const inSkipped = el => {
      const skipped = el.closest(skipSelector);
      return Boolean(skipped) && body.contains(skipped);
    };
    // Lists of cards for other stories: items with a linked thumbnail (The Atlantic's
    // mid-article "related" lists). Their headlines aren't article text either.
    const cards = [...body.querySelectorAll('figure a img')]
      .map(img => img.closest('li'))
      .filter(li => li && body.contains(li));
    const inCard = el => cards.some(card => card.contains(el));
    const blocks = [];
    let taken = null;
    for (const el of body.querySelectorAll('div, p, h2, h3, figure')) {
      if (taken && taken.contains(el)) continue;
      if (inCard(el)) continue;
      if (el.tagName === 'FIGURE') {
        if (insideSkipped(el.parentElement, body) || inSkipped(el)) continue;
        const figure = figureBlock(el, base, site);
        if (figure) blocks.push(figure);
        taken = el;
        continue;
      }
      if (insideSkipped(el, body) || inSkipped(el)) continue;
      const isHeading = el.tagName === 'H2' || el.tagName === 'H3';
      if (!isHeading && !isParagraph(el)) continue;
      const text = clean(el.textContent);
      if (!text || isJunk(text) || linkOnly(el, text)) continue;
      blocks.push(isHeading ? { type: 'heading', text } : { type: 'paragraph', text, inlines: inlinesOf(el, base) });
      taken = el;
    }
    const paragraphs = blocks.filter(b => b.type === 'paragraph');
    return {
      blocks,
      paragraphs: paragraphs.length,
      chars: paragraphs.reduce((n, b) => n + b.text.length, 0),
    };
  }

  // Is this extracted article good enough to show? liveChars is the live page's own text.
  function isComplete(article, liveChars, { paywalled }) {
    if (!article || article.paragraphs < MIN_PARAGRAPHS) return false;
    return !paywalled || article.chars >= liveChars * COMPLETE_RATIO;
  }

  const extract = { MIN_PARAGRAPHS, COMPLETE_RATIO, findArticleBody, guessBody, extractArticle, originalUrl, isComplete };
  root.NYTFix = Object.assign(root.NYTFix || {}, { extract });
  if (typeof module === 'object' && module.exports) module.exports = extract;
})(globalThis);
