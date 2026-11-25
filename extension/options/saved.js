// The saved articles on the settings page, in words: what cache.list() gives, as rows, and the rows as
// elements. Titles come from the sites' pages, so they only ever go in as text.
(function (root) {
  'use strict';

  const DAY = 24 * 60 * 60 * 1000;
  const size = bytes => (bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);
  const total = articles => `${articles.length} article${articles.length === 1 ? '' : 's'}, ${size(articles.reduce((n, a) => n + a.bytes, 0))}`;

  // Days by the calendar, as the reader counts them: 'today', 'yesterday', '3 days ago'
  function savedOn(savedAt, now) {
    const midnight = ms => new Date(ms).setHours(0, 0, 0, 0);
    const days = Math.round((midnight(now) - midnight(savedAt)) / DAY);
    return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  }

  // Saved before titles were: the address's last part, as words ("lead-explosion-middletown.html"),
  // without the number many outlets put in it.
  function titleFromUrl(url) {
    let parts = [];
    try { parts = decodeURIComponent(url.pathname).split('/').filter(Boolean); } catch { parts = url.pathname.split('/').filter(Boolean); }
    const wordy = parts.reverse().find(p => /[a-z]{3,}.*-.*[a-z]/i.test(p)) || parts[0] || '';
    const words = wordy.replace(/\.[a-z]{3,5}$/i, '').split('-').filter(w => w && !/^([0-9a-f]{8,}|p[0-9a-z]{5}|\d{5,})$/i.test(w)).join(' ');
    return /[a-z]{3,}/i.test(words) ? words.charAt(0).toUpperCase() + words.slice(1) : url.hostname;
  }

  // { url, title, meta } for each. siteName(hostname): the outlet's name, or null.
  function rows(articles, { siteName = () => null, now = Date.now() } = {}) {
    return articles.flatMap(article => {
      let url;
      try { url = new URL(article.url); } catch { return []; }
      if (url.protocol !== 'https:') return [];
      const meta = [siteName(url.hostname) || url.hostname.replace(/^www\./, ''), `saved ${savedOn(article.savedAt, now)}`, size(article.bytes)];
      if (article.partial) meta.push('may be missing its end');
      return [{ url: article.url, title: article.title || titleFromUrl(url), meta: meta.join(' · ') }];
    });
  }

  // onRemove(row): the row's Remove button was clicked.
  function build(doc, row, onRemove) {
    const item = doc.createElement('li');
    const words = doc.createElement('div');
    words.className = 'saved-words';
    const link = doc.createElement('a');
    link.href = row.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = row.title;
    const meta = doc.createElement('span');
    meta.className = 'saved-meta';
    meta.textContent = row.meta;
    words.append(link, meta);
    const remove = doc.createElement('button');
    remove.type = 'button';
    remove.className = 'nf-link saved-remove';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${row.title}`);
    remove.addEventListener('click', () => onRemove(row));
    item.append(words, remove);
    return item;
  }

  const saved = { size, total, savedOn, rows, build };
  root.NYTFix = Object.assign(root.NYTFix || {}, { saved });
  if (typeof module === 'object' && module.exports) module.exports = saved;
})(globalThis);
