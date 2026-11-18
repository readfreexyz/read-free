// When the status bar says why an outlet is boycotted and asks for donations (src/notify.js), the
// reasons themselves (src/reasons.js), and the bar's parts for them (src/status.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const notify = require('../extension/src/notify.js');
const reasons = require('../extension/src/reasons.js');
const statusBar = require('../extension/src/status.js');
const { parse, memoryArea } = require('./fixtures.js');

const NOW = Date.parse('2026-11-16T15:00:00Z');
const H = 3600e3;
const D = 24 * H;
const TIP = { text: 'Support the project', short: 'Donate', href: 'https://ko-fi.com/example' };
const REASON = reasons.reasonFor('nyt');
const state = (s = {}) => notify.normalize({ v: 1, ...s });
const daysBack = n => Array.from({ length: n }, (_, i) => new Date(NOW - (n - i) * D).toISOString().slice(0, 10));
const at = (s, o = {}) => notify.plan(state(s), { site: 'nyt', article: 'https://www.nytimes.com/a', outcome: 'lifted', reason: REASON, tip: TIP, now: NOW, ...o });
// A reader who has been using it a while: past the quiet threshold, on several days, never asked.
const REGULAR = { fixed: 30, days: daysBack(8), sites: { nyt: NOW - 2 * D } };

test("the reason: once per outlet, open; again after a month; never on a reload, or where there's none", () => {
  const first = at({});
  assert.equal(first.explain, true);
  assert.equal(first.show, true);
  assert.equal(first.hideAfterMs, notify.RULES.hideMs.explain);
  assert.equal(first.next.sites.nyt, NOW);
  assert.equal(at({ sites: { nyt: NOW - 2 * D } }).explain, false, 'seen two days ago');
  assert.equal(at({ sites: { nyt: NOW - 31 * D } }).explain, true, 'a month on');
  assert.equal(at({ articles: ['https://www.nytimes.com/a'] }).explain, false, 'a reload');
  assert.equal(at({}, { reason: null }).explain, false, 'The New Yorker');
  assert.equal(at({}, { explainedHere: true }).explain, false, 'already shown while archive.today loaded');
  assert.equal(notify.explainNow(state({}), { site: 'nyt', article: 'x', reason: REASON, now: NOW }), true);
  const over = notify.startOver(state({ fixed: 40, sites: { nyt: NOW }, donate: { snoozeUntil: NOW + D } }));
  assert.deepEqual([over.fixed, over.sites, over.donate.snoozeUntil], [0, {}, NOW + D], 'starting over keeps the donation answer');
});

test('the donation link: after 10 articles on 3 days, never with a reason, every two weeks at most', () => {
  assert.ok(at(REGULAR).donate, 'a regular reader, never asked');
  assert.equal(at(REGULAR).next.donate.lastAskAt, NOW);
  assert.equal(at({ ...REGULAR, fixed: 5 }).donate, null, 'too soon: 6 articles');
  assert.equal(at({ ...REGULAR, days: daysBack(1) }).donate, null, 'too soon: 2 days of use');
  assert.equal(at({ ...REGULAR, sites: {} }).donate, null, 'not with a reason');
  assert.equal(at(REGULAR, { explainedHere: true }).donate, null, 'not after a reason shown while loading');
  assert.equal(at(REGULAR, { tip: null }).donate, null, 'no donation link set');
  assert.equal(at(REGULAR, { outcome: 'partial' }).donate, null, 'not when the end may be missing');
  assert.equal(at({ ...REGULAR, articles: ['https://www.nytimes.com/a'] }).donate, null, 'not on a reload');
  assert.equal(at({ ...REGULAR, donate: { lastAskAt: NOW - 13 * D } }).donate, null, 'asked 13 days ago');
  assert.ok(at({ ...REGULAR, donate: { lastAskAt: NOW - 15 * D } }).donate, 'asked 15 days ago');
  const later = notify.later(state(REGULAR), NOW);
  // (The New Yorker: no reason coming due a month and a half on to take the donation's place)
  const later45 = days => notify.plan(later, { site: 'newyorker', article: 'b', outcome: 'lifted', reason: null, tip: TIP, now: NOW + days * D });
  assert.equal(later45(44).donate, null, '"Not now": 45 days');
  assert.ok(later45(46).donate);
  assert.equal(notify.plan(later, { site: 'nyt', article: 'b', outcome: 'lifted', reason: REASON, tip: TIP, now: NOW + 46 * D }).donate, null, "NYT's reason is due again, and goes first");
  const gave = notify.gave(state(REGULAR), NOW);
  assert.equal(notify.plan(gave, { site: 'newyorker', article: 'b', outcome: 'lifted', reason: null, tip: TIP, now: NOW + 100 * D }).donate, null, 'clicked through: half a year');
});

test("quiet once there's nothing new: no notification for a regular reader's lifted wall, unless they ask for one", () => {
  const quiet = { ...REGULAR, donate: { lastAskAt: NOW - D } };
  assert.equal(at(quiet).show, false);
  assert.equal(at(quiet, { alwaysConfirm: true }).show, true);
  assert.equal(at({ ...quiet, fixed: 2 }).show, true, 'the first five articles');
  assert.equal(at(quiet, { outcome: 'swapped' }).show, true, 'they watched archive.today load');
  assert.equal(at({ ...quiet, fixed: 2, articles: ['https://www.nytimes.com/a'] }).show, false, 'a reload says nothing new');
  assert.equal(at({ ...quiet, fixed: 2, articles: ['https://www.nytimes.com/a'] }, { alwaysConfirm: true }).show, false);
});

test('the record: an article counts once, days are kept, junk is dropped', () => {
  const once = at({});
  assert.equal(once.next.fixed, 1);
  assert.deepEqual(once.next.days, ['2026-11-16']);
  const again = notify.plan(once.next, { site: 'nyt', article: 'https://www.nytimes.com/a', outcome: 'saved', reason: REASON, now: NOW + H });
  assert.equal(again.next.fixed, 1, 'a reload');
  assert.deepEqual(again.next.days, ['2026-11-16']);
  assert.deepEqual(notify.normalize({ v: 1, fixed: -3, articles: [1, 'a'], days: ['x', '2026-11-01'], sites: { nyt: 'no', ft: 5 }, donate: { asks: NaN } }),
    { v: 1, fixed: 0, articles: ['a'], days: ['2026-11-01'], sites: { ft: 5 }, donate: { lastAskAt: 0, snoozeUntil: 0, asks: 0 }, months: {} });
  assert.deepEqual(notify.normalize(null), notify.fresh());
});

test('the tally: each article once, by outlet and month; a login wall is read but not paid; starting over keeps it', () => {
  const month = notify.monthOf(NOW);
  assert.equal(month, '2026-11');
  const one = at({});
  assert.deepEqual(one.next.months, { [month]: { nyt: { read: 1, paid: 1 } } });
  const reload = notify.plan(one.next, { site: 'nyt', article: 'https://www.nytimes.com/a', outcome: 'saved', now: NOW + H });
  assert.deepEqual(reload.next.months, one.next.months, 'a reload counts nothing');
  const login = notify.plan(one.next, { site: 'nyt', article: 'https://www.nytimes.com/b', outcome: 'lifted', paid: false, now: NOW + H });
  assert.deepEqual(login.next.months[month].nyt, { read: 2, paid: 1 }, "NYT's login wall: read, but no subscription needed");
  const ft = notify.plan(login.next, { site: 'ft', article: 'https://www.ft.com/content/c', outcome: 'swapped', now: NOW + 2 * H });
  assert.deepEqual(ft.next.months[month], { nyt: { read: 2, paid: 1 }, ft: { read: 1, paid: 1 } });
  const nextMonth = notify.plan(ft.next, { site: 'ft', article: 'https://www.ft.com/content/d', outcome: 'lifted', now: NOW + 20 * D });
  assert.deepEqual(Object.keys(nextMonth.next.months), ['2026-11', '2026-12']);
  assert.deepEqual(notify.startOver(nextMonth.next).months, nextMonth.next.months, 'its own reading, not something said to the reader');
});

test('the tally: junk is dropped, paid never above read, ten years kept', () => {
  assert.deepEqual(notify.normalize({ v: 1, months: {
    x: { nyt: { read: 1 } },
    '2026-13': { nyt: { read: 1 } },
    '2026-10': { nyt: { read: 2, paid: 5 }, 'BAD!': { read: 1 }, ft: { read: 0, paid: 0 }, wsj: 'no', cnn: { read: 1.7, paid: -1 } },
    '2026-09': {},
  } }).months, { '2026-10': { nyt: { read: 2, paid: 2 }, cnn: { read: 1, paid: 0 } } });
  const many = {};
  for (let y = 2010; y < 2027; y++) for (let m = 1; m <= 12; m++) many[`${y}-${String(m).padStart(2, '0')}`] = { nyt: { read: 1, paid: 1 } };
  const kept = Object.keys(notify.normalize({ v: 1, months: many }).months);
  assert.equal(kept.length, notify.RULES.keepMonths);
  assert.equal(kept.at(-1), '2026-12', 'the newest kept');
});

test('"I\'ve donated": the donation link is never offered again; with a tally, the ask says it', () => {
  assert.ok(at(REGULAR).donate);
  assert.equal(at(REGULAR, { donated: true }).donate, null);
  const plan = at(REGULAR);
  const words = notify.barOptions(plan, { siteName: 'NYT', reason: REASON, tally: 'This month: 12 articles from 3 outlets.' }).donate.text;
  assert.equal(words, notify.COPY.donateWithTally('This month: 12 articles from 3 outlets.'));
  assert.match(words, /^This month: 12 articles from 3 outlets\. .*chip in/);
  assert.equal(notify.barOptions(plan, { siteName: 'NYT', reason: REASON }).donate.text, notify.COPY.donateText, 'no tally: the plain ask');
});

test('load and save use chrome.storage.local, and survive a broken one', async () => {
  const area = memoryArea();
  assert.deepEqual(await notify.load(area), notify.fresh());
  await notify.save(area, at({}).next);
  assert.equal((await notify.load(area)).fixed, 1);
  const broken = { get: async () => { throw new Error('gone'); }, set: async () => { throw new Error('gone'); } };
  assert.deepEqual(await notify.load(broken), notify.fresh());
  await notify.save(broken, notify.fresh()); // no throw
});

test('every supported site has a sourced reason, or is listed as having none', () => {
  require('../extension/src/adapter.js');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../extension/manifest.json'), 'utf8'));
  const files = [...new Set(manifest.content_scripts.flatMap(cs => cs.js).filter(f => f.startsWith('sites/')))];
  for (const f of files) require(path.join(__dirname, '../extension', f));
  const ids = Object.values(globalThis.NYTFix.sites).filter(s => s.live).map(s => s.id);
  for (const id of ids) {
    const reason = reasons.reasonFor(id);
    if (reasons.NO_REASON.includes(id)) {
      assert.equal(reason, null, `${id} is listed as having none`);
      continue;
    }
    assert.ok(reason, `${id} has no reason`);
    assert.ok(reason.text.length > 40 && reason.text.length <= 200, `${id}: ${reason.text.length} characters`);
    assert.match(reason.source.href, /^https:\/\//, id);
    assert.ok(reason.source.name && reason.source.year >= 2023, id);
  }
  for (const id of Object.keys(reasons.REASONS)) assert.ok(ids.includes(id), `a reason for ${id}, which isn't a site`);
});

// The status bar's parts

function bar() {
  const doc = parse('<!doctype html><html><body></body></html>');
  const b = statusBar.create(doc);
  return { doc, b, q: sel => b.shadow.querySelector(sel), qa: sel => [...b.shadow.querySelectorAll(sel)] };
}
const WHY = { heading: "Why we don't pay NYT", ...REASON };

test('status bar: the reason open, or behind "Why?"; with one, only × closes it', () => {
  const open = bar();
  open.b.finish('done', "Removed NYT's wall.", { reason: WHY, explain: true });
  assert.equal(open.q('.why').hidden, false);
  assert.equal(open.q('.why-head').textContent, "Why we don't pay NYT");
  assert.equal(open.q('.source').href, REASON.source.href);
  assert.equal(open.q('.toggle'), null);
  open.q('.bar').click();
  assert.ok(open.b.host.isConnected, 'a click on the bar leaves it');
  open.q('.close').click();
  assert.equal(open.b.host.isConnected, false, '× closes it');

  const closed = bar();
  closed.b.finish('done', "Removed NYT's wall.", { reason: WHY, explain: false });
  assert.equal(closed.q('.why').hidden, true);
  closed.q('.toggle').click();
  assert.equal(closed.q('.why').hidden, false);
  assert.equal(closed.q('.toggle'), null);
  assert.ok(closed.b.host.isConnected);
  closed.b.remove();

  const plain = bar();
  plain.b.finish('done', 'Showing the archived article.');
  plain.q('.bar').click();
  assert.equal(plain.b.host.isConnected, false, 'a plain bar still closes on a click');
});

test('status bar: the reason while archive.today loads stays when it finishes, once', () => {
  const { b, qa } = bar();
  b.stage('download', 'Getting the newest archive.today snapshot…', { expectedMs: 9000 });
  b.why(WHY, { open: true });
  b.why(WHY, { open: true });
  assert.equal(qa('.why').length, 1);
  b.finish('done', 'Showing the archived article.', { reason: WHY, explain: false });
  assert.equal(qa('.why').length, 1);
  assert.equal(qa('.why')[0].hidden, false);
  assert.equal(qa('.toggle').length, 0);
  b.remove();
});

test('status bar: the donation link and "Not now"', () => {
  const answered = [];
  const { b, q } = bar();
  b.finish('done', "Removed NYT's wall.", { donate: { text: notify.COPY.donateText, button: 'Donate', href: TIP.href, onGive: () => answered.push('gave'), onLater: () => answered.push('later') } });
  assert.equal(q('.give').href, TIP.href);
  assert.equal(q('.give').target, '_blank');
  q('.later').click();
  assert.deepEqual(answered, ['later']);
  assert.equal(q('.ask').hidden, true);
  assert.ok(b.host.isConnected);
  b.remove();
  // open: the extension's own donation page instead of the link (the content script asks the
  // service worker to open it)
  const opened = [];
  const own = bar();
  own.b.finish('done', 'x', { donate: { text: 'x', href: TIP.href, open: () => opened.push('page'), onGive: () => opened.push('gave') } });
  const click = new own.doc.defaultView.MouseEvent('click', { bubbles: true, cancelable: true });
  own.q('.give').dispatchEvent(click);
  assert.deepEqual(opened, ['page', 'gave']);
  assert.equal(click.defaultPrevented, true, "the link itself isn't followed");
  own.b.remove();
  const http = bar();
  http.b.finish('done', 'x', { donate: { text: 'x', href: 'http://example.com' } });
  assert.equal(http.q('.ask'), null, 'https only');
  http.b.remove();
});

test('status bar: once the reader has opened "Why?", moving the pointer away leaves time to read', async () => {
  const { b, q } = bar();
  b.finish('done', "Removed NYT's wall.", { reason: WHY, explain: false, hideAfterMs: 3000 });
  const win = q('.bar').ownerDocument.defaultView;
  q('.bar').dispatchEvent(new win.MouseEvent('mouseenter'));
  q('.toggle').click();
  q('.bar').dispatchEvent(new win.MouseEvent('mouseleave'));
  await new Promise(r => setTimeout(r, 2600));
  assert.ok(b.host.isConnected, 'still up after the 2.3 s a plain bar gets');
  b.remove();
});

test('status bar: made but not used yet, it shows nothing (a saved copy may make it unneeded)', () => {
  const { b, q } = bar();
  assert.ok(q('.bar').classList.contains('pending'));
  b.stage('find', 'Looking…');
  assert.equal(q('.bar').classList.contains('pending'), false);
  b.remove();
});
