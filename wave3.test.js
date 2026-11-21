'use strict';

// Wave 3 coverage: Bjorklund invariants, step evenness, canonical
// rotation and JSON exports, MIDI byte structure, keyboard grid
// navigation, aria-live announcements, and invalid-import recovery.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('./rhythm.js');
const { createPage, auditPage } = require('./dom-harness.cjs');

const vec = (s) => Array.from(s, (c) => (c === '1' ? 1 : 0));
const str = (v) => v.join('');

/* ------------------------------------------------------------------ */
/* Step evenness and Bjorklund invariants                              */
/* ------------------------------------------------------------------ */

test('evennessIndex stays inside [0, 1] for every supported voice', () => {
  for (let n = 1; n <= 32; n++) {
    for (let k = 0; k <= n; k++) {
      const e = R.evennessIndex(R.euclideanRhythm(k, n));
      assert.ok(e >= 0 && e <= 1, `E(${k},${n}) evenness ${e}`);
    }
  }
});

test('evennessIndex is exactly 1 when onsets divide the cycle evenly', () => {
  for (const [k, n] of [[4, 8], [2, 8], [8, 16], [3, 12], [1, 8], [16, 16], [5, 20]]) {
    assert.equal(R.evennessIndex(R.euclideanRhythm(k, n)), 1, `E(${k},${n})`);
  }
});

test('evennessIndex is below 1 when density cannot tile evenly', () => {
  assert.ok(R.evennessIndex(R.euclideanRhythm(3, 8)) < 1);
  assert.ok(R.evennessIndex(R.euclideanRhythm(5, 12)) < 1);
  assert.ok(R.evennessIndex(R.euclideanRhythm(7, 16)) < 1);
});

test('evennessIndex is rotation invariant on every shift', () => {
  for (const [k, n] of [[3, 8], [5, 16], [7, 12], [4, 9]]) {
    const base = R.evennessIndex(R.euclideanRhythm(k, n));
    for (let r = -n; r <= 2 * n; r++) {
      assert.equal(R.evennessIndex(R.euclideanRhythm(k, n, r)), base, `E(${k},${n},${r})`);
    }
  }
});

test('evennessIndex edge cases: silence, single onset, and full density', () => {
  assert.equal(R.evennessIndex(vec('00000')), 0);
  assert.equal(R.evennessIndex(vec('00010000')), 1);
  assert.equal(R.evennessIndex(vec('1111')), 1);
  assert.equal(R.evennessIndex(vec('1')), 1);
});

test('clustered onsets score near zero and below every Euclidean peer', () => {
  const clustered = vec('11100000');
  const euclidean = R.euclideanRhythm(3, 8);
  assert.equal(R.evennessIndex(clustered), 0);
  assert.ok(R.evennessIndex(euclidean) > R.evennessIndex(clustered));
});

test('Bjorklund attains the maximum evenness of all same-density vectors', () => {
  // Exhaustive over every binary vector of length 12, grouped by popcount.
  const n = 12;
  const best = new Map();
  for (let mask = 0; mask < (1 << n); mask++) {
    const pattern = [];
    for (let bit = 0; bit < n; bit++) pattern.push((mask >> bit) & 1);
    const onsets = pattern.reduce((a, b) => a + b, 0);
    const e = R.evennessIndex(pattern);
    if (!best.has(onsets) || e > best.get(onsets)) best.set(onsets, e);
  }
  for (let k = 0; k <= n; k++) {
    const e = R.evennessIndex(R.euclideanRhythm(k, n));
    assert.ok(e >= best.get(k) - 1e-12, `E(${k},${n}) ${e} vs best ${best.get(k)}`);
  }
});

test('a non-maximally-even vector scores strictly below the Euclidean peer', () => {
  // Gaps 2+3+3+4+4 have spread 2 where E(5,16) holds 3+3+3+3+4.
  const uneven = vec('1010010010001000');
  assert.equal(R.inspectPattern(uneven).gapSpread, 2);
  assert.ok(R.evennessIndex(uneven) < R.evennessIndex(R.euclideanRhythm(5, 16)));
});

test('complement of E(k,n) shares the canonical necklace of E(n-k,n)', () => {
  for (const [k, n] of [[3, 8], [5, 16], [2, 7], [4, 12], [1, 5], [6, 11]]) {
    const complement = R.euclideanRhythm(k, n).map((v) => (v ? 0 : 1));
    assert.equal(str(R.canonicalVector(complement)), str(R.canonicalVector(R.euclideanRhythm(n - k, n))));
    assert.equal(R.evennessIndex(complement), R.evennessIndex(R.euclideanRhythm(n - k, n)));
  }
});

test('evennessIndex validates its input like every pattern consumer', () => {
  assert.throws(() => R.evennessIndex('101'), TypeError);
  assert.throws(() => R.evennessIndex([2, 0]), TypeError);
  assert.throws(() => R.evennessIndex([]), RangeError);
});

test('Bjorklund output matches an independent slope reference as a necklace', () => {
  // Slope formulation: onset where floor((i+1)*k/n) increments. It can
  // differ by a rotation, so both sides are compared in canonical form.
  const slope = (k, n) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(Math.floor(((i + 1) * k) / n) - Math.floor((i * k) / n));
    return out;
  };
  for (let n = 2; n <= 24; n++) {
    for (let k = 1; k <= n; k++) {
      const a = str(R.canonicalVector(R.euclideanRhythm(k, n)));
      const b = str(R.canonicalVector(slope(k, n)));
      assert.equal(a, b, `E(${k},${n}) necklace`);
    }
  }
});

test('every Euclidean rotation keeps the canonical necklace', () => {
  const base = str(R.canonicalVector(R.euclideanRhythm(5, 13)));
  for (let r = 0; r < 13; r++) {
    assert.equal(str(R.canonicalVector(R.euclideanRhythm(5, 13, r))), base);
  }
});

/* ------------------------------------------------------------------ */
/* Canonical rotation (Booth least rotation)                           */
/* ------------------------------------------------------------------ */

test('canonicalRotation returns an index inside the vector', () => {
  for (let n = 1; n <= 20; n++) {
    for (let k = 0; k <= n; k++) {
      const shift = R.canonicalRotation(R.euclideanRhythm(k, n));
      assert.ok(Number.isInteger(shift) && shift >= 0 && shift < n);
    }
  }
});

test('canonicalVector is the lexicographic minimum of all rotations', () => {
  // Exhaustive over every vector of length 8 against a brute-force scan.
  const n = 8;
  for (let mask = 0; mask < (1 << n); mask++) {
    const pattern = [];
    for (let bit = 0; bit < n; bit++) pattern.push((mask >> bit) & 1);
    const canonical = str(R.canonicalVector(pattern));
    for (let r = 1; r < n; r++) {
      const rotated = str(R.rotateVector(pattern, -r));
      assert.ok(canonical <= rotated, `mask ${mask} shift ${r}`);
    }
  }
});

test('canonicalVector equals the vector left-rotated by canonicalShift', () => {
  const pattern = R.euclideanRhythm(7, 12, 3);
  const shift = R.canonicalRotation(pattern);
  const expected = pattern.slice(shift).concat(pattern.slice(0, shift));
  assert.deepEqual(R.canonicalVector(pattern), expected);
});

test('canonicalRotation of a constant vector is zero', () => {
  assert.equal(R.canonicalRotation(vec('111111')), 0);
  assert.equal(R.canonicalRotation(vec('0000')), 0);
  assert.equal(R.canonicalRotation(vec('1')), 0);
});

test('canonicalVector is rotation invariant for arbitrary vectors', () => {
  for (const pattern of [vec('1011010010'), vec('110010'), vec('100'), vec('1110010')]) {
    const base = str(R.canonicalVector(pattern));
    for (let r = 0; r < pattern.length; r++) {
      assert.equal(str(R.canonicalVector(R.rotateVector(pattern, r))), base);
    }
  }
});

test('canonical helpers reject malformed patterns', () => {
  assert.throws(() => R.canonicalRotation('101'), TypeError);
  assert.throws(() => R.canonicalVector([1, 2, 0]), TypeError);
  assert.throws(() => R.canonicalVector([]), RangeError);
});

/* ------------------------------------------------------------------ */
/* inspectPattern and analyzer depth                                   */
/* ------------------------------------------------------------------ */

test('inspectPattern evenness matches evennessIndex on the same vector', () => {
  for (const [k, n] of [[3, 8], [5, 16], [7, 12], [0, 4]]) {
    const pattern = R.euclideanRhythm(k, n);
    assert.equal(R.inspectPattern(pattern).evenness, R.evennessIndex(pattern));
  }
});

test('analyzePolyrhythm reports per-track evenness on tracks and syncopation rows', () => {
  const a = R.analyzePolyrhythm([
    { name: 'Tresillo', pulses: 3, steps: 8 },
    { name: 'Seven', pulses: 7, steps: 12 }
  ], 120);
  assert.equal(a.tracks[0].evenness, R.evennessIndex(R.euclideanRhythm(3, 8)));
  assert.equal(a.tracks[1].evenness, R.evennessIndex(R.euclideanRhythm(7, 12)));
  assert.equal(a.syncopation.perTrack[0].evenness, a.tracks[0].evenness);
  assert.equal(a.syncopation.perTrack[1].evenness, a.tracks[1].evenness);
});

test('LCM cycle length equals lcmAll of declared steps across combos', () => {
  const cases = [
    [[4, 8], 8], [[8, 12, 9], 72], [[7, 5, 3], 105], [[16, 4, 8, 2], 16], [[6, 10, 15], 30]
  ];
  for (const [steps, expected] of cases) {
    const a = R.analyzePolyrhythm(steps.map((s) => ({ pulses: 1, steps: s })), 120);
    assert.equal(a.cycleSteps, expected, `steps ${steps}`);
    assert.equal(a.cycleSteps, R.lcmAll(steps));
  }
});

test('analyzePolyrhythm is deterministic across repeated calls', () => {
  const tracks = [
    { name: 'A', pulses: 5, steps: 16, rotation: 2 },
    { name: 'B', pattern: vec('1001010'), note: 40 }
  ];
  assert.deepEqual(R.analyzePolyrhythm(tracks, 110), R.analyzePolyrhythm(tracks, 110));
});

test('syncopation index is deterministic and non-negative', () => {
  for (const pattern of [vec('10010010'), vec('0010010'), vec('1111011101101110')]) {
    const score = R.syncopationIndex(pattern);
    assert.ok(score >= 0 && Number.isFinite(score));
    assert.equal(R.syncopationIndex(pattern), score);
  }
});

/* ------------------------------------------------------------------ */
/* Canonical JSON and pattern export/import                            */
/* ------------------------------------------------------------------ */

test('canonicalJson sorts object keys at every depth', () => {
  const out = R.canonicalJson({ b: 1, a: { d: 4, c: 3 }, e: [{ y: 2, x: 1 }] });
  assert.equal(out, '{"a":{"c":3,"d":4},"b":1,"e":[{"x":1,"y":2}]}');
});

test('canonicalJson preserves array order and emits no whitespace', () => {
  const out = R.canonicalJson([3, 1, 2]);
  assert.equal(out, '[3,1,2]');
  assert.doesNotMatch(R.canonicalJson({ z: [1, { b: 2, a: 1 }] }), /[ \n]/);
});

test('canonicalJson is deterministic and rejects non-JSON values', () => {
  const value = { b: [1, { d: 2, c: 3 }], a: 'x' };
  assert.equal(R.canonicalJson(value), R.canonicalJson(value));
  assert.throws(() => R.canonicalJson(undefined), TypeError);
  assert.throws(() => R.canonicalJson(() => 1), TypeError);
});

test('exportPattern emits canonical JSON with sorted top-level keys', () => {
  const text = R.exportPattern({ name: 'Tresillo', pulses: 3, steps: 8, rotation: 0, note: 36 });
  const parsed = JSON.parse(text);
  assert.deepEqual(Object.keys(parsed), Object.keys(parsed).sort());
  assert.equal(parsed.schema, 'beatgrid/pattern');
  assert.equal(parsed.version, 1);
  assert.equal(parsed.generator, 'bjorklund');
  assert.equal(parsed.vector, '10010010');
});

test('exportPattern is byte identical across repeated calls', () => {
  const track = { name: 'Bell', pulses: 7, steps: 12, rotation: 3, note: 56 };
  assert.equal(R.exportPattern(track), R.exportPattern(track));
  assert.equal(R.exportPattern(vec('10110')), R.exportPattern(vec('10110')));
});

test('exportPattern canonicalVector is shared across rotations', () => {
  const a = JSON.parse(R.exportPattern({ pulses: 5, steps: 16, rotation: 0 }));
  const b = JSON.parse(R.exportPattern({ pulses: 5, steps: 16, rotation: 9 }));
  assert.equal(a.canonicalVector, b.canonicalVector);
  assert.notEqual(a.vector, b.vector);
  assert.equal(R.rotateVector(vec(a.vector), -(a.canonicalShift)).join(''), a.canonicalVector);
});

test('describePattern reports measured values that match engine calls', () => {
  const d = R.describePattern({ name: 'Study', pattern: vec('10100100'), note: 42 });
  const info = R.inspectPattern(vec('10100100'));
  assert.equal(d.generator, 'manual');
  assert.equal(d.onsets, info.onsets);
  assert.deepEqual(d.gaps, info.gaps);
  assert.equal(d.evenness, info.evenness);
  assert.equal(d.gapSpread, info.gapSpread);
  assert.equal(d.fundamentalPeriod, info.fundamentalPeriod);
  assert.equal(d.syncopation.score, R.syncopationIndex(vec('10100100')));
  assert.ok(!('pulses' in d), 'manual descriptor has no pulses field');
});

test('describePattern honors stepsPerBeat and validates it', () => {
  const d = R.describePattern([1, 0, 1, 0], { stepsPerBeat: 8 });
  assert.equal(d.syncopation.stepsPerBeat, 8);
  assert.equal(d.syncopation.evaluatedSteps, 32);
  assert.throws(() => R.describePattern([1], { stepsPerBeat: 0 }), RangeError);
  assert.throws(() => R.describePattern([1], { stepsPerBeat: 17 }), RangeError);
});

test('importPattern round-trips a single descriptor', () => {
  const text = R.exportPattern({ name: 'Round', pulses: 5, steps: 16, rotation: 1 });
  const voice = R.importPattern(text);
  assert.equal(voice.name, 'Round');
  assert.equal(str(voice.pattern), str(R.euclideanRhythm(5, 16, 1)));
});

test('importPattern returns an array for a pattern set', () => {
  const set = R.canonicalJson({
    schema: 'beatgrid/pattern-set', version: 1, title: 'Set', bpm: 120,
    patterns: [JSON.parse(R.exportPattern({ pulses: 3, steps: 8 })), JSON.parse(R.exportPattern({ pattern: vec('1101') }))]
  });
  const voices = R.importPattern(set);
  assert.equal(voices.length, 2);
  assert.equal(str(voices[0].pattern), '10010010');
  assert.equal(str(voices[1].pattern), '1101');
});

test('importPattern rejects malformed descriptors', () => {
  assert.throws(() => R.importPattern(42), TypeError);
  assert.throws(() => R.importPattern(' '.repeat(65537)), RangeError);
  assert.throws(() => R.importPattern('null'), TypeError);
  assert.throws(() => R.importPattern('{"schema":"other"}'), TypeError);
  assert.throws(() => R.importPattern('{"schema":"beatgrid/pattern","version":2,"vector":"1"}'), TypeError);
  assert.throws(() => R.importPattern('{"schema":"beatgrid/pattern","version":1,"vector":"102"}'), RangeError);
  assert.throws(() => R.importPattern('{"schema":"beatgrid/pattern","version":1,"vector":""}'), RangeError);
  assert.throws(() => R.importPattern('{"schema":"beatgrid/pattern","version":1,"vector":"' + '1'.repeat(65) + '"}'), RangeError);
  assert.throws(() => R.importPattern('{"schema":"beatgrid/pattern","version":1}'), TypeError);
});

test('importPattern pattern-set rejects empty and oversized sets', () => {
  const wrap = (patterns) => JSON.stringify({ schema: 'beatgrid/pattern-set', version: 1, patterns });
  assert.throws(() => R.importPattern(wrap([])), RangeError);
  assert.throws(() => R.importPattern(wrap(Array.from({ length: 9 }, () => ({ vector: '1' })))), RangeError);
  assert.throws(() => R.importPattern(wrap([{ vector: '10' }, { vector: 'xx' }])), RangeError);
});

test('importPattern accepts a raw pattern array and sanitizes the name', () => {
  const voice = R.importPattern(JSON.stringify({
    schema: 'beatgrid/pattern', version: 1, name: 'A\nB', pattern: [1, 0, 1, 0]
  }));
  assert.equal(voice.name, 'A B');
  assert.deepEqual(voice.pattern, [1, 0, 1, 0]);
});

test('exportPattern validates its input', () => {
  assert.throws(() => R.exportPattern('1001'), TypeError);
  assert.throws(() => R.exportPattern({ pulses: 3, steps: 0 }), RangeError);
  assert.throws(() => R.exportPattern({ pattern: [1, 9, 0] }), TypeError);
});

/* ------------------------------------------------------------------ */
/* SMF Type 0 byte structure                                           */
/* ------------------------------------------------------------------ */

const MIDI_SIMPLE = [
  { name: 'Kick', pulses: 3, steps: 8, note: 36 },
  { name: 'Hat', pulses: 5, steps: 8, note: 42 }
];

// Independent SMF parser: returns { events, endTick } with absolute ticks.
function parseSmf(bytes) {
  const head = String.fromCharCode(...bytes.slice(0, 4));
  assert.equal(head, 'MThd');
  assert.equal((bytes[8] << 8) | bytes[9], 0, 'format 0');
  assert.equal((bytes[10] << 8) | bytes[11], 1, 'one track');
  const division = (bytes[12] << 8) | bytes[13];
  assert.equal(String.fromCharCode(...bytes.slice(14, 18)), 'MTrk');
  const declared = (bytes[18] * 0x1000000) + (bytes[19] * 0x10000) + (bytes[20] * 0x100) + bytes[21];
  assert.equal(declared, bytes.length - 22, 'MTrk length');
  const events = [];
  let offset = 22;
  let tick = 0;
  while (offset < bytes.length) {
    const delta = R.vlqDecode(bytes, offset);
    tick += delta.value;
    offset += delta.consumed;
    const status = bytes[offset++];
    let data;
    if (status === 0xff) {
      const type = bytes[offset++];
      const length = R.vlqDecode(bytes, offset);
      offset += length.consumed;
      data = Array.from(bytes.slice(offset, offset + length.value));
      offset += length.value;
      events.push({ tick, kind: 'meta', type, data });
    } else {
      data = [bytes[offset++], bytes[offset++]];
      events.push({ tick, kind: 'channel', status, data });
    }
  }
  assert.equal(offset, bytes.length);
  return { events, endTick: tick, division };
}

test('encodeMidiFile is byte identical on repeated calls', () => {
  const a = R.encodeMidiFile(MIDI_SIMPLE, 120, 480);
  const b = R.encodeMidiFile(MIDI_SIMPLE, 120, 480);
  assert.deepEqual(a, b);
  assert.equal(a.length, b.length);
});

test('encodeMidiFile is identical regardless of option key order', () => {
  const a = R.encodeMidiFile(MIDI_SIMPLE, 120, { ppq: 240, gate: 0.5 });
  const b = R.encodeMidiFile(MIDI_SIMPLE, 120, { gate: 0.5, ppq: 240 });
  assert.deepEqual(a, b);
});

test('MThd declares the requested division as big-endian ticks per quarter', () => {
  for (const ppq of [24, 96, 480, 960]) {
    const bytes = R.encodeMidiFile(MIDI_SIMPLE, 120, ppq);
    assert.equal((bytes[12] << 8) | bytes[13], ppq);
    assert.equal(bytes[12] & 0x80, 0, 'not a SMPTE division');
  }
});

test('MTrk opens with name, tempo, and meter meta events at tick zero', () => {
  const { events } = parseSmf(R.encodeMidiFile(MIDI_SIMPLE, 120, 480));
  const opening = events.filter((e) => e.tick === 0 && e.kind === 'meta');
  assert.deepEqual(opening.map((e) => e.type), [0x03, 0x51, 0x58]);
  const name = opening[0].data.map((b) => String.fromCharCode(b)).join('');
  assert.equal(name, 'BeatGrid format 0');
  assert.deepEqual(opening[2].data, [0x04, 0x02, 0x18, 0x08]);
  const firstChannel = events.findIndex((e) => e.kind === 'channel');
  assert.ok(firstChannel > 2, 'meta events precede channel events');
});

test('tempo meta event encodes microseconds per quarter as a 24-bit value', () => {
  const { events } = parseSmf(R.encodeMidiFile(MIDI_SIMPLE, 150, 480));
  const tempo = events.find((e) => e.kind === 'meta' && e.type === 0x51);
  assert.ok(tempo, 'tempo meta present');
  assert.equal((tempo.data[0] << 16) | (tempo.data[1] << 8) | tempo.data[2], 400000);
});

test('every delta time decodes as a legal VLQ and ticks never decrease', () => {
  const bytes = R.encodeMidiFile(MIDI_SIMPLE, 120, 480);
  let offset = 22;
  let tick = 0;
  let last = 0;
  while (offset < bytes.length) {
    const delta = R.vlqDecode(bytes, offset);
    assert.ok(delta.consumed >= 1 && delta.consumed <= 4);
    tick += delta.value;
    assert.ok(tick >= last);
    last = tick;
    offset += delta.consumed;
    const status = bytes[offset];
    if (status === 0xff) {
      const length = R.vlqDecode(bytes, offset + 2);
      offset += 2 + length.consumed + length.value;
    } else {
      offset += 3;
    }
  }
  assert.equal(tick, 8 * 120, 'shared 8-step cycle x 120 ticks per step');
});

test('every note-on pairs with a later note-off on the same note and channel', () => {
  const { events } = parseSmf(R.encodeMidiFile(MIDI_SIMPLE, 120, 480));
  const ons = events.filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0x90);
  const offs = events.filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0x80);
  assert.equal(ons.length, offs.length);
  assert.equal(ons.length, 8); // 3 + 5 onsets over a single shared 8-step cycle
  for (const on of ons) {
    const off = offs.find((e) => e.data[0] === on.data[0] && (e.status & 0x0f) === (on.status & 0x0f) && e.tick > on.tick);
    assert.ok(off, `note ${on.data[0]} has a closing note-off`);
    assert.ok(on.data[1] >= 1 && on.data[1] <= 127, 'onset velocity in range');
    assert.equal(off.data[1], 0, 'note-off velocity zero');
  }
});

test('no running status: every channel event declares a full status byte', () => {
  const bytes = R.encodeMidiFile(MIDI_SIMPLE, 120, 480);
  let offset = 22;
  while (offset < bytes.length) {
    const delta = R.vlqDecode(bytes, offset);
    offset += delta.consumed;
    const status = bytes[offset];
    assert.ok(status >= 0x80, `status byte ${status} at ${offset}`);
    if (status === 0xff) {
      const length = R.vlqDecode(bytes, offset + 2);
      offset += 2 + length.consumed + length.value;
    } else {
      assert.ok((status & 0xf0) === 0x90 || (status & 0xf0) === 0x80);
      offset += 3;
    }
  }
});

test('note-on ticks land exactly on expanded onset step boundaries', () => {
  const { events, division } = parseSmf(R.encodeMidiFile(MIDI_SIMPLE, 120, 480));
  const ticksPerStep = division / R.DEFAULT_STEPS_PER_BEAT;
  const expected = new Set();
  for (const track of MIDI_SIMPLE) {
    const pattern = R.euclideanRhythm(track.pulses, track.steps);
    pattern.forEach((v, s) => { if (v) expected.add(Math.round(s * ticksPerStep)); });
  }
  const onTicks = new Set(events.filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0x90).map((e) => e.tick));
  assert.deepEqual(onTicks, expected);
});

test('end-of-track is the last event and lands on the cycle boundary', () => {
  const { events, endTick } = parseSmf(R.encodeMidiFile(MIDI_SIMPLE, 120, 480));
  const last = events[events.length - 1];
  assert.equal(last.kind, 'meta');
  assert.equal(last.type, 0x2f);
  assert.equal(endTick, last.tick);
  assert.equal(last.tick, 8 * 120, 'cycleSteps x ticksPerStep');
});

test('gate changes note-off placement without moving note-ons', () => {
  const onsOf = (gate) => parseSmf(R.encodeMidiFile(MIDI_SIMPLE, 120, 480, { gate })).events
    .filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0x90).map((e) => e.tick);
  assert.deepEqual(onsOf(0.25), onsOf(1));
  const offsOf = (gate) => parseSmf(R.encodeMidiFile(MIDI_SIMPLE, 120, 480, { gate })).events
    .filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0x80).map((e) => e.tick);
  assert.notDeepEqual(offsOf(0.25), offsOf(1));
});

test('a lone onset produces a minimal valid file', () => {
  const { events } = parseSmf(R.encodeMidiFile([{ pulses: 1, steps: 4 }], 60, 96));
  const channel = events.filter((e) => e.kind === 'channel');
  assert.equal(channel.filter((e) => (e.status & 0xf0) === 0x90).length, 1);
  assert.equal(channel.filter((e) => (e.status & 0xf0) === 0x80).length, 1);
});

test('encodeMidiFile rejects empty voice lists and bad byte inputs', () => {
  assert.throws(() => R.encodeMidiFile([], 120), RangeError);
  assert.throws(() => R.describeMidiChunks(R.encodeMidiFile(MIDI_SIMPLE).slice(0, 20)), RangeError);
});

/* ------------------------------------------------------------------ */
/* Keyboard grid navigation and aria-live                              */
/* ------------------------------------------------------------------ */

test('exactly one step pad is tabbable per the roving tabindex', () => {
  const page = createPage(__dirname);
  const cells = page.get('trackEditor').querySelectorAll('.step-cell');
  const tabbable = cells.filter((c) => c.getAttribute('tabindex') === '0');
  assert.equal(tabbable.length, 1);
  assert.equal(tabbable[0], cells[0]);
});

test('ArrowRight moves focus and the tab stop to the next pad', () => {
  const page = createPage(__dirname);
  const cells = page.get('trackEditor').children[0].querySelectorAll('.step-cell');
  cells[0].focus();
  page.fire(cells[0], 'keydown', { code: 'ArrowRight' });
  const moved = page.document.activeElement;
  assert.equal(moved.getAttribute('data-step'), '1');
  assert.equal(moved.getAttribute('tabindex'), '0');
  assert.equal(cells[0].getAttribute('tabindex'), '-1');
});

test('ArrowRight wraps from the last pad back to the first', () => {
  const page = createPage(__dirname);
  const cells = page.get('trackEditor').children[0].querySelectorAll('.step-cell');
  const last = cells[cells.length - 1];
  last.focus();
  page.fire(last, 'keydown', { code: 'ArrowRight' });
  assert.equal(page.document.activeElement.getAttribute('data-step'), '0');
});

test('ArrowLeft wraps to the row end from the first pad', () => {
  const page = createPage(__dirname);
  const cells = page.get('trackEditor').children[0].querySelectorAll('.step-cell');
  cells[0].focus();
  page.fire(cells[0], 'keydown', { code: 'ArrowLeft' });
  assert.equal(page.document.activeElement.getAttribute('data-step'), String(cells.length - 1));
});

test('ArrowDown moves to the same step on the next voice', () => {
  const page = createPage(__dirname);
  const row0 = page.get('trackEditor').children[0].querySelectorAll('.step-cell');
  row0[2].focus();
  page.fire(row0[2], 'keydown', { code: 'ArrowDown' });
  const moved = page.document.activeElement;
  assert.equal(moved.getAttribute('data-track'), '1');
  assert.equal(moved.getAttribute('data-step'), '2');
});

test('ArrowUp on the first voice stays on the first voice', () => {
  const page = createPage(__dirname);
  const cells = page.get('trackEditor').children[0].querySelectorAll('.step-cell');
  cells[1].focus();
  page.fire(cells[1], 'keydown', { code: 'ArrowUp' });
  assert.equal(page.document.activeElement.getAttribute('data-track'), '0');
  assert.equal(page.document.activeElement.getAttribute('data-step'), '1');
});

test('ArrowDown clamps the step index to a shorter row', () => {
  const page = createPage(__dirname);
  // Voice 2 has 12 steps, voice 3 has 9: step 11 clamps to 8.
  const row1 = page.get('trackEditor').children[1].querySelectorAll('.step-cell');
  row1[11].focus();
  page.fire(row1[11], 'keydown', { code: 'ArrowDown' });
  const moved = page.document.activeElement;
  assert.equal(moved.getAttribute('data-track'), '2');
  assert.equal(moved.getAttribute('data-step'), '8');
});

test('Home and End jump to the row edges', () => {
  const page = createPage(__dirname);
  const cells = page.get('trackEditor').children[0].querySelectorAll('.step-cell');
  cells[3].focus();
  page.fire(cells[3], 'keydown', { code: 'End' });
  assert.equal(page.document.activeElement.getAttribute('data-step'), '7');
  page.fire(page.document.activeElement, 'keydown', { code: 'Home' });
  assert.equal(page.document.activeElement.getAttribute('data-step'), '0');
});

test('PageDown and PageUp jump between the first and last voice', () => {
  const page = createPage(__dirname);
  const cells = page.get('trackEditor').children[0].querySelectorAll('.step-cell');
  cells[1].focus();
  page.fire(cells[1], 'keydown', { code: 'PageDown' });
  assert.equal(page.document.activeElement.getAttribute('data-track'), '2');
  page.fire(page.document.activeElement, 'keydown', { code: 'PageUp' });
  assert.equal(page.document.activeElement.getAttribute('data-track'), '0');
});

test('Space toggles the focused pad and announces the new state', () => {
  const page = createPage(__dirname);
  const cells = page.get('trackEditor').children[0].querySelectorAll('.step-cell');
  cells[1].focus();
  page.fire(cells[1], 'keydown', { code: 'Space' });
  const updated = page.get('trackEditor').children[0].querySelectorAll('.step-cell')[1];
  assert.equal(updated.getAttribute('aria-pressed'), 'true');
  assert.match(page.get('gridLive').textContent, /step 2 onset/);
});

test('Enter toggles the pad off and announces a rest', () => {
  const page = createPage(__dirname);
  const cells = page.get('trackEditor').children[0].querySelectorAll('.step-cell');
  cells[0].focus();
  page.fire(cells[0], 'keydown', { code: 'Enter' });
  const updated = page.get('trackEditor').children[0].querySelectorAll('.step-cell')[0];
  assert.equal(updated.getAttribute('aria-pressed'), 'false');
  assert.match(page.get('gridLive').textContent, /step 1 rest/);
});

test('focus is restored on the same pad after a keyboard toggle', () => {
  const page = createPage(__dirname);
  const cells = page.get('trackEditor').children[0].querySelectorAll('.step-cell');
  cells[4].focus();
  page.fire(cells[4], 'keydown', { code: 'Space' });
  const active = page.document.activeElement;
  assert.equal(active.getAttribute('data-track'), '0');
  assert.equal(active.getAttribute('data-step'), '4');
  assert.equal(active.getAttribute('tabindex'), '0');
});

test('grid live region carries polite status semantics', () => {
  const page = createPage(__dirname);
  const live = page.get('gridLive');
  assert.equal(live.getAttribute('role'), 'status');
  assert.equal(live.getAttribute('aria-live'), 'polite');
  assert.ok(live.classList.contains('sr-only'));
});

test('session status region announces politely', () => {
  const page = createPage(__dirname);
  assert.equal(page.get('sessionStatus').getAttribute('role'), 'status');
  assert.equal(page.get('sessionStatus').getAttribute('aria-live'), 'polite');
});

test('P runs and stops the cycle from the keyboard', () => {
  const page = createPage(__dirname);
  page.key('KeyP');
  assert.equal(page.get('cyclePlayBtn').textContent, 'Stop cycle');
  page.key('KeyP');
  assert.equal(page.get('cyclePlayBtn').textContent, 'Run cycle');
});

test('A adds a voice from the keyboard', () => {
  const page = createPage(__dirname);
  const before = page.get('trackEditor').children.length;
  page.key('KeyA');
  assert.equal(page.get('trackEditor').children.length, before + 1);
  assert.match(page.get('gridLive').textContent, /Voice 4 added/);
});

test('E and M trigger session and MIDI downloads from the keyboard', () => {
  const page = createPage(__dirname);
  page.key('KeyE');
  page.key('KeyM');
  const names = page.document.downloads.map((d) => d.filename);
  assert.deepEqual(names, ['beatgrid-study.json', 'beatgrid-study.mid']);
});

test('shortcuts stay quiet while typing in a field', () => {
  const page = createPage(__dirname);
  const before = page.get('trackEditor').children.length;
  page.key('KeyA', 'keydown', page.get('bpm'));
  page.key('KeyP', 'keydown', page.get('title'));
  assert.equal(page.get('trackEditor').children.length, before);
  assert.equal(page.get('cyclePlayBtn').textContent, 'Run cycle');
});

test('removing a voice announces the new count', () => {
  const page = createPage(__dirname);
  const remove = page.get('trackEditor').children[1].querySelector('.remove-btn');
  remove.click();
  assert.match(page.get('gridLive').textContent, /removed, 2 voices remain/);
});

/* ------------------------------------------------------------------ */
/* Import recovery and pattern round-trip through the UI               */
/* ------------------------------------------------------------------ */

test('empty import reports a friendly rejection without touching state', () => {
  const page = createPage(__dirname);
  page.get('sessionJson').value = '   ';
  page.get('importSessionBtn').click();
  assert.match(page.get('sessionStatus').textContent, /paste a session or pattern/i);
  assert.equal(page.get('statCycle').textContent, '72');
  assert.equal(page.get('trackEditor').children.length, 3);
});

test('garbage import is rejected and the workspace is unchanged', () => {
  const page = createPage(__dirname);
  page.get('sessionJson').value = '{not json';
  page.get('importSessionBtn').click();
  assert.match(page.get('sessionStatus').textContent, /Import rejected/);
  assert.match(page.get('gridLive').textContent, /Import rejected/);
  assert.equal(page.get('statCycle').textContent, '72');
  assert.equal(page.get('downloadMidiBtn').disabled, false);
});

test('a valid import succeeds immediately after a rejected one', () => {
  const page = createPage(__dirname);
  page.get('sessionJson').value = '{"schema":"other"}';
  page.get('importSessionBtn').click();
  assert.match(page.get('sessionStatus').textContent, /Import rejected/);
  const session = { schema: 'beatgrid/session', version: 1, title: 'Recovered', bpm: 100, ppq: 480, gate: 0.5,
    tracks: [{ name: 'Solo', pulses: 4, steps: 4 }] };
  page.get('sessionJson').value = JSON.stringify(session);
  page.get('importSessionBtn').click();
  assert.match(page.get('sessionStatus').textContent, /Imported 1 voices/);
  assert.equal(page.get('statCycle').textContent, '4');
  assert.equal(page.get('bpm').value, '100');
});

test('a beatgrid/pattern import adds a manual voice', () => {
  const page = createPage(__dirname);
  page.get('sessionJson').value = R.exportPattern({ name: 'Clave', pattern: vec('1001001010010000') });
  page.get('importSessionBtn').click();
  assert.equal(page.get('trackEditor').children.length, 4);
  assert.match(page.get('sessionStatus').textContent, /1 pattern voice/);
  const row = page.get('trackEditor').children[3];
  assert.equal(row.querySelectorAll('.step-cell').length, 16);
  assert.match(row.textContent, /Manual vector/);
});

test('a pattern-set import restores all voices and canonicalizes the textarea', () => {
  const page = createPage(__dirname);
  page.get('downloadPatternsBtn').click();
  const download = page.document.downloads.at(-1);
  assert.match(download.filename, /patterns\.json$/);
  const exported = page.get('sessionJson').value;
  const parsed = JSON.parse(exported);
  assert.equal(parsed.schema, 'beatgrid/pattern-set');
  page.get('sessionJson').value = JSON.stringify({ schema: 'beatgrid/session', version: 1, title: 'One', bpm: 120, ppq: 480, gate: 0.5,
    tracks: [{ name: 'One', pulses: 1, steps: 4 }] });
  page.get('importSessionBtn').click();
  assert.equal(page.get('trackEditor').children.length, 1);
  page.get('sessionJson').value = exported;
  page.get('importSessionBtn').click();
  assert.equal(page.get('trackEditor').children.length, 4);
  const parsed2 = JSON.parse(page.get('sessionJson').value);
  assert.equal(parsed2.schema, 'beatgrid/session', 'textarea shows the canonical session after import');
});

test('pattern imports beyond the voice limit reject atomically', () => {
  const page = createPage(__dirname);
  const set = JSON.stringify({ schema: 'beatgrid/pattern-set', version: 1,
    patterns: Array.from({ length: 6 }, () => ({ vector: '1001' })) });
  page.get('sessionJson').value = set;
  page.get('importSessionBtn').click();
  assert.match(page.get('sessionStatus').textContent, /would exceed/);
  assert.equal(page.get('trackEditor').children.length, 3);
});

test('diagnostics table reports the new evenness column', () => {
  const page = createPage(__dirname);
  const header = page.get('diagnosticsTable').querySelector('thead tr');
  assert.match(header.textContent, /Evenness/);
  const firstRow = page.get('diagnosticsTable').querySelector('tbody tr');
  assert.match(firstRow.textContent, /0\.800/); // E(3,8)
});

test('the shortcuts disclosure documents every binding', () => {
  const page = createPage(__dirname);
  const keys = page.document.querySelectorAll('.shortcuts kbd').map((k) => k.textContent);
  for (const key of ['Home', 'End', 'Page Up', 'Page Down', 'Space', 'Enter', 'P', 'A', 'E', 'M', 'L']) {
    assert.ok(keys.includes(key), `shortcuts list covers ${key}`);
  }
  assert.equal(keys.length, 15); // four arrows plus the named bindings
});

/* ------------------------------------------------------------------ */
/* Source hygiene                                                      */
/* ------------------------------------------------------------------ */

test('shipped sources contain no em or en dashes', () => {
  for (const file of ['index.html', 'app.js', 'rhythm.js', 'style.css']) {
    const text = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.doesNotMatch(text, /[\u2013\u2014]/, file);
    assert.doesNotMatch(text, /&(?:mdash|ndash);/i, file);
  }
});

test('shipped sources contain no smooth scrolling or AI tool mentions', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.doesNotMatch(css, /scroll-behavior/i);
  assert.doesNotMatch(html, /scroll-behavior|scroll-smooth/i);
  for (const file of ['index.html', 'app.js', 'rhythm.js', 'style.css']) {
    const text = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.doesNotMatch(text, /\b(?:Claude|ChatGPT|OpenAI|Copilot|Devin|Anthropic|Gemini)\b/i, file);
  }
});

test('a keyboard-heavy session still passes the structural audit', () => {
  const page = createPage(__dirname);
  const cells = page.get('trackEditor').children[0].querySelectorAll('.step-cell');
  cells[0].focus();
  page.fire(cells[0], 'keydown', { code: 'ArrowRight' });
  page.fire(page.document.activeElement, 'keydown', { code: 'Space' });
  page.key('KeyA');
  page.get('sessionJson').value = 'oops';
  page.get('importSessionBtn').click();
  page.get('sessionJson').value = R.exportSession({ schema: 'beatgrid/session', version: 1, title: 'Audit', bpm: 120, ppq: 480, gate: 0.5,
    tracks: [{ name: 'Audit voice', pulses: 3, steps: 8 }] });
  page.get('importSessionBtn').click();
  auditPage(page);
});
