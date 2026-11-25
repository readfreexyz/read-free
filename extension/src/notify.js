// What the status bar adds once a wall is off: why this outlet is boycotted (reasons.js), now
// and then the donation link, and, while a newer version is out, how to update. Decided from a
// small record kept in chrome.storage.local:
//   { v, fixed, articles, days, sites: { id: when last explained }, donate: { lastAskAt, snoozeUntil, asks },
//     update: { lastAt }, months: { 'YYYY-MM': { id: { read, paid } } } }
// months is the reader's own tally (src/tally.js): how many articles from each outlet they read
// each month, and how many of those were behind a paywall (not NYT's login wall, which a free
// account gets past). Counts only, never which articles, and it never leaves the browser.
// The reason is shown once per outlet (again after a month): while archive.today loads, when
// there's a wait, else when the wall is off; afterwards it's one click away ("Why?"). The
// donation link waits until the extension has been useful for a while (10 articles, on 3
// different days), never shares a notification with a reason, and comes at most every two weeks;
// never, once the reader has said they donated (settings: donated).
// A newer version (src/release.js, for copies loaded by hand) is mentioned at most every three
// days until the reader updates, never with a reason (it waits for the next article), and in
// place of the donation link.
// Every wall that comes off is said, reloads too, unless the reader asked for quiet (settings:
// quiet). Then, after the first 5 articles, a wall coming off with nothing new to say shows no
// notification at all (the toolbar icon's ✓ still marks the page), and neither does a reload of an
// article already read; a wait for archive.today always ends with one, since they watched it load.
// plan() is pure: content.js loads the record when the page starts (with the settings, so the
// decision is made at once) and saves plan().next.
(function (root) {
  'use strict';

  const KEY = 'notify';
  const DAY = 24 * 60 * 60 * 1000;
  const RULES = Object.freeze({
    reexplainAfterDays: 30, // explain an outlet again after this long
    donateAfterFixes: 10,   // never ask before the reader's tenth article…
    donateAfterDays: 3,     // …read on at least three different days
    donateEveryDays: 14,    // at most every two weeks
    laterDays: 45,          // "Not now"
    gaveDays: 180,          // they clicked through to donate
    keepArticles: 200,      // articles remembered, so a reload isn't counted again
    keepDays: 60,
    quietAfterFixes: 5,     // then only say something new
    keepMonths: 120,        // the tally: ten years of months
    updateEveryDays: 3,     // a newer version: mentioned at most this often
    hideMs: { explain: 12000, donate: 12000, update: 12000, brief: 3000 },
  });

  const fresh = () => ({ v: 1, fixed: 0, articles: [], days: [], sites: {}, donate: { lastAskAt: 0, snoozeUntil: 0, asks: 0 }, update: { lastAt: 0 }, months: {} });
  const dayOf = now => new Date(now).toISOString().slice(0, 10);
  // The tally's month, in the reader's own time zone: '2026-11'.
  const monthOf = now => {
    const d = new Date(now);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const num = x => (Number.isFinite(x) && x >= 0 ? x : 0);
  const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
  const SITE_ID = /^[a-z0-9-]{1,40}$/;

  function normalizeMonths(saved) {
    const months = {};
    if (!saved || typeof saved !== 'object') return months;
    for (const key of Object.keys(saved).filter(k => MONTH.test(k)).sort().slice(-RULES.keepMonths)) {
      const sites = {};
      const month = saved[key];
      if (month && typeof month === 'object') {
        for (const [id, count] of Object.entries(month)) {
          if (!SITE_ID.test(id) || !count || typeof count !== 'object') continue;
          const read = Math.floor(num(count.read));
          if (read) sites[id] = { read, paid: Math.min(read, Math.floor(num(count.paid))) };
        }
      }
      if (Object.keys(sites).length) months[key] = sites;
    }
    return months;
  }

  // One more article from this outlet this month; paid: it was behind a paywall.
  function counted(months, { site, paid, now }) {
    const key = monthOf(now);
    const month = months[key] || {};
    const was = month[site] || { read: 0, paid: 0 };
    return normalizeMonths({ ...months, [key]: { ...month, [site]: { read: was.read + 1, paid: was.paid + (paid ? 1 : 0) } } });
  }

  function normalize(saved) {
    const s = saved && typeof saved === 'object' && saved.v === 1 ? saved : {};
    const d = s.donate && typeof s.donate === 'object' ? s.donate : {};
    const u = s.update && typeof s.update === 'object' ? s.update : {};
    const sites = {};
    if (s.sites && typeof s.sites === 'object') for (const [id, at] of Object.entries(s.sites)) if (Number.isFinite(at)) sites[id] = at;
    return {
      v: 1,
      fixed: num(s.fixed),
      articles: Array.isArray(s.articles) ? s.articles.filter(a => typeof a === 'string').slice(-RULES.keepArticles) : [],
      days: Array.isArray(s.days) ? s.days.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(-RULES.keepDays) : [],
      sites,
      donate: { lastAskAt: num(d.lastAskAt), snoozeUntil: num(d.snoozeUntil), asks: num(d.asks) },
      update: { lastAt: num(u.lastAt) },
      months: normalizeMonths(s.months),
    };
  }

  async function load(area) {
    try {
      const { [KEY]: saved } = await area.get(KEY);
      return normalize(saved);
    } catch {
      return fresh();
    }
  }

  async function save(area, state) {
    try {
      await area.set({ [KEY]: state });
    } catch {
      // Storage full or gone: the next page decides from defaults.
    }
  }

  // Should this page explain why the outlet is boycotted? Not on a reload of an article already
  // read, and once per outlet a month.
  function explainNow(state, { site, article, reason, now = Date.now() }) {
    return Boolean(reason) && !state.articles.includes(article) && now - (state.sites[site] || 0) >= RULES.reexplainAfterDays * DAY;
  }
  const explained = (state, site, now = Date.now()) => ({ ...state, sites: { ...state.sites, [site]: now } });

  // A wall came off. outcome: 'lifted' | 'swapped' | 'saved' (a saved copy) | 'partial' | 'page'
  // (the text was in the site's page). quiet: the reader asked for it.
  // paid: it was a paywall (false for NYT's login wall). explainedHere: the reason was already
  // shown on this page (while archive.today loaded). donated: the reader said they donated.
  // newer: a newer version is out (release.notice(): { version, href, text }), or null.
  // Returns { show, explain, donate, update, hideAfterMs, next }: whether to show a notification
  // at all; explain the reason open; offer the donation link (the tip, or null); say a newer
  // version is out (newer, or null); how long the bar stays; the record to save.
  function plan(state, { site, article, outcome, reason, tip, paid = true, explainedHere = false, quiet = false, donated = false, newer = null, now = Date.now() }) {
    const repeat = state.articles.includes(article);
    const explain = !explainedHere && explainNow(state, { site, article, reason, now });
    const today = dayOf(now);
    const days = state.days.includes(today) ? state.days : [...state.days, today].slice(-RULES.keepDays);
    const update = Boolean(newer?.version) && /^https:\/\//i.test(newer.href || '') && !explain && !explainedHere
      && now - state.update.lastAt >= RULES.updateEveryDays * DAY;
    const donate = Boolean(tip) && !donated && !repeat && !explain && !explainedHere && !update && outcome !== 'partial'
      && state.fixed + 1 >= RULES.donateAfterFixes
      && days.length >= RULES.donateAfterDays
      && now >= state.donate.snoozeUntil
      && now - state.donate.lastAskAt >= RULES.donateEveryDays * DAY;
    const next = {
      ...(explain ? explained(state, site, now) : state),
      fixed: state.fixed + (repeat ? 0 : 1),
      articles: repeat ? state.articles : [...state.articles, article].slice(-RULES.keepArticles),
      days,
      donate: donate ? { ...state.donate, lastAskAt: now, asks: state.donate.asks + 1 } : state.donate,
      update: update ? { lastAt: now } : state.update,
      months: repeat ? state.months : counted(state.months, { site, paid, now }),
    };
    const hideAfterMs = explain ? RULES.hideMs.explain : donate ? RULES.hideMs.donate : update ? RULES.hideMs.update : RULES.hideMs.brief;
    const waited = outcome === 'swapped' || outcome === 'partial'; // the reader watched archive.today load
    const show = !quiet || explain || donate || update || explainedHere || waited || (!repeat && state.fixed < RULES.quietAfterFixes);
    return { show, explain, donate: donate ? tip : null, update: update ? newer : null, hideAfterMs, next };
  }

  // The wording, in one place.
  const COPY = Object.freeze({
    whyHeading: name => `Why we don't pay ${name}`,
    donateText: 'Read Free is reader-funded. Chip in to keep the boycott going.',
    // With the reader's tally in front (tally.askText): "This month: 23 articles from 6 outlets,
    // about $95 in subscriptions you didn't pay them."
    donateWithTally: tally => `${tally} Read Free is reader-funded: chip in to keep the boycott going.`,
    donateButton: 'Donate',
    updateText: version => `Read Free ${version} is out. Updating keeps it working as the outlets change their walls.`,
    updateButton: 'How to update',
  });

  // plan() as options for the status bar's finish() (src/status.js). tally: the reader's tally
  // as one sentence for the donation link, or null.
  const reasonOptions = (reason, siteName) => reason && { heading: COPY.whyHeading(siteName), ...reason };
  function barOptions(plan, { siteName, reason, tally = null, onOpen, onGive, onLater }) {
    return {
      hideAfterMs: plan.hideAfterMs,
      reason: reasonOptions(reason, siteName),
      explain: plan.explain,
      donate: plan.donate && { text: tally ? COPY.donateWithTally(tally) : COPY.donateText, button: COPY.donateButton, href: plan.donate.href, open: onOpen, onGive, onLater },
      newer: plan.update && { text: COPY.updateText(plan.update.version), button: COPY.updateButton, href: plan.update.href },
    };
  }

  // "Start notifications over" (the settings page): as on the first day, reasons and all. The
  // donation link's snooze is kept: the reader answered it. So is the tally: it's their reading,
  // not something said to them.
  const startOver = state => ({ ...fresh(), donate: state.donate, months: state.months });

  // The reader answered the donation link: "Not now", or clicked through.
  const later = (state, now = Date.now()) => ({ ...state, donate: { ...state.donate, snoozeUntil: now + RULES.laterDays * DAY } });
  const gave = (state, now = Date.now()) => ({ ...state, donate: { ...state.donate, snoozeUntil: now + RULES.gaveDays * DAY } });

  const notify = { KEY, RULES, COPY, fresh, normalize, monthOf, load, save, explainNow, explained, plan, reasonOptions, barOptions, startOver, later, gave };
  root.NYTFix = Object.assign(root.NYTFix || {}, { notify });
  if (typeof module === 'object' && module.exports) module.exports = notify;
})(globalThis);
