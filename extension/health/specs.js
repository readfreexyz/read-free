// What each supported site should show the health checks (health/checks.js), by adapter id.
//   home        where to find sample articles (the homepage)
//   method      how the extension deals with its wall, which decides what's checked:
//               'lift'  the page sends the whole article: it must keep doing so
//               'guard' the same, plus a page-world guard (page/*.js) waiting for the site's
//                       own events: their names must still be in the page or its scripts
//               'swap'  the page sends a cut article, the rest comes from archive.today: only
//                       the body selector is checked
//   minWords    for a page that gives no length (no JSON-LD wordCount or articleBody): the
//               fewest words that still count as the whole article
//   minBodyWords  the fewest paragraph words live.body should hold (default 20; 0 where a cut
//               page keeps none, like Spiegel+)
//   paragraphs  what counts as a paragraph in live.body (default 'p')
//   body: false   don't check live.body (FT's signed-out readers get a barrier page instead)
//   feed        an RSS or Atom feed of the site's articles: samples for the archive.today check
//               ('swap' sites) when the homepage refuses a script (as NYT, FT, The Atlantic and
//               WSJ do; their feeds answer)
//   markers.html     strings the page itself must contain
//   markers.scripts  [{ name, src (RegExp for the script's address), texts }]
(function (root) {
  'use strict';

  // Nine's client bundle holds the event Piano fires and the types page/nine.js holds back.
  const NINE_CLIENT = [{ name: "Nine's client", src: /\/hashed-metro-assets\/client\.[0-9a-f]+\.js/, texts: ['pianoContentWall', 'payWall', 'NO_PAYWALL'] }];

  const specs = {
    nyt: { home: 'https://www.nytimes.com/', method: 'swap', feed: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml' },
    ft: { home: 'https://www.ft.com/', method: 'swap', feed: 'https://www.ft.com/world?format=rss', body: false, bodyNote: 'signed-out readers get a barrier page, no article body' },
    atlantic: { home: 'https://www.theatlantic.com/', method: 'swap', feed: 'https://www.theatlantic.com/feed/all/' },
    // The subscription engine that cuts the article (script#journey) and the sections it deletes.
    // Its own script is at an address that changes, so only the page is checked.
    newyorker: { home: 'https://www.newyorker.com/', method: 'guard', minWords: 150, markers: { html: ['id="journey"', 'data-journey-hook="grid-wrapper"'] } },
    cnn: { home: 'https://www.cnn.com/', method: 'lift', minWords: 150 },
    latimes: { home: 'https://www.latimes.com/', method: 'lift', minWords: 150 },
    newsweek: { home: 'https://www.newsweek.com/', method: 'lift', minWords: 150 },
    globeandmail: { home: 'https://www.theglobeandmail.com/', method: 'lift', minWords: 150 },
    thestar: { home: 'https://www.thestar.com/', method: 'lift', minWords: 150 },
    wsj: { home: 'https://www.wsj.com/', method: 'swap', feed: 'https://feeds.content.dowjones.io/public/rss/RSSWorldNews' },
    theage: { home: 'https://www.theage.com.au/', method: 'guard', minWords: 150, markers: { scripts: NINE_CLIENT } },
    smh: { home: 'https://www.smh.com.au/', method: 'guard', minWords: 150, markers: { scripts: NINE_CLIENT } },
    spiegel: { home: 'https://www.spiegel.de/', method: 'swap', feed: 'https://www.spiegel.de/schlagzeilen/index.rss', minBodyWords: 0 },
    lemonde: { home: 'https://www.lemonde.fr/', method: 'swap', feed: 'https://www.lemonde.fr/rss/une.xml' },
    nationalpost: { home: 'https://nationalpost.com/', method: 'swap', minBodyWords: 10 },
    // The loader's event for the ad-blocker popup is in the page; the wall's event
    // (pno_abc_test:init) is in a chunk loaded later, so only its module's own guard is checked.
    corriere: { home: 'https://www.corriere.it/', method: 'guard', markers: { html: ['adblockActivated'] } },
    spectator: { home: 'https://spectator.com/', method: 'lift', minWords: 150 },
    // Batch 4. Reuters' paragraphs are divs, and its bulletins can be 40 words long; DataDome
    // refuses scripted requests, so it's only checked from Chrome.
    reuters: { home: 'https://www.reuters.com/', method: 'lift', paragraphs: 'div[data-testid^="paragraph-"]', minBodyWords: 10, minWords: 30 },
    lalibre: { home: 'https://www.lalibre.be/', method: 'lift', minWords: 150 },
    // Batch 6. NRC and The Independent give no length in their JSON-LD.
    abces: { home: 'https://www.abc.es/', method: 'lift', minWords: 150 },
    elmundo: { home: 'https://www.elmundo.es/', method: 'lift', minWords: 150 },
    // NRC sends the whole article and its script cuts the drawn page, after the extension starts
    // (sites/nrc.js). It gives no length, and its short pieces (a 117-word "docu hit", seen
    // 2026-11-16) sit among the homepage's first links, so no minWords: a word count can't tell
    // them from a cut. The parts the extension keeps are checked.
    nrc: { home: 'https://www.nrc.nl/', method: 'lift', minBodyWords: 10 },
    independent: { home: 'https://www.independent.co.uk/', method: 'lift', minWords: 150 },
    // Batch 7. Haaretz sends one paragraph (or the whole article, on some). Most of The Jerusalem
    // Post's articles are free, so the samples mostly say its body is still where it was. Ynet's cut
    // is in a 6.9 MB bundle, so only the page is checked; its text is in the container's blocks (lists
    // and quotes as well as paragraphs).
    haaretz: { home: 'https://www.haaretz.com/', method: 'swap', feed: 'https://www.haaretz.com/srv/haaretz-latest-headlines', minBodyWords: 10 },
    jpost: { home: 'https://www.jpost.com/', method: 'lift', minWords: 100 },
    ynet: { home: 'https://www.ynet.co.il/', method: 'guard', paragraphs: '[data-contents="true"] > *', minBodyWords: 10, minWords: 30, markers: { html: ['data-contents="true"', 'public-DraftEditor-content'] } },
  };

  root.NYTFix = Object.assign(root.NYTFix || {}, { healthSpecs: specs });
  if (typeof module === 'object' && module.exports) module.exports = specs;
})(globalThis);
