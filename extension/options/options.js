// Read Free's settings page: the reader's tally (src/tally.js), on or off for each site and for
// all of them, which archive.today address to use, clearing saved articles, and the donation link
// with "I've donated" (shown only when settings.TIP_URL is set).
(async function () {
  'use strict';
  const { archive, settings, cache: articleCache, ui, notify, tally, access } = globalThis.NYTFix;
  const sync = chrome.storage.sync;
  const cache = articleCache.create(chrome.storage.local);
  const $ = id => document.getElementById(id);

  const flash = (el, text) => {
    el.textContent = text;
    clearTimeout(el.flashTimer);
    el.flashTimer = setTimeout(() => { el.textContent = ''; }, 1500);
  };

  $('version').textContent = `v${chrome.runtime.getManifest().version}`;

  // Firefox: addresses it hasn't let Read Free work on. Asking has to be the first thing the click
  // does, so they're looked up beforehand.
  let toAllow = [];
  async function showAccess() {
    toAllow = await access.missing(chrome);
    if (!toAllow.length) return;
    const one = toAllow.length === 1;
    $('access-text').textContent = `Firefox isn't letting Read Free work on ${access.names(toAllow)}. It doesn't ask about sites an update adds; or ${one ? 'it was' : 'they were'} turned off in Firefox's add-on settings.`;
    $('access-allow').textContent = one ? 'Allow it' : 'Allow them';
    $('access').hidden = false;
    await access.see(toAllow, chrome.storage.local);
  }
  $('access-allow').addEventListener('click', () => {
    chrome.permissions.request({ origins: toAllow }).then(async granted => {
      if (!granted) return;
      await showAccess();
      if (toAllow.length) return;
      $('access-allow').hidden = true;
      $('access-status').textContent = 'Allowed. Reload any of their pages you have open.';
    }).catch(e => { $('access-status').textContent = `Firefox said no: ${e.message}`; });
  });
  showAccess().catch(() => {});

  let prefs = await settings.load(sync);

  // Sites: one switch each, and one for all of them. Turned off everywhere, each site keeps its
  // own setting for when it comes back on.
  const sites = Object.values(await ui.loadSites().catch(() => ({}))).filter(s => s.live).sort(ui.byName);
  $('site-count').textContent = sites.length ? String(sites.length) : '';
  const list = $('sites');
  const switches = new Map();
  for (const site of sites) {
    const item = document.createElement('li');
    const label = document.createElement('label');
    const name = document.createElement('span');
    name.className = 'name';
    const host = document.createElement('span');
    host.className = 'host';
    host.textContent = site.hosts.find(h => !h.startsWith('*.'))?.replace(/^www\./, '') || site.hosts[0].replace(/^\*\./, '');
    name.append(site.name, host);
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.setAttribute('role', 'switch');
    toggle.className = 'nf-switch';
    toggle.setAttribute('aria-label', site.name);
    toggle.addEventListener('change', async () => { prefs = await settings.setSite(sync, site.id, toggle.checked); show(); });
    label.append(name, toggle);
    item.append(label);
    list.append(item);
    switches.set(site.id, toggle);
  }
  // Your boycott: this month and since the tally began, then this month's outlets
  const locale = navigator.language;
  const currency = tally.currencyFor(locale);
  const names = new Map(sites.map(site => [site.id, site.name]));
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  async function showTally() {
    const { months } = await notify.load(chrome.storage.local);
    const view = tally.dashboard(tally.summarize(months, { month: notify.monthOf(Date.now()), currency }), { locale });
    $('tally-empty').hidden = Boolean(view);
    $('tally-body').hidden = !view;
    if (!view) return;
    // The one number that leads: what this month's reading would have cost
    const when = view.hero.since ? `since ${view.since.from}` : `in ${view.month}`;
    $('hero-eyebrow').textContent = `${view.hero.cost ? 'Withheld' : 'Read'} ${when}`;
    $('hero-value').textContent = view.hero.value;
    $('hero-note').textContent = view.hero.cost ? 'roughly what subscribing would have cost' : `article${view.hero.value === '1' ? '' : 's'}, none of them paid for`;
    const stat = (label, value, detail) => {
      const box = el('div', 'stat');
      const dd = el('dd', '', value);
      if (detail) dd.append(el('span', 'detail', detail));
      box.append(el('dt', '', label), dd);
      return box;
    };
    const stats = [stat('Articles', view.articles), stat('Outlets', view.outlets)];
    if (view.since && !view.hero.since) stats.push(stat(view.since.label, view.since.value || view.since.articles, view.since.value ? `${view.since.articles} articles` : 'articles'));
    $('stats').replaceChildren(...stats);
    // Give it to UNRWA; or some of it to the project
    const aid = settings.aidLink();
    if (aid) {
      $('give-aid').href = aid.href;
      $('give-aid').textContent = view.hero.cost ? `Donate ${view.hero.value} to ${aid.name}` : `Donate to ${aid.name}`;
    }
    $('give-aid').hidden = !aid;
    $('give-note').hidden = !aid;
    const tip = settings.tipLink();
    if (tip) $('give-project').href = `../${settings.GIVE_PAGE}`;
    $('give-project').hidden = !tip;
    // This month's outlets, the most expensive first, each with a bar for its cost
    $('outlets-head').textContent = `${view.month}'s outlets`;
    $('outlets-head').hidden = !view.rows.length;
    $('tally-sites').replaceChildren(...view.rows.map(row => {
      const item = el('li');
      const name = el('span', 'name', names.get(row.id) || row.id);
      const read = el('span', 'read', `${row.read} ${row.read === 1 ? 'article' : 'articles'}`);
      // A bar only for an outlet with a cost: none for one with no price (it isn't zero)
      const bar = el('span', 'bar');
      bar.setAttribute('aria-hidden', 'true');
      if (row.value) {
        const fill = el('span', 'fill');
        fill.style.width = `${Math.max(row.share * 100, 2)}%`;
        bar.append(fill);
      } else {
        bar.classList.add('empty');
      }
      const cost = el('span', 'cost');
      if (row.value) {
        cost.append(el('strong', '', row.value), el('span', 'per', '/mo'));
        const source = tally.PRICES[row.id]?.source;
        if (source) {
          const link = el('a', 'source', '\u2197');
          link.href = source;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.title = `Where this price comes from (checked ${tally.PRICES[row.id].checked})`;
          link.setAttribute('aria-label', `Where ${names.get(row.id) || row.id}'s price comes from`);
          cost.append(link);
        }
      } else {
        cost.classList.add('none');
        cost.textContent = row.note;
      }
      item.title = row.value ? `${names.get(row.id) || row.id}: ${row.value} a month, ${row.read} ${row.read === 1 ? 'article' : 'articles'}` : `${names.get(row.id) || row.id}: ${row.note}`;
      item.append(name, bar, read, cost);
      return item;
    }));
  }
  const ratesDate = tally.RATES_DATE && new Date(`${tally.RATES_DATE}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  $('tally-dates').textContent = ratesDate ? `, converted at the rates of ${ratesDate}` : '';
  await showTally();
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area === 'local' && changes[notify.KEY]) showTally();
  });

  $('all-switch').addEventListener('change', async event => { prefs = await settings.save(sync, { enabled: event.target.checked }); show(); });
  function show() {
    $('all-switch').checked = prefs.enabled;
    if ($('confirm-switch')) $('confirm-switch').checked = !prefs.quiet;
    if ($('donated-switch')) $('donated-switch').checked = prefs.donated;
    list.classList.toggle('all-off', !prefs.enabled);
    for (const [id, toggle] of switches) {
      toggle.checked = !prefs.disabledSites.includes(id);
      toggle.disabled = !prefs.enabled;
    }
  }
  show();
  // Changed in the toolbar menu while this page is open
  settings.onChange(chrome.storage, next => { prefs = next; show(); });

  // Notifications
  const confirm = $('confirm-switch');
  confirm.checked = !prefs.quiet;
  confirm.addEventListener('change', async () => { prefs = await settings.save(sync, { quiet: !confirm.checked }); });
  $('reasons-again').addEventListener('click', async () => {
    const local = chrome.storage.local;
    await notify.save(local, notify.startOver(await notify.load(local)));
    flash($('reasons-status'), 'Done');
  });

  // archive.today address
  const select = $('mirror');
  for (const mirror of archive.MIRRORS) select.append(new Option(mirror, mirror));
  select.value = prefs.mirror;
  select.addEventListener('change', async () => {
    prefs = await settings.save(sync, { mirror: select.value });
    flash($('mirror-status'), 'Saved');
  });

  // Saved articles
  const clear = $('clear');
  const size = bytes => (bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);
  const showCount = async () => {
    const { articles: n, bytes } = await cache.usage();
    clear.textContent = n ? `Clear ${n} saved article${n === 1 ? '' : 's'} (${size(bytes)})` : 'No saved articles';
    clear.disabled = n === 0;
  };
  clear.addEventListener('click', async () => {
    await cache.clear();
    await showCount();
    flash($('clear-status'), 'Cleared');
  });
  await showCount();

  // Donation link, and "I've donated" (on trust: the status bar stops offering the link)
  const tip = settings.tipLink();
  if (tip) {
    $('tip-link').href = `../${settings.GIVE_PAGE}`;
    $('tip').hidden = false;
  }
  const donated = $('donated-switch');
  donated.checked = prefs.donated;
  donated.addEventListener('change', async () => { prefs = await settings.save(sync, { donated: donated.checked }); });
})();
