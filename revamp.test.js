'use strict';

// L569 revamp regressions: arithmetic normalization, strict codecs,
// accessible document structure, ARIA state, markdown export shape, and
// stale lab export invalidation.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPage, auditPage } = require('./dom-harness.cjs');
const R = require('./rhythm.js');
const L = require('./polyrhythm-lab.js');

test('rotation sweep per onset syncopation uses the evaluated meter horizon', () => {
  const sweep = L.rotationSweep([{ pattern: [1, 0, 0] }, { pattern: [0, 1, 0, 1] }], 0, 120);
  const point = sweep.points[0];
  const onsets = 1;
  const evaluatedOnsets = onsets * R.lcm(3, 16) / 3;
  assert.equal(evaluatedOnsets, 16);
  assert.equal(point.syncopation, 20);
  assert.ok(Math.abs(point.syncPerOnset - point.syncopation / evaluatedOnsets) < 1e-12);
});

test('base64url decode rejects noncanonical trailing bits', () => {
  assert.deepEqual(L.b64urlDecode('AA'), [0]);
  assert.deepEqual(L.b64urlDecode('AAA'), [0, 0]);
  assert.equal(L.b64urlDecode('AB'), null);
  assert.equal(L.b64urlDecode('AAB'), null);
});

test('markdown brief escapes table pipes in voice names', () => {
  const brief = L.briefFor({ e: L.LIVE_ID, bpm: 120, voice: 0, rot: 0 }, [
    { name: 'Kick | rim', pattern: [1, 0, 0, 0] }
  ]);
  assert.ok(brief.markdown.includes('Kick \\| rim'), 'voice name pipe is escaped');
  const voiceRow = brief.markdown.split('\n').find((line) => line.includes('Kick \\| rim'));
  assert.equal((voiceRow.match(/(?<!\\)\|/g) || []).length, 9, 'voice row keeps exactly its table delimiters');
});

test('document has one h1 and a keyboard focusable skip target', () => {
  const page = createPage(__dirname);
  auditPage(page);
  const headings = page.document.querySelectorAll('h1');
  assert.equal(headings.length, 1);
  assert.equal(headings[0].textContent, 'BeatGrid');
  assert.equal(page.get('workspace').getAttribute('tabindex'), '-1');
});

test('informational wheel markers are not exposed as buttons', () => {
  const page = createPage(__dirname);
  const hit = page.get('wheelSvg').querySelector('.wheel-hit');
  assert.equal(hit.getAttribute('role'), 'img');
  assert.match(hit.getAttribute('aria-label'), /step 1/);
});

test('active ensemble rows and selected sweep bars expose state to AT', () => {
  const page = createPage(__dirname);
  const rows = page.get('labCompareTable').querySelectorAll('tbody tr.lab-compare-row');
  assert.equal(rows[0].getAttribute('aria-current'), 'true');
  assert.equal(rows[1].getAttribute('aria-current'), null);

  const initialBars = page.get('labSweepSvg').querySelectorAll('.sweep-bar');
  assert.equal(initialBars[0].getAttribute('aria-pressed'), 'true');
  assert.equal(initialBars[1].getAttribute('aria-pressed'), 'false');
  initialBars[3].click();
  const bars = page.get('labSweepSvg').querySelectorAll('.sweep-bar');
  assert.equal(bars[3].getAttribute('aria-pressed'), 'true');
  assert.equal(bars[0].getAttribute('aria-pressed'), 'false');
});

test('stylesheet honors reduced motion without removing state colors', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce\)[\s\S]*transition:\s*none/);
});

function setStepCount(page, rowIndex, steps) {
  const row = page.get('trackEditor').children[rowIndex];
  const input = row.querySelectorAll('.mini-field input')[1];
  assert.ok(input, 'missing step-count input');
  input.value = String(steps);
  page.fire(input, 'change');
}

test('oversized live workspace invalidates stale lab exports until recovery', () => {
  const page = createPage(__dirname);
  const rows = page.get('labCompareTable').querySelectorAll('tbody tr.lab-compare-row');
  rows.find((row) => row.getAttribute('data-ensemble') === L.LIVE_ID).click();
  assert.match(page.get('labDigest').textContent, /SHA-256 brief fingerprint/);

  setStepCount(page, 0, 61);
  setStepCount(page, 1, 59);

  assert.match(page.get('labAuditStatus').textContent, /Lab paused/);
  assert.equal(page.get('labDigest').textContent, '');
  assert.equal(page.get('labDigest').getAttribute('data-digest'), null);
  for (const id of ['labJsonBtn', 'labCsvBtn', 'labMdBtn', 'labLinkBtn', 'labVerifyBtn', 'labTamperBtn', 'labApplyRotBtn', 'labLoadBtn']) {
    assert.equal(page.get(id).disabled, true, id + ' remains enabled with stale data');
  }

  page.get('labCompareTable').querySelectorAll('tbody tr.lab-compare-row')
    .find((row) => row.getAttribute('data-ensemble') === 'default-study').click();
  assert.match(page.get('labDigest').textContent, /SHA-256 brief fingerprint/);
  assert.equal(page.get('labJsonBtn').disabled, false);
  assert.equal(page.get('labApplyRotBtn').disabled, false);
});
