const test = require('node:test');
const assert = require('node:assert/strict');
const settings = require('../extension/src/settings.js');
const { memoryArea } = require('./fixtures.js');

const DEFAULTS = { mirror: 'archive.ph', enabled: true, disabledSites: [], alwaysConfirm: false, donated: false };

test('defaults: archive.ph, on everywhere', async () => {
  assert.deepEqual(await settings.load(memoryArea()), DEFAULTS);
});

test('saves a mirror and loads it back', async () => {
  const area = memoryArea();
  assert.deepEqual(await settings.save(area, { mirror: 'archive.is' }), { ...DEFAULTS, mirror: 'archive.is' });
  assert.deepEqual(await settings.load(area), { ...DEFAULTS, mirror: 'archive.is' });
});

test('settings saved by an older version (the mirror only) load with the new defaults', async () => {
  assert.deepEqual(await settings.load(memoryArea({ settings: { mirror: 'archive.is' } })), { ...DEFAULTS, mirror: 'archive.is' });
});

test('anything that is not an archive.today mirror falls back to the default', async () => {
  assert.deepEqual(await settings.load(memoryArea({ settings: { mirror: 'evil.example' } })), DEFAULTS);
  const area = memoryArea();
  await settings.save(area, { mirror: 'evil.example' });
  assert.deepEqual(area.data.settings, DEFAULTS);
});

test('a broken storage area still gives the defaults', async () => {
  const broken = { get: async () => { throw new Error('storage unavailable'); } };
  assert.deepEqual(await settings.load(broken), DEFAULTS);
});

test('off everywhere, or on one site: isOn answers per adapter id', async () => {
  const area = memoryArea();
  await settings.setSite(area, 'nyt', false);
  await settings.setSite(area, 'smh', false);
  await settings.setSite(area, 'nyt', false); // twice: listed once
  let prefs = await settings.load(area);
  assert.deepEqual(prefs.disabledSites, ['nyt', 'smh']);
  assert.equal(settings.isOn(prefs, 'nyt'), false);
  assert.equal(settings.isOn(prefs, 'theage'), true, "The Age stays on when the Herald is off");
  prefs = await settings.setSite(area, 'nyt', true);
  assert.deepEqual(prefs.disabledSites, ['smh']);
  prefs = await settings.save(area, { enabled: false });
  assert.equal(settings.isOn(prefs, 'theage'), false, 'off everywhere');
  assert.deepEqual(prefs.disabledSites, ['smh'], 'the per-site list is kept for when it comes back on');
});

test('only true, false and site ids are kept', async () => {
  assert.deepEqual(settings.normalize({ enabled: 'no', disabledSites: ['nyt', 7, '<b>', 'nyt', ''] }), { ...DEFAULTS, disabledSites: ['nyt'] });
  assert.deepEqual(settings.normalize({ disabledSites: 'nyt' }), DEFAULTS);
  assert.deepEqual(settings.normalize(null), DEFAULTS);
  assert.equal(settings.normalize({ alwaysConfirm: 'yes' }).alwaysConfirm, false);
  assert.equal(settings.normalize({ alwaysConfirm: true }).alwaysConfirm, true);
});

test('onChange: only the sync area\'s settings, normalized', () => {
  const listeners = [];
  const seen = [];
  settings.onChange({ onChanged: { addListener: fn => listeners.push(fn) } }, prefs => seen.push(prefs));
  listeners[0]({ settings: { newValue: { enabled: false } } }, 'sync');
  listeners[0]({ settings: { newValue: { enabled: false } } }, 'local');
  listeners[0]({ 'article:x': { newValue: {} } }, 'sync');
  assert.deepEqual(seen, [{ ...DEFAULTS, enabled: false }]);
  settings.onChange(undefined, () => {}); // no storage API (tests, old pages): no error
});

test('tipLink: only an https address; a Ko-fi page comes with its donation panel', () => {
  assert.equal(settings.tipLink(''), null);
  assert.equal(settings.tipLink('http://example.com/tip'), null);
  assert.equal(settings.tipLink('javascript:alert(1)'), null);
  assert.deepEqual(settings.tipLink('https://example.com/tip'), { text: 'Support the project', short: 'Donate', href: 'https://example.com/tip', embed: null });
  assert.equal(settings.tipLink().href, 'https://ko-fi.com/readfree', 'the project’s Ko-fi page');
  assert.equal(settings.tipLink().embed, 'https://ko-fi.com/readfree/?hidefeed=true&widget=true&embed=true&preview=true', 'and its donation panel, the form of it another page may frame');
  assert.equal(settings.GIVE_PAGE, 'give/give.html');
});

test("aidLink: UNRWA's own donation page, with nothing added to the address", () => {
  assert.deepEqual(settings.aidLink(), { name: 'UNRWA', href: 'https://www.unrwa.org/donate' });
  assert.equal(new URL(settings.AID_URL).search, '', 'no amount or anything else in it: the tally stays in the browser');
  assert.equal(settings.aidLink('http://example.com'), null);
});
