'use strict';

// Wave 4: strict review fixes. Atomic pattern import that validates the
// prospective session before touching the workspace, MIDI voice fields
// that round-trip through pattern records, a persistent off switch for
// the single-key shortcuts (WCAG 2.1.4), and a canonical JSON writer
// that never builds an intermediate plain object.

const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('./rhythm.js');
const { createPage, auditPage } = require('./dom-harness.cjs');

const vec = (s) => Array.from(s, (c) => (c === '1' ? 1 : 0));
const str = (v) => v.join('');

/* ------------------------------------------------------------------ */
/* Atomic pattern import                                               */
/* ------------------------------------------------------------------ */

test('a rejected oversized pattern import leaves voices, downloads, and MIDI bytes untouched', async () => {
  const page = createPage(__dirname);
  // Default voices run 8, 12, and 9 steps on a shared 72-step cycle.
  page.get('downloadMidiBtn').click();
  const first = page.document.downloads.at(-1);
  const midiBefore = new Uint8Array(await page.blobs.get(first.href).arrayBuffer());

  // lcm(72, 61) = 4392 exceeds the 4096-step shared cycle limit.
  page.get('sessionJson').value = R.exportPattern([1, ...Array(60).fill(0)]);
  page.get('importSessionBtn').click();

  assert.match(page.get('sessionStatus').textContent, /Import rejected/);
  assert.match(page.get('sessionStatus').textContent, /4096/);
  assert.equal(page.get('trackEditor').children.length, 3);
  assert.equal(page.get('statCycle').textContent, '72');
  for (const id of ['downloadMidiBtn', 'downloadLyBtn', 'copyLyBtn', 'exportSessionBtn', 'downloadPatternsBtn']) {
    assert.equal(page.get(id).disabled, false, id + ' stays enabled');
  }

  page.get('downloadMidiBtn').click();
  const second = page.document.downloads.at(-1);
  const midiAfter = new Uint8Array(await page.blobs.get(second.href).arrayBuffer());
  assert.deepEqual(midiAfter, midiBefore, 'MIDI bytes are identical after the rejection');

  const session = JSON.parse(page.get('sessionJson').value === '' ? '{}' : page.get('sessionJson').value);
  assert.notEqual(session.schema, 'beatgrid/session', 'textarea was not rewritten with phantom voices');

  // A legal pattern still imports immediately after the rejection.
  page.get('sessionJson').value = R.exportPattern([1, 0, 1, 0]);
  page.get('importSessionBtn').click();
  assert.equal(page.get('trackEditor').children.length, 4);
  assert.match(page.get('sessionStatus').textContent, /Imported 1 pattern voice/);
  assert.equal(page.get('statCycle').textContent, '72');
  auditPage(page);
});

test('an oversized pattern-set import is rejected before any voice is added', () => {
  const page = createPage(__dirname);
  const set = JSON.stringify({
    schema: 'beatgrid/pattern-set', version: 1,
    patterns: [{ vector: '1010' }, { vector: '1' + '0'.repeat(60) }]
  });
  page.get('sessionJson').value = set;
  page.get('importSessionBtn').click();
  assert.match(page.get('sessionStatus').textContent, /Import rejected/);
  assert.equal(page.get('trackEditor').children.length, 3, 'not even the first legal pattern was added');
  assert.equal(page.get('downloadMidiBtn').disabled, false);
});

/* ------------------------------------------------------------------ */
/* Pattern records round-trip MIDI voice fields                        */
/* ------------------------------------------------------------------ */

test('exportPattern then importPattern preserves note, channel, and velocity', () => {
  const text = R.exportPattern({ name: 'Voice', pattern: [1, 0, 1], note: 51, channel: 3, velocity: 57 });
  const parsed = JSON.parse(text);
  assert.equal(parsed.note, 51);
  assert.equal(parsed.channel, 3);
  assert.equal(parsed.velocity, 57);
  const voice = R.importPattern(text);
  assert.equal(voice.name, 'Voice');
  assert.deepEqual(voice.pattern, [1, 0, 1]);
  assert.equal(voice.note, 51);
  assert.equal(voice.channel, 3);
  assert.equal(voice.velocity, 57);
});

test('older timing-only pattern records still import cleanly', () => {
  const voice = R.importPattern(JSON.stringify({ schema: 'beatgrid/pattern', version: 1, name: 'Old', vector: '1010' }));
  assert.equal(voice.name, 'Old');
  assert.deepEqual(voice.pattern, [1, 0, 1, 0]);
  assert.equal(voice.note, undefined, 'absent fields defer to the receiving defaults');
});

test('pattern voice fields validate MIDI ranges and integer types on import', () => {
  const wrap = (fields) => JSON.stringify({ schema: 'beatgrid/pattern', version: 1, vector: '101', ...fields });
  for (const bad of [
    { note: 200 }, { note: -1 }, { note: 36.5 }, { note: '36' },
    { channel: 16 }, { channel: -1 }, { channel: 2.5 },
    { velocity: 0 }, { velocity: 128 }, { velocity: '96' }
  ]) {
    assert.throws(() => R.importPattern(wrap(bad)), JSON.stringify(bad));
  }
  const edge = R.importPattern(wrap({ note: 0, channel: 15, velocity: 1 }));
  assert.equal(edge.note, 0);
  assert.equal(edge.channel, 15);
  assert.equal(edge.velocity, 1);
});

test('pattern-set entries keep their own voice fields independently', () => {
  const set = JSON.stringify({
    schema: 'beatgrid/pattern-set', version: 1,
    patterns: [
      { vector: '101', note: 40, channel: 2, velocity: 70 },
      { vector: '1001' }
    ]
  });
  const voices = R.importPattern(set);
  assert.equal(voices[0].note, 40);
  assert.equal(voices[0].channel, 2);
  assert.equal(voices[0].velocity, 70);
  assert.equal(voices[1].note, undefined);
});

test('pattern voice settings round-trip through the UI into the session and MIDI bytes', async () => {
  const page = createPage(__dirname);
  page.get('sessionJson').value = R.exportPattern({ name: 'Voice', pattern: [1, 0, 1], note: 51, channel: 3, velocity: 57 });
  page.get('importSessionBtn').click();
  assert.equal(page.get('trackEditor').children.length, 4);

  const session = JSON.parse(page.get('sessionJson').value);
  assert.equal(session.tracks[3].note, 51);
  assert.equal(session.tracks[3].channel, 3);
  assert.equal(session.tracks[3].velocity, 57);

  // The MIDI file carries note 51 (0x33) on channel 3 (status 0x93) at velocity 57 (0x39).
  page.get('downloadMidiBtn').click();
  const bytes = new Uint8Array(await page.blobs.get(page.document.downloads.at(-1).href).arrayBuffer());
  const triplet = Array.from(bytes).some((_, i) => bytes[i] === 0x93 && bytes[i + 1] === 0x33 && bytes[i + 2] === 0x39);
  assert.ok(triplet, 'note-on 0x93 0x33 0x39 present in the MIDI stream');
});

test('manual rows expose note, channel, and velocity controls that reach the session', () => {
  const page = createPage(__dirname);
  page.get('sessionJson').value = R.exportPattern({ name: 'Voice', pattern: [1, 0, 1], note: 51, channel: 3, velocity: 57 });
  page.get('importSessionBtn').click();
  const row = page.get('trackEditor').children[3];
  const note = row.querySelector('input[aria-label="note"]');
  const channel = row.querySelector('input[aria-label="ch"]');
  const velocity = row.querySelector('input[aria-label="vel"]');
  assert.ok(note && channel && velocity, 'manual row exposes the voice fields');
  assert.equal(note.value, '51');
  assert.equal(channel.value, '3');
  assert.equal(velocity.value, '57');
  note.value = '60';
  page.fire(note, 'change');
  page.get('exportSessionBtn').click();
  const restored = JSON.parse(page.get('sessionJson').value);
  assert.equal(restored.tracks[3].note, 60);
});

test('a pattern-set export re-imports every voice with its MIDI settings', () => {
  const page = createPage(__dirname);
  page.get('downloadPatternsBtn').click();
  const exported = page.get('sessionJson').value;
  page.get('sessionJson').value = JSON.stringify({
    schema: 'beatgrid/session', version: 1, title: 'One', bpm: 120, ppq: 480, gate: 0.5,
    tracks: [{ name: 'One', pulses: 1, steps: 4 }]
  });
  page.get('importSessionBtn').click();
  page.get('sessionJson').value = exported;
  page.get('importSessionBtn').click();
  const restored = JSON.parse(page.get('sessionJson').value);
  // Pattern imports append voices: the lone Euclidean voice plus the three from the set.
  assert.equal(restored.tracks.length, 4);
  const imported = restored.tracks.slice(1);
  assert.deepEqual(imported.map((t) => t.note), [36, 56, 45]);
  assert.deepEqual(imported.map((t) => t.channel), [9, 9, 9]);
  assert.deepEqual(imported.map((t) => t.velocity), [96, 96, 96]);
  assert.deepEqual(imported.map((t) => t.pattern.join('')), ['10010010', '101101011010', '101010100']);
});

/* ------------------------------------------------------------------ */
/* WCAG 2.1.4 single-key shortcut toggle                               */
/* ------------------------------------------------------------------ */

test('the single-key toggle disables P, A, E, M, L and updates the disclosure', () => {
  const page = createPage(__dirname);
  const toggle = page.get('keysToggle');
  assert.equal(toggle.checked, true);
  assert.match(page.get('shortcutState').textContent, /are on/);
  page.key('KeyA');
  assert.equal(page.get('trackEditor').children.length, 4);

  toggle.checked = false;
  page.fire(toggle, 'change');
  assert.match(page.get('shortcutState').textContent, /are off/);
  assert.ok(page.document.querySelector('.shortcuts').classList.contains('is-off'), 'disclosure dims the single-key list items');

  // The reviewed repro: an unrelated control holds focus, a letter fires.
  page.get('themeBtn').focus();
  page.key('KeyA', 'keydown', page.get('themeBtn'));
  assert.equal(page.get('trackEditor').children.length, 4, 'A no longer adds a voice');
  page.key('KeyE', 'keydown', page.get('themeBtn'));
  page.key('KeyM', 'keydown', page.get('themeBtn'));
  page.key('KeyL', 'keydown', page.get('themeBtn'));
  assert.equal(page.document.downloads.length, 0, 'no downloads fire while shortcuts are off');
  page.key('KeyP', 'keydown', page.get('themeBtn'));
  assert.equal(page.get('cyclePlayBtn').textContent, 'Run cycle');
  assert.equal(page.storage.get('beatgrid-keys'), 'off', 'the choice persisted');

  // Pad navigation keys are unaffected by the toggle.
  const cells = page.get('trackEditor').children[0].querySelectorAll('.step-cell');
  cells[0].focus();
  page.fire(cells[0], 'keydown', { code: 'ArrowRight' });
  assert.equal(page.document.activeElement.getAttribute('data-step'), '1');

  toggle.checked = true;
  page.fire(toggle, 'change');
  assert.match(page.get('shortcutState').textContent, /are on/);
  assert.ok(!page.document.querySelector('.shortcuts').classList.contains('is-off'));
  page.key('KeyA');
  assert.equal(page.get('trackEditor').children.length, 5);
  assert.equal(page.storage.get('beatgrid-keys'), 'on');
});

test('a stored off preference disables single-key shortcuts on load', () => {
  const page = createPage(__dirname, { storage: { 'beatgrid-keys': 'off' } });
  assert.equal(page.get('keysToggle').checked, false);
  assert.match(page.get('shortcutState').textContent, /are off/);
  page.key('KeyA');
  assert.equal(page.get('trackEditor').children.length, 3);
  auditPage(page);
});

test('the shortcut toggle works when storage is blocked', () => {
  const page = createPage(__dirname, { storageBlocked: true });
  const toggle = page.get('keysToggle');
  toggle.checked = false;
  page.fire(toggle, 'change');
  page.key('KeyA');
  assert.equal(page.get('trackEditor').children.length, 3);
  assert.match(page.get('shortcutState').textContent, /are off/);
});

/* ------------------------------------------------------------------ */
/* Safe canonical JSON                                                 */
/* ------------------------------------------------------------------ */

test('canonicalJson keeps an own __proto__ key and sorts numeric keys lexically', () => {
  const value = JSON.parse('{"__proto__":{"own":true},"10":10,"2":2}');
  assert.equal(R.canonicalJson(value), '{"10":10,"2":2,"__proto__":{"own":true}}');
  const round = JSON.parse(R.canonicalJson(value));
  assert.equal(Object.keys(round).length, 3);
  assert.equal(round['__proto__'].own, true);
});

test('canonicalJson sorts only own enumerable keys at every depth', () => {
  const value = { z: 1, a: { '10': 1, '2': 2, b: 3 } };
  assert.equal(R.canonicalJson(value), '{"a":{"10":1,"2":2,"b":3},"z":1}');
  assert.equal(R.canonicalJson({ b: [{ '9': 9, '10': 10 }] }), '{"b":[{"10":10,"9":9}]}');
});

test('canonicalJson mirrors JSON.stringify for members that cannot serialize', () => {
  assert.equal(R.canonicalJson([1, undefined, 3]), '[1,null,3]');
  assert.equal(R.canonicalJson({ a: 1, b: undefined }), '{"a":1}');
  assert.equal(R.canonicalJson({ a: NaN }), '{"a":null}');
  for (const value of [{ b: 1, a: [3, { y: 2, x: 1 }] }, [1, 'two', null, true], 'text', 42, null]) {
    assert.deepEqual(JSON.parse(R.canonicalJson(value)), JSON.parse(JSON.stringify(value)));
  }
});

test('canonicalJson output stays byte identical across calls and safe on odd trees', () => {
  const value = JSON.parse('{"__proto__":[1,2],"z":{"__proto__":0},"a":1}');
  assert.equal(R.canonicalJson(value), R.canonicalJson(value));
  assert.equal(R.canonicalJson(value), '{"__proto__":[1,2],"a":1,"z":{"__proto__":0}}');
});
