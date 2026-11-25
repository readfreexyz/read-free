// The New York Times. What the core needs to know about the site, from Phase 0 and the incognito
// diagnostics (docs/phase0-findings.md). The wall-hiding CSS that has to apply before first paint
// is in nyt.css.
//
// NYT Cooking (cooking.nytimes.com) is the same outlet, so it's the same site here (one switch, one
// reason), with settings of its own on that address (siteFor). From the user's own browser, signed
// out, 2026-11-24:
// - The server sends the whole recipe, every time: the page as fetched has the recipe block
//   ([class*=recipebody_body-container]) with nothing on it, and the page as drawn under the wall
//   still held all 16 ingredients the JSON-LD gives, and every step.
// - The wall is put on by script: the block gets `inert` and a class (recipebody_is-extended-
//   truncator-fade…) that clips it to 250px (1,398 px of recipe), and a box
//   (omacookingtruncatorregiwall_…) asks the reader to sign up. Nothing is deleted.
// - So it only has to come off: the class names end in hashes, so selectors match their start.
(function (root) {
  'use strict';

  // "To leave without signing in, use your browser's Back button."; "logging in" since Nov 2026.
  const LOGIN_WORDING = /without (?:signing|logging) in|free to read/i;
  // The text is cut: the article body ends in NYT's "Subscribe to The Times to read as many
  // articles as you like." line (a short paragraph linking to /subscription). A login wall leaves
  // the whole story; the print-edition note under the article links to a subscription page too,
  // but sits outside the body.
  // On a page with no article body (live blogs, interactive pages) the line has to say so in words.
  const cutOff = doc => {
    const body = doc.querySelector('section[name="articleBody"]');
    return [...(body || doc).querySelectorAll(body ? 'a[href*="/subscription"]' : 'main a[href*="/subscription"]')].some(a => {
      const line = a.closest('p, div');
      const text = line ? line.textContent.trim() : '';
      return Boolean(line) && text.length < 200 && (Boolean(body) || /subscribe to (?:the times|keep|read|continue)/i.test(text));
    });
  };

  const PINNED = 'main#site-content[style*="position: fixed"]';

  // The whole article, from the data NYT sends with its page (window.__preloadedData, an inline
  // script): since Nov 2026 the page is cut in the browser (config.isOptimisticallyTruncated), and the
  // rest of the text is all there. In the user's Chrome, 2026-11-25, 5 articles of 5: 1,164 words of
  // NYT's own count of 1,160; 1,360 of 1,347; 1,776 of 1,738; 995 of 976; 3,079 of 3,059. So there's
  // nothing to ask archive.today for.
  const DATA = /^\s*window\.__preloadedData\s*=\s*/;
  function pageData(doc) {
    const script = [...doc.scripts].find(s => DATA.test(s.textContent.slice(0, 80)));
    if (!script) return null;
    const text = script.textContent.replace(DATA, '').replace(/;?\s*$/, '');
    // A JavaScript object rather than JSON: some values are undefined (never inside a string, which
    // the first half of the pattern steps over)
    try {
      return JSON.parse(text.replace(/"(?:[^"\\]|\\.)*"|\bundefined\b/g, m => (m === 'undefined' ? 'null' : m)));
    } catch {
      return null;
    }
  }
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  const webAddress = href => {
    try {
      const url = new URL(href, 'https://www.nytimes.com');
      return /^https?:$/.test(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  };
  function runs(content) {
    const out = [];
    let spaced = true; // the text so far ends in a space (or there's none)
    for (const inline of content || []) {
      let text = inline?.__typename === 'LineBreakInline' ? ' ' : typeof inline?.text === 'string' ? inline.text : '';
      text = text.replace(/\s+/g, ' ');
      if (spaced) text = text.replace(/^ /, '');
      if (!text) continue;
      spaced = text.endsWith(' ');
      const run = { text };
      for (const format of inline.formats || []) {
        if (format?.__typename === 'LinkFormat') run.href = webAddress(format.url) || undefined;
        if (format?.__typename === 'ItalicFormat') run.em = true;
        if (format?.__typename === 'BoldFormat') run.strong = true;
      }
      if (!run.href) delete run.href;
      out.push(run);
    }
    if (out.length) out[out.length - 1].text = out[out.length - 1].text.replace(/ $/, '');
    return out.filter(run => run.text);
  }
  function photo(media) {
    const all = (media?.crops || []).flatMap(crop => crop?.renditions || []).filter(r => /^https:\/\/static\d*\.nyt\.com\//.test(r?.url));
    const named = name => all.find(r => r.name === name)?.url;
    const src = named('articleLarge') || named('jumbo') || named('superJumbo');
    if (!src) return null;
    const figure = { type: 'figure', src, alt: clean(media.altText), caption: clean([media.caption?.text, media.credit].filter(Boolean).join(' ')) };
    const hires = named('superJumbo') || named('jumbo');
    if (hires && hires !== src) figure.hires = hires;
    return figure;
  }
  // { blocks, paragraphs, chars, left } as extract.js makes them, or null if the data isn't there, is
  // for another article (NYT can show one without loading a page), or doesn't hold it all. left: how
  // many graphics, videos and embeds it has that can't be drawn from it.
  function articleFromPage(doc) {
    const article = pageData(doc)?.loaderData?.data?.article;
    const content = article?.sprinkledBody?.content;
    if (!Array.isArray(content)) return null;
    let path = '';
    try { path = new URL(article.url, 'https://www.nytimes.com').pathname; } catch { /* no address */ }
    if (path !== doc.location?.pathname) return null;
    const blocks = [];
    let left = 0;
    const paragraph = (inlines, prefix = '') => {
      const list = prefix && inlines.length ? [{ text: prefix }, ...inlines] : inlines;
      const text = clean(list.map(run => run.text).join(''));
      if (text) blocks.push({ type: 'paragraph', text, inlines: list });
    };
    const add = (block, prefix = '') => {
      const type = block?.__typename || '';
      if (type === 'ParagraphBlock' || type === 'DetailBlock') paragraph(runs(block.content), prefix);
      else if (/^Heading\dBlock$/.test(type)) {
        const text = clean(runs(block.content).map(run => run.text).join(''));
        if (text) blocks.push({ type: 'heading', text });
      } else if (type === 'ListBlock') (block.content || []).forEach((item, i) => (item?.content || []).forEach(b => add(b, /ordered|number|decimal/i.test(block.style || '') && !/unordered/i.test(block.style) ? `${i + 1}. ` : '\u2022 ')));
      else if (type === 'BlockquoteBlock') (block.content || []).forEach(b => add(b));
      else if (type === 'ImageBlock') { const figure = photo(block.media); if (figure) blocks.push(figure); }
      else if (type === 'DiptychBlock') for (const media of [block.imageOne, block.imageTwo]) { const figure = photo(media); if (figure) blocks.push(figure); }
      else if (type === 'GridBlock') for (const item of block.gridMedia || block.media || []) { const figure = photo(item?.media || item); if (figure) blocks.push(figure); }
      else if (/Interactive|Video|Slideshow|Embed|Audio|Map|Unstructured/.test(type)) left++;
      // Else not the article's: ad slots (Dropzone), the header, related links, rules, pull quotes
    };
    content.forEach(block => add(block));
    const prose = blocks.filter(b => b.type === 'paragraph' || b.type === 'heading');
    const paragraphs = blocks.filter(b => b.type === 'paragraph');
    const words = prose.map(b => b.text).join(' ').split(/\s+/).filter(Boolean).length;
    // Whole, by NYT's own count (its words come out a little over)
    if (paragraphs.length < 3 || !(article.wordCount > 0) || words < article.wordCount * 0.95) return null;
    return { blocks, paragraphs: paragraphs.length, chars: paragraphs.reduce((n, b) => n + b.text.length, 0), left };
  }
  const news = {
    id: 'nyt',
    name: 'The New York Times',
    shortName: 'NYT',
    hosts: ['www.nytimes.com', 'cooking.nytimes.com'],

    // Articles: /2026/11/14/world/europe/slug.html. Live blogs: /live/2026/11/13/us/slug.
    // Interactive pages: /interactive/2026/11/24/climate/slug.html, or with no date; handled as
    // live blogs are: a login wall comes off; there's no text to swap in.
    isArticle: path => /^\/\d{4}\/\d{2}\/\d{2}\/.+\.html$/.test(path),
    isLive: path => /^\/(?:live\/\d{4}\/\d{2}\/\d{2}\/|interactive\/.)/.test(path),
    // Drop the query string and fragment (?smid=…, #comments) and force the www host, because
    // archive.today looks snapshots up by exact URL.
    normalizeUrl: href => `https://www.nytimes.com${new URL(href).pathname}`,

    live: {
      body: 'section[name="articleBody"]', // the article body: swapped out, and its classes reused
      story: 'article#story',             // fallback home for the banner and text
      main: 'main#site-content',          // the page content: scroll anchor, scope for the upsell line
      upsellLink: 'a[href*="/subscription"]', // "Subscribe to The Times…" line under cut-off text
      fromPage: articleFromPage, // the whole text, if the page was sent it
      wall: {
        popup: '#gateway-content',        // filled while a wall is up (hidden by nyt.css)
        // NYT makes the page inert under a wall: main until Nov 2026, and since then the article
        // body and several divs, one by one (the user's Chrome, 2026-11-25).
        // Interactive pages have nothing inert: main is pinned by inline styles (position: fixed;
        // width: 100%; margin-top: 0px), so the document has no height to scroll (the same day).
        inert: `#site-content[inert], main[inert], section[name="articleBody"][inert], ${PINNED}`,
        pinned: 'main#site-content', // unpinned while the wall is off (and by nyt.css at once)
        // nyt.css hides the wall on every page; where Read Free doesn't act, nothing would undo the
        // rest (a pinned page with no wall to see), so the site's own wall shows there.
        elsewhere: 'show',
        // If NYT changes its marks again (paywall.js): the popup is measured, let out for a moment.
        // Shown with the wall's wording or a cut article, it's a wall like any other (probe); shown
        // with neither, NYT's own wall goes back up after a few seconds, with a note (failOpen). An
        // article that's cut with no wall to see gets a note too (cut).
        probe: doc => cutOff(doc) || LOGIN_WORDING.test(doc.querySelector('#gateway-content')?.textContent || ''),
        failOpen: true,
        cut: doc => cutOff(doc),
        container: '[data-testid="vi-gateway-container"]', // its positioned children are scrims
        login: LOGIN_WORDING, // the login wall's popup wording
        // 'login' only when the popup says so and the text isn't cut. Since Nov 2026 the paywall's
        // popup carries the "To leave without signing in, use your browser's Back button" note
        // too (#gateway-exit-advisory), so the wording alone called cut articles login walls:
        // the wall came off, and the text stayed cut.
        type: doc => {
          const popup = doc.querySelector('#gateway-content');
          const wording = popup ? popup.textContent : '';
          return LOGIN_WORDING.test(wording) && !cutOff(doc) ? 'login' : 'paywall';
        },
      },
    },

    snapshot: {
      // archive.today keeps `name` and ids, not classes (Phase 0).
      body: ['section[name="articleBody"]', 'article#story'],
      junk: /^(advertisement|skip advertisement|supported by|continue reading the main story)$/i,
      // Photos are named crops on static01.nyt.com: …-articleLarge.jpg (1,024 px in the snapshots
      // checked). The -superJumbo crop of the same photo is 2,048 px.
      hiresImage: src => {
        if (!/^https:\/\/static\d*\.nyt\.com\//.test(src)) return null;
        const hires = src.replace(/-(articleLarge|articleInline|jumbo|popup|mediumThreeByTwo\d+|threeByTwo\w*|videoSixteenByNine\w*|thumbLarge|square\d+)(\.\w+)(?=\?|$)/, '-superJumbo$2');
        return hires === src ? null : hires;
      },
    },
  };

  // NYT Cooking's recipes
  const RECIPE = '[class*="recipebody_body-container"]';
  const INGREDIENT = `${RECIPE} [class*="ingredients_ingredients"] li`;
  const STEP = `${RECIPE} [class*="preparation_stepList"] > li`;
  // How many ingredients the JSON-LD's recipe has, or 0
  const listed = doc => {
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
      let items;
      try { items = [].concat(JSON.parse(script.textContent)); } catch { continue; }
      const recipe = items.flatMap(i => (i && i['@graph']) || [i]).find(i => i && [].concat(i['@type']).includes('Recipe'));
      if (recipe) return [].concat(recipe.recipeIngredient || []).length;
    }
    return 0;
  };
  const wholeRecipe = doc => doc.querySelector(STEP) !== null && doc.querySelectorAll(INGREDIENT).length >= Math.max(1, listed(doc));

  const cooking = {
    ...news,
    isArticle: path => /^\/recipes\/\d+-[a-z0-9-]+\/?$/.test(path),
    isLive: () => false,
    normalizeUrl: href => `https://cooking.nytimes.com${new URL(href).pathname}`,
    live: {
      body: RECIPE,
      story: 'main',
      main: 'main',
      upsellLink: null,
      wall: {
        popup: null,
        detect: doc => doc.querySelector(`${RECIPE}[inert], ${RECIPE}[class*="truncator"]`) !== null,
        type: doc => (wholeRecipe(doc) ? 'lift' : 'paywall'),
        reveal: [RECIPE],
        hide: ['[class*="omacookingtruncator"]'],
        liftedMessage: "Removed NYT Cooking's wall. The whole recipe was already on the page.",
        inert: null,
        container: null,
      },
    },
    snapshot: { body: ['auto'], skip: null, junk: null },
  };

  const siteFor = hostname => (hostname === 'cooking.nytimes.com' ? cooking : news);
  const site = siteFor(root.location?.hostname);

  root.NYTFix = root.NYTFix || {};
  root.NYTFix.sites = Object.assign(root.NYTFix.sites || {}, { [site.id]: site });
  if (typeof module === 'object' && module.exports) module.exports = Object.assign(site, { siteFor });
})(globalThis);
