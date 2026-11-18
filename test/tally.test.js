// The reader's tally and what subscribing would have cost (src/tally.js). The arithmetic is
// tested with prices and rates made up here, so updating the real ones never breaks it; the real
// ones are checked for shape and sources.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const tally = require('../extension/src/tally.js');

const PRICES = {
  nyt: { amount: 24, currency: 'USD', per: '4 weeks' }, // 26 a month
  ft: { amount: 30, currency: 'GBP', per: 'month' },    // 45 USD at 1.5 USD to the pound
  wsj: { amount: 120, currency: 'USD', per: 'year' },   // 10 a month
  reuters: { amount: 3, currency: 'USD', per: 'week' }, // 13 a month
};
const RATES = { USD: 1, GBP: 1 / 1.5, EUR: 0.9 };
const opts = extra => ({ prices: PRICES, rates: RATES, ...extra });
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} ≠ ${expected}`);

test('prices become so much a month, in the reader’s currency', () => {
  near(tally.monthly(PRICES.nyt), 26, '4 weeks: 13 a year');
  near(tally.monthly(PRICES.reuters), 13, 'weekly: 52 a year');
  near(tally.monthly(PRICES.wsj), 10, 'yearly');
  assert.equal(tally.monthly({ amount: 5, currency: 'USD', per: 'fortnight' }), null);
  assert.equal(tally.monthly({ amount: -5, currency: 'USD', per: 'month' }), null);
  near(tally.perMonth('ft', 'USD', opts()), 45, 'pounds to dollars');
  near(tally.perMonth('ft', 'EUR', opts()), 40.5, 'pounds to euros, through the dollar');
  assert.equal(tally.perMonth('ft', 'JPY', opts()), null, 'no rate: no figure');
  assert.equal(tally.perMonth('abces', 'USD', opts()), null, 'no price');
});

test('the reader’s currency comes from the browser’s region; anything else is dollars', () => {
  const rates = { USD: 1, EUR: 0.9, GBP: 0.75, CAD: 1.4, AUD: 1.5 };
  const cases = { 'en-US': 'USD', en: 'USD', 'nl-NL': 'EUR', nl: 'EUR', 'fr-BE': 'EUR', es: 'EUR', 'en-GB': 'GBP', 'fr-CA': 'CAD', 'en-AU': 'AUD', 'ja-JP': 'USD', 'not a locale!': 'USD', '': 'USD' };
  for (const [locale, currency] of Object.entries(cases)) assert.equal(tally.currencyFor(locale, rates), currency, locale);
  assert.equal(tally.currencyFor('en-GB', { USD: 1 }), 'USD', 'a currency with no rate falls back');
});

test('summarize: an outlet read behind its paywall counts its subscription once a month; a login wall costs nothing; no price, not counted', () => {
  const months = {
    '2026-10': { nyt: { read: 5, paid: 5 }, wsj: { read: 1, paid: 1 } },
    '2026-11': { nyt: { read: 9, paid: 7 }, ft: { read: 2, paid: 2 }, abces: { read: 3, paid: 3 }, cnn: { read: 1, paid: 0 } },
  };
  const s = tally.summarize(months, opts({ month: '2026-11', currency: 'USD' }));
  assert.equal(s.currency, 'USD');
  assert.deepEqual(s.month.sites.map(r => r.id), ['nyt', 'abces', 'ft', 'cnn'], 'most read first');
  assert.deepEqual([s.month.read, s.month.outlets, s.month.unpriced], [15, 4, ['abces']]);
  near(s.month.cost, 26 + 45, 'NYT and the FT; ABC has no price; CNN read past a login wall');
  assert.equal(s.month.sites.find(r => r.id === 'cnn').cost, 0);
  assert.equal(s.month.sites.find(r => r.id === 'abces').cost, null);
  assert.deepEqual([s.total.since, s.total.read, s.total.outlets, s.total.unpriced], ['2026-10', 21, 5, ['abces']]);
  near(s.total.cost, 26 + 10 + 26 + 45, 'NYT counted in both months');
  const empty = tally.summarize({}, opts({ month: '2026-11' }));
  assert.deepEqual([empty.month.read, empty.month.sites, empty.total.read, empty.total.since], [0, [], 0, '2026-11']);
  const quiet = tally.summarize({ '2026-10': { nyt: { read: 1, paid: 1 } } }, opts({ month: '2026-11' }));
  assert.deepEqual([quiet.month.read, quiet.total.read], [0, 1], 'nothing yet this month');
});

test('words and numbers: the donation link’s sentence; what the toolbar menu and the settings page show', () => {
  const locale = 'en-US';
  const words = (months, month = '2026-11') => tally.summarize(months, opts({ month, currency: 'USD' }));
  const busy = words({ '2026-09': { wsj: { read: 4, paid: 4 } }, '2026-11': { nyt: { read: 9, paid: 9 }, ft: { read: 2, paid: 2 } } });
  assert.equal(tally.askText(busy, { locale }), "This month: 11 articles from 2 outlets, about $71 in subscriptions you didn't pay them.");
  const early = words({ '2026-09': { wsj: { read: 4, paid: 4 } }, '2026-11': { nyt: { read: 1, paid: 1 } } });
  assert.equal(tally.askText(early, { locale }), "Since September: 5 articles from 2 outlets, about $36 in subscriptions you didn't pay them.", 'this month has hardly started');
  assert.equal(tally.askText(words({ '2026-11': { nyt: { read: 2, paid: 2 } } }), { locale }), null, 'too little to say');
  assert.equal(tally.askText(words({ '2026-11': { abces: { read: 3, paid: 3 } } }), { locale }), 'This month: 3 articles from 1 outlet.', 'no price: no money');
  const lastYear = words({ '2025-12': { nyt: { read: 4, paid: 4 } } }, '2026-11');
  assert.match(tally.askText(lastYear, { locale }), /^Since December 2025: 4 articles from 1 outlet/);

  assert.equal(tally.dashboard(words({}), { locale }), null, 'nothing read yet');
  const view = tally.dashboard(busy, { locale });
  assert.deepEqual(view.hero, { value: '$71', cost: true, since: false }, "this month's cost leads");
  assert.deepEqual([view.articles, view.outlets, view.month], ['11', '2', 'November']);
  assert.deepEqual(view.since, { label: 'Since September', from: 'September', value: '$81', articles: '15', outlets: '3' });
  assert.deepEqual(view.rows.map(r => [r.id, r.value, r.note]), [['ft', '$45', 'a month'], ['nyt', '$26', 'a month']], 'the most expensive first');
  near(view.rows[1].share, 26 / 45, 'bars against the top one');
  const mixed = tally.dashboard(words({ '2026-11': { abces: { read: 3, paid: 3 }, nyt: { read: 1, paid: 0 }, wsj: { read: 1, paid: 1 } } }), { locale });
  assert.deepEqual(mixed.rows.map(r => [r.id, r.value, r.note, r.share]), [['wsj', '$10', 'a month', 1], ['nyt', null, 'free past the login wall', 0], ['abces', null, 'no price found', 0]]);
  assert.deepEqual(tally.dashboard(words({ '2026-11': { abces: { read: 3, paid: 3 } } }), { locale }).hero, { value: '3', cost: false, since: false }, 'no price: the count leads');
  const quietMonth = tally.dashboard(words({ '2026-09': { wsj: { read: 4, paid: 4 } } }), { locale });
  assert.deepEqual([quietMonth.hero, quietMonth.articles, quietMonth.rows], [{ value: '$10', cost: true, since: true }, '0', []], 'nothing yet this month: since the tally began leads');
  assert.equal(tally.costText(0.4, 'USD', locale), null);
});

test('money is whole units in the reader’s own format', () => {
  const fmt = (amount, currency, locale) => new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
  assert.equal(tally.money(70.6, 'EUR', 'nl-NL'), fmt(71, 'EUR', 'nl-NL'));
  assert.equal(tally.money(70.4, 'GBP', 'en-GB'), fmt(70, 'GBP', 'en-GB'));
  assert.equal(tally.money(5, 'XYZ!', 'en-US'), '5 XYZ!', 'a bad currency code still says something');
});

test('the real prices: each a regular price with a source, in a currency with a rate; every outlet priced or listed as not', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../extension/manifest.json'), 'utf8'));
  const files = [...new Set(manifest.content_scripts.flatMap(cs => cs.js).filter(f => f.startsWith('sites/')))];
  require('../extension/src/adapter.js');
  const ids = files.flatMap(f => {
    const loaded = require(path.join('../extension', f));
    return (Array.isArray(loaded) ? loaded : [loaded]).map(s => s.id);
  });
  assert.ok(ids.length >= 20);
  for (const id of ids) assert.ok(tally.PRICES[id] || tally.UNPRICED[id], `${id}: a price, or why there's none`);
  for (const [id, price] of Object.entries(tally.PRICES)) {
    assert.ok(ids.includes(id), `${id} is a supported outlet`);
    assert.ok(!tally.UNPRICED[id], `${id}: not both`);
    assert.ok(tally.RATES[price.currency], `${id}: ${price.currency} has a rate`);
    assert.ok(tally.monthly(price) > 0, `${id}: an amount and a billing period`);
    assert.match(price.source, /^https:\/\//, `${id}: source`);
    assert.match(price.checked, /^\d{4}-\d{2}-\d{2}$/, `${id}: when it was checked`);
    assert.ok(price.plan, `${id}: which plan`);
  }
  for (const [id, why] of Object.entries(tally.UNPRICED)) assert.ok(typeof why === 'string' && why.length > 10, `${id}: why`);
  if (Object.keys(tally.PRICES).length) assert.match(tally.RATES_DATE, /^\d{4}-\d{2}-\d{2}$/);
});
