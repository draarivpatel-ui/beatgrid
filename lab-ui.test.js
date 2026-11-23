'use strict';

// Wave 5 UI coverage: the polyrhythm and phase lab inside the real page.
// Every check executes the shipped index.html, rhythm.js, polyrhythm-lab.js,
// and app.js through the deterministic DOM harness.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPage, auditPage } = require('./dom-harness.cjs');
const R = require('./rhythm.js');
const L = require('./polyrhythm-lab.js');

const ENSEMBLE_IDS = ['default-study', 'tresillo-cinquillo-poly', 'balkan-compound', 'prime-phase-drift', 'binary-grid-control'];

/* ------------------------------------------------------------------ */
/* Boot and structure                                                  */
/* ------------------------------------------------------------------ */

test('lab section boots unhidden with the module present', () => {
  const page = createPage(__dirname);
  assert.equal(page.get('labPanel').hidden, false);
  auditPage(page);
});

test('ensemble select exposes five presets plus the live workspace', () => {
  const page = createPage(__dirname);
  const options = page.get('labEnsembleSel').querySelectorAll('option');
  assert.equal(options.length, 6);
  assert.equal(options.at(-1).getAttribute('value'), 'live-workspace');
  assert.equal(page.get('labEnsembleSel').value, 'default-study');
});

test('comparator lists every ensemble row with the active one marked', () => {
  const page = createPage(__dirname);
  const rows = page.get('labCompareTable').querySelectorAll('tbody tr.lab-compare-row');
  assert.equal(rows.length, 6);
  assert.equal(rows[0].getAttribute('data-ensemble'), 'default-study');
  assert.ok(rows[0].className.includes('is-active'));
  assert.equal(rows.at(-1).getAttribute('data-ensemble'), 'live-workspace');
});

test('comparator row values match module analysis', () => {
  const page = createPage(__dirname);
  const rows = page.get('labCompareTable').querySelectorAll('tbody tr.lab-compare-row');
  const expected = { 'default-study': '72', 'tresillo-cinquillo-poly': '48', 'balkan-compound': '693', 'prime-phase-drift': '1001', 'binary-grid-control': '16', 'live-workspace': '72' };
  rows.forEach((row) => {
    const horizon = row.querySelectorAll('td')[1].textContent;
    assert.equal(horizon, expected[row.getAttribute('data-ensemble')], row.getAttribute('data-ensemble'));
  });
});

test('voice detail table mirrors the active ensemble', () => {
  const page = createPage(__dirname);
  const rows = page.get('labVoiceTable').querySelectorAll('tbody tr');
  assert.equal(rows.length, 3);
  assert.match(rows[0].textContent, /Tresillo/);
  assert.equal(rows[0].querySelectorAll('td')[1].textContent, '10010010');
  assert.equal(rows[0].querySelectorAll('td')[2].textContent, R.canonicalVector(R.euclideanRhythm(3, 8, 0)).join(''));
});

test('voice select lists the active ensemble voices', () => {
  const page = createPage(__dirname);
  const options = page.get('labVoiceSel').querySelectorAll('option');
  assert.equal(options.length, 3);
  assert.match(options[0].textContent, /Tresillo/);
});

/* ------------------------------------------------------------------ */
/* Comparator row selection                                            */
/* ------------------------------------------------------------------ */

for (const id of ENSEMBLE_IDS.slice(1)) {
  test(`clicking the ${id} row activates that ensemble`, () => {
    const page = createPage(__dirname);
    page.get('labCompareTable').querySelectorAll('tbody tr.lab-compare-row').find((r) => r.getAttribute('data-ensemble') === id).click();
    assert.equal(page.get('labEnsembleSel').value, id);
    // Rows re-render on selection: re-query for the active marker.
    const fresh = page.get('labCompareTable').querySelectorAll('tbody tr.lab-compare-row').find((r) => r.getAttribute('data-ensemble') === id);
    assert.ok(fresh.className.includes('is-active'));
    const expectedVoices = L.ensembleById(id).tracks.length;
    assert.equal(page.get('labVoiceTable').querySelectorAll('tbody tr').length, expectedVoices);
    assert.equal(page.get('labVoiceSel').querySelectorAll('option').length, expectedVoices);
  });
}

test('keyboard Enter on a comparator row selects it', () => {
  const page = createPage(__dirname);
  const row = page.get('labCompareTable').querySelectorAll('tbody tr.lab-compare-row').find((r) => r.getAttribute('data-ensemble') === 'balkan-compound');
  page.fire(row, 'keydown', { code: 'Enter' });
  assert.equal(page.get('labEnsembleSel').value, 'balkan-compound');
});

test('the ensemble select drives the same switch as row clicks', () => {
  const page = createPage(__dirname);
  page.get('labEnsembleSel').value = 'prime-phase-drift';
  page.fire(page.get('labEnsembleSel'), 'change');
  assert.equal(page.get('labVoiceTable').querySelectorAll('tbody tr').length, 3);
  assert.match(page.get('labSweepSvg').textContent, /rotation r of Prime seven/);
  assert.match(page.get('labSweepCaption').textContent, /In-phase rotations r = /);
});

/* ------------------------------------------------------------------ */
/* Necklace SVG                                                        */
/* ------------------------------------------------------------------ */

test('necklace draws one guide ring and dots per shown voice', () => {
  const page = createPage(__dirname);
  const guides = page.get('labNecklaceSvg').querySelectorAll('.neck-guide');
  assert.equal(guides.length, 3);
  const dots = page.get('labNecklaceSvg').querySelectorAll('.neck-dot');
  assert.equal(dots.length, 8 + 12 + 9);
});

test('necklace draws coincident onset rays for shared hits', () => {
  const page = createPage(__dirname);
  const rays = page.get('labNecklaceSvg').querySelectorAll('.neck-ray');
  const analysis = L.analyzeEnsemble(L.ensembleById('default-study').tracks, 120);
  assert.ok(rays.length > 0);
  assert.ok(rays.length <= analysis.coincidenceSteps.length);
});

test('necklace polygons connect onset vertices per voice', () => {
  const page = createPage(__dirname);
  const polys = page.get('labNecklaceSvg').querySelectorAll('.neck-poly');
  assert.equal(polys.length, 3);
  for (const poly of polys) assert.match(poly.getAttribute('d'), /^M[\d.]+ [\d.]+/);
});

test('necklace caps at four voices for a five plus voice workspace', () => {
  const page = createPage(__dirname);
  const row = page.get('labCompareTable').querySelectorAll('tbody tr.lab-compare-row').find((r) => r.getAttribute('data-ensemble') === 'tresillo-cinquillo-poly');
  row.click();
  assert.equal(page.get('labNecklaceSvg').querySelectorAll('.neck-guide').length, 4);
  assert.match(page.get('labNecklaceCaption').textContent, /4 of 4 voices/);
});

/* ------------------------------------------------------------------ */
/* Rotation sweep chart                                                */
/* ------------------------------------------------------------------ */

test('sweep chart draws one focusable bar per rotation step', () => {
  const page = createPage(__dirname);
  const bars = page.get('labSweepSvg').querySelectorAll('.sweep-bar');
  assert.equal(bars.length, 8);
  for (const bar of bars) {
    assert.equal(bar.getAttribute('tabindex'), '0');
    assert.equal(bar.getAttribute('role'), 'button');
    assert.match(bar.getAttribute('aria-label'), /Rotation \d of 8/);
  }
});

test('sweep bar counts match the module sweep for each voice', () => {
  const page = createPage(__dirname);
  const ens = L.ensembleById('default-study');
  [0, 1, 2].forEach((voice) => {
    page.get('labVoiceSel').value = String(voice);
    page.fire(page.get('labVoiceSel'), 'change');
    const bars = page.get('labSweepSvg').querySelectorAll('.sweep-bar');
    assert.equal(bars.length, ens.tracks[voice].steps, 'voice ' + voice + ' bar count');
  });
});

test('clicking a sweep bar selects its rotation and reports details', () => {
  const page = createPage(__dirname);
  page.get('labSweepSvg').querySelectorAll('.sweep-bar')[3].click();
  assert.match(page.get('labRotReadout').textContent, /Rotation 3 selected: \d+ coincidences, syncopation [\d.]+/);
  // Bars re-render on selection: re-query for the marker.
  const fresh = page.get('labSweepSvg').querySelectorAll('.sweep-bar')[3];
  assert.ok(fresh.className.includes('is-selected'));
});

test('keyboard Enter on a sweep bar selects its rotation', () => {
  const page = createPage(__dirname);
  const bars = page.get('labSweepSvg').querySelectorAll('.sweep-bar');
  page.fire(bars[5], 'keydown', { code: 'Enter' });
  assert.match(page.get('labRotReadout').textContent, /Rotation 5 selected/);
});

test('sweep focus shows the shared tooltip with sweep details', () => {
  const page = createPage(__dirname);
  const bars = page.get('labSweepSvg').querySelectorAll('.sweep-bar');
  bars[0].focus();
  const tip = page.get('wheelTooltip');
  assert.equal(tip.hidden, false);
  assert.match(tip.textContent, /Rotation 0/);
  assert.match(tip.textContent, /coincidences/);
});

test('in-phase and hocket bars carry their marker classes', () => {
  const page = createPage(__dirname);
  const sweep = L.rotationSweep(L.ensembleById('default-study').tracks, 0, 120);
  const bars = page.get('labSweepSvg').querySelectorAll('.sweep-bar');
  for (const r of sweep.inPhase) assert.ok(bars[r].className.includes('is-inphase'), 'r=' + r + ' in-phase');
  for (const r of sweep.hocket) assert.ok(bars[r].className.includes('is-hocket'), 'r=' + r + ' hocket');
  assert.match(page.get('labSweepCaption').textContent, /In-phase rotations r = /);
});

test('apply rotation updates the applied state and voice table', () => {
  const page = createPage(__dirname);
  const bars = page.get('labSweepSvg').querySelectorAll('.sweep-bar');
  bars[2].click();
  page.get('labApplyRotBtn').click();
  assert.match(page.get('labRotReadout').textContent, /Rotation 2 applied/);
  assert.ok(page.get('labSweepSvg').querySelectorAll('.sweep-bar')[2].className.includes('is-applied'));
  const rotCell = page.get('labVoiceTable').querySelectorAll('tbody tr')[0].querySelectorAll('td').at(-1);
  assert.equal(rotCell.textContent, '2');
});

test('applied rotation changes the analyzed voice vector', () => {
  const page = createPage(__dirname);
  const before = page.get('labVoiceTable').querySelectorAll('tbody tr')[0].querySelectorAll('td')[1].textContent;
  page.get('labSweepSvg').querySelectorAll('.sweep-bar')[2].click();
  page.get('labApplyRotBtn').click();
  const after = page.get('labVoiceTable').querySelectorAll('tbody tr')[0].querySelectorAll('td')[1].textContent;
  assert.notEqual(after, before);
  const expected = R.euclideanRhythm(3, 8, 2).join('');
  assert.equal(after, expected);
  // The canonical column stays identical: it is rotation invariant by design.
  const canonical = page.get('labVoiceTable').querySelectorAll('tbody tr')[0].querySelectorAll('td')[2].textContent;
  assert.equal(canonical, R.canonicalVector(R.euclideanRhythm(3, 8, 0)).join(''));
});

test('applied rotation changes the audited brief digest', () => {
  const page = createPage(__dirname);
  const before = page.get('labDigest').getAttribute('data-digest');
  page.get('labSweepSvg').querySelectorAll('.sweep-bar')[1].click();
  page.get('labApplyRotBtn').click();
  const after = page.get('labDigest').getAttribute('data-digest');
  assert.match(before, /^[0-9a-f]{64}$/);
  assert.match(after, /^[0-9a-f]{64}$/);
  assert.notEqual(after, before);
});

test('applied rotation survives a voice reselect round trip', () => {
  const page = createPage(__dirname);
  page.get('labSweepSvg').querySelectorAll('.sweep-bar')[3].click();
  page.get('labApplyRotBtn').click();
  page.get('labVoiceSel').value = '1';
  page.fire(page.get('labVoiceSel'), 'change');
  page.get('labVoiceSel').value = '0';
  page.fire(page.get('labVoiceSel'), 'change');
  const rotCell = page.get('labVoiceTable').querySelectorAll('tbody tr')[0].querySelectorAll('td').at(-1);
  assert.equal(rotCell.textContent, '3');
});

/* ------------------------------------------------------------------ */
/* Lab tempo                                                           */
/* ------------------------------------------------------------------ */

test('lab tempo input re-analyzes at a valid bpm', () => {
  const page = createPage(__dirname);
  const before = page.get('labDigest').getAttribute('data-digest');
  page.get('labBpm').value = '60';
  page.fire(page.get('labBpm'), 'input');
  // BPM is part of the brief payload, so the digest must rotate with it.
  const brief = L.briefFor({ e: 'default-study', bpm: 60, voice: 0, rot: 0 });
  assert.equal(page.get('labDigest').getAttribute('data-digest'), brief.digest);
  assert.notEqual(brief.digest, before);
});

test('lab tempo reverts hostile input on change', () => {
  const page = createPage(__dirname);
  for (const bad of ['abc', '301', '19', '120.5', '']) {
    page.get('labBpm').value = bad;
    page.fire(page.get('labBpm'), 'change');
    assert.equal(page.get('labBpm').value, '120', 'bad input ' + bad);
    assert.match(page.get('labAuditStatus').textContent, /20 to 300/);
  }
});

/* ------------------------------------------------------------------ */
/* Load ensemble into studio                                           */
/* ------------------------------------------------------------------ */

test('load ensemble replaces studio voices with lab tracks', () => {
  const page = createPage(__dirname);
  page.get('labCompareTable').querySelectorAll('tbody tr.lab-compare-row').find((r) => r.getAttribute('data-ensemble') === 'balkan-compound').click();
  page.get('labLoadBtn').click();
  const rows = page.get('trackEditor').querySelectorAll('.track-row');
  assert.equal(rows.length, 3);
  const nameInput = rows[0].querySelectorAll('.track-name-input')[0];
  assert.equal(nameInput.value, 'Aksak seven');
  assert.equal(page.get('statCycle').textContent, '693');
  assert.match(page.get('sessionStatus').textContent, /Loaded 3 voices/);
});

test('load ensemble applies the sweep rotation to the studio voice', () => {
  const page = createPage(__dirname);
  page.get('labSweepSvg').querySelectorAll('.sweep-bar')[2].click();
  page.get('labApplyRotBtn').click();
  page.get('labLoadBtn').click();
  const session = JSON.parse(page.get('sessionJson').value || 'null');
  assert.ok(session === null); // textarea untouched until export
  page.get('exportSessionBtn').click();
  const exported = R.importSession(page.get('sessionJson').value);
  assert.equal(exported.tracks[0].rotation, 2);
  assert.equal(exported.tracks[0].steps, 8);
});

test('load button is disabled for the live workspace row', () => {
  const page = createPage(__dirname);
  const row = page.get('labCompareTable').querySelectorAll('tbody tr.lab-compare-row').find((r) => r.getAttribute('data-ensemble') === 'live-workspace');
  row.click();
  assert.equal(page.get('labLoadBtn').disabled, true);
});

/* ------------------------------------------------------------------ */
/* Audited exports and digest parity                                   */
/* ------------------------------------------------------------------ */

test('digest line carries a 64 hex fingerprint', () => {
  const page = createPage(__dirname);
  const digest = page.get('labDigest').getAttribute('data-digest');
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.match(page.get('labDigest').textContent, new RegExp(digest.slice(0, 16)));
});

test('JSON, CSV, and Markdown exports share the on page digest', async () => {
  const page = createPage(__dirname);
  const digest = page.get('labDigest').getAttribute('data-digest');
  page.get('labJsonBtn').click();
  page.get('labCsvBtn').click();
  page.get('labMdBtn').click();
  const names = page.document.downloads.map((d) => d.filename);
  assert.deepEqual(names, ['beatgrid-study-brief.json', 'beatgrid-study-brief.csv', 'beatgrid-study-brief.md']);
  const texts = await Promise.all(page.document.downloads.map((d) => page.blobs.get(d.href).text()));
  for (const text of texts) assert.ok(text.includes(digest), 'export missing the page digest');
  const parsed = JSON.parse(texts[0]);
  assert.equal(parsed.sha256, digest);
  assert.equal(L.verifyBrief(texts[0]).ok, true);
});

test('verify button confirms the exported digest', () => {
  const page = createPage(__dirname);
  page.get('labVerifyBtn').click();
  assert.match(page.get('labAuditStatus').textContent, /Digest verified: payload matches [0-9a-f]{24}/);
});

test('tamper check reports a flagged mismatch', () => {
  const page = createPage(__dirname);
  page.get('labTamperBtn').click();
  assert.match(page.get('labAuditStatus').textContent, /flagged a mismatch as designed/);
});

test('share link field fills with a decodable #bg= hash', () => {
  const page = createPage(__dirname);
  page.get('labLinkBtn').click();
  const link = page.get('labShareOut').value;
  const hash = link.slice(link.indexOf('#'));
  assert.ok(hash.startsWith('#bg='));
  const decoded = L.decodeShareHash(hash);
  assert.deepEqual(decoded, { e: 'default-study', bpm: 120, voice: 0, rot: 0 });
  assert.match(link, /^http:\/\/beatgrid\.test\/index\.html#bg=/);
});

test('share link reflects the applied rotation', () => {
  const page = createPage(__dirname);
  page.get('labSweepSvg').querySelectorAll('.sweep-bar')[4].click();
  page.get('labApplyRotBtn').click();
  page.get('labLinkBtn').click();
  const link = page.get('labShareOut').value;
  const decoded = L.decodeShareHash(link.slice(link.indexOf('#')));
  assert.equal(decoded.rot, 4);
  assert.equal(decoded.voice, 0);
});

/* ------------------------------------------------------------------ */
/* Self-test runner                                                    */
/* ------------------------------------------------------------------ */

test('self-test runner reports every check passing in the page', () => {
  const page = createPage(__dirname);
  page.get('labSelfTestBtn').click();
  const report = L.runSelfTests();
  assert.equal(page.get('labTestSummary').textContent, report.passed + '/' + report.total + ' self-tests passing');
  const items = page.get('labTestList').querySelectorAll('li');
  assert.equal(items.length, report.total);
  for (const item of items) {
    assert.ok(item.className.includes('is-ok'), item.textContent);
    assert.match(item.textContent, / ok$/);
  }
  assert.ok(report.total >= 16);
});

/* ------------------------------------------------------------------ */
/* Bookmark hash restore                                               */
/* ------------------------------------------------------------------ */

test('bookmark hash on load restores ensemble, bpm, voice, and rotation', () => {
  const hash = L.encodeShareState({ e: 'balkan-compound', bpm: 132, voice: 2, rot: 5 });
  const page = createPage(__dirname, { hash });
  assert.equal(page.get('labEnsembleSel').value, 'balkan-compound');
  assert.equal(page.get('labBpm').value, '132');
  assert.equal(page.get('labVoiceSel').value, '2');
  const bars = page.get('labSweepSvg').querySelectorAll('.sweep-bar');
  assert.equal(bars.length, 11);
  assert.ok(bars[5].className.includes('is-applied'), 'rot 5 should be applied');
  const expected = L.briefFor({ e: 'balkan-compound', bpm: 132, voice: 2, rot: 5, rotations: { 2: 5 } });
  assert.equal(page.get('labDigest').getAttribute('data-digest'), expected.digest);
});

test('bookmark rotation wraps into the voice period', () => {
  const hash = L.encodeShareState({ e: 'default-study', bpm: 120, voice: 0, rot: 10 });
  const page = createPage(__dirname, { hash });
  const bars = page.get('labSweepSvg').querySelectorAll('.sweep-bar');
  assert.ok(bars[2].className.includes('is-applied'), 'rot 10 wraps to 2 on 8 steps');
});

test('out of range bookmark voice clamps to the ensemble size', () => {
  const hash = '#bg=' + L.b64urlEncode(L.utf8Encode('{"v":1,"e":"default-study","bpm":120,"voice":7,"rot":0}'));
  const page = createPage(__dirname, { hash });
  assert.equal(page.get('labVoiceSel').value, '2');
});

test('hostile bookmark hash fails closed to the default lab state', () => {
  const hash = '#bg=' + L.b64urlEncode(L.utf8Encode('{"__proto__":{"x":1},"v":1,"e":"default-study"}'));
  const page = createPage(__dirname, { hash });
  assert.equal(page.get('labPanel').hidden, false);
  assert.equal(page.get('labEnsembleSel').value, 'default-study');
  assert.equal(page.get('labBpm').value, '120');
});

test('hashchange applies a new bookmark without reload', () => {
  const page = createPage(__dirname);
  const hash = L.encodeShareState({ e: 'prime-phase-drift', bpm: 88, voice: 1, rot: 4 });
  page.context.location.hash = hash;
  page.fire(page.context, 'hashchange');
  assert.equal(page.get('labEnsembleSel').value, 'prime-phase-drift');
  assert.equal(page.get('labBpm').value, '88');
  assert.equal(page.get('labVoiceSel').value, '1');
  const bars = page.get('labSweepSvg').querySelectorAll('.sweep-bar');
  assert.ok(bars[4].className.includes('is-applied'));
});

test('reload restoration keeps the studio and lab state consistent', () => {
  const hash = L.encodeShareState({ e: 'binary-grid-control', bpm: 140, voice: 3, rot: 7 });
  const page = createPage(__dirname, { hash });
  assert.equal(page.get('statCycle').textContent, '72'); // studio untouched
  assert.equal(page.get('labEnsembleSel').value, 'binary-grid-control');
  assert.equal(page.get('labVoiceSel').value, '3');
  const bars = page.get('labSweepSvg').querySelectorAll('.sweep-bar');
  assert.equal(bars.length, 16);
  assert.ok(bars[7].className.includes('is-applied'));
});

/* ------------------------------------------------------------------ */
/* Live workspace row                                                  */
/* ------------------------------------------------------------------ */

test('live workspace row tracks studio edits', () => {
  const page = createPage(__dirname);
  const before = page.get('labCompareTable').querySelectorAll('tbody tr.lab-compare-row').at(-1).querySelectorAll('td')[2].textContent;
  page.get('addTrackBtn').click();
  const row = page.get('labCompareTable').querySelectorAll('tbody tr.lab-compare-row').at(-1);
  // Column 2 is the coincidence cell; a fourth voice moves it.
  assert.notEqual(row.querySelectorAll('td')[2].textContent, before);
  assert.equal(row.querySelectorAll('td')[0].textContent, '4');
});

test('live workspace analysis matches the studio analysis', () => {
  const page = createPage(__dirname);
  page.get('labCompareTable').querySelectorAll('tbody tr.lab-compare-row').find((r) => r.getAttribute('data-ensemble') === 'live-workspace').click();
  assert.equal(page.get('labVoiceTable').querySelectorAll('tbody tr').length, 3);
  const vectors = [...page.get('labVoiceTable').querySelectorAll('tbody tr')].map((r2) => r2.querySelectorAll('td')[1].textContent);
  assert.deepEqual(vectors, ['10010010', '101101011010', '101010100']);
});

/* ------------------------------------------------------------------ */
/* Graceful degradation                                                */
/* ------------------------------------------------------------------ */

test('the lab hides gracefully when polyrhythm-lab.js is absent', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beatgrid-nolab-'));
  try {
    for (const name of ['index.html', 'style.css', 'rhythm.js', 'app.js']) {
      fs.copyFileSync(path.join(__dirname, name), path.join(tmp, name));
    }
    const html = fs.readFileSync(path.join(tmp, 'index.html'), 'utf8').replace('<script src="polyrhythm-lab.js"></script>\n', '');
    fs.writeFileSync(path.join(tmp, 'index.html'), html);
    const page = createPage(tmp);
    assert.equal(page.get('labPanel').hidden, true);
    assert.equal(page.get('statCycle').textContent, '72');
    auditPage(page);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* Print and theme preservation                                        */
/* ------------------------------------------------------------------ */

test('print stylesheet hides the lab panel', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
  const printBlock = css.match(/@media print \{([\s\S]*)\}\s*$/);
  assert.ok(printBlock, 'print block missing');
  assert.match(printBlock[1], /#labPanel/);
});

test('theme toggle still works with the lab active', () => {
  const page = createPage(__dirname);
  page.get('themeBtn').click();
  assert.equal(page.document.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(page.get('labPanel').hidden, false);
  assert.ok(page.get('labNecklaceSvg').querySelectorAll('.neck-dot').length > 0);
});

test('existing studio panels still render beside the lab', () => {
  const page = createPage(__dirname);
  assert.equal(page.get('statCycle').textContent, '72');
  assert.equal(page.get('trackEditor').children.length, 3);
  assert.ok(page.get('wheelSvg').querySelectorAll('.wheel-dot').length > 0);
  assert.match(page.get('lilyPreview').textContent, /DrumStaff/);
  assert.match(page.get('hexDump').textContent, /4D 54 68 64/);
});
