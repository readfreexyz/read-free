// Site health checks (extension/health/checks.js): structure checks on fetched pages.
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const health = require('../extension/health/checks.js');
const specs = require('../extension/health/specs.js');
const nyt = require('../extension/sites/nyt.js');
const corriere = require('../extension/sites/corriere.js');
const [theage] = require('../extension/sites/nine.js');
const spectator = require('../extension/sites/spectator.js');
const { livePageHtml, corriereLivePageHtml, nineLivePageHtml, spectatorLivePageHtml, snapshotHtml } = require('./fixtures.js');

// A fetched page, as the runners hand it over.
const page = (html, url, status = 200) => ({ ok: true, status, url, html, doc: new JSDOM(html, { url }).window.document });
const links = hrefs => `<!doctype html><html><head><title>Home</title></head><body>${hrefs.map(h => `<a href="${h}">x</a>`).join('')}</body></html>`;
const filler = n => Array.from({ length: n }, (_, i) => `/section/page-${i}`);
const status = (results, check) => results.filter(r => r.check === check).map(r => r.status);

test("unusable: a refusal, a bot check or an error page can't be checked; a normal page can", () => {
  assert.match(health.unusable(page('<html><body>no</body></html>', 'https://x.example/', 403)), /refused \(HTTP 403\)/);
  assert.match(health.unusable(page('<html><head><title>Just a moment...</title></head><body></body></html>', 'https://x.example/')), /bot check/);
  assert.match(health.unusable({ ok: false, error: 'ENOTFOUND' }), /couldn't load it \(ENOTFOUND\)/);
  assert.match(health.unusable(page('<html><body>gone</body></html>', 'https://x.example/', 404)), /HTTP 404/);
  assert.equal(health.unusable(page(links(filler(3)), 'https://x.example/')), null);
});

test('checkHome: article links found (relative, on any of the hosts), else a failure, unless the page is drawn by script', () => {
  const home = page(links([...filler(40), '/2026/11/14/us/politics/ground-stop.html', 'https://www.nytimes.com/2026/11/14/world/x.html?smid=1', '/live/2026/11/14/us/blog', 'https://example.com/2026/11/14/us/other.html']), 'https://www.nytimes.com/');
  const { results, samples } = health.checkHome(nyt, home);
  assert.deepEqual(status(results, 'article links'), ['pass']);
  assert.deepEqual(samples, ['https://www.nytimes.com/2026/11/14/us/politics/ground-stop.html', 'https://www.nytimes.com/2026/11/14/world/x.html'], 'no live blog, no other host, no query');
  assert.deepEqual(status(health.checkHome(nyt, page(links(filler(40)), 'https://www.nytimes.com/')).results, 'article links'), ['fail'], 'the URL pattern changed');
  assert.deepEqual(status(health.checkHome(nyt, page(links(filler(5)), 'https://www.nytimes.com/')).results, 'article links'), ['skip'], 'drawn by script');
  assert.deepEqual(status(health.checkHome(nyt, page('x', 'https://www.nytimes.com/', 403)).results, 'article links'), ['skip']);
});

test("checkHome: subdomains for '*.' hosts; live blogs, videos and galleries aren't samples", () => {
  const home = page(links([...filler(40),
    'https://milano.corriere.it/notizie/cronaca/26_novembre_15/a-b-40e77b89-3f4d-4477-88d6-f80b085adxlk.shtml',
    'https://www.corriere.it/video-articoli/26_novembre_15/clip-40e77b89-3f4d-4477-88d6-f80b085adxlk.shtml']), 'https://www.corriere.it/');
  assert.deepEqual(health.checkHome(corriere, home).samples, ['https://milano.corriere.it/notizie/cronaca/26_novembre_15/a-b-40e77b89-3f4d-4477-88d6-f80b085adxlk.shtml']);
  const nine = page(links([...filler(40), '/sport/nrl/world-cup-final-live-jillaroos-20261115-p61e99.html', '/sport/cricket/a-story-20261115-p61e9n.html']), 'https://www.theage.com.au/');
  assert.deepEqual(health.checkHome(theage, nine).samples, ['https://www.theage.com.au/sport/cricket/a-story-20261115-p61e9n.html']);
});

test('checkArticle, a swap site: only the body selector is checked', () => {
  const url = 'https://www.nytimes.com/2026/11/14/world/x.html';
  assert.deepEqual(health.checkArticle(nyt, specs.nyt, page(livePageHtml(), url)).map(r => [r.check, r.status]), [['article body', 'pass']]);
  const broken = health.checkArticle(nyt, specs.nyt, page(livePageHtml({ section: false }), url));
  assert.deepEqual(status(broken, 'article body'), ['fail']);
  assert.match(broken[0].detail, /matches nothing/);
});

test('checkArticle, a guard site: the whole text sent, the parts to keep there, the guard\'s event named in the page', () => {
  const url = 'https://www.corriere.it/esteri/26_novembre_14/x-8e63fa3b-6c0d-49ae-827c-f09199dc9xlk.shtml';
  const withMarker = html => html.replace('</body>', "<script>var config = [{ events: [{ target: document, eventName: 'adblockActivated' }] }];</script></body>");
  const good = health.checkArticle(corriere, specs.corriere, page(withMarker(corriereLivePageHtml()), url));
  assert.deepEqual(good.map(r => r.status), ['pass', 'pass', 'pass', 'pass'], JSON.stringify(good));

  const cut = health.checkArticle(corriere, specs.corriere, page(withMarker(corriereLivePageHtml({ onPage: 2 })), url));
  assert.deepEqual(status(cut, 'whole text sent'), ['fail']);
  assert.match(cut.find(r => r.check === 'whole text sent').detail, /may now cut the text/);

  const noHeader = page(withMarker(corriereLivePageHtml()), url);
  noHeader.doc.getElementById('l-header').remove();
  assert.deepEqual(status(health.checkArticle(corriere, specs.corriere, noHeader), 'parts to keep'), ['fail']);

  assert.deepEqual(status(health.checkArticle(corriere, specs.corriere, page(corriereLivePageHtml(), url)), '"adblockActivated" in the page'), ['fail'], 'the event renamed');
});

test('checkArticle, a lift site without a length in its JSON-LD: minWords decides', () => {
  const url = 'https://www.theage.com.au/national/x-20261114-p61d87.html';
  assert.deepEqual(status(health.checkArticle(theage, specs.theage, page(nineLivePageHtml({ cut: false, prompt: false }), url)), 'whole text sent'), ['pass']);
  assert.deepEqual(status(health.checkArticle(theage, specs.theage, page(nineLivePageHtml({ cut: true, prompt: false }), url)), 'whole text sent'), ['fail'], 'cut before sending');
  const spec = { method: 'lift' };
  assert.deepEqual(status(health.checkArticle(theage, spec, page(nineLivePageHtml({ cut: false, prompt: false }), url)), 'whole text sent'), ['skip'], 'nothing to compare with');
});

test("markerScripts and checkScript: the guard's events must still be in the site's script", () => {
  const url = 'https://www.theage.com.au/national/x-20261114-p61d87.html';
  const html = nineLivePageHtml().replace('</head>', '<script src="/hashed-metro-assets/client.4346dea32742a94f.js"></script></head>');
  const [{ marker, url: src }] = health.markerScripts(specs.theage, page(html, url));
  assert.equal(src, 'https://www.theage.com.au/hashed-metro-assets/client.4346dea32742a94f.js');
  const good = { ok: true, status: 200, text: 'r="pianoContentWall",c="payWall",m="NO_PAYWALL"' };
  assert.deepEqual(health.checkScript(marker, good).map(r => r.status), ['pass']);
  assert.deepEqual(health.checkScript(marker, { ...good, text: 'r="pianoWall"' }).map(r => r.status), ['fail']);
  assert.deepEqual(health.checkScript(marker, null).map(r => r.status), ['fail'], 'the script is gone');
  assert.deepEqual(health.checkScript(marker, { ok: false, error: 'timeout' }).map(r => r.status), ['skip']);
  assert.deepEqual(health.markerScripts(specs.theage, page(nineLivePageHtml(), url)).map(m => m.url), [null]);
});

test("overall: any failure fails the site; nothing checked is a skip; a lift site's whole text is checked", () => {
  assert.equal(health.overall([{ status: 'pass' }, { status: 'skip' }]), 'pass');
  assert.equal(health.overall([{ status: 'pass' }, { status: 'fail' }]), 'fail');
  assert.equal(health.overall([{ status: 'skip' }]), 'skip');
  const url = 'https://spectator.com/article/x-y/';
  assert.deepEqual(status(health.checkArticle(spectator, specs.spectator, page(spectatorLivePageHtml({ paid: 'missing' }), url)), 'whole text sent'), ['fail']);
  assert.deepEqual(health.splitSelectors('a > b, c:not(d, e), [x="1,2"]'), ['a > b', 'c:not(d, e)', '[x="1,2"]']);
});

test('combine: a check fails only on most samples; a lone odd page is a note on a pass', () => {
  const r = (check, status, detail = status) => ({ check, status, detail });
  const one = health.combine([
    { sample: 'a', results: [r('article body', 'pass', '1 match, 900 words')] },
    { sample: 'b', results: [r('article body', 'fail', 'matches nothing')] },
    { sample: 'c', results: [r('article body', 'pass', '1 match, 700 words')] },
  ]);
  assert.equal(one[0].status, 'pass');
  assert.match(one[0].detail, /2 of 3 samples.*b: matches nothing/);
  const most = health.combine([
    { sample: 'a', results: [r('article body', 'fail', 'matches nothing')] },
    { sample: 'b', results: [r('article body', 'fail', 'matches nothing')] },
    { sample: 'c', results: [r('article body', 'pass')] },
  ]);
  assert.equal(most[0].status, 'fail');
  assert.match(most[0].detail, /failed on 2 of 3 samples/);
  assert.equal(health.combine([{ sample: 'a', results: [r('article body', 'fail', 'x')] }])[0].status, 'fail', 'one sample, failing');
  assert.equal(health.combine([{ sample: 'a', results: [r('whole text sent', 'skip', 'no length')] }])[0].status, 'skip');
  assert.deepEqual(health.combine([]), []);
});

test("checkHome: today's stories first, menu links (LA Times' 2022 hub pages) last", () => {
  const latimes = require('../extension/sites/latimes.js');
  const html = `<!doctype html><html><head><title>Home</title></head><body>
    <header><nav><a href="/lifestyle/image/story/2022-09-13/trend-analysis">Image</a></nav></header>
    <main>${filler(40).map(h => `<a href="${h}">x</a>`).join('')}
      <a href="/politics/story/2026-11-14/older">older</a><a href="/california/story/2026-11-15/newest">newest</a></main></body></html>`;
  assert.deepEqual(health.checkHome(latimes, page(html, 'https://www.latimes.com/')).samples, [
    'https://www.latimes.com/california/story/2026-11-15/newest',
    'https://www.latimes.com/politics/story/2026-11-14/older',
    'https://www.latimes.com/lifestyle/image/story/2022-09-13/trend-analysis',
  ]);
});

test("unusable: Le Monde's \"Client Challenge\" and other pages that only ask for JavaScript are bot checks", () => {
  const challenge = '<!doctype html><html><head><title>Client Challenge</title></head><body><noscript>Please enable JavaScript.</noscript></body></html>';
  assert.match(health.unusable(page(challenge, 'https://www.lemonde.fr/x')), /bot check/);
  const scriptOnly = '<!doctype html><html><head><title>Le Monde</title></head><body>You need to enable JavaScript to run this app.</body></html>';
  assert.match(health.unusable(page(scriptOnly, 'https://www.lemonde.fr/x')), /only asks for JavaScript/);
  assert.equal(health.unusable(page(livePageHtml(), 'https://www.nytimes.com/2026/01/01/x.html')), null, 'a real page');
});

test('feedSamples: the articles in an RSS or Atom feed, on the site, without query, each once', () => {
  const rss = `<rss><channel><link>https://www.nytimes.com</link>
    <item><link>https://www.nytimes.com/2026/11/19/world/asia/a.html?utm=rss</link></item>
    <item><link><![CDATA[https://www.nytimes.com/2026/11/19/us/b.html]]></link></item>
    <item><link>https://www.nytimes.com/2026/11/19/world/asia/a.html</link></item>
    <item><link>https://www.nytimes.com/live/2026/11/19/us/c</link></item>
    <item><link>https://elsewhere.example/2026/11/19/us/d.html</link></item></channel></rss>`;
  assert.deepEqual(health.feedSamples(nyt, rss), ['https://www.nytimes.com/2026/11/19/world/asia/a.html', 'https://www.nytimes.com/2026/11/19/us/b.html']);
  const atom = `<feed><link rel="alternate" href="https://www.nytimes.com/"/><entry><link rel="alternate" href="https://www.nytimes.com/2026/11/19/us/e.html"/></entry></feed>`;
  assert.deepEqual(health.feedSamples(nyt, atom), ['https://www.nytimes.com/2026/11/19/us/e.html']);
  assert.deepEqual(health.feedSamples(nyt, ''), []);
});

test("checkSnapshot: the extension's extractor on archive.today's snapshot; a missing snapshot, a CAPTCHA or a thin capture is a skip", () => {
  const ARTICLE = 'https://www.nytimes.com/2026/01/01/world/x.html';
  const SNAP = 'https://archive.ph/AbCdE';
  const good = health.checkSnapshot(nyt, page(snapshotHtml(), SNAP), ARTICLE);
  assert.equal(good.status, 'pass', good.detail);
  assert.match(good.detail, /^12 paragraphs/);
  assert.equal(health.checkSnapshot(nyt, page('<html><body>Not found</body></html>', SNAP, 404), ARTICLE).status, 'skip');
  assert.match(health.checkSnapshot(nyt, page('<html><body><div class="g-recaptcha"></div></body></html>', SNAP), ARTICLE).detail, /captcha/);
  assert.match(health.checkSnapshot(nyt, { ok: false, error: 'ECONNRESET' }, ARTICLE).detail, /didn't answer/);
  const thin = health.checkSnapshot(nyt, page(snapshotHtml({ paragraphs: 2 }), SNAP), ARTICLE);
  assert.equal(thin.status, 'skip', 'a capture behind the wall is not the extension\'s to fix');
  const moved = health.checkSnapshot(nyt, page('<!doctype html><html><body><div id="CONTENT"><p>Menu</p></div></body></html>', SNAP), ARTICLE);
  assert.equal(moved.status, 'fail', 'no article body where the adapter looks: the layout changed');
});

test("track: run to run, a failure alerts; a site that answered and then hasn't for a week alerts; one that never answered is only listed", () => {
  const day = n => `2026-11-${String(n).padStart(2, '0')}`;
  let t = health.track({}, { nyt: { state: 'skip' }, lemonde: { state: 'pass' }, wsj: { state: 'fail' } }, day(1));
  assert.deepEqual(t.alerts, [{ id: 'wsj', why: 'failed' }]);
  assert.deepEqual(t.never, ['nyt']);
  assert.deepEqual(t.state.sites.lemonde, { lastAnswered: day(1), quietSince: null });
  // Le Monde stops answering: quiet for six days, then an alert on the seventh
  for (let n = 2; n <= 7; n++) {
    t = health.track(t.state, { nyt: { state: 'skip' }, lemonde: { state: 'skip' }, wsj: { state: 'pass' } }, day(n));
    assert.deepEqual(t.alerts, [], `day ${n}`);
    assert.deepEqual(t.blind, [{ id: 'lemonde', since: day(2) }], `day ${n}`);
  }
  t = health.track(t.state, { nyt: { state: 'skip' }, lemonde: { state: 'skip' }, wsj: { state: 'pass' } }, day(9));
  assert.deepEqual(t.alerts, [{ id: 'lemonde', why: `couldn't be checked since ${day(2)}; it last answered on ${day(1)}` }]);
  assert.deepEqual(t.never, ['nyt'], 'never answered: listed, never an alert');
  // It answers again: quiet no more
  t = health.track(t.state, { nyt: { state: 'skip' }, lemonde: { state: 'pass' }, wsj: { state: 'pass' } }, day(10));
  assert.deepEqual([t.alerts, t.blind], [[], []]);
});
