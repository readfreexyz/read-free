// Saves extracted article text so reloads and revisits swap in instantly instead of waiting
// 8–15 s (or much longer) for archive.today. Only the extracted blocks are stored (about 3 bytes
// per character of text: 50 KB for a long article), never the 3.8 MB snapshot page. Also
// remembers, briefly, that archive.today had no snapshot of an article, so reloads don't keep
// asking.
//
// Articles are kept for 30 days, up to 50 MB in all (the extension asks for unlimitedStorage;
// without it chrome.storage.local stops at 10 MB). Past that, the oldest go first. Each article
// has a small info entry (when it was saved, how big it is) next to its text, so trimming reads
// only those, not every saved article.
//
// `area` is chrome.storage.local in the extension, or any object with the same promise-based
// get/set/remove and, optionally, getKeys (the tests pass an in-memory one).
(function (root) {
  'use strict';

  // the text: { v, savedAt, partial?, blocks, snapshotUrl?, snapshotTime?, left?, leftAs? }. Without a
  // snapshot, it's from the outlet's own page (render.apply)
  const ARTICLE = 'article:';
  const INFO = 'info:';       // beside it: { v, savedAt, partial?, bytes, title? }
  const MISSING = 'missing:'; // { v, savedAt }
  // Bump when the stored shape changes, so old entries are ignored (2: links and photos;
  // 3: info entries).
  const VERSION = 3;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const TTL_MS = 30 * DAY_MS;
  // Someone may archive the article soon, so "no snapshot yet" is only remembered briefly.
  const MISSING_TTL_MS = 30 * 60 * 1000;
  // A copy that may be missing its end (no snapshot looked complete) is kept as briefly, so a
  // fuller snapshot gets a chance.
  const PARTIAL_TTL_MS = 30 * 60 * 1000;
  const MAX_BYTES = 50 * 1024 * 1024;

  // Roughly what chrome.storage counts for an item: its key plus its value as JSON, in UTF-8.
  const sizeOf = (key, value) => new TextEncoder().encode(key + JSON.stringify(value)).length;

  function create(area, { now = Date.now, ttlMs = TTL_MS, missingTtlMs = MISSING_TTL_MS, partialTtlMs = PARTIAL_TTL_MS, maxBytes = MAX_BYTES } = {}) {
    const fresh = (entry, ttl) => Boolean(entry) && entry.v === VERSION && now() - entry.savedAt <= ttl;
    const articleFresh = entry => fresh(entry, entry && entry.partial ? partialTtlMs : ttlMs);

    // Every key in the area, without reading the values (getKeys needs Chrome 130).
    async function allKeys() {
      return typeof area.getKeys === 'function' ? area.getKeys() : Object.keys(await area.get(null));
    }

    // Drop expired entries, leftovers of older versions, and the oldest articles past maxBytes.
    async function sweep() {
      const keys = await allKeys();
      const has = new Set(keys);
      const infoKeys = keys.filter(key => key.startsWith(INFO));
      const missingKeys = keys.filter(key => key.startsWith(MISSING));
      const [infos, missing] = await Promise.all([
        infoKeys.length ? area.get(infoKeys) : {},
        missingKeys.length ? area.get(missingKeys) : {},
      ]);
      const drop = [];
      const kept = [];
      for (const key of infoKeys) {
        const url = key.slice(INFO.length);
        const info = infos[key];
        if (!info || !articleFresh(info) || !has.has(ARTICLE + url)) drop.push(key, ARTICLE + url);
        else kept.push({ url, ...info });
      }
      // Text with no info beside it was saved by an older version.
      for (const key of keys) {
        if (key.startsWith(ARTICLE) && !has.has(INFO + key.slice(ARTICLE.length))) drop.push(key);
      }
      let total = 0;
      for (const article of kept.sort((a, b) => b.savedAt - a.savedAt)) {
        total += article.bytes;
        if (total > maxBytes) drop.push(ARTICLE + article.url, INFO + article.url);
      }
      for (const key of missingKeys) {
        if (!fresh(missing[key], missingTtlMs)) drop.push(key);
      }
      if (drop.length) await area.remove([...new Set(drop)].filter(key => has.has(key)));
    }

    // Returns { blocks, snapshotUrl, snapshotTime, left?, leftAs? } or null.
    async function get(url) {
      const { [ARTICLE + url]: entry } = await area.get(ARTICLE + url);
      if (!entry) return null;
      if (!articleFresh(entry)) {
        await area.remove([ARTICLE + url, INFO + url]);
        return null;
      }
      const kept = { blocks: entry.blocks, snapshotUrl: entry.snapshotUrl, snapshotTime: entry.snapshotTime };
      return entry.left ? { ...kept, left: entry.left, ...(entry.leftAs ? { leftAs: entry.leftAs } : {}) } : kept;
    }

    // partial: the snapshot may be missing its end, so keep it only for partialTtlMs.
    // title: the article's, for the list on the settings page.
    async function put(url, { blocks, snapshotUrl, snapshotTime, left, leftAs }, { partial = false, title = '' } = {}) {
      const savedAt = now();
      const entry = { v: VERSION, savedAt, blocks, snapshotUrl, snapshotTime, ...(left ? { left, ...(leftAs ? { leftAs } : {}) } : {}) };
      const info = { v: VERSION, savedAt, bytes: 0 };
      if (partial) entry.partial = info.partial = true;
      if (title) info.title = String(title).slice(0, 300);
      info.bytes = sizeOf(ARTICLE + url, entry) + sizeOf(INFO + url, info);
      // One set, so the text and its info are written together.
      await area.set({ [ARTICLE + url]: entry, [INFO + url]: info });
      await area.remove(MISSING + url);
      await sweep();
    }

    // When archive.today last said it had no snapshot of this article: { checkedAt } or null.
    async function getMissing(url) {
      const { [MISSING + url]: entry } = await area.get(MISSING + url);
      if (!entry) return null;
      if (!fresh(entry, missingTtlMs)) {
        await area.remove(MISSING + url);
        return null;
      }
      return { checkedAt: entry.savedAt };
    }

    async function putMissing(url) {
      await area.set({ [MISSING + url]: { v: VERSION, savedAt: now() } });
      await sweep();
    }

    const ours = key => key.startsWith(ARTICLE) || key.startsWith(INFO) || key.startsWith(MISSING);

    // The saved articles, newest first (for the options page): { url, savedAt, bytes, partial, title }.
    // Reads the info entries only. Not those that have run out, though they may not be gone yet.
    async function list() {
      const keys = await allKeys();
      const has = new Set(keys);
      const infoKeys = keys.filter(key => key.startsWith(INFO) && has.has(ARTICLE + key.slice(INFO.length)));
      const infos = infoKeys.length ? await area.get(infoKeys) : {};
      return infoKeys
        .filter(key => articleFresh(infos[key]))
        .map(key => ({ url: key.slice(INFO.length), savedAt: infos[key].savedAt, bytes: infos[key].bytes || 0, partial: Boolean(infos[key].partial), title: infos[key].title || '' }))
        .sort((a, b) => b.savedAt - a.savedAt);
    }

    // How many articles are saved, and roughly how many bytes they take.
    async function usage() {
      const articles = await list();
      return { articles: articles.length, bytes: articles.reduce((n, a) => n + a.bytes, 0) };
    }

    // Forget one saved article.
    async function remove(url) {
      await area.remove([ARTICLE + url, INFO + url]);
    }

    // Forget every saved article and "no snapshot yet" answer. Other keys are left alone.
    async function clear() {
      const keys = (await allKeys()).filter(ours);
      if (keys.length) await area.remove(keys);
    }

    return { get, put, getMissing, putMissing, list, usage, remove, clear };
  }

  const cache = { create, INFO, VERSION, TTL_MS, MISSING_TTL_MS, PARTIAL_TTL_MS, MAX_BYTES };
  root.NYTFix = Object.assign(root.NYTFix || {}, { cache });
  if (typeof module === 'object' && module.exports) module.exports = cache;
})(globalThis);
