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

  const { archive, extract, render, status: statusBar, paywall, notices, cache: articleCache, scroll: scrollTracker, settings: settingsLib, notify: notifyLib, tally: tallyLib, reasons: reasonsLib, adapter: adapterLib, details: detailsLib, sites = {} } = globalThis.NYTFix;
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
  // After two addresses that took longer than this, together, not to answer, the reader is told,
  // rather than kept waiting for a third request that would most likely go the same way.
  const GIVE_UP_AFTER_MS = 30000;
  const FIND_STAGE = { expectedMs: 1500, slowAfterMs: 8000, slowLabel: 'archive.today is slow to answer. Still waiting…' };
  const DOWNLOAD_STAGE = { expectedMs: 9000, slowAfterMs: 20000, slowLabel: 'archive.today is slow right now. Still waiting…' };
  // How many snapshots to try when newer ones are incomplete. Each can be a cold 8–15 s
  // render on archive.today's side, so keep it small.
  const MAX_ATTEMPTS = 3;
  const NAVIGATION_POLL_MS = 1000;
  const HOLD_PLACE_MS = 1500;
  // After a swap, how long to check that the site hasn't redrawn the article over it.
  const SWAP_GUARD_MS = 30000;
  const SWAP_GUARD_TRIES = 5;
  // After a wall is lifted, how long until the page must be scrollable (wall.failOpen)
  const FROZEN_CHECK_MS = 2500;

  const cache = articleCache.create(chrome.storage.local);
  const incognito = Boolean(chrome.extension?.inIncognitoContext);
  // What an incognito window reads isn't kept on the computer (the settings page lists what is)
  const remembering = incognito ? { put: async () => {}, putMissing: async () => {} } : cache;
  const articleTitle = () => (document.querySelector('meta[property="og:title"]')?.content || document.querySelector('h1')?.textContent || document.title || '').replace(/\s+/g, ' ').trim();
  // The reader's settings (settings.js), loaded before the page is acted on and kept current.
  let prefs = null;
  const siteOn = () => !prefs || settingsLib.isOn(prefs, site.id);
  // What the status bar has said before (notify.js): loaded with the settings, so deciding what
  // to add once a wall is off takes no waiting.
  let notifyState = notifyLib.fresh();
  let explainedHere = false; // the reason was shown on this page, while archive.today loaded
  // A newer version out, as the service worker answers when the page starts (release.notice()),
  // or null: unknown, none, or no answer yet.
  let newer = null;
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
  let stopMissed = () => {};  // a wall that isn't recognized (paywall.watchMissed)
  let missed = null;          // ...and what was seen: 'hidden' (the site's popup), 'cut' (the text), or
                              // 'frozen' / 'stuck' (lifted, but it can't be scrolled; stuck: archived text is in)
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
      sendResponse({ site: site.id, state: pageState(), mark: iconMark?.state || null, restored: userRestored, ...(missed ? { missed, article: site.isArticle(location.pathname), inPage: Boolean(articleInPage()) } : {}) });
      return false;
    }
    if (msg?.type === 'nytfix:checked') {
      onChecked();
      return false;
    }
    // Copy page details (the menu): the page's structure, whatever kind of page it is
    if (msg?.type === 'nytfix:details') {
      sendResponse({ details: detailsLib ? detailsLib.describe(document, site, { version: chrome.runtime.getManifest?.().version || '', browser: settingsLib.browserName(navigator.userAgent), state: pageState(), missed }) : null });
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
    missed = null;
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
    if (!supportedPage()) {
      // Site CSS hides the wall on every page of the site (wall.elsewhere: 'show': NYT)
      if (site.live.wall?.elsewhere === 'show') render.showWall(document);
      return;
    }
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
      if (!loading && !applied() && !userRestored && missed !== 'hidden') activate();
    });
    // Not while archive.today's check is waiting either: its button is in the status bar.
    const free = () => siteOn() && !loading && !applied() && !userRestored && !missed && !checkWaiting;
    stopMissed = paywall.watchMissed(document, site, {
      // Site CSS is hiding something the site would be showing, and nothing here will undo what
      // comes with it: the site's version, rather than a page that's held for no visible reason.
      onHidden: () => { if (free()) showMissed('hidden'); },
      onCut: () => { if (free() && site.isArticle(location.pathname)) showMissed('cut'); },
    });
  }

  // A wall that isn't recognized: say so, and offer what can be done by hand. The status bar is
  // outside the page's content, so it can be used even where the site has made that inert.
  function showMissed(what) {
    missed = what;
    const name = site.shortName || site.name;
    const article = site.isArticle(location.pathname);
    const message = {
      cut: 'This page looks cut off, but Read Free didn\'t recognize a wall.',
      hidden: `${name} put up something Read Free doesn't recognize, so it's been left in place.`,
      frozen: `Read Free couldn't free the scrolling here, so ${name}'s wall is back.`,
      stuck: "The article is in, but Read Free couldn't free the scrolling here.",
    }[what];
    console.info(`[Read Free] missed: ${what}`);
    if (what === 'hidden' || what === 'frozen') render.showWall(document);
    statusBar.create(document).finish('info', message, {
      hideAfterMs: 30000,
      offer: {
        button: what === 'frozen' || what === 'stuck' ? null : !article ? 'Remove it' : articleInPage() ? 'Show the whole article' : 'Load from archive.today',
        onAccept: () => { if (!loading && !applied()) activate({ manual: true }); },
        report: reportLink(message),
      },
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
    stopMissed();
    stopWaiting();
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
    // The reader says it's a wall: the text is held to what a cut page shows (run), and a page with
    // nothing to swap in is let go of.
    const byHand = manual && missed;
    if (byHand) {
      missed = null;
      if (site.isArticle(location.pathname)) pagePaywalled = true;
      else {
        lift();
        markIcon('lifted', `Removed ${site.shortName || site.name}'s wall.`);
        return;
      }
    }
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
      const message = site.live.wall.liftedMessage || (site.isArticle(location.pathname)
        ? 'Removed the login wall. This story is free to read.'
        : `Removed ${site.shortName || site.name}'s wall.`);
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
      if ((wall || byHand) && showFromPage()) return;
      run({ force: manual });
      return;
    }
    // A live blog behind the paywall: there's no full text to show yet, so let the site's wall show.
    if (wall) render.showWall(document);
    if (manual) {
      statusBar.create(document).finish('info', wall
        ? `Pages like this one behind ${site.shortName || site.name}'s paywall aren't supported yet.`
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
    if (site.live.wall?.failOpen) setTimeout(checkFrozen, FROZEN_CHECK_MS, generation);
  }

  // The wall is off, but the page still can't be scrolled: give the site's wall back rather than
  // leave the reader on a page that's held. Once archived text is in, that's worth keeping, so it's
  // only said. While archive.today loads, not yet: run() checks when it's done.
  function checkFrozen(gen) {
    if (gen !== generation || !undoLift || loading || userRestored || !render.frozen(document, site)) return;
    if (undoSwap) {
      showMissed('stuck');
      return;
    }
    undoAll();
    render.removeBanner(document);
    markIcon(null);
    showMissed('frozen');
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
    stopWaiting();
    stopKeeping();
    pageGuard('release');
    userRestored = true;
    markIcon(null);
  }

  // The whole article, if the site's page was sent it (site.live.fromPage): nothing to ask
  // archive.today for. True if it's in.
  function articleInPage() {
    let text = null;
    try { text = site.live.fromPage?.(document) || null; } catch (e) { console.warn('[Read Free]', e); }
    return text && text.chars > render.liveStats(document, site).chars ? text : null;
  }
  function showFromPage() {
    const text = articleInPage();
    if (!text) return false;
    pagePaywalled = true;
    stopWaiting();
    render.removeBanner(document);
    show(text);
    // For the list on the settings page; and it stands in if the page stops sending it
    remembering.put(site.normalizeUrl(location.href), text, { title: articleTitle() }).catch(warnCache);
    announce(null, `Removed ${site.shortName || site.name}'s wall. The whole article was in its page.`, 'page');
    return true;
  }

  // Swap in archived text (lifting the wall first, if it isn't already).
  function show(snapshot, { again = false } = {}) {
    guardPausedUntil = Date.now() + HOLD_PLACE_MS; // apply() keeps the reader's paragraph in place itself
    clearPlaceholder(); // first: apply() then hides the site's subscription line for good
    lift();
    render.hideWall(document); // in case it was shown again after archive.today couldn't help
    undoSwap?.();
    undoSwap = render.apply(document, site, { ...snapshot, onRestore: undo });
    if (snapshot.snapshotUrl) markIcon('swapped', `Showing the article from archive.today, in place of ${site.shortName || site.name}'s paywall.`);
    else markIcon('lifted', `Removed ${site.shortName || site.name}'s paywall. The whole article was in its page.`);
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
  // unreachable: no answer at all from that address (background.js), so another one may do.
  // timedOut: no whole answer in the time it was given.
  // check: the archive.today page that wants a CAPTCHA; own: it asked for it for this article.
  class FixError extends Error {
    constructor(message, { blocked = false, unreachable = false, timedOut = false, check = null, own = false } = {}) {
      super(message);
      this.blocked = blocked;
      this.unreachable = unreachable;
      this.timedOut = timedOut;
      this.check = check;
      this.own = own;
    }
  }
  const noAnswer = hosts => `Couldn't connect to ${hosts.length > 1 ? `archive.today: neither ${hosts.join(' nor ')} answered` : hosts[0]}. It may be down for a moment, or your network may be blocking it. Wait a minute and try again.`;

  const dismiss = { text: 'Dismiss', onClick: () => render.removeBanner(document) };
  // Fetch the article from archive.today again, after a failure (a network hiccup, a slow
  // snapshot, a CAPTCHA completed since) or a "no snapshot yet".
  function retry() {
    if (loading) return;
    render.hideWall(document); // shown again on FT when archive.today couldn't help
    run({ force: true });
  }
  const tryAgain = { text: 'Try again', onClick: retry };

  // archive.today wants a CAPTCHA, which is the reader's to complete: on the snapshot that asked, or
  // for a lookup, on its search page for the article (archive.checkPage: /newest/ shows a visit none
  // when there's no snapshot yet). It may not show one there: it can ask scripts for one and not a page the reader opens (the
  // user's Chrome, 2026-11-25: the article in a tab; a CAPTCHA to a script on that very page, with the
  // same cookies). Then the archived copy is there to read; Read Free doesn't pass its requests off as
  // page visits. If there was one (as on WSJ that day), its cookie goes with Read Free's own requests, so when the reader
  // comes back the article is asked for again, once. A check completed from another article's page
  // counts too: this one sees that when the reader gets to it (nytfix:check).
  // The button is in the status bar too, which stays up: the banner and the note go where the page
  // has room for them (on FT, under its subscription page), but the bar is in the same corner on
  // every site. status: that bar, taken down once there's nothing more to wait for.
  let stopWaiting = () => {};
  let onChecked = () => {};
  let checkWaiting = false;
  function waitForCheck(check, status) {
    stopWaiting();
    checkWaiting = true;
    const gen = generation;
    let opened = false;
    let asking = false;
    const back = async () => {
      if (asking || document.visibilityState === 'hidden') return;
      asking = true;
      // Not opened from here: has it been completed elsewhere?
      const done = opened || (await chrome.runtime.sendMessage({ type: 'nytfix:check', host: new URL(check).hostname }).catch(() => true)) === false;
      asking = false;
      if (!done || gen !== generation || loading || applied() && undoSwap) return;
      stopWaiting();
      retry();
    };
    const events = [[document, 'visibilitychange'], [window, 'focus']];
    for (const [target, name] of events) target.addEventListener(name, back);
    stopWaiting = () => {
      for (const [target, name] of events) target.removeEventListener(name, back);
      status.remove();
      checkWaiting = false;
      onChecked = () => {};
      stopWaiting = () => {};
    };
    // The check's window loaded another page, or was closed (background.js). It can do so more than
    // once; each asks again, unless one is on its way.
    onChecked = () => { if (gen === generation && !loading && !(applied() && undoSwap)) retry(); };
    return {
      text: 'Complete the check',
      onClick: async () => {
        const inWindow = await chrome.runtime.sendMessage({ type: 'nytfix:openCheck', url: check }).catch(() => false);
        if (inWindow) return;
        opened = true;
        window.open(check, '_blank', 'noopener');
      },
    };
  }
  // The background lets the tab being read go first
  document.addEventListener('visibilitychange', () => {
    if (loading) chrome.runtime.sendMessage({ type: 'nytfix:looking', visible: document.visibilityState !== 'hidden' }).catch(() => {});
  });
  const warnCache = e => console.warn('[Read Free] cache error', e);

  // Content scripts can't fetch archive.today cross-origin, so the service worker does it.
  // The service worker can go away mid-request (Chrome restarts it; Read Free reloads for an
  // update, or by hand): "the message channel closed before a response was received", or no
  // answer at all. Asked again once, half a second later, a fresh one answers, and the newest
  // snapshot still comes the quick way. A copy of Read Free that was itself replaced
  // ("Extension context invalidated") can't be helped by asking again: the page needs a reload.
  const BACKGROUND_WENT_AWAY = /message channel (is )?closed|receiving end does not exist|message port closed/i;
  const BACKGROUND_RETRY_MS = 500;
  // force: the reader asked (Try again, or back from a check), so ask even while a check is waiting.
  async function bgFetch(url, timeoutMs, { force = false } = {}) {
    let res;
    for (let attempt = 1; ; attempt++) {
      try {
        res = await chrome.runtime.sendMessage({ type: 'nytfix:fetch', url, timeoutMs, force, visible: document.visibilityState !== 'hidden' });
      } catch (e) {
        if (attempt > 1 || !BACKGROUND_WENT_AWAY.test(e.message)) {
          throw new FixError(`The extension's background worker didn't answer (${e.message}). Reload the page and try again.`);
        }
      }
      if (res || attempt > 1) break;
      console.info("[Read Free] the background worker didn't answer; asking it again");
      await new Promise(resolve => setTimeout(resolve, BACKGROUND_RETRY_MS));
    }
    if (!res) throw new FixError("The extension's background worker didn't answer. Reload the page and try again.");
    const host = new URL(url).hostname;
    const wantsCheck = (check, own) => new FixError(incognito
      ? `${host} wants a CAPTCHA, which Read Free can't get past in ${settingsLib.isFirefox() ? 'a private' : 'an incognito'} window. Read the article on ${host} instead.`
      : `${host} wants a CAPTCHA before it sends Read Free the article. Complete the check in a small window, and the article loads here by itself. If it shows no check, look for the article there.`, { blocked: true, check: archive.checkPage(archive.isArchiveUrl(check) ? check : url), own });
    if (!res.ok) {
      if (res.reason === 'check') throw wantsCheck(res.check, false); // another article's
      if (res.reason) console.info(`[Read Free] ${host}: ${res.error} (${res.reason})`);
      if (res.reason === 'unreachable') throw new FixError(noAnswer([host]), { unreachable: true });
      if (res.reason === 'cut-off') throw new FixError(`The connection to ${host} broke off before the page had arrived. Try again.`);
      throw new FixError(`Couldn't reach ${host}: ${res.error}.`, { timedOut: !res.reason });
    }
    const blocked = archive.looksBlocked(res.status, res.body);
    if (blocked === 'captcha') throw wantsCheck(res.url, true); // the page that asked: often the snapshot, not the lookup
    if (blocked === 'rate-limited') throw new FixError(`${host} is rate-limiting requests. Wait a minute and try again.`, { blocked: true });
    return res;
  }

  // Let the browser paint the status bar before a long synchronous step.
  const nextPaint = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

  // force: skip the remembered "no snapshot yet" answer (toolbar click, "Check again").
  async function run({ force = false } = {}) {
    loading = true;
    stopWaiting();
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
        announce(status, saved.snapshotUrl ? 'Showing the archived article (saved copy).' : 'Showing the saved article.', 'saved');
        return;
      }

      // Not saved, so this will take a while: tell readers who reach the end of the site's text.
      if (paywalled) placeholder = render.showLoadingPlaceholder(document, site);

      if (!force) {
        const missing = await cache.getMissing(articleUrl).catch(() => null);
        if (stale()) return;
        if (missing) return noSnapshot(status, articleUrl, missing.checkedAt, mirror, paywalled);
      }

      // Ask archive.today. addressOf: the page's address, given a mirror. If the mirror in use
      // can't be connected to at all, a second one is asked, once, and the rest goes there too.
      // Seen 2026-11-25: for minutes at a time, connections to archive.ph closed after 20 s
      // without an answer. Not for a slow answer (every address has the same server behind it) or
      // a CAPTCHA (that's for the reader to complete, not to go around).
      const unanswered = [];
      const startedAt = Date.now();
      const ask = async (stage, addressOf, timeoutMs) => {
        try {
          return await bgFetch(addressOf(mirror), timeoutMs, { force });
        } catch (e) {
          // With neither address answering, a list that times out is one more not answering.
          if (e.timedOut && unanswered.length > 1) throw new FixError(noAnswer(unanswered), { unreachable: true });
          if (!e.unreachable || stale()) throw e;
          const first = mirror;
          if (!unanswered.includes(first)) unanswered.push(first);
          if (unanswered.length > 1) throw new FixError(noAnswer(unanswered), { unreachable: true });
          mirror = archive.secondMirror(first);
          console.info(`[Read Free] trying ${mirror} instead`);
          status.stage(stage, `${first} didn't answer. Trying ${mirror}…`, stage === 'find' ? FIND_STAGE : DOWNLOAD_STAGE);
          try {
            return await bgFetch(addressOf(mirror), timeoutMs, { force });
          } catch (again) {
            if (!again.unreachable) throw again;
            unanswered.push(mirror);
            mirror = first; // the reader's own choice, for what's left and for the banner's link
            throw new FixError(noAnswer(unanswered), { unreachable: true });
          }
        }
      };

      // Pull the article out of a snapshot page: { snapshot, complete }, or null if its text
      // isn't there.
      const read = async (body, snapshotUrl, snapshotTime) => {
        status.stage('extract', 'Pulling out the article text…', { expectedMs: 400 });
        await nextPaint();
        if (stale()) return null;
        const article = extract.extractArticle(new DOMParser().parseFromString(body, 'text/html'), site, { baseUrl: snapshotUrl, articleUrl });
        if (!article || article.paragraphs < extract.MIN_PARAGRAPHS) return null;
        const snapshot = { blocks: article.blocks, snapshotUrl, snapshotTime, chars: article.chars, ...(article.left ? { left: article.left, leftAs: article.leftAs } : {}) };
        return { snapshot, complete: extract.isComplete(article, live.chars, { paywalled }) };
      };
      const tried = []; // times of the snapshots fetched so far
      let best = null;  // the longest usable snapshot, in case none is complete

      // 1. The newest snapshot, in one request (/newest/). Usually that's all it takes.
      status.stage('download', 'Getting the newest archive.today snapshot…', DOWNLOAD_STAGE);
      explainWhileWaiting(status, articleUrl);
      try {
        const res = await ask('download', m => archive.newestUrl(articleUrl, m), SNAPSHOT_TIMEOUT_MS);
        if (stale()) return;
        const memento = archive.mementoAt(res.url);
        if (!memento && res.status === 404) {
          remembering.putMissing(articleUrl).catch(warnCache);
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
        if (e.unreachable && Date.now() - startedAt > GIVE_UP_AFTER_MS) throw e;
        // The lookup or the snapshot didn't come through: the timemap is a second way in.
        console.info(`[Read Free] the newest snapshot didn't come through (${e.message}); asking for the list of snapshots instead`);
      }

      // 2. The list of snapshots (the timemap): older ones when the newest was incomplete, or
      // all of them when it didn't come through.
      status.stage('find', tried.length
        ? 'That snapshot was incomplete. Looking for older ones…'
        : 'Asking archive.today for its list of snapshots…', FIND_STAGE);
      let mementos = [];
      try {
        const tm = await ask('find', m => archive.timemapUrl(articleUrl, m), TIMEMAP_TIMEOUT_MS);
        if (stale()) return;
        mementos = tm.status === 200 ? archive.parseTimemap(tm.body) : [];
        if (!mementos.length && !tried.length) {
          if (tm.status !== 200 && tm.status !== 404) throw new FixError(`${mirror} answered ${tm.status} when listing snapshots.`);
          remembering.putMissing(articleUrl).catch(warnCache);
          return noSnapshot(status, articleUrl, Date.now(), mirror, paywalled);
        }
      } catch (e) {
        if (stale() || !best) throw e;
        // With a snapshot in hand, offer it below rather than an error.
        console.info(`[Read Free] couldn't list older snapshots (${e.message})`);
      }

      // Newest first, skipping the one already fetched; at most MAX_ATTEMPTS in all.
      const candidates = archive.newestFirst(mementos, MAX_ATTEMPTS + tried.length)
        .filter(m => !tried.includes(m.time))
        .slice(0, Math.max(0, MAX_ATTEMPTS - tried.length));
      for (const memento of candidates) {
        const savedAgo = render.relativeTime(memento.time);
        status.stage('download', tried.length === 0
          ? `Waiting for archive.today to send the snapshot (saved ${savedAgo})…`
          : `That snapshot was incomplete. Trying an older one (saved ${savedAgo})…`, DOWNLOAD_STAGE);
        tried.push(memento.time);
        let snap;
        try {
          snap = await ask('download', m => archive.toMirror(memento.url, m), SNAPSHOT_TIMEOUT_MS);
        } catch (e) {
          if (stale() || !best) throw e;
          break; // keep what we have
        }
        if (stale()) return;
        if (snap.status !== 200) continue;
        const result = await read(snap.body, archive.toMirror(memento.url, mirror), memento.time);
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
        remembering.put(articleUrl, best, { partial: true, title: articleTitle() }).catch(warnCache);
        return;
      }
      const which = tried.length > 1 ? `The ${tried.length} newest archive.today snapshots look` : 'The archive.today snapshot looks';
      status.finish('error', `${which} incomplete too.`);
      placeholder?.finish('error', `Couldn't load the rest of this article: ${which.charAt(0).toLowerCase()}${which.slice(1)} incomplete too.`, { action: tryAgain });
      showWallIfNothingToRead(paywalled);
      render.showBanner(document, site, {
        kind: 'error',
        message: `${which} incomplete too: the longest has ${best.chars.toLocaleString()} characters, and this page already shows ${live.chars.toLocaleString()}.`,
        links: [{ text: 'View snapshot', href: best.snapshotUrl }, reportLink(`${which} incomplete too.`)],
        actions: [tryAgain, dismiss],
      });
    } catch (e) {
      if (stale()) return;
      // Shown in the banner already; Chrome's Errors page is kept for real faults (an exception
      // that isn't a FixError still says so there)
      if (e instanceof FixError) console.info('[Read Free]', e.message);
      else console.warn('[Read Free]', e);
      const message = e instanceof FixError ? e.message : `Something went wrong: ${e.message}`;
      const captcha = e instanceof FixError && e.check;
      // In an incognito window a check doesn't count for Read Free's requests (they go with the
      // regular window's cookies), so there's only reading it there. The snapshot that asked, if it
      // was this article's; else the newest.
      const page = captcha && incognito ? (e.own && archive.mementoAt(e.check) ? e.check : archive.newestUrl(articleUrl, mirror)) : null;
      const readThere = page ? { text: `Open it on ${mirror}`, href: page } : null;
      const check = captcha && !readThere ? waitForCheck(e.check, status) : null;
      status.finish('error', message, check || readThere ? { action: check || readThere } : {});
      placeholder?.finish('error', `Couldn't load the rest of this article. ${message}`, { action: check || (readThere ? { text: readThere.text, onClick: () => window.open(page, '_blank', 'noopener') } : tryAgain) });
      showWallIfNothingToRead(paywalled);
      render.showBanner(document, site, {
        kind: 'error',
        message,
        links: check ? [reportLink(message)] : [readThere || { text: 'Open on archive.today', href: archive.searchUrl(articleUrl, mirror) }, reportLink(message)],
        actions: check ? [check, tryAgain, dismiss] : [tryAgain, dismiss],
      });
    } finally {
      if (!stale()) {
        loading = false;
        if (site.live.wall?.failOpen) setTimeout(checkFrozen, FROZEN_CHECK_MS, gen);
      }
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
    remembering.put(articleUrl, snapshot, { title: articleTitle() }).catch(warnCache);
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
    const plan = notifyLib.plan(notifyState, { site: site.id, article: site.normalizeUrl(location.href), outcome, reason, tip: settingsLib.tipLink(), paid, explainedHere, quiet: prefs?.quiet, donated: prefs?.donated, newer });
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
  // "Report a problem" in an error banner (settings.reportLink): an email the reader writes and
  // sends themself, with what happened, the outlet and the versions; never the article's address.
  function reportLink(what) {
    const report = settingsLib.reportLink({ outlet: site.name, what, version: chrome.runtime.getManifest?.().version || '', browser: settingsLib.browserName(navigator.userAgent) });
    return { text: 'Report a problem', href: report.href, title: `Email ${report.address}` };
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

  // A newer version out (for copies loaded by hand), from what the service worker already knows
  // (src/release.js): nothing is fetched from here. Asked once, without holding the page up; if
  // the answer hasn't come by the time a wall comes off, the status bar just doesn't mention it.
  try {
    Promise.resolve(chrome.runtime.sendMessage({ type: 'nytfix:newer' })).then(answer => { newer = answer?.version ? answer : null; }, () => {});
  } catch {
    // The extension was reloaded under this page: nothing to ask
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
