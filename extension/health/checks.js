// Site health checks: does each adapter still fit the site? Sites change their markup, URLs and
// scripts without warning (Nine's wide layout, spectator.co.uk moving to spectator.com, NYT's
// popup wording), and an adapter that no longer fits fails quietly. These checks look at what a
// signed-out first-time reader is sent and compare it with what the adapter expects.
//
// They work on fetched HTML, parsed but never run: no layout, no scripts. So they check
// structure (the adapter's selectors, the page's JSON-LD, the strings a page-world guard waits
// for), not wall behaviour. Each result is
//   { check, status: 'pass' | 'fail' | 'skip', detail }
// 'skip' means it couldn't be checked (a bot check, a refusal, a page drawn by script), which is
// not a problem with the adapter. Details give counts and selectors, never article text.
//
// Pure functions: the caller fetches (the extension, signed out; or tools/site-health.mjs) and
// parses (DOMParser, or jsdom in Node). See health/specs.js for what each site should show.
(function (root) {
  'use strict';

  const adapter = (root.NYTFix && root.NYTFix.adapter) || (typeof require === 'function' ? require('../src/adapter.js') : null);

  const BOT_TITLE = /just a moment|attention required|access denied|are you a robot|captcha|security check|verify you are human|pardon our interruption/i;
  const BLOCKED_STATUS = new Set([401, 402, 403, 405, 406, 429, 451, 503]); // 402: National Post's TollBit
  const MIN_LINKS_IF_SERVER_DRAWN = 30;
  // Pages with their own layout that share the article URL pattern: live blogs (the Herald's
  // "…-final-live-…-20261115-p61e99.html"), videos, galleries, podcasts. Not samples.
  const NOT_A_SAMPLE = /(^|[-/])(live|live-updates|liveblog|video|videos|gallery|galleries|photos|podcasts?)([-/.]|$)/i;

  const result = (check, status, detail) => ({ check, status, detail });

  // Why a fetched page can't be checked, or null if it can. page: { ok, status, html, doc, error }.
  function unusable(page) {
    if (!page || !page.ok) return `couldn't load it${page && page.error ? ` (${page.error})` : ''}`;
    if (BLOCKED_STATUS.has(page.status)) return `refused (HTTP ${page.status}), probably a bot check`;
    if (page.status >= 400) return `HTTP ${page.status}`;
    const title = page.doc && page.doc.title ? page.doc.title : '';
    const start = page.doc && page.doc.body ? page.doc.body.textContent.replace(/\s+/g, ' ').slice(0, 400) : '';
    if (BOT_TITLE.test(title) || (page.html.length < 30000 && BOT_TITLE.test(start))) return 'a bot check answered';
    return null;
  }

  const MENUS = 'header, nav, footer, [role="navigation"], [role="banner"], [role="contentinfo"]';
  // A date in an article URL, as a number (20261115), or 0: /2026/11/15/, /2026-11-15/, -20261115-.
  function dateIn(path) {
    const m = /(20\d{2})[-/]?(0[1-9]|1[0-2])[-/]?([0-2]\d|3[01])(?!\d)/.exec(path);
    return m ? Number(m[1] + m[2] + m[3]) : 0;
  }

  // hosts may hold '*.example.com' (Corriere's local editions).
  const onHosts = (site, hostname) => site.hosts.some(h => h === hostname || (h.startsWith('*.') && hostname.endsWith(h.slice(1))));

  // The homepage still links to articles the adapter recognizes. Returns { results, samples }:
  // samples are article URLs to check next, in page order.
  function checkHome(site, home) {
    const problem = unusable(home);
    if (problem) return { results: [result('article links', 'skip', `homepage: ${problem}`)], samples: [] };
    const base = home.url;
    const all = [...home.doc.querySelectorAll('a[href]')];
    const found = new Map();
    all.forEach((a, index) => {
      let url;
      try { url = new URL(a.getAttribute('href'), base); } catch { return; }
      if (!/^https?:$/.test(url.protocol) || !onHosts(site, url.hostname)) return;
      if (!site.isArticle(url.pathname) || site.isLive(url.pathname) || NOT_A_SAMPLE.test(url.pathname)) return;
      const clean = `https://${url.hostname}${url.pathname}`;
      if (found.has(clean)) return;
      found.set(clean, { url: clean, index, inMenu: Boolean(a.closest(MENUS)), date: dateIn(url.pathname) });
    });
    // Today's stories first: links in the page's content before those in its menus (LA Times'
    // menu leads to 2022 hub pages under /story/), and newer dates in the URL first.
    const samples = [...found.values()].sort((a, b) =>
      (a.inMenu - b.inMenu) || ((b.date || 0) - (a.date || 0)) || (a.index - b.index)).map(s => s.url);
    if (samples.length) return { results: [result('article links', 'pass', `${samples.length} on the homepage`)], samples };
    if (all.length < MIN_LINKS_IF_SERVER_DRAWN) {
      return { results: [result('article links', 'skip', `the homepage has only ${all.length} links (drawn by script?)`)], samples };
    }
    return { results: [result('article links', 'fail', `none of the homepage's ${all.length} links looks like an article: has the URL pattern changed?`)], samples };
  }

  // A selector list split at its top-level commas ('a, b:not(c, d)' → ['a', 'b:not(c, d)']).
  function splitSelectors(list) {
    const parts = [];
    let depth = 0, start = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (c === ',' && depth === 0) { parts.push(list.slice(start, i).trim()); start = i + 1; }
    }
    parts.push(list.slice(start).trim());
    return parts.filter(Boolean);
  }

  // Words in the paragraphs of every element matching `body`; null if nothing matches. Paragraphs
  // are <p> unless the spec says otherwise (Reuters': div[data-testid^="paragraph-"]).
  function wordsIn(doc, body, paragraphs = 'p') {
    if (paragraphs === 'p') return adapter.bodyWords(doc, body);
    const bodies = [...doc.querySelectorAll(body)];
    if (!bodies.length) return null;
    const count = t => (t.replace(/\s+/g, ' ').trim() ? t.replace(/\s+/g, ' ').trim().split(' ').length : 0);
    return bodies.reduce((n, b) => n + [...b.querySelectorAll(paragraphs)].reduce((m, el) => m + count(el.textContent), 0), 0);
  }

  // A sample article: the adapter's body selector, the text it expects the page to send, the
  // parts it keeps, and the strings a page-world guard needs in the page.
  function checkArticle(site, spec, page) {
    const problem = unusable(page);
    if (problem) return [result('article page', 'skip', problem)];
    const doc = page.doc;
    const results = [];
    const body = site.live.body;

    if (spec.body === false || !body) {
      results.push(result('article body', 'skip', spec.bodyNote || 'not checked for this site'));
    } else {
      const matches = doc.querySelectorAll(body).length;
      const words = wordsIn(doc, body, spec.paragraphs);
      const min = spec.minBodyWords ?? 20;
      if (!matches) results.push(result('article body', 'fail', `live.body (${body}) matches nothing`));
      else if (min > 0 && words < min) results.push(result('article body', 'fail', `live.body matches ${matches}, with only ${words} words in paragraphs`));
      else results.push(result('article body', 'pass', `${matches} match(es), ${words} words`));
    }

    // Sites whose fix is lifting the wall: the page must keep sending the whole article.
    if ((spec.method === 'lift' || spec.method === 'guard') && body && spec.body !== false) {
      const words = wordsIn(doc, body, spec.paragraphs);
      const ld = adapter.articleLd(doc);
      const expected = ld && (ld.wordCount || ld.bodyWords);
      // As the adapters judge it (adapter.wholeTextOnPage): at least 3/4 of the JSON-LD's length.
      const whole = words === null || !expected ? null : words >= expected * 0.75;
      if (whole === true) results.push(result('whole text sent', 'pass', `${words} of ${expected} words`));
      else if (whole === false) results.push(result('whole text sent', 'fail', `${words} of ${expected} words: the site may now cut the text before sending it`));
      else if (words !== null && spec.minWords) {
        results.push(words >= spec.minWords
          ? result('whole text sent', 'pass', `${words} words (the page gives no length; at least ${spec.minWords} expected)`)
          : result('whole text sent', 'fail', `only ${words} words, at least ${spec.minWords} expected: the site may now cut the text`));
      } else results.push(result('whole text sent', 'skip', 'the page gives no length to compare with'));
    }

    // live.keep: the parts a wall deletes and the extension puts back must still be there to keep.
    if (site.live.keep) {
      const missing = splitSelectors(site.live.keep).filter(sel => !doc.querySelector(sel));
      results.push(missing.length
        ? result('parts to keep', 'fail', `not on the page: ${missing.join(' | ')}`)
        : result('parts to keep', 'pass', `${splitSelectors(site.live.keep).length} found`));
    }

    for (const text of (spec.markers && spec.markers.html) || []) {
      results.push(page.html.includes(text)
        ? result(`"${text}" in the page`, 'pass', 'found')
        : result(`"${text}" in the page`, 'fail', 'missing: the page-world guard may be waiting for an event the site no longer sends'));
    }
    return results;
  }

  // Scripts the guard's markers live in: [{ marker, url }] for the caller to fetch.
  function markerScripts(spec, page) {
    const wanted = (spec.markers && spec.markers.scripts) || [];
    if (!wanted.length || unusable(page)) return [];
    const srcs = [...page.doc.querySelectorAll('script[src]')].map(s => {
      try { return new URL(s.getAttribute('src'), page.url).href; } catch { return null; }
    }).filter(Boolean);
    return wanted.map(marker => ({ marker, url: srcs.find(src => marker.src.test(src)) || null }));
  }

  // One marker script, fetched: does it still hold the strings the guard waits for?
  function checkScript(marker, script) {
    const check = `${marker.name} script`;
    if (!script) return [result(check, 'fail', `no script matching ${marker.src} on the page`)];
    if (!script.ok || script.status >= 400) return [result(check, 'skip', `couldn't load it (${script.error || `HTTP ${script.status}`})`)];
    const missing = marker.texts.filter(t => !script.text.includes(t));
    return [missing.length
      ? result(check, 'fail', `missing ${missing.map(t => `"${t}"`).join(', ')}: the page-world guard may be waiting for an event the site no longer sends`)
      : result(check, 'pass', `${marker.texts.length} string(s) found`)];
  }

  // Several samples' results, one check at a time. A real breakage (a renamed selector, text cut
  // before sending) fails on every article; an odd page (LA Times' "trend analysis" hub under
  // /story/, the Globe's interactive features) fails on one. So a check fails only when it fails
  // on most of the samples it could run on; a lone failure is a note on a pass.
  // perSample: [{ sample, results: [...] }].
  function combine(perSample) {
    const order = [];
    const byCheck = new Map();
    for (const { sample, results } of perSample) {
      for (const r of results) {
        if (!byCheck.has(r.check)) { byCheck.set(r.check, []); order.push(r.check); }
        byCheck.get(r.check).push({ ...r, sample });
      }
    }
    return order.map(check => {
      const all = byCheck.get(check);
      const ran = all.filter(r => r.status !== 'skip');
      if (!ran.length) return { ...all[0], sample: undefined };
      const fails = ran.filter(r => r.status === 'fail');
      const of = `${ran.length} sample${ran.length > 1 ? 's' : ''}`;
      if (fails.length * 2 > ran.length) {
        return result(check, 'fail', `${ran.length > 1 ? `failed on ${fails.length} of ${of}: ` : ''}${fails[0].detail}`);
      }
      const passing = ran.find(r => r.status === 'pass');
      const note = fails.length ? `; ${fails.length} of ${of} didn't (${fails[0].sample}: ${fails[0].detail}), probably an unusual page` : '';
      return result(check, 'pass', `${passing.detail}${ran.length > 1 ? ` (${ran.length - fails.length} of ${of})` : ''}${note}`);
    });
  }

  // A site's overall state: 'fail' if any check failed, 'skip' if nothing could be checked,
  // else 'pass'.
  function overall(results) {
    if (results.some(r => r.status === 'fail')) return 'fail';
    if (results.every(r => r.status === 'skip')) return 'skip';
    return 'pass';
  }

  const health = { unusable, checkHome, checkArticle, markerScripts, checkScript, combine, overall, splitSelectors };
  root.NYTFix = Object.assign(root.NYTFix || {}, { health });
  if (typeof module === 'object' && module.exports) module.exports = health;
})(globalThis);
