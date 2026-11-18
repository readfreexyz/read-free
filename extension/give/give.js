// The donation page, inside the extension. With a tally that has a cost, two steps: what the
// reader withheld, most of it to UNRWA (settings.aidLink); then some of it to Read Free. Without
// one, just the second. Opened from the toolbar menu, the settings page and the status bar.
// The ways to give Read Free come from src/donations.js: the list kept from Read Free's site (or
// the built-in link) at once, then the site's current one if it changed. When the first is a
// Ko-fi page, it's Ko-fi's own panel; the rest are links. An empty list: donations are paused,
// and only UNRWA is offered. The services are loaded only here, and given nothing about the
// reader.
(async function () {
  'use strict';
  const { settings, notify, tally, donations } = globalThis.NYTFix;
  const $ = id => document.getElementById(id);
  const local = chrome.storage.local;
  const keepWhole = name => name.replace(/-/g, '‑'); // "Ko-fi" on one line
  const heading = { title: $('title').textContent, lede: $('lede').textContent.replace(/\s+/g, ' ').trim() };
  const aid = settings.aidLink();

  // What the reader withheld (src/tally.js), and where most of it belongs
  const record = await notify.load(local);
  let withheld = null;
  try {
    const locale = navigator.language;
    const view = tally.dashboard(tally.summarize(record.months, { month: notify.monthOf(Date.now()), currency: tally.currencyFor(locale) }), { locale });
    if (view?.hero.cost && aid) withheld = view;
  } catch { /* no tally: just the ways to give */ }

  function wayItem(way) {
    const item = document.createElement('li');
    const link = Object.assign(document.createElement('a'), { className: 'way', href: way.href, target: '_blank', rel: 'noopener noreferrer' });
    const part = (className, text) => Object.assign(document.createElement('span'), { className, textContent: text });
    link.append(part('way-name', keepWhole(way.name)));
    if (way.note) link.append(part('way-note', way.note));
    const go = part('way-go', '↗');
    go.setAttribute('aria-hidden', 'true');
    link.append(go);
    item.append(link);
    return item;
  }

  function paint(list) {
    const { panel, links, none } = donations.view(list);
    const twoSteps = Boolean(withheld) && !none;
    document.body.classList.toggle('two-steps', twoSteps);

    if (withheld) {
      const value = withheld.hero.value;
      $('title').textContent = `Put the ${value} to work`;
      $('lede').textContent = `${withheld.hero.since ? `Since ${withheld.since.from}, you` : 'This month you'} read about ${value} worth of subscriptions without paying the outlets. Here's where it can go instead.`;
    } else if (none) {
      $('title').textContent = "Read Free isn't taking donations right now";
      $('lede').textContent = aid ? `Thank you for thinking of it. If you'd like to give, give to Palestinians through ${aid.name}.` : 'Thank you for thinking of it.';
    } else {
      $('title').textContent = heading.title;
      $('lede').textContent = heading.lede;
    }

    // 1. UNRWA
    $('aid-step').hidden = !withheld;
    if (withheld) {
      $('withheld-value').textContent = withheld.hero.value;
      $('withheld-label').textContent = withheld.hero.since ? `withheld since ${withheld.since.from}, roughly` : 'withheld this month, roughly';
      $('aid').href = aid.href;
      $('aid').textContent = `Donate ${withheld.hero.value} to ${aid.name} ↗`;
    }

    // 2. Read Free
    $('tip-step').hidden = none;
    $('tip-head').textContent = twoSteps ? 'Some of it: Read Free' : 'Give to Read Free';
    const frame = $('kofi');
    $('panel').hidden = !panel;
    $('fallback').hidden = !panel;
    if (panel) {
      if (frame.getAttribute('src') !== panel.embed) frame.src = panel.embed;
      frame.title = `Donate to Read Free on ${panel.name}`;
      $('panel-link').href = panel.href;
      $('panel-link').textContent = `Open Read Free on ${keepWhole(panel.name)} ↗`;
    } else if (frame.getAttribute('src')) {
      frame.src = 'about:blank';
    }
    $('others').hidden = !(panel && links.length);
    $('ways').hidden = Boolean(panel) || !links.length;
    $(panel ? 'others-list' : 'ways').replaceChildren(...links.map(wayItem));
    $(panel ? 'ways' : 'others-list').replaceChildren();
    const who = panel ? keepWhole(panel.name) : links.length === 1 ? keepWhole(links[0].name) : 'them';
    $('privacy').textContent = (panel
      ? `${who}'s panel loads only on this page, and Read Free tells it nothing: not what you read, not what you withheld. Payments go through ${who}.`
      : `Read Free tells ${who} nothing: not what you read, not what you withheld.`)
      + (settings.DONATIONS_URLS.length ? " This list comes from Read Free's website; fetching it sends nothing about your reading." : '');

    // Nothing to give Read Free: say so, and point to UNRWA if step 1 doesn't already
    $('paused').hidden = !none;
    $('paused-text').hidden = !withheld;
    $('paused-aid').hidden = Boolean(withheld) || !aid;
    if (aid) {
      $('paused-aid').href = aid.href;
      $('paused-aid').textContent = `Donate to ${aid.name} ↗`;
    }
  }

  let shown = (await donations.load(local)) || donations.builtIn();
  try { paint(shown); } catch (e) { console.warn('[Read Free] donation page:', e); }

  // Coming here counts as clicking through to donate: the status bar stops asking for half a year
  await notify.save(local, notify.gave(record));

  // The current list from Read Free's site, if it changed since it was kept
  const fresh = await donations.refresh(local).catch(() => null);
  if (fresh && !donations.same(fresh, shown)) {
    shown = fresh;
    paint(fresh);
  }
})();
