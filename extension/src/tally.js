// The reader's tally, and roughly what subscribing would have cost. notify.js counts the
// articles ({ 'YYYY-MM': { id: { read, paid } } }, months in the reader's time zone); this turns
// them into figures and words for the toolbar menu, the settings page and the donation link.
// The cost: an outlet read behind its paywall in a month counts its cheapest digital
// subscription for that month, once, however many articles it was. At the regular price, not
// the introductory offer, converted to the reader's currency at fixed rates. An outlet with no
// price found isn't counted (and is named as such): approximate, but never a guess.
// Like the rest of the record, none of it leaves the browser.
(function (root) {
  'use strict';

  // Each outlet's cheapest digital subscription that unlocks its paywalled articles, at the
  // regular price (as sold in its home market where a source says so). per: the billing period.
  //   { amount, currency, per: 'month' | '4 weeks' | 'week' | 'year', plan, source, checked }
  // Each figure is one its source page states, read there on the date given (checked). Most
  // outlets' own pricing pages won't load for a script, so most come from trade press, price
  // trackers and app stores. An outlet that isn't here has no price we'd stand behind (UNPRICED
  // says why); it's never counted.
  const P = (amount, currency, per, plan, source, checked = '2026-11-17') => Object.freeze({ amount, currency, per, plan, source, checked });
  const PRICES = Object.freeze({
    // US
    nyt: P(16, 'USD', '4 weeks', 'All Access', 'https://www.nytimes.com/subscription'), // NYT's own page, after the introductory months; it may show other countries' visitors other prices
    wsj: P(38.99, 'USD', '4 weeks', 'WSJ Digital', 'https://www.thepricer.org/how-much-does-wsj-subscription-cost/'),
    atlantic: P(79.99, 'USD', 'year', 'Digital', 'https://subger.com/en/service/atlantic'),
    newyorker: P(119.99, 'USD', 'year', 'Digital', 'https://www.thepricer.org/how-much-does-new-yorker-subscription-cost/'), // the app-store price
    latimes: P(16, 'USD', '4 weeks', 'Digital', 'https://www.thepricer.org/how-much-does-an-la-times-subscription-cost/'),
    cnn: P(6.99, 'USD', 'month', 'All Access', 'https://www.thewrap.com/cnn-streaming-service-price-launch-date/'),
    reuters: P(1, 'USD', 'week', 'Digital', 'https://pressgazette.co.uk/paywalls/reuters-cnn-paywalls-digital-subscriptions/'), // no introductory offer
    // Canada
    globeandmail: P(31.96, 'CAD', '4 weeks', 'Digital All Access', 'https://subger.com/en/us/service/the-globe-and-mail'),
    thestar: P(27.98, 'CAD', 'month', 'Digital', 'https://moneygenius.ca/personal-finance/newspapers/toronto-star'), // the page is from 2024
    // UK
    ft: P(468, 'GBP', 'year', 'Standard Digital', 'https://pressgazette.co.uk/media-audience-and-business-data/news-subcriptions-prices-2026/'),
    dailymail: P(6.99, 'GBP', 'month', 'Mail+', 'https://pressgazette.co.uk/media-audience-and-business-data/news-subcriptions-prices-2026/'),
    independent: P(5.99, 'GBP', 'month', 'Independent Premium', 'https://subger.com/en/gb/service/independent-premium'), // its table; its text says £6.99
    spectator: P(99.99, 'GBP', 'year', 'Digital', 'https://pressgazette.co.uk/paywalls/uk-digital-news-subscriptions-cost-2025/'),
    // Europe
    abces: P(110, 'EUR', 'year', 'ABC Premium', 'https://www.ocu.org/reclamar/lista-reclamaciones-publicas/renovaci-C3-B3n-de-suscripci-C3-B3n/e787d66c8148a58773'), // what a renewal was charged (a consumer complaint)
    corriere: P(9.99, 'EUR', 'month', 'Digitale', 'https://subger.com/it/service/corriere-della-sera'),
    lalibre: P(198, 'EUR', 'year', 'Numérique+', 'https://www.student.be/fr/only-for-students/30-de-reduction-pour-les-etudiants-sur-les-abonnements-a-la-libre/'), // the list price a student discount is taken off
    nrc: P(17.5, 'EUR', 'month', 'Digitaal Basis', 'https://subger.com/en/service/nrc'), // the page gives no period; a year at that price isn't plausible
    spiegel: P(21.99, 'EUR', 'month', 'SPIEGEL+', 'https://subtracker.io/kuendigen/spiegel-plus-kuendigen'),
    // Israel
    jpost: P(8, 'USD', 'month', 'Premium Plus', 'https://store.jpost.com', '2026-11-25'), // its own store
    // Australia
    smh: P(25.99, 'AUD', 'month', 'Digital', 'https://mumbrella.com.au/nine-publishing-hikes-digital-subscription-prices-by-20-879130'),
    theage: P(25.99, 'AUD', 'month', 'Digital', 'https://mumbrella.com.au/nine-publishing-hikes-digital-subscription-prices-by-20-879130'),
  });
  const UNPRICED = Object.freeze({
    usatoday: 'no page we could open states a price',
    nationalpost: 'the only page found that states one (C$29.99 a month) is from 2021',
    newsweek: "its subscribe page shows no prices to a script, and other sources disagree",
    elmundo: 'no page we could open states a price',
    lemonde: 'the only page found that states one (€9.99 a month) is from 2020',
    haaretz: 'the pages that state a price disagree ($15 to $25 a month)',
    ynet: 'the only price found (NIS 15.90 a month) is from 2019',
  });

  // Units of each currency to one US dollar: the Banque de France's daily rates (euro
  // reference rates) of 2026-11-11, https://www.banque-france.fr/en/statistics/rates-and-prices/exchange-rates-daily-parities-2026-11-11
  const RATES = Object.freeze({ USD: 1, EUR: 0.8987, GBP: 0.7515, CAD: 1.4235, AUD: 1.4579 });
  const RATES_DATE = '2026-11-11';

  const PER_MONTH = Object.freeze({ month: 1, '4 weeks': 13 / 12, week: 52 / 12, year: 1 / 12 });
  // The reader's currency, from the browser's language and region ('nl-NL' → EUR)
  const EURO = new Set(['AT', 'BE', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES']);
  const BY_REGION = Object.freeze({ US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD' });

  function currencyFor(locale, rates = RATES) {
    let region = null;
    try {
      region = new Intl.Locale(locale).maximize().region;
    } catch {
      // not a locale
    }
    const currency = EURO.has(region) ? 'EUR' : BY_REGION[region];
    return currency && rates[currency] ? currency : 'USD';
  }

  // A price as so much a month, in its own currency, or null.
  function monthly(price) {
    const factor = price && PER_MONTH[price.per];
    return factor && Number.isFinite(price.amount) && price.amount > 0 ? price.amount * factor : null;
  }
  function convert(amount, from, to, rates = RATES) {
    if (amount === null) return null;
    if (from === to) return amount;
    return rates[from] && rates[to] ? (amount / rates[from]) * rates[to] : null;
  }
  // An outlet's subscription a month in the reader's currency, or null when it has no price.
  function perMonth(id, currency, { prices = PRICES, rates = RATES } = {}) {
    const price = prices[id];
    return price ? convert(monthly(price), price.currency, currency, rates) : null;
  }

  // The figures, for this month (month: its key, notify.monthOf()) and since the tally began.
  //   { currency,
  //     month: { key, read, outlets, cost, unpriced: [id], sites: [{ id, read, paid, cost }] },
  //     total: { since, read, outlets, cost, unpriced: [id] } }
  // cost: the outlets that have a price; a site's cost is null when it has none, 0 when it was
  // read only past a login wall.
  function summarize(months, { month, currency = 'USD', prices = PRICES, rates = RATES }) {
    const keys = Object.keys(months || {}).sort();
    const priceOf = id => perMonth(id, currency, { prices, rates });
    const rowsOf = key => Object.entries(months[key])
      .map(([id, count]) => ({ id, read: count.read, paid: count.paid, cost: count.paid ? priceOf(id) : 0 }))
      .sort((a, b) => b.read - a.read || a.id.localeCompare(b.id));
    const sum = rows => ({
      read: rows.reduce((n, r) => n + r.read, 0),
      cost: rows.reduce((n, r) => n + (r.cost || 0), 0),
      unpriced: [...new Set(rows.filter(r => r.cost === null).map(r => r.id))].sort(),
    });
    const sites = months?.[month] ? rowsOf(month) : [];
    const all = keys.flatMap(rowsOf);
    return {
      currency,
      month: { key: month, ...sum(sites), outlets: sites.length, sites },
      total: { since: keys[0] || month, ...sum(all), outlets: new Set(all.map(r => r.id)).size },
    };
  }

  // Words
  const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;
  function money(amount, currency, locale) {
    const whole = Math.round(amount);
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(whole);
    } catch {
      return `${whole} ${currency}`;
    }
  }
  const readText = (read, outlets) => `${plural(read, 'article')} from ${plural(outlets, 'outlet')}`;
  // "about $95", or null when nothing with a price was read behind a paywall
  const costText = (cost, currency, locale) => (cost >= 1 ? `about ${money(cost, currency, locale)}` : null);
  // '2026-09' → "September", or "September 2025" in another year than month's
  function monthName(key, { month, locale }) {
    const [year, m] = key.split('-').map(Number);
    const date = new Date(Date.UTC(year, m - 1, 15));
    const sameYear = month && month.slice(0, 4) === key.slice(0, 4);
    try {
      return new Intl.DateTimeFormat(locale, { month: 'long', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' }).format(date);
    } catch {
      return key;
    }
  }
  const spent = (part, currency, locale) => {
    const cost = costText(part.cost, currency, locale);
    return cost ? `, ${cost} in subscriptions you didn't pay them` : '';
  };

  // The tally as one sentence for the donation link: this month's, or since the tally began
  // when this month has hardly started; null when there's too little to say.
  //   "This month: 23 articles from 6 outlets, about $95 in subscriptions you didn't pay them."
  function askText(summary, { locale, atLeast = 3 } = {}) {
    const { month, total, currency } = summary;
    if (month.read >= atLeast) return `This month: ${readText(month.read, month.outlets)}${spent(month, currency, locale)}.`;
    if (total.read >= atLeast && total.since !== month.key) {
      return `Since ${monthName(total.since, { month: month.key, locale })}: ${readText(total.read, total.outlets)}${spent(total, currency, locale)}.`;
    }
    return null;
  }

  // The numbers the toolbar menu and the settings page show, formatted, or null before the
  // first article. Exactly one leads (hero): this month's cost, or its article count when
  // nothing read this month has a price; since the tally began (since: true) when nothing has
  // been read yet this month.
  //   { hero: { value: '$155', cost: true, since: false } | { value: '18', cost: false, since: false },
  //     articles: '18', outlets: '6', month: 'November',
  //     since: { label: 'Since September', from: 'September', value: '$291' | null, articles: '52', outlets: '7' } | null,
  //     rows: [{ id, read, paid, cost, value: '$52' | null, note, share }] }
  // rows: this month's outlets, the most expensive first; share: its cost against the top one
  // (0 with none); note: 'a month', 'free past the login wall' or 'no price found'.
  function dashboard(summary, { locale } = {}) {
    const { month, total, currency } = summary;
    if (!total.read) return null;
    const amount = cost => (cost >= 1 ? money(cost, currency, locale) : null);
    const count = n => n.toLocaleString(locale || 'en');
    const top = Math.max(0, ...month.sites.map(r => r.cost || 0));
    const rows = month.sites
      .map(r => ({
        ...r,
        value: r.paid && r.cost !== null ? amount(r.cost) || `< ${money(1, currency, locale)}` : null,
        note: !r.paid ? 'free past the login wall' : r.cost === null ? 'no price found' : 'a month',
        share: top && r.cost ? r.cost / top : 0,
      }))
      .sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1) || b.read - a.read || a.id.localeCompare(b.id));
    const lead = month.read ? month : total;
    const cost = amount(lead.cost);
    return {
      hero: { value: cost || count(lead.read), cost: Boolean(cost), since: !month.read },
      articles: count(month.read),
      outlets: count(month.outlets),
      month: monthName(month.key, { month: month.key, locale }),
      since: total.since === month.key ? null : {
        label: `Since ${monthName(total.since, { month: month.key, locale })}`,
        from: monthName(total.since, { month: month.key, locale }),
        value: amount(total.cost),
        articles: count(total.read),
        outlets: count(total.outlets),
      },
      rows,
    };
  }

  const tally = {
    PRICES, UNPRICED, RATES, RATES_DATE, PER_MONTH,
    currencyFor, monthly, convert, perMonth, summarize,
    money, readText, costText, monthName, askText, dashboard,
  };
  root.NYTFix = Object.assign(root.NYTFix || {}, { tally });
  if (typeof module === 'object' && module.exports) module.exports = tally;
})(globalThis);
