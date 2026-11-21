'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPage, auditPage } = require('./dom-harness.cjs');
const R = require('./rhythm.js');

test('HTML IDs, labels, and real scripts boot in both document readiness states', () => {
  for (const loading of [false, true]) {
    const page = createPage(__dirname, { loading, storageBlocked: true });
    auditPage(page);
    assert.equal(page.get('statCycle').textContent, '72');
    assert.equal(page.get('statSeconds').textContent, '9.00');
    assert.equal(page.get('trackEditor').children.length, 3);
    assert.equal(page.get('diagnosticsTable').querySelectorAll('tbody tr').length, 3);
    assert.match(page.get('wheelCaption').textContent, /Inner ring is track 1/);
    assert.equal(page.get('downloadMidiBtn').disabled, false);
  }
});

test('manual pad edits can be restored to their Euclidean vector', () => {
  const page = createPage(__dirname);
  const original = page.get('trackEditor').children[0].querySelectorAll('.step-cell').map(cell => cell.getAttribute('aria-pressed'));
  page.get('trackEditor').children[0].querySelector('.step-cell').click();
  const row = page.get('trackEditor').children[0];
  assert.equal(row.querySelector('.step-cell').getAttribute('aria-pressed'), 'false');
  row.querySelectorAll('button').find(button => button.textContent === 'Reset to Euclidean').click();
  assert.deepEqual(page.get('trackEditor').children[0].querySelectorAll('.step-cell').map(cell => cell.getAttribute('aria-pressed')), original);
  auditPage(page);
});

test('invalid controls clear stale exports and recover when corrected', () => {
  const page = createPage(__dirname);
  for (const invalid of ['', '1e999', '120.5junk', '0']) {
    page.get('bpm').value = invalid;
    page.fire(page.get('bpm'), 'input');
    assert.equal(page.get('downloadMidiBtn').disabled, true);
    assert.equal(page.get('lilyPreview').textContent, '');
    assert.equal(page.get('statCycle').textContent, '-');
    auditPage(page);
  }
  page.get('bpm').value = '150';
  page.fire(page.get('bpm'), 'change');
  assert.equal(page.get('statSeconds').textContent, '7.20');
  assert.equal(page.get('downloadMidiBtn').disabled, false);
  auditPage(page);
});

test('session import is atomic and retains manual patterns and MIDI parameters', async () => {
  const page = createPage(__dirname);
  const session = { schema: 'beatgrid/session', version: 1, title: 'Custom', bpm: 90, ppq: 25, gate: 0.75,
    tracks: [{ name: 'Custom vector', pattern: [0, 1, 0, 1], note: 51, channel: 3, velocity: 80 }] };
  page.get('sessionJson').value = R.exportSession(session);
  page.get('importSessionBtn').click();
  assert.equal(page.get('trackEditor').children.length, 1);
  assert.equal(page.get('ppq').value, '25');
  page.get('exportSessionBtn').click();
  const restored = R.importSession(page.get('sessionJson').value);
  assert.deepEqual(restored, R.validateSession(session));
  const download = page.document.downloads.at(-1);
  assert.equal(download.filename, 'custom.json');
  assert.deepEqual(R.importSession(await page.blobs.get(download.href).text()), restored);
  page.get('sessionJson').value = '{"schema":"other"}';
  page.get('importSessionBtn').click();
  assert.match(page.get('sessionStatus').textContent, /Import rejected/);
  assert.equal(page.get('trackEditor').children.length, 1);
  assert.equal(page.get('bpm').value, '90');
});

test('voice limits, table views, themes, texture, print, and file actions are wired', () => {
  const page = createPage(__dirname);
  for (let index = 0; index < 5; index++) page.get('addTrackBtn').click();
  assert.equal(page.get('trackEditor').children.length, 8);
  assert.equal(page.get('addTrackBtn').disabled, true);
  page.get('wheelTableBtn').click();
  assert.equal(page.get('wheelTableWrap').hidden, false);
  page.get('wheelChartBtn').click();
  assert.equal(page.get('wheelTableWrap').hidden, true);
  page.get('themeBtn').click();
  assert.equal(page.document.documentElement.getAttribute('data-theme'), 'dark');
  page.get('textureToggle').checked = true;
  page.fire(page.get('textureToggle'), 'change');
  assert.equal(page.document.documentElement.getAttribute('data-texture'), 'on');
  page.get('printBtn').click();
  assert.equal(page.document.printed, true);
  page.get('downloadMidiBtn').click();
  page.get('downloadLyBtn').click();
  assert.deepEqual(page.document.downloads.map(item => item.filename), ['beatgrid-study.mid', 'beatgrid-study.ly']);
  page.get('copyLyBtn').click();
  assert.equal(page.get('copyLyBtn').textContent, 'Select and copy');
  auditPage(page);
});

test('oversized cycle imports reject before changing a valid session', () => {
  const page = createPage(__dirname);
  page.get('sessionJson').value = JSON.stringify({ schema: 'beatgrid/session', version: 1, title: 'Large', bpm: 120, ppq: 480, gate: 0.5,
    tracks: [61, 59, 53].map(steps => ({ pulses: 1, steps })) });
  page.get('importSessionBtn').click();
  assert.match(page.get('sessionStatus').textContent, /4096/);
  assert.equal(page.get('statCycle').textContent, '72');
  assert.equal(page.get('downloadMidiBtn').disabled, false);
});

test('silent cycle playhead sweeps the wheel at session tempo', () => {
  const page = createPage(__dirname);
  page.get('cyclePlayBtn').click();
  assert.equal(page.get('cyclePlayBtn').textContent, 'Stop cycle');
  assert.equal(page.get('cyclePlayBtn').getAttribute('aria-pressed'), 'true');
  assert.ok(page.get('wheelSvg').querySelector('#playheadG'));
  assert.match(page.get('playStatus').textContent, /Step 1 of 72 - 3 voices sounding/);
  assert.match(page.get('playStatus').textContent, /coincidence step/);
  const x0 = page.get('wheelSvg').querySelector('#playLine').getAttribute('x2');
  page.flushFrame(125); // one step at 120 bpm with four steps per beat
  assert.match(page.get('playStatus').textContent, /Step 2 of 72/);
  assert.notEqual(page.get('wheelSvg').querySelector('#playLine').getAttribute('x2'), x0);
  for (let index = 0; index < 71; index++) page.flushFrame(125);
  assert.match(page.get('playStatus').textContent, /Step 1 of 72/); // wraps to the cycle start
  page.get('bpm').value = '150';
  page.fire(page.get('bpm'), 'input');
  assert.ok(page.get('wheelSvg').querySelector('#playheadG')); // playhead survives a re-render
  page.get('cyclePlayBtn').click();
  assert.equal(page.get('cyclePlayBtn').textContent, 'Run cycle');
  assert.equal(page.get('cyclePlayBtn').getAttribute('aria-pressed'), 'false');
  assert.equal(page.get('wheelSvg').querySelector('#playheadG'), null);
  assert.equal(page.get('playStatus').textContent, '');
  page.flushFrame(500);
  assert.equal(page.get('playStatus').textContent, '');

  // Restart must not stack RAF loops: one 125 ms frame advances exactly one step.
  page.get('cyclePlayBtn').click();
  page.flushFrame(125);
  assert.match(page.get('playStatus').textContent, /Step 2 of 72/, 'restart advances one step per frame, not two');
  page.flushFrame(125);
  assert.match(page.get('playStatus').textContent, /Step 3 of 72/);
  page.get('cyclePlayBtn').click();
  page.get('cyclePlayBtn').click(); // immediate second start on top of a pending RAF
  page.flushFrame(125);
  assert.match(page.get('playStatus').textContent, /Step 2 of 72/, 'rapid stop+start still runs a single loop');
  page.get('cyclePlayBtn').click();
  auditPage(page);
});
