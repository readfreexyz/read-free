const test = require('node:test');
const assert = require('node:assert/strict');
const statusBar = require('../extension/src/status.js');
const { parse } = require('./fixtures.js');

// A status bar on a blank page with a fake clock. Call update() after moving the clock.
function setup() {
  const doc = parse('<!doctype html><html><body></body></html>');
  const clock = { now: 1_000_000 };
  const bar = statusBar.create(doc, { clock: () => clock.now });
  const q = sel => bar.shadow.querySelector(sel);
  const advance = ms => { clock.now += ms; bar.update(); };
  return { doc, bar, q, advance };
}

test('create shows one status bar in a shadow root, replacing any earlier one', () => {
  const { doc, bar } = setup();
  const second = statusBar.create(doc);
  assert.equal(doc.querySelectorAll('#nytfix-status').length, 1);
  assert.equal(doc.getElementById('nytfix-status'), second.host);
  assert.equal(bar.host.isConnected, false);
  assert.equal(second.shadow.querySelector('.bar').getAttribute('role'), 'status');
  second.remove();
});

test('a stage eases toward its end over the expected time and never passes it', () => {
  const { bar, q, advance } = setup();
  bar.stage('download', 'Waiting…', { expectedMs: 9000 });
  assert.ok(Math.abs(bar.progress - 0.12) < 1e-9, 'download starts where find ends');
  advance(9000);
  assert.ok(bar.progress > 0.7 && bar.progress < 0.8, `~79% after the expected time, got ${bar.progress}`);
  assert.ok(Math.abs(parseFloat(q('.fill').style.width) - bar.progress * 100) < 0.1);
  advance(10 * 60000);
  assert.ok(bar.progress <= 0.9, 'never passes the end of the download stage');
  bar.remove();
});

test('progress never goes backwards between stages', () => {
  const { bar, advance } = setup();
  bar.stage('find', 'Finding…', { expectedMs: 1500 });
  advance(1000);
  const afterFind = bar.progress;
  bar.stage('download', 'Waiting…', { expectedMs: 9000 });
  assert.ok(bar.progress >= afterFind);
  advance(60000);
  const afterDownload = bar.progress;
  bar.stage('extract', 'Extracting…', { expectedMs: 400 });
  assert.ok(bar.progress >= afterDownload);
  bar.remove();
});

test('re-entering an earlier stage (a retry) keeps moving forward', () => {
  const { bar, advance } = setup();
  bar.stage('download', 'Waiting…', { expectedMs: 9000 });
  advance(60000);
  bar.stage('extract', 'Extracting…', { expectedMs: 400 });
  advance(400);
  const beforeRetry = bar.progress;
  assert.ok(beforeRetry > 0.9);
  bar.stage('download', 'Trying an older one…', { expectedMs: 9000 });
  assert.ok(bar.progress >= beforeRetry, 'no jump backwards');
  advance(9000);
  assert.ok(bar.progress > beforeRetry && bar.progress < 1, 'still creeping toward the end');
  bar.remove();
});

test('remove(doc) takes down whatever status bar is showing', () => {
  const { doc, bar } = setup();
  statusBar.remove(doc);
  assert.equal(bar.host.isConnected, false);
  statusBar.remove(doc); // nothing showing: no error
});

test('shows elapsed seconds, and the slow label once a stage drags on', () => {
  const { bar, q, advance } = setup();
  bar.stage('download', 'Waiting for archive.today…', { expectedMs: 9000, slowAfterMs: 20000, slowLabel: 'Still waiting…' });
  assert.equal(q('.time').textContent, '', 'no counter for the first second');
  advance(5000);
  assert.equal(q('.label').textContent, 'Waiting for archive.today…');
  assert.equal(q('.time').textContent, '5 s');
  advance(16000);
  assert.equal(q('.label').textContent, 'Still waiting…');
  assert.equal(q('.time').textContent, '21 s');
  bar.remove();
});

test('finish fills the bar, shows the outcome and stops the counter', () => {
  const { bar, q, advance } = setup();
  bar.stage('download', 'Waiting…', { expectedMs: 9000 });
  advance(9000);
  bar.finish('done', 'Showing the archived article.');
  assert.equal(parseFloat(q('.fill').style.width), 100);
  assert.equal(q('.bar').dataset.kind, 'done');
  assert.equal(q('.label').textContent, 'Showing the archived article.');
  assert.equal(q('.time').textContent, '');
  bar.remove();
});

test('finish can show a link; hovering holds the bar so it can be clicked', async () => {
  const { doc, bar, q } = setup();
  bar.finish('done', 'Showing the archived article.', { link: { text: 'Leave a tip', href: 'https://example.com/tip' }, hideAfterMs: 20 });
  const a = q('a.link');
  assert.equal(a.href, 'https://example.com/tip');
  assert.equal(a.textContent, 'Leave a tip');
  assert.equal(a.target, '_blank');
  q('.bar').dispatchEvent(new doc.defaultView.Event('mouseenter'));
  await new Promise(r => setTimeout(r, 400));
  assert.equal(bar.host.isConnected, true, 'still there while hovered');
  bar.remove();
});

test('a link that is not https is not shown', () => {
  const { bar, q } = setup();
  bar.finish('done', 'Done.', { link: { text: 'Bad', href: 'javascript:alert(1)' } });
  assert.equal(q('a'), null);
  bar.remove();
});

test('a finished bar hides itself after a while', async () => {
  const { bar } = setup();
  bar.finish('error', 'archive.today has no snapshot of this article yet.', { hideAfterMs: 10 });
  assert.equal(bar.shadow.querySelector('.bar').dataset.kind, 'error');
  await new Promise(r => setTimeout(r, 400));
  assert.equal(bar.host.isConnected, false);
});

test('clicking a finished bar dismisses it, but clicking while working does not', () => {
  const { bar, q } = setup();
  bar.stage('find', 'Finding…');
  q('.bar').click();
  assert.equal(bar.host.isConnected, true);
  bar.finish('info', 'This page already has the full text.');
  q('.bar').click();
  assert.equal(bar.host.isConnected, false);
});
