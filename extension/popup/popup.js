// The toolbar menu: what Read Free did on this tab, a button to undo it (or run it by hand),
// the reader's tally, switches for this site and for all sites, the settings, and the donation
// link. Its words come from view.js and tally.js; the page's state from the tab's content
// script ('nytfix:state').
(async function () {
  'use strict';
  const { settings, ui, popupView, notify, reasons, tally, release } = globalThis.NYTFix;
  const sync = chrome.storage.sync;
  const $ = id => document.getElementById(id);

  $('version').textContent = `v${chrome.runtime.getManifest().version}`;
  const tip = settings.tipLink();
  const givePage = chrome.runtime.getURL(settings.GIVE_PAGE);
  if (tip) {
    $('donate').href = givePage;
    $('donate-text').textContent = tip.text;
    $('donate').hidden = false;
  }
  // A newer version is out (src/release.js): what's known at once, then a check at most daily
  const running = chrome.runtime.getManifest().version;
  const showNewer = record => {
    const newer = release.notice(record, running);
    if (!newer) return;
    $('newer').href = newer.href;
    $('newer-text').textContent = newer.text;
    $('newer').hidden = false;
  };
  release.load(chrome.storage.local).then(showNewer);
  release.refresh(chrome.storage.local).then(showNewer).catch(() => {});

  $('settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let url = null;
  try { url = tab?.url ? new URL(tab.url) : null; } catch { /* not a URL we can read */ }
  const sites = await ui.loadSites().catch(() => ({}));
  const site = url?.protocol === 'https:' ? ui.siteForHost(sites, url.hostname) : null;
  let prefs = await settings.load(sync);

  // Why this outlet is boycotted (reasons.js), with its source
  const why = site && notify.reasonOptions(reasons.reasonFor(site.id), site.shortName || site.name);
  if (why) {
    $('why-head').textContent = why.heading;
    $('why-text').textContent = why.text;
    $('why-source').textContent = `${why.source.name}, ${why.source.year} \u2197`;
    $('why-source').href = why.source.href;
    $('why').hidden = false;
  }
  // The reader's tally (src/tally.js): this month, and since it began
  const locale = navigator.language;
  const record = await notify.load(chrome.storage.local);
  const view = tally.dashboard(tally.summarize(record.months, { month: notify.monthOf(Date.now()), currency: tally.currencyFor(locale) }), { locale });
  if (view) {
    // Nothing yet this month: since the tally began leads instead
    const lead = view.hero.since ? { articles: view.since.articles, outlets: view.since.outlets, when: `since ${view.since.from}` } : { articles: view.articles, outlets: view.outlets, when: 'this month' };
    $('tally-head').textContent = `${view.hero.cost ? 'Withheld' : 'Read'} ${lead.when}`;
    $('tally-value').textContent = view.hero.value;
    $('tally-note').textContent = view.hero.cost ? 'Roughly what subscribing would have cost.' : 'None of them paid for.';
    $('tally-articles').textContent = lead.articles;
    $('tally-articles-label').textContent = lead.articles === '1' ? 'article' : 'articles';
    $('tally-outlets').textContent = lead.outlets;
    $('tally-outlets-label').textContent = lead.outlets === '1' ? 'outlet' : 'outlets';
    // Give it to UNRWA; or some of it to the project (which then needn't be in the footer too)
    const aid = settings.aidLink();
    if (aid) {
      $('tally-aid').href = aid.href;
      $('tally-aid').textContent = view.hero.cost ? `Donate ${view.hero.value} to ${aid.name}` : `Donate to ${aid.name}`;
      $('tally-aid').hidden = false;
    }
    if (tip) {
      $('tally-project').href = givePage;
      $('tally-project').hidden = false;
      $('donate').hidden = true;
    }
    if (view.since && !view.hero.since) {
      $('tally-since').textContent = `${view.since.label}: ${view.since.value ? `${view.since.value} withheld, ` : ''}${view.since.articles} articles`;
      $('tally-since').hidden = false;
    }
    $('tally').hidden = false;
  }
  let page = null;
  let reloading = false;
  let poll = null;

  const ask = async () => {
    try {
      return await chrome.tabs.sendMessage(tab.id, { type: 'nytfix:state' });
    } catch {
      return null; // no content script here
    }
  };

  function render() {
    const view = popupView.describe({ url, site, page, prefs, reloading });
    $('site-name').textContent = view.title;
    $('site-host').textContent = view.sub && view.sub !== view.title ? view.sub : '';
    $('state').dataset.tone = view.tone;
    $('state-text').textContent = view.text;
    const button = $('action');
    button.hidden = !view.action;
    if (view.action) {
      button.textContent = view.action.label;
      button.dataset.action = view.action.id;
      button.classList.toggle('nf-primary', view.action.primary);
      button.disabled = false;
    }
    $('site-row').hidden = !site;
    if (site) {
      $('site-short').textContent = site.shortName || site.name;
      $('site-switch').checked = !prefs.disabledSites.includes(site.id);
      $('site-switch').disabled = !prefs.enabled;
    }
    $('all-switch').checked = prefs.enabled;
    // While archive.today loads, look again every half second.
    clearTimeout(poll);
    if (page?.state === 'loading') poll = setTimeout(refresh, 500);
  }

  async function refresh() {
    page = site ? await ask() : null;
    render();
  }

  // A switch changed. If it's about this tab's site, reload the tab, so the page is acted on (or
  // left as the site sends it) from the start; the menu stays open and shows the result.
  async function changed(next) {
    prefs = next;
    if (site) {
      reloading = true;
      render();
      await chrome.tabs.reload(tab.id).catch(() => { reloading = false; });
    }
    render();
  }
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (tabId !== tab?.id || info.status !== 'complete' || !reloading) return;
    reloading = false;
    refresh();
  });

  $('site-switch').addEventListener('change', async event => {
    changed(await settings.setSite(sync, site.id, event.target.checked));
  });
  $('all-switch').addEventListener('change', async event => {
    changed(await settings.save(sync, { enabled: event.target.checked }));
  });

  $('action').addEventListener('click', async () => {
    const button = $('action');
    button.disabled = true;
    if (button.dataset.action === 'reload') {
      reloading = true;
      render();
      await chrome.tabs.reload(tab.id).catch(() => {});
      return;
    }
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'nytfix:toggle' });
    } catch { /* the page went away */ }
    await refresh();
  });

  await refresh();
})();
