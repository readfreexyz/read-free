// Runs on supported news sites and acts on their articles (and NYT's live blogs). What a site
// looks like (URLs, walls, article body, snapshot layout) comes from its adapter, sites/*.js,
// which registers itself in NYTFix.sites; this script picks the one for the current host.
// - Site CSS keeps the walls from being drawn at all. This script finishes the job the moment a
//   wall goes up (before the next paint): it removes `inert` and the scrim.
// - Login wall ("free to read, log in to continue"): the whole story is already in the page,
//   so lifting the wall is all there is to do. No archive.today request.
// - Sites that cut the article in the browser (The Age, the Herald): a page-world guard
//   (page/*.js) keeps the cut from happening, and the wall is only lifted. The fastest way, so
//   the first one to look for on a new site.
// - Paywall on an article: the wall comes off at once, then the archived text is swapped in:
//   a copy saved in the last 30 days, or else the newest complete archive.today snapshot
//   (trying up to three). Subscribers never get a wall, so nothing happens for them.
// - "Turn off your ad blocker" popups over an article are hidden too (notices.js).
// - Toolbar menu (popup/): undo (the site's version, wall and all), or run it by hand; it asks
//   this script for the page's state.
// - Off on this site or everywhere (settings.js): the page is left as the site sends it.
// - Sites can switch pages without a full load. Each new page starts fresh.
(function () {
  'use strict';
  if (globalThis.__nytfixLoaded) return;
  globalThis.__nytfixLoaded = true;

  const { archive, extract, render, status: statusBar, paywall, notices, cache: articleCache, scroll: scrollTracker, settings: settingsLib, notify: notifyLib, tally: tallyLib, reasons: reasonsLib, adapter: adapterLib, sites = {} } = globalThis.NYTFix;
  const KEPT_ATTR = adapterLib?.KEPT_ATTR || 'data-nytfix-kept';
  // hosts may hold '*.example.com' for every subdomain (Corriere's local editions).
  const onHost = host => host === location.hostname || (host.startsWith('*.') && location.hostname.endsWith(host.slice(1)));
  const site = Object.values(sites).find(s => s.hosts.some(onHost) && s.live);
  if (!site) return;
  const TIMEMAP_TIMEOUT_MS = 20000;
  // archive.today usually takes 8–15 s to render a snapshot nobody has asked for lately, but
  // tests have seen 45 s and once 73 s. Once rendered, it answers in well under a second.
  // Also the limit for /newest/, which looks the article up (0.4–12 s seen) and then renders.
  const SNAPSHOT_TIMEOUT_MS = 90000;
  const DOWNLOAD_STAGE = { expectedMs: 9000, slowAfterMs: 20000, slowLabel: 'archive.today is slow right now. Still waiting…' };
  // How many snapshots to try when newer ones are incomplete. Each can be a cold 8–15 s
  // render on archive.today's side, so keep it small.
  const MAX_ATTEMPTS = 3;
  const NAVIGATION_POLL_MS = 1000;
  const HOLD_PLACE_MS = 1500;
  // After a swap, how long to check that the site hasn't redrawn the article over it.
  const SWAP_GUARD_MS = 30000;
  const SWAP_GUARD_TRIES = 5;

  const cache = articleCache.create(chrome.storage.local);
  // The reader's settings (settings.js), loaded before the page is acted on and kept current.
  let prefs = null;
  const siteOn = () => !prefs || settingsLib.isOn(prefs, site.id);
  // What the status bar has said before (notify.js): loaded with the settings, so deciding what
  // to add once a wall is off takes no waiting.
  let notifyState = notifyLib.fresh();
  let explainedHere = false; // the reason was shown on this page, while archive.today loaded
  let loading = false;
  let undoLift = null;      // puts the site's wall back
  let undoSwap = null;      // takes the archived text out again
  let placeholder = null;   // "Loading the rest…" where the site's text ends, while archive.today loads
  let userRestored = false; // the reader chose the site's version, so don't redo anything on our own
  // This page had a paywall. Remembered for retries: once the wall is lifted, the page may no
  // longer look paywalled (NYT's `inert` is gone), but the text on it is still cut off.
  let pagePaywalled = false;
  let generation = 0;       // bumped on navigation, so work for the previous page stops
  let stopWatching = () => {};
  let stopNotices = () => {}; // ad-blocker notices (notices.js)
  let stopKeeping = () => {}; // putting back what a wall deletes (site.live.keep)
  let siteCut = false;        // ...and it did, on this page
  let onSiteCut = null;       // waiting for the site's decision (awaitDecision)
  let noticesHidden = false;  // an ad-blocker notice was hidden on this page
  let guardPausedUntil = 0;   // the extension is moving the page itself until then
  let currentPath = location.pathname;
  // Where the reader last scrolled to, so lifting a wall can put them back there.
  // Scrolling doesn't count while a wall is up, but it does once the extension has lifted it,
  // even if the site leaves its marks behind (LA Times keeps body.met-panel-open, which its
  // adapter reads as a wall). Otherwise the reader's place is never known after a lift.
  const tracker = scrollTracker.track(document, {
    measure: () => render.anchorTop(document, site),
    isWallShowing: () => !undoLift && paywall.isActive(document, site),
    // The page went well above the reader's place on its own. Once the extension has acted on
    // the page, put them back: LA Times' metering script sends the page to the top before every
    // popup it opens, including ones that open after the wall is off (the ad-blocker one).
    onJumpUp: (position, top, verdict) => {
      if (!(applied() || noticesHidden) || Date.now() < guardPausedUntil) return;
      console.info(`[Read Free] the page scrolled up by itself (${verdict}, ${Math.round(position)} -> ${Math.round(top)}); putting the reader back`);
      keepPlace(position);
    },
  });

  const supportedPage = () => site.isArticle(location.pathname) || site.isLive(location.pathname);

  // Page-world guards (page/*.js) hold back a site's own wall events so the article is never cut.
  // 'release': the reader asked for the site's version, so let them through. 'hold': hold them
  // again (a new page, or the reader ran the extension again). Sites without one don't listen.
  const pageGuard = action => document.dispatchEvent(new CustomEvent(`nytfix:${action}`));
  const applied = () => Boolean(undoLift || undoSwap);
  const stateName = () => (loading ? 'loading' : applied() ? 'applied' : 'idle');

  // The mark on the toolbar icon (background.js draws it): this page had a wall and it's off.
  // 'lifted': the text was on the page; 'swapped': archived text is showing. Cleared when the
  // reader leaves the page, when the site shows another page without a full load, and on undo.
  let iconMark = null;
  function markIcon(state, title = '') {
    if (!state && !iconMark) return;
    iconMark = state ? { state, title } : null;
    sendMark();
  }
  function sendMark(mark = iconMark) {
    try {
      chrome.runtime.sendMessage({ type: 'nytfix:mark', state: mark?.state || null, title: mark?.title || '' }).catch(() => {});
    } catch {
      // The extension was reloaded or removed while the page was open.
    }
  }
  // Leaving the page: take the mark off, in case the next page isn't one of ours (Chrome should
  // clear it anyway). Back from the back/forward cache: the page is as it was, so put it back.
  window.addEventListener('pagehide', () => {
    if (iconMark) sendMark(null);
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted && iconMark) sendMark();
  });

  // The toolbar menu: 'nytfix:state' asks what's going on here, 'nytfix:toggle' undoes, or runs
  // the extension by hand.
  const pageState = () => (!siteOn() ? 'off' : !supportedPage() ? 'not-article' : stateName());
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'nytfix:state') {
      sendResponse({ site: site.id, state: pageState(), mark: iconMark?.state || null, restored: userRestored });
      return false;
    }
    if (msg?.type !== 'nytfix:toggle') return false;
    if (!siteOn()) {
      sendResponse({ state: 'off' });
      return false;
    }
    if (!supportedPage()) {
      sendResponse({ state: 'not-article' });
      return false;
    }
    if (!loading) {
      if (applied()) undo();
      else activate({ manual: true });
    }
    sendResponse({ state: stateName() });
    return false;
  });

  function startPage() {
    markIcon(null);
    userRestored = false;
    pagePaywalled = false;
    noticesHidden = false;
    explainedHere = false;
    tracker.reset();
    document.documentElement.classList.remove('nytfix-off');
    // "Turn off your ad blocker" popups: hidden on every page of the site (Corriere's homepage
    // has one too), whether or not there's a wall. The reader's place is noted before hiding and
    // restored after, as when a wall comes off.
    stopNotices = notices.watch(document, {
      beforeHide: () => ({ place: placeToKeep(), tracked: tracker.position(), scrollY: Math.round(window.scrollY), locks: scrollLocks() }),
      onHide: (hidden, before) => {
        noticesHidden = true;
        console.info(`[Read Free] hid an ad-blocker notice: ${JSON.stringify({
          hidden: hidden.map(el => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.classList.length ? '.' + [...el.classList].slice(0, 3).join('.') : ''}`),
          before,
          after: { scrollY: Math.round(window.scrollY), locks: scrollLocks() },
        })}`);
        keepPlace(before.place);
      },
    });
    if (!supportedPage()) return;
    pageGuard('hold');
    // A wall that deletes the article from the page (Corriere's private-browsing one): put it
    // back as it goes, so lifting the wall leaves the article, not a blank page.
    siteCut = false;
    onSiteCut = null;
    document.documentElement.removeAttribute(KEPT_ATTR);
    if (site.live.keep) {
      stopKeeping = render.keepOnPage(document, site.live.keep, nodes => {
        console.info(`[Read Free] the site removed the article from the page (${nodes.map(n => n.tagName.toLowerCase() + (n.id ? '#' + n.id : '')).join(', ')}); put it back`);
        siteCut = true;
        // For the adapter's wall check (adapter.cutKept): the text is whole, however short.
        document.documentElement.setAttribute(KEPT_ATTR, '');
        onSiteCut?.();
      });
    }
    stopWatching = paywall.watch(document, site, () => {
      if (!loading && !applied() && !userRestored) activate();
    });
  }

  // The site showed another page without a full load. Drop everything tied to the old one, without
  // putting its wall back, and start over.
  function checkNavigation() {
    if (location.pathname === currentPath) return;
    currentPath = location.pathname;
    generation++;
    loading = false;
    stopWatching();
    stopNotices();
    stopKeeping();
    undoAll({ putBackPaywall: false });
    statusBar.remove(document);
    render.removeBanner(document);
    if (siteOn()) startPage();
    else stayOff();
  }

  // Off on this site, or everywhere: leave the page as the site sends it. Its wall comes back
  // (site CSS in sites/*.css only hides walls without .nytfix-off), a page-world guard lets the
  // site's events through, and the toolbar icon goes grey.
  function stayOff() {
    document.documentElement.classList.add('nytfix-off');
    pageGuard('release');
    markIcon('off', prefs.enabled ? `Off on ${site.name}.` : 'Off on all sites.');
  }

  // Decide what to do about the wall on this page.
  function activate({ manual = false } = {}) {
    if (!siteOn()) return; // turned off in another tab since this page started
    if (manual) pageGuard('hold');
    const wall = paywall.wallType(document, site);
    if (wall) {
      const wording = paywall.popupWording(document, site).slice(0, 160);
      console.info(`[Read Free] ${wall === 'paywall' ? 'paywall' : 'wall over the whole text'} (${wall}) detected. Its popup says: "${wording}"`);
    }
    // 'login' (NYT's login wall) and 'lift' (a site that sent the whole article): the text is
    // all on the page, so taking the wall off is enough.
    if (wall === 'login' || wall === 'lift') {
      const decision = site.live.wall.decision;
      const undecided = Boolean(decision) && !siteCut && decision.pending(document);
      lift();
      const message = site.live.wall.liftedMessage || 'Removed the login wall. This story is free to read.';
      const say = () => {
        // The status bar keeps it short; the toolbar icon's tooltip has the whole message.
        announce(null, message.split(/(?<=\.) /)[0], 'lifted', { paid: wall !== 'login' });
        markIcon('lifted', message);
      };
      if (undecided) awaitDecision(decision, say);
      else say();
      return;
    }
    if (site.isArticle(location.pathname)) {
      run({ force: manual });
      return;
    }
    // A live blog behind the paywall: there's no full text to show yet, so let the site's wall show.
    if (wall) render.showWall(document);
    if (manual) {
      statusBar.create(document).finish('info', wall
        ? `Live blogs behind ${site.shortName}'s paywall aren't supported yet.`
        : 'There is no login wall or paywall on this page.');
    }
  }

  // The site decides after the page is drawn whether this reader may read, and until then hides
  // the text either way (site.live.wall.decision: ABC). The lift has shown it already; say
  // nothing until the site has decided. It deleted the text (put back by live.keep): that was a
  // wall. It let the reader in: there was none, so the lift is taken back, leaving the text as
  // the site now shows it. No decision in time: the text would have stayed hidden, so that was
  // a wall too.
  function awaitDecision(decision, say) {
    const gen = generation;
    let observer = null;
    let timer = null;
    const decide = (wall, why) => {
      if (!timer) return; // decided already
      clearTimeout(timer);
      timer = null;
      observer?.disconnect();
      if (onSiteCut === refused) onSiteCut = null;
      if (gen !== generation || userRestored || !undoLift) return;
      console.info(`[Read Free] the site decided: ${why}`);
      if (wall) say();
      else undoAll({ putBackPaywall: false });
    };
    const refused = () => decide(true, 'it removed the text, so that was a wall');
    timer = setTimeout(() => decide(true, `no answer in ${decision.waitMs / 1000} s, so the text would have stayed hidden`), decision.waitMs);
    onSiteCut = refused;
    observer = new MutationObserver(() => {
      if (decision.allowed(document)) decide(false, 'the reader may read it, so there was no wall');
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  }

  // Take the wall off and keep the reader's place.
  function lift() {
    if (undoLift) return;
    const place = placeToKeep();
    undoLift = render.liftWall(document, site);
    keepPlace(place);
  }

  function clearPlaceholder() {
    placeholder?.remove();
    placeholder = null;
  }

  function undoAll({ putBackPaywall = true } = {}) {
    stopSwapGuard();
    clearPlaceholder();
    undoSwap?.();
    undoSwap = null;
    undoLift?.({ putBackPaywall });
    undoLift = null;
  }

  // The reader asked for the site's version: put everything back, and don't redo it on our own.
  function undo() {
    undoAll();
    stopKeeping();
    pageGuard('release');
    userRestored = true;
    markIcon(null);
  }

  // Swap in archived text (lifting the wall first, if it isn't already).
  function show(snapshot, { again = false } = {}) {
    guardPausedUntil = Date.now() + HOLD_PLACE_MS; // apply() keeps the reader's paragraph in place itself
    clearPlaceholder(); // first: apply() then hides the site's subscription line for good
    lift();
    render.hideWall(document); // in case it was shown again after archive.today couldn't help
    undoSwap?.();
    undoSwap = render.apply(document, site, { ...snapshot, onRestore: undo });
    markIcon('swapped', `Showing the article from archive.today, in place of ${site.shortName || site.name}'s paywall.`);
    if (!again) guardSwap(snapshot);
  }

  // React sites can redraw the article after the swap, or before the body is even there (The Age:
  // the archived text landed at the end of the page, the site's own paragraphs showing above it).
  // For a while, put the archived text back whenever it's no longer in place.
  let swapGuard = null;
  function stopSwapGuard() {
    clearInterval(swapGuard);
    swapGuard = null;
  }
  function guardSwap(snapshot) {
    stopSwapGuard();
    const gen = generation;
    const until = Date.now() + SWAP_GUARD_MS;
    let tries = 0;
    swapGuard = setInterval(() => {
      if (gen !== generation || !undoSwap || Date.now() > until) return stopSwapGuard();
      if (render.swapIntact(document, site)) return;
      if (++tries > SWAP_GUARD_TRIES) return stopSwapGuard();
      console.info('[Read Free] the site redrew the article; putting the archived text back');
      show(snapshot, { again: true });
    }, 500);
  }

  // How <html> and <body> lock scrolling right now (for the console).
  function scrollLocks() {
    return [document.documentElement, document.body].map(el => {
      const style = getComputedStyle(el);
      return `${el.tagName.toLowerCase()} overflow-y:${style.overflowY} position:${style.position} top:${style.top}`;
    });
  }

  // Where to put the reader once a wall is off: where they last scrolled to themselves, or else
  // wherever the page content is right now. Read it before lifting.
  function placeToKeep() {
    return tracker.position() ?? render.anchorTop(document, site);
  }

  function keepPlace(place) {
    guardPausedUntil = Date.now() + HOLD_PLACE_MS;
    const first = render.scrollAnchorTo(document, site, place);
    console.info(`[Read Free] keeping your place: ${JSON.stringify({ ...first, recentScrolls: tracker.log() })}`);
    // The site may scroll the page again right after the wall comes off. For a moment, put the
    // reader back, unless they're the one scrolling.
    const until = Date.now() + HOLD_PLACE_MS;
    const hold = () => {
      if (Date.now() > until || tracker.readerActive()) return;
      if (Math.abs(render.anchorTop(document, site) - place) > 100) render.scrollAnchorTo(document, site, place);
      requestAnimationFrame(hold);
    };
    requestAnimationFrame(hold);
  }

  // A paywalled page with no article of its own (FT's barrier page) when archive.today can't
  // help: show the site's wall again rather than leave just a headline.
  function showWallIfNothingToRead(paywalled) {
    if (paywalled && !render.liveArticleBody(document, site)) render.showWall(document);
  }

  // blocked: archive.today wants a CAPTCHA or is rate-limiting, so asking it another way won't help.
  class FixError extends Error {
    constructor(message, { blocked = false } = {}) {
      super(message);
      this.blocked = blocked;
    }
  }

  const dismiss = { text: 'Dismiss', onClick: () => render.removeBanner(document) };
  // Fetch the article from archive.today again, after a failure (a network hiccup, a slow
  // snapshot, a CAPTCHA completed since) or a "no snapshot yet".
  function retry() {
    if (loading) return;
    render.hideWall(document); // shown again on FT when archive.today couldn't help
    run({ force: true });
  }
  const tryAgain = { text: 'Try again', onClick: retry };
  const warnCache = e => console.warn('[Read Free] cache error', e);

  // Content scripts can't fetch archive.today cross-origin, so the service worker does it.
  async function bgFetch(url, timeoutMs) {
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'nytfix:fetch', url, timeoutMs });
    } catch (e) {
      throw new FixError(`The extension's background worker didn't answer (${e.message}). Reload the page and try again.`);
    }
    if (!res) throw new FixError("The extension's background worker didn't answer. Reload the page and try again.");
    const host = new URL(url).hostname;
    if (!res.ok) throw new FixError(`Couldn't reach ${host}: ${res.error}.`);
    const blocked = archive.looksBlocked(res.status, res.body);
    if (blocked === 'captcha') {
      throw new FixError(`${host} wants a CAPTCHA. Open it, complete the check, then click the toolbar button again.`, { blocked: true });
    }
    if (blocked === 'rate-limited') throw new FixError(`${host} is rate-limiting requests. Wait a minute and try again.`, { blocked: true });
    return res;
  }

  // Let the browser paint the status bar before a long synchronous step.
  const nextPaint = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

  // force: skip the remembered "no snapshot yet" answer (toolbar click, "Check again").
  async function run({ force = false } = {}) {
    loading = true;
    const gen = generation;
    const stale = () => gen !== generation;
    const articleUrl = site.normalizeUrl(location.href);
    clearPlaceholder(); // a note left by an earlier attempt
    const paywalled = pagePaywalled || paywall.isActive(document, site);
    if (paywalled) pagePaywalled = true;
    const live = render.liveStats(document, site);
    // Don't keep the reader behind the wall while archive.today takes its time.
    if (paywalled) lift();
    const status = statusBar.create(document);
    render.removeBanner(document);
    let mirror = archive.DEFAULT_MIRROR;
    try {
      const [saved, current] = await Promise.all([cache.get(articleUrl).catch(() => null), settingsLib.load(chrome.storage.sync)]);
      if (stale()) return;
      mirror = current.mirror;
      if (saved) {
        show(saved);
        announce(status, 'Showing the archived article (saved copy).', 'saved');
        return;
      }

      // Not saved, so this will take a while: tell readers who reach the end of the site's text.
      if (paywalled) placeholder = render.showLoadingPlaceholder(document, site);

      if (!force) {
        const missing = await cache.getMissing(articleUrl).catch(() => null);
        if (stale()) return;
        if (missing) return noSnapshot(status, articleUrl, missing.checkedAt, mirror, paywalled);
      }

      // Pull the article out of a snapshot page: { snapshot, complete }, or null if its text
      // isn't there.
      const read = async (body, snapshotUrl, snapshotTime) => {
        status.stage('extract', 'Pulling out the article text…', { expectedMs: 400 });
        await nextPaint();
        if (stale()) return null;
        const article = extract.extractArticle(new DOMParser().parseFromString(body, 'text/html'), site, { baseUrl: snapshotUrl, articleUrl });
        if (!article || article.paragraphs < extract.MIN_PARAGRAPHS) return null;
        const snapshot = { blocks: article.blocks, snapshotUrl, snapshotTime, chars: article.chars };
        return { snapshot, complete: extract.isComplete(article, live.chars, { paywalled }) };
      };
      const tried = []; // times of the snapshots fetched so far
      let best = null;  // the longest usable snapshot, in case none is complete

      // 1. The newest snapshot, in one request (/newest/). Usually that's all it takes.
      status.stage('download', 'Getting the newest archive.today snapshot…', DOWNLOAD_STAGE);
      explainWhileWaiting(status, articleUrl);
      try {
        const res = await bgFetch(archive.newestUrl(articleUrl, mirror), SNAPSHOT_TIMEOUT_MS);
        if (stale()) return;
        const memento = archive.mementoAt(res.url);
        if (!memento && res.status === 404) {
          cache.putMissing(articleUrl).catch(warnCache);
          return noSnapshot(status, articleUrl, Date.now(), mirror, paywalled);
        }
        if (!memento || res.status !== 200) throw new FixError(`${mirror} answered ${res.status} when asked for the newest snapshot.`);
        tried.push(memento.time);
        const result = await read(res.body, archive.toMirror(memento.url, mirror), memento.time);
        if (stale()) return;
        if (result?.complete) return finishWith(status, articleUrl, result.snapshot, live);
        if (result) best = result.snapshot;
      } catch (e) {
        if (stale()) return;
        if (!(e instanceof FixError) || e.blocked) throw e;
        // The lookup or the snapshot didn't come through: the timemap is a second way in.
        console.warn(`[Read Free] the newest snapshot didn't come through (${e.message}); asking for the list of snapshots instead`);
      }

      // 2. The list of snapshots (the timemap): older ones when the newest was incomplete, or
      // all of them when it didn't come through.
      status.stage('find', tried.length
        ? 'That snapshot was incomplete. Looking for older ones…'
        : 'Asking archive.today for its list of snapshots…', { expectedMs: 1500, slowAfterMs: 8000, slowLabel: 'archive.today is slow to answer. Still waiting…' });
      let mementos = [];
      try {
        const tm = await bgFetch(archive.timemapUrl(articleUrl, mirror), TIMEMAP_TIMEOUT_MS);
        if (stale()) return;
        mementos = tm.status === 200 ? archive.parseTimemap(tm.body) : [];
        if (!mementos.length && !tried.length) {
          if (tm.status !== 200 && tm.status !== 404) throw new FixError(`${mirror} answered ${tm.status} when listing snapshots.`);
          cache.putMissing(articleUrl).catch(warnCache);
          return noSnapshot(status, articleUrl, Date.now(), mirror, paywalled);
        }
      } catch (e) {
        if (stale() || !best) throw e;
        // With a snapshot in hand, offer it below rather than an error.
        console.warn(`[Read Free] couldn't list older snapshots (${e.message})`);
      }

      // Newest first, skipping the one already fetched; at most MAX_ATTEMPTS in all.
      const candidates = archive.newestFirst(mementos, MAX_ATTEMPTS + tried.length)
        .filter(m => !tried.includes(m.time))
        .slice(0, Math.max(0, MAX_ATTEMPTS - tried.length));
      for (const memento of candidates) {
        const snapshotUrl = archive.toMirror(memento.url, mirror);
        const savedAgo = render.relativeTime(memento.time);
        status.stage('download', tried.length === 0
          ? `Waiting for archive.today to send the snapshot (saved ${savedAgo})…`
          : `That snapshot was incomplete. Trying an older one (saved ${savedAgo})…`, DOWNLOAD_STAGE);
        tried.push(memento.time);
        let snap;
        try {
          snap = await bgFetch(snapshotUrl, SNAPSHOT_TIMEOUT_MS);
        } catch (e) {
          if (stale() || !best) throw e;
          break; // keep what we have
        }
        if (stale()) return;
        if (snap.status !== 200) continue;
        const result = await read(snap.body, snapshotUrl, memento.time);
        if (stale()) return;
        if (result?.complete) return finishWith(status, articleUrl, result.snapshot, live);
        if (result && (!best || result.snapshot.chars > best.chars)) best = result.snapshot;
      }

      if (!best) {
        // Captures do fail: WSJ's sometimes come out as an empty page shell.
        throw new FixError(tried.length > 1
          ? `The ${tried.length} newest archive.today snapshots have no article text in them (captures sometimes fail). Archiving the page again on archive.today usually fixes it.`
          : "archive.today's snapshot has no article text in it (captures sometimes fail). Archiving the page again on archive.today usually fixes it.");
      }
      // None looked complete, but the longest still has more text than the page: show it rather
      // than ask. Usually the article is just short, so the wall had already shown most of it
      // (an Atlantic piece of 2.9k characters, 2k of them on the page). It's saved only
      // briefly, in case a fuller snapshot turns up.
      if (best.chars > live.chars) {
        show(best);
        announce(status, 'Showing the longest archive.today snapshot. It may be missing the end.', 'partial');
        cache.put(articleUrl, best, { partial: true }).catch(warnCache);
        return;
      }
      const which = tried.length > 1 ? `The ${tried.length} newest archive.today snapshots look` : 'The archive.today snapshot looks';
      status.finish('error', `${which} incomplete too.`);
      placeholder?.finish('error', `Couldn't load the rest of this article: ${which.charAt(0).toLowerCase()}${which.slice(1)} incomplete too.`, { action: tryAgain });
      showWallIfNothingToRead(paywalled);
      render.showBanner(document, site, {
        kind: 'error',
        message: `${which} incomplete too: the longest has ${best.chars.toLocaleString()} characters, and this page already shows ${live.chars.toLocaleString()}.`,
        links: [{ text: 'View snapshot', href: best.snapshotUrl }],
        actions: [tryAgain, dismiss],
      });
    } catch (e) {
      if (stale()) return;
      console.warn('[Read Free]', e);
      const message = e instanceof FixError ? e.message : `Something went wrong: ${e.message}`;
      status.finish('error', message);
      placeholder?.finish('error', `Couldn't load the rest of this article. ${message}`, { action: tryAgain });
      showWallIfNothingToRead(paywalled);
      render.showBanner(document, site, {
        kind: 'error',
        message,
        links: [{ text: 'Open on archive.today', href: archive.searchUrl(articleUrl, mirror) }],
        actions: [tryAgain, dismiss],
      });
    } finally {
      if (!stale()) loading = false;
    }
  }

  function finishWith(status, articleUrl, snapshot, live) {
    if (snapshot.chars <= live.chars) {
      status.finish('info', 'This page already has the full text. Nothing was replaced.');
      render.showBanner(document, site, {
        kind: 'info',
        message: `This page already has as much text as the snapshot (${live.chars.toLocaleString()} vs ${snapshot.chars.toLocaleString()} characters), so nothing was replaced.`,
        links: [{ text: 'View snapshot', href: snapshot.snapshotUrl }],
        actions: [{ text: 'Use the snapshot anyway', onClick: () => show(snapshot) }, dismiss],
      });
      return;
    }
    show(snapshot);
    announce(status, 'Showing the archived article.', 'swapped');
    cache.put(articleUrl, snapshot).catch(warnCache);
  }

  function noSnapshot(status, articleUrl, checkedAt, mirror, paywalled) {
    const when = Date.now() - checkedAt < 60000 ? '' : ` (checked ${render.relativeTime(checkedAt)})`;
    status.finish('info', `archive.today has no snapshot of this article yet${when}.`);
    placeholder?.finish('info', `archive.today has no snapshot of this article yet${when}, so this is all of it for now.`, { action: { text: 'Check again', onClick: retry } });
    showWallIfNothingToRead(paywalled);
    render.showBanner(document, site, {
      kind: 'info',
      message: `archive.today has no snapshot of this article yet${when}. You can archive it there, then check again.`,
      links: [{ text: 'Archive it on archive.today', href: archive.searchUrl(articleUrl, mirror) }],
      actions: [{ text: 'Check again', onClick: retry }, dismiss],
    });
  }

  // The wall is off: the status bar says so, and (notify.js decides) why this outlet is
  // boycotted and, now and then, the donation link.
  // status: the bar already showing (archive.today), or null to make one if there's anything
  // to say. paid: the wall was a paywall (not NYT's login wall), for the reader's tally.
  function announce(status, message, outcome, { paid = true } = {}) {
    const reason = reasonsLib.reasonFor(site.id);
    const plan = notifyLib.plan(notifyState, { site: site.id, article: site.normalizeUrl(location.href), outcome, reason, tip: settingsLib.tipLink(), paid, explainedHere, alwaysConfirm: prefs?.alwaysConfirm, donated: prefs?.donated });
    remember(plan.next);
    if (!plan.show) {
      status?.remove();
      return;
    }
    const options = notifyLib.barOptions(plan, {
      siteName: site.shortName || site.name,
      reason,
      tally: plan.donate && tallyText(plan.next.months),
      onOpen: () => chrome.runtime.sendMessage({ type: 'nytfix:give' }).catch(() => window.open(plan.donate.href, '_blank', 'noopener')),
      onGive: () => remember(notifyLib.gave(notifyState)),
      onLater: () => remember(notifyLib.later(notifyState)),
    });
    // A copy that may be missing its end: a note, there long enough to read.
    if (outcome === 'partial') options.hideAfterMs = Math.max(options.hideAfterMs, 8000);
    (status || statusBar.create(document)).finish(outcome === 'partial' ? 'info' : 'done', message, options);
  }
  // archive.today takes 8–15 s: the reader is waiting, so this is when to say why (the first
  // time on this outlet).
  function explainWhileWaiting(status, articleUrl) {
    const reason = reasonsLib.reasonFor(site.id);
    if (explainedHere || !notifyLib.explainNow(notifyState, { site: site.id, article: articleUrl, reason })) return;
    status.why(notifyLib.reasonOptions(reason, site.shortName || site.name), { open: true });
    explainedHere = true;
    remember(notifyLib.explained(notifyState, site.id));
  }
  // The reader's tally as one sentence, for the donation link (src/tally.js), or null.
  function tallyText(months) {
    if (!tallyLib) return null;
    const locale = navigator.language;
    const summary = tallyLib.summarize(months, { month: notifyLib.monthOf(Date.now()), currency: tallyLib.currencyFor(locale) });
    return tallyLib.askText(summary, { locale });
  }
  function remember(state) {
    notifyState = state;
    notifyLib.save(chrome.storage.local, state);
  }

  // Start last, once everything above is defined and the settings are in: if a wall is already
  // up, startPage acts on it straight away.
  Promise.all([settingsLib.load(chrome.storage.sync), notifyLib.load(chrome.storage.local)]).then(([loaded, said]) => {
    prefs = loaded;
    notifyState = said;
    // Other tabs keep the record too: stay current with theirs.
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area === 'local' && changes[notifyLib.KEY]) notifyState = notifyLib.normalize(changes[notifyLib.KEY].newValue);
    });
    // Turned off or on elsewhere (the menu reloads the tab it was opened on): this page keeps
    // what it did, and stops acting on its own.
    settingsLib.onChange(chrome.storage, next => { prefs = next; });
    if (siteOn()) startPage();
    else stayOff();
    setInterval(checkNavigation, NAVIGATION_POLL_MS);
  });
})();
