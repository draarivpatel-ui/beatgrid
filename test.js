'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('./rhythm.js');

const vec = (s) => Array.from(s, (c) => (c === '1' ? 1 : 0));
const str = (v) => v.join('');

/* ------------------------------------------------------------------ */
/* Bjorklund E(k, n) canonical patterns                                */
/* ------------------------------------------------------------------ */

test('E(3,8) is the canonical tresillo 10010010', () => {
  assert.equal(str(R.euclideanRhythm(3, 8)), '10010010');
});

test('E(5,8) is the cinquillo 10110110', () => {
  assert.equal(str(R.euclideanRhythm(5, 8)), '10110110');
});

test('E(5,16) is the bossa nova clave 1001001001001000', () => {
  assert.equal(str(R.euclideanRhythm(5, 16)), '1001001001001000');
});

test('E(7,12) is the West African bell 101101011010', () => {
  assert.equal(str(R.euclideanRhythm(7, 12)), '101101011010');
});

test('E(4,9) is the aksak 9/8 pattern 101010100', () => {
  assert.equal(str(R.euclideanRhythm(4, 9)), '101010100');
});

test('E(4,12) is four evenly spaced onsets', () => {
  assert.equal(str(R.euclideanRhythm(4, 12)), '100100100100');
});

test('E(3,4) is the common 3 over 4 pattern 1110', () => {
  assert.equal(str(R.euclideanRhythm(3, 4)), '1110');
});

test('E(2,5) is 10100', () => {
  assert.equal(str(R.euclideanRhythm(2, 5)), '10100');
});

test('E(5,12) is 100101001010', () => {
  assert.equal(str(R.euclideanRhythm(5, 12)), '100101001010');
});

test('E(7,16) is 1001010100101010', () => {
  assert.equal(str(R.euclideanRhythm(7, 16)), '1001010100101010');
});

test('E(1,4) places a single onset at step zero', () => {
  assert.equal(str(R.euclideanRhythm(1, 4)), '1000');
});

test('E(13,16) is the complement of E(3,16)', () => {
  assert.equal(str(R.euclideanRhythm(13, 16)), '1011110111101111');
});

test('E(0,n) is an all-rest vector', () => {
  assert.equal(str(R.euclideanRhythm(0, 8)), '00000000');
});

test('E(n,n) is an all-onset vector', () => {
  assert.equal(str(R.euclideanRhythm(6, 6)), '111111');
});

test('k greater than n saturates to all onsets', () => {
  assert.equal(str(R.euclideanRhythm(9, 6)), '111111');
});

test('E(k,n) always has length n', () => {
  for (let n = 1; n <= 32; n++) {
    for (let k = 0; k <= n; k++) {
      assert.equal(R.euclideanRhythm(k, n).length, n, `E(${k},${n}) length`);
    }
  }
});

test('E(k,n) always has exactly min(k,n) onsets', () => {
  for (let n = 1; n <= 24; n++) {
    for (let k = 0; k <= n; k++) {
      const count = R.euclideanRhythm(k, n).filter(Boolean).length;
      assert.equal(count, k, `E(${k},${n}) onset count`);
    }
  }
});

test('E(k,n) contains only binary values', () => {
  for (let n = 1; n <= 20; n++) {
    for (let k = 0; k <= n; k++) {
      for (const v of R.euclideanRhythm(k, n)) {
        assert.ok(v === 0 || v === 1);
      }
    }
  }
});

test('Bjorklund distributes onsets maximally evenly (gap spread <= 1)', () => {
  for (let n = 2; n <= 24; n++) {
    for (let k = 1; k <= n; k++) {
      const v = R.euclideanRhythm(k, n);
      const positions = [];
      for (let i = 0; i < n; i++) if (v[i]) positions.push(i);
      const gaps = positions.map((p, i) => ((positions[(i + 1) % k] - p + n) % n) || n);
      // Gap of zero occurs only when k === 1 (single onset wraps a full cycle).
      assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 1, `E(${k},${n}) gaps ${gaps}`);
    }
  }
});

test('invalid Bjorklund arguments throw TypeError or RangeError', () => {
  assert.throws(() => R.euclideanRhythm(1.5, 8), TypeError);
  assert.throws(() => R.euclideanRhythm(3, 0), RangeError);
  assert.throws(() => R.euclideanRhythm(-1, 8), RangeError);
  assert.throws(() => R.euclideanRhythm(3, 8, 0.5), TypeError);
  assert.throws(() => R.euclideanRhythm('3', 8), TypeError);
});

/* ------------------------------------------------------------------ */
/* Rotation and rotation invariance                                    */
/* ------------------------------------------------------------------ */

test('rotation by zero is identity', () => {
  assert.equal(str(R.euclideanRhythm(3, 8, 0)), str(R.euclideanRhythm(3, 8)));
});

test('rotation by one step shifts onsets right', () => {
  assert.equal(str(R.euclideanRhythm(3, 8, 1)), '01001001');
});

test('rotation by n equals identity', () => {
  assert.equal(str(R.euclideanRhythm(5, 16, 16)), str(R.euclideanRhythm(5, 16, 0)));
});

test('rotation by 2n equals identity', () => {
  assert.equal(str(R.euclideanRhythm(7, 12, 24)), str(R.euclideanRhythm(7, 12, 0)));
});

test('negative rotation wraps to a positive shift', () => {
  assert.equal(str(R.euclideanRhythm(3, 8, -1)), str(R.euclideanRhythm(3, 8, 7)));
  assert.equal(str(R.euclideanRhythm(4, 9, -4)), str(R.euclideanRhythm(4, 9, 5)));
});

test('rotation preserves onset count for every shift', () => {
  const base = R.euclideanRhythm(5, 16);
  for (let r = -20; r <= 20; r++) {
    assert.equal(R.euclideanRhythm(5, 16, r).filter(Boolean).length, 5);
    assert.equal(str(R.rotateVector(base, r)), str(R.euclideanRhythm(5, 16, r)));
  }
});

test('rotation invariance: the multiset of inter-onset gaps is unchanged', () => {
  const gapsOf = (v) => {
    const pos = [];
    for (let i = 0; i < v.length; i++) if (v[i]) pos.push(i);
    return pos.map((p, i) => (pos[(i + 1) % pos.length] - p + v.length) % v.length).sort().join(',');
  };
  for (let r = 0; r < 12; r++) {
    assert.equal(gapsOf(R.euclideanRhythm(7, 12, r)), gapsOf(R.euclideanRhythm(7, 12, 0)));
  }
});

/* ------------------------------------------------------------------ */
/* GCD / LCM / vectors                                                 */
/* ------------------------------------------------------------------ */

test('gcd handles coprime, common factors, and zero', () => {
  assert.equal(R.gcd(12, 8), 4);
  assert.equal(R.gcd(9, 16), 1);
  assert.equal(R.gcd(0, 7), 7);
  assert.equal(R.gcd(-12, 8), 4);
});

test('lcm handles common cases', () => {
  assert.equal(R.lcm(8, 12), 24);
  assert.equal(R.lcm(9, 16), 144);
  assert.equal(R.lcm(4, 6), 12);
  assert.equal(R.lcm(0, 5), 0);
});

test('lcmAll reduces a list of step counts', () => {
  assert.equal(R.lcmAll([8, 12, 9]), 72);
  assert.equal(R.lcmAll([16, 4, 8]), 16);
  assert.equal(R.lcmAll([7, 5, 3]), 105);
});

test('expandPattern tiles a pattern to an exact length', () => {
  assert.equal(str(R.expandPattern(vec('101'), 7)), '1011011');
  assert.equal(str(R.expandPattern(vec('101'), 0)), '');
  assert.throws(() => R.expandPattern(vec('101'), -1), RangeError);
});

test('hammingDistance counts differing positions', () => {
  assert.equal(R.hammingDistance(vec('1010'), vec('1111')), 2);
  assert.equal(R.hammingDistance(vec('1010'), vec('1010')), 0);
  assert.throws(() => R.hammingDistance(vec('101'), vec('10')), RangeError);
});

test('metricalWeight ranks downbeat above beat above division', () => {
  assert.equal(R.metricalWeight(0, 4), 4);
  assert.equal(R.metricalWeight(4, 4), 3);
  assert.equal(R.metricalWeight(8, 4), 3);
  assert.equal(R.metricalWeight(2, 4), 2);
  assert.equal(R.metricalWeight(3, 4), 1);
});

test('syncopationIndex is zero for a plain four-on-the-floor bar', () => {
  assert.equal(R.syncopationIndex(vec('1000100010001000'), 4), 0);
});

test('syncopationIndex is positive for an offbeat pattern', () => {
  assert.ok(R.syncopationIndex(vec('0010001000100010'), 4) > 0);
});

/* ------------------------------------------------------------------ */
/* Polyrhythm analysis                                                 */
/* ------------------------------------------------------------------ */

const TRACKS = [
  { name: 'Tresillo', pulses: 3, steps: 8, note: 36 },
  { name: 'West African Bell', pulses: 7, steps: 12, note: 56 },
  { name: 'Aksak 9/8', pulses: 4, steps: 9, note: 45 }
];

test('analyzePolyrhythm computes the LCM cycle in steps', () => {
  const a = R.analyzePolyrhythm(TRACKS, 120);
  assert.equal(a.cycleSteps, 72);
  assert.equal(a.lcmSteps, 72);
});

test('analyzePolyrhythm computes cycle seconds from bpm', () => {
  const a = R.analyzePolyrhythm(TRACKS, 120);
  assert.equal(a.secondsPerStep, 60 / 120 / 4);
  assert.equal(a.cycleSeconds, 9);
  assert.equal(a.cycleBeats, 18);
});

test('cycle seconds scale inversely with bpm', () => {
  const a = R.analyzePolyrhythm(TRACKS, 120);
  const b = R.analyzePolyrhythm(TRACKS, 240);
  assert.equal(b.cycleSeconds, a.cycleSeconds / 2);
});

test('a single track cycle equals its own step count', () => {
  const a = R.analyzePolyrhythm([{ pulses: 5, steps: 16 }], 100);
  assert.equal(a.cycleSteps, 16);
  assert.equal(a.cycleSeconds, 16 * 60 / 100 / 4);
});

test('coincidence matrix is square and symmetric', () => {
  const a = R.analyzePolyrhythm(TRACKS, 120);
  assert.equal(a.coincidenceMatrix.length, 3);
  for (let i = 0; i < 3; i++) {
    assert.equal(a.coincidenceMatrix[i].length, 3);
    for (let j = 0; j < 3; j++) {
      assert.equal(a.coincidenceMatrix[i][j], a.coincidenceMatrix[j][i]);
    }
  }
});

test('coincidence diagonal equals the expanded onset count', () => {
  const a = R.analyzePolyrhythm(TRACKS, 120);
  const expected = [27, 42, 32];
  for (let i = 0; i < 3; i++) {
    assert.equal(a.coincidenceMatrix[i][i], expected[i]);
  }
});

test('off-diagonal coincidences match an independent brute force count', () => {
  const a = R.analyzePolyrhythm(TRACKS, 120);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let count = 0;
      for (let s = 0; s < a.cycleSteps; s++) {
        if (a.tracks[i].expanded[s] && a.tracks[j].expanded[s]) count++;
      }
      assert.equal(a.coincidenceMatrix[i][j], count);
    }
  }
});

test('coincidenceRates are coincidences divided by cycleSteps', () => {
  const a = R.analyzePolyrhythm(TRACKS, 120);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      assert.ok(Math.abs(a.coincidenceRates[i][j] - a.coincidenceMatrix[i][j] / 72) < 1e-12);
    }
  }
});

test('coincidenceSteps lists exactly the shared-onset steps', () => {
  const a = R.analyzePolyrhythm(TRACKS, 120);
  const expected = [];
  for (let s = 0; s < a.cycleSteps; s++) {
    let hits = 0;
    for (const t of a.tracks) if (t.expanded[s]) hits++;
    if (hits >= 2) expected.push(s);
  }
  assert.deepEqual(a.coincidenceSteps, expected);
  assert.equal(a.coincidenceCount, expected.length);
});

test('coincidenceDensity lies in [0, 1]', () => {
  const a = R.analyzePolyrhythm(TRACKS, 120);
  assert.ok(a.coincidenceDensity >= 0 && a.coincidenceDensity <= 1);
});

test('hammingDistances are symmetric with a zero diagonal', () => {
  const a = R.analyzePolyrhythm(TRACKS, 120);
  for (let i = 0; i < 3; i++) {
    assert.equal(a.hammingDistances[i][i], 0);
    for (let j = 0; j < 3; j++) {
      assert.equal(a.hammingDistances[i][j], a.hammingDistances[j][i]);
      assert.equal(a.hammingDistances[i][j], R.hammingDistance(a.tracks[i].expanded, a.tracks[j].expanded));
    }
  }
});

test('hammingRates equal distances divided by cycleSteps', () => {
  const a = R.analyzePolyrhythm(TRACKS, 120);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      assert.ok(Math.abs(a.hammingRates[i][j] - a.hammingDistances[i][j] / 72) < 1e-12);
    }
  }
});

test('identical tracks yield zero hamming distance and maximal coincidence', () => {
  const a = R.analyzePolyrhythm([
    { name: 'A', pulses: 3, steps: 8 },
    { name: 'B', pulses: 3, steps: 8 }
  ], 120);
  assert.equal(a.hammingDistances[0][1], 0);
  assert.equal(a.coincidenceMatrix[0][1], 3);
});

test('syncopation report includes per-track scores and a total', () => {
  const a = R.analyzePolyrhythm(TRACKS, 120);
  assert.equal(a.syncopation.perTrack.length, 3);
  assert.equal(a.syncopation.total, a.syncopation.perTrack.reduce((s, x) => s + x.score, 0));
  assert.equal(a.syncopationIndex, a.syncopation.total);
  assert.ok(a.syncopation.mean > 0);
});

test('analyzePolyrhythm accepts explicit pattern arrays', () => {
  const a = R.analyzePolyrhythm([
    { name: 'Manual', pattern: vec('10010010'), note: 36 },
    { name: 'Manual2', pattern: vec('101'), note: 38 }
  ], 90);
  assert.equal(a.cycleSteps, 24);
  assert.equal(a.tracks[0].pulses, 3);
});

test('normalizeTracks clamps notes, channels, and velocities into MIDI range', () => {
  const t = R.normalizeTracks([{ name: 'X', pulses: 1, steps: 4, note: 999, channel: 99, velocity: 999 }])[0];
  assert.equal(t.note, 127);
  assert.equal(t.channel, 15);
  assert.equal(t.velocity, 127);
});

test('analyzePolyrhythm rejects empty track lists and invalid bpm', () => {
  assert.throws(() => R.analyzePolyrhythm([], 120), RangeError);
  assert.throws(() => R.analyzePolyrhythm(TRACKS, 0), RangeError);
  assert.throws(() => R.analyzePolyrhythm(TRACKS, -5), RangeError);
  assert.throws(() => R.analyzePolyrhythm('nope', 120), TypeError);
});

/* ------------------------------------------------------------------ */
/* Variable length quantity                                            */
/* ------------------------------------------------------------------ */

test('vlqEncode of zero is a single zero byte', () => {
  assert.deepEqual(R.vlqEncode(0), [0x00]);
});

test('vlqEncode of 127 is a single byte', () => {
  assert.deepEqual(R.vlqEncode(127), [0x7f]);
});

test('vlqEncode of 128 is 81 00', () => {
  assert.deepEqual(R.vlqEncode(128), [0x81, 0x00]);
});

test('vlqEncode of 8192 is C0 00', () => {
  assert.deepEqual(R.vlqEncode(8192), [0xc0, 0x00]);
});

test('vlqEncode of 0xFFFFFFF is FF FF FF 7F', () => {
  assert.deepEqual(R.vlqEncode(0x0fffffff), [0xff, 0xff, 0xff, 0x7f]);
});

test('vlqEncode marks continuation bits only on bytes before the last', () => {
  for (const value of [1, 64, 128, 200, 8191, 8192, 16383, 100000, 0x0fffffff]) {
    const bytes = R.vlqEncode(value);
    for (let i = 0; i < bytes.length - 1; i++) assert.ok((bytes[i] & 0x80) !== 0);
    assert.equal(bytes[bytes.length - 1] & 0x80, 0);
  }
});

test('vlqDecode round trips a wide range of values', () => {
  for (const value of [0, 1, 63, 127, 128, 129, 255, 8192, 16383, 65535, 123456, 0x0fffffff]) {
    const bytes = Uint8Array.from(R.vlqEncode(value));
    const out = R.vlqDecode(bytes, 0);
    assert.equal(out.value, value);
    assert.equal(out.consumed, bytes.length);
  }
});

test('vlqDecode reports the consumed length within a longer stream', () => {
  // 360 -> 0x82 0x68, followed by a standalone zero delta and a 127 delta.
  const stream = Uint8Array.from([0x30, 0x82, 0x68, 0x00, 0x7f]);
  assert.deepEqual(R.vlqDecode(stream, 0), { value: 0x30, consumed: 1 });
  assert.deepEqual(R.vlqDecode(stream, 1), { value: 360, consumed: 2 });
  assert.deepEqual(R.vlqDecode(stream, 3), { value: 0, consumed: 1 });
  assert.deepEqual(R.vlqDecode(stream, 4), { value: 127, consumed: 1 });
});

test('vlqEncode rejects negative, non-integer, and oversized values', () => {
  assert.throws(() => R.vlqEncode(-1), RangeError);
  assert.throws(() => R.vlqEncode(1.5), TypeError);
  assert.throws(() => R.vlqEncode(0x10000000), RangeError);
});

test('vlqDecode rejects an incomplete VLQ', () => {
  assert.throws(() => R.vlqDecode(Uint8Array.from([0x80, 0x80, 0x80, 0x80]), 0), RangeError);
});

/* ------------------------------------------------------------------ */
/* Standard MIDI File encoding                                         */
/* ------------------------------------------------------------------ */

const MIDI_TRACKS = [
  { name: 'Tresillo', pulses: 3, steps: 8, note: 36 },
  { name: 'Bell', pulses: 7, steps: 12, note: 56 }
];

test('encodeMidiFile returns a Uint8Array', () => {
  const bytes = R.encodeMidiFile(MIDI_TRACKS, 120, 480);
  assert.ok(bytes instanceof Uint8Array);
  assert.ok(bytes.length > 14);
});

test('SMF header starts with the MThd chunk id', () => {
  const bytes = R.encodeMidiFile(MIDI_TRACKS, 120, 480);
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'MThd');
});

test('SMF header length is exactly 6 bytes', () => {
  const bytes = R.encodeMidiFile(MIDI_TRACKS, 120, 480);
  assert.deepEqual(Array.from(bytes.slice(4, 8)), [0, 0, 0, 6]);
});

test('SMF header declares format 0', () => {
  const bytes = R.encodeMidiFile(MIDI_TRACKS, 120, 480);
  assert.deepEqual(Array.from(bytes.slice(8, 10)), [0, 0]);
});

test('SMF header declares exactly one track', () => {
  const bytes = R.encodeMidiFile(MIDI_TRACKS, 120, 480);
  assert.deepEqual(Array.from(bytes.slice(10, 12)), [0, 1]);
});

test('SMF header encodes the requested division', () => {
  const bytes = R.encodeMidiFile(MIDI_TRACKS, 120, 960);
  assert.deepEqual(Array.from(bytes.slice(12, 14)), [0x03, 0xc0]);
});

test('SMF division is a positive ticks-per-quarter note, not SMPTE', () => {
  const bytes = R.encodeMidiFile(MIDI_TRACKS, 120, 480);
  assert.equal(bytes[12] & 0x80, 0);
  assert.equal((bytes[12] << 8) | bytes[13], 480);
});

test('the MTrk chunk id follows the header', () => {
  const bytes = R.encodeMidiFile(MIDI_TRACKS, 120, 480);
  assert.equal(String.fromCharCode(...bytes.slice(14, 18)), 'MTrk');
});

test('MTrk declared length matches the remaining bytes', () => {
  const bytes = R.encodeMidiFile(MIDI_TRACKS, 120, 480);
  const declared = (bytes[18] * 0x1000000) + (bytes[19] * 0x10000) + (bytes[20] * 0x100) + bytes[21];
  assert.equal(declared, bytes.length - 22);
});

test('describeMidiChunks finds MThd and one MTrk with exact offsets', () => {
  const bytes = R.encodeMidiFile(MIDI_TRACKS, 120, 480);
  const chunks = R.describeMidiChunks(bytes);
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks[0], { type: 'MThd', offset: 0, length: 6 });
  assert.equal(chunks[1].type, 'MTrk');
  assert.equal(chunks[1].offset, 14);
  assert.equal(chunks[1].length, bytes.length - 22);
});

test('MTrk body starts with three VLQ deltas of zero and meta events', () => {
  const bytes = R.encodeMidiFile(MIDI_TRACKS, 120, 480);
  assert.equal(bytes[22], 0);
  assert.equal(bytes[23], 0xff);
  assert.equal(bytes[24], 0x03);
});

test('SMF contains the tempo meta event FF 51 03 and microseconds per quarter', () => {
  const bytes = R.encodeMidiFile(MIDI_TRACKS, 120, 480);
  const marker = [0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20];
  const found = Array.from(bytes).some((_, i) => marker.every((v, j) => bytes[i + j] === v));
  assert.ok(found, 'FF 51 03 07 A1 20 (500000 us per quarter at 120 BPM) present');
});

test('microsPerQuarter converts bpm to microseconds', () => {
  assert.equal(R.microsPerQuarter(120), 500000);
  assert.equal(R.microsPerQuarter(60), 1000000);
  assert.equal(R.microsPerQuarter(240), 250000);
});

test('tempo bytes change when bpm changes', () => {
  const slow = R.encodeMidiFile(MIDI_TRACKS, 90, 480);
  const fast = R.encodeMidiFile(MIDI_TRACKS, 180, 480);
  const grab = (b) => {
    for (let i = 0; i + 6 < b.length; i++) {
      if (b[i] === 0xff && b[i + 1] === 0x51 && b[i + 2] === 0x03) return [b[i + 3], b[i + 4], b[i + 5]];
    }
    return null;
  };
  assert.deepEqual(grab(slow), [0x0a, 0x2c, 0x2b]); // 666667 us at 90 BPM
  assert.deepEqual(grab(fast), [0x05, 0x16, 0x15]); // 333333 us at 180 BPM
});

test('SMF contains note-on and note-off events on channel 10 (index 9)', () => {
  const bytes = R.encodeMidiFile(MIDI_TRACKS, 120, 480);
  let noteOn = 0;
  let noteOff = 0;
  for (let i = 22; i < bytes.length; i++) {
    if (bytes[i] === 0x99 && i + 2 < bytes.length) noteOn++;
    if (bytes[i] === 0x89 && i + 2 < bytes.length) noteOff++;
  }
  // LCM(8, 12) = 24 steps. E(3,8) contributes 9 onsets, E(7,12) contributes 14.
  assert.equal(noteOn, 23);
  assert.equal(noteOff, noteOn);
});

test('SMF ends with the end-of-track meta event FF 2F 00', () => {
  const bytes = R.encodeMidiFile(MIDI_TRACKS, 120, 480);
  assert.deepEqual(Array.from(bytes.slice(-3)), [0xff, 0x2f, 0x00]);
});

test('SMF body parses as a valid sequence of VLQ delta times and events', () => {
  const bytes = R.encodeMidiFile(MIDI_TRACKS, 120, 480);
  let i = 22;
  let events = 0;
  let ended = false;
  while (i < bytes.length) {
    const delta = R.vlqDecode(bytes, i);
    i += delta.consumed;
    const status = bytes[i];
    if ((status & 0x80) === 0) {
      // Running status is not used by this encoder.
      assert.fail(`unexpected data byte at ${i}`);
    }
    if (status === 0xff) {
      const type = bytes[i + 1];
      const len = R.vlqDecode(bytes, i + 2);
      i += 2 + len.consumed + len.value;
      if (type === 0x2f) ended = true;
    } else if ((status & 0xf0) === 0x90 || (status & 0xf0) === 0x80) {
      i += 3;
    } else {
      assert.fail(`unexpected status ${status.toString(16)} at ${i}`);
    }
    events++;
    assert.ok(delta.value >= 0);
  }
  assert.ok(ended, 'end of track reached');
  assert.ok(events > 30, 'many events parsed');
  assert.equal(i, bytes.length);
});

test('delta times are non-decreasing absolute tick positions', () => {
  const bytes = R.encodeMidiFile(MIDI_TRACKS, 120, 480);
  let i = 22;
  let tick = 0;
  while (i < bytes.length) {
    const delta = R.vlqDecode(bytes, i);
    tick += delta.value;
    i += delta.consumed;
    const status = bytes[i];
    if (status === 0xff) {
      const len = R.vlqDecode(bytes, i + 2);
      i += 2 + len.consumed + len.value;
    } else {
      i += 3;
    }
    assert.ok(tick >= 0);
  }
  assert.ok(tick > 0);
});

test('encodeMidiFile supports an options object in place of ppq', () => {
  const bytes = R.encodeMidiFile(MIDI_TRACKS, 120, { ppq: 240, gate: 0.25 });
  assert.deepEqual(Array.from(bytes.slice(12, 14)), [0x00, 0xf0]);
  assert.ok(bytes instanceof Uint8Array);
});

test('encodeMidiFile validates ppq, gate, and stepsPerBeat', () => {
  assert.throws(() => R.encodeMidiFile(MIDI_TRACKS, 120, 0), RangeError);
  assert.throws(() => R.encodeMidiFile(MIDI_TRACKS, 120, 32768), RangeError);
  assert.throws(() => R.encodeMidiFile(MIDI_TRACKS, 120, 480.5), TypeError);
  assert.throws(() => R.encodeMidiFile(MIDI_TRACKS, 120, 480, { gate: 0 }), RangeError);
  assert.throws(() => R.encodeMidiFile(MIDI_TRACKS, 120, 480, { stepsPerBeat: 0 }), RangeError);
});

test('hexDump renders offsets, hex bytes, and an ASCII gutter', () => {
  const out = R.hexDump(Uint8Array.from([0x4d, 0x54, 0x68, 0x64]), 4);
  assert.match(out, /00000000/);
  assert.match(out, /4D 54 68 64/);
  assert.match(out, /\|MThd\|/);
});

/* ------------------------------------------------------------------ */
/* LilyPond exporter                                                   */
/* ------------------------------------------------------------------ */

test('exportLilyPond returns a string with a version and header', () => {
  const ly = R.exportLilyPond(MIDI_TRACKS, 120, 'Phase Study');
  assert.equal(typeof ly, 'string');
  assert.match(ly, /\\version "2\.24\.0"/);
  assert.match(ly, /title = "Phase Study"/);
});

test('exportLilyPond emits one DrumStaff per track', () => {
  const ly = R.exportLilyPond(MIDI_TRACKS, 120, 'Score');
  assert.equal((ly.match(/\\new DrumStaff/g) || []).length, 2);
  assert.match(ly, /instrumentName = "Tresillo"/);
  assert.match(ly, /instrumentName = "Bell"/);
});

test('exportLilyPond sets a time signature from each track step count', () => {
  const ly = R.exportLilyPond(MIDI_TRACKS, 120, 'Score');
  assert.match(ly, /\\time 8\/16/);
  assert.match(ly, /\\time 12\/16/);
});

test('exportLilyPond emits the correct count of notes and rests for one cycle', () => {
  const ly = R.exportLilyPond([{ name: 'Solo', pulses: 3, steps: 8, note: 36 }], 120, 'Solo');
  const bd = (ly.match(/\bbd16\b/g) || []).length;
  const rest = (ly.match(/\br16\b/g) || []).length;
  assert.equal(bd, 3);
  assert.equal(rest, 5);
});

test('exportLilyPond repeats patterns out to the LCM cycle', () => {
  const ly = R.exportLilyPond(MIDI_TRACKS, 120, 'Score');
  const bd = (ly.match(/\bbd16\b/g) || []).length;
  assert.equal(bd, 9); // E(3,8) repeated three times over 24 steps
});

test('exportLilyPond maps MIDI notes to drum names', () => {
  const ly = R.exportLilyPond([{ name: 'HiHat', pulses: 2, steps: 4, note: 42 }], 120, 'Drums');
  assert.match(ly, /\bhh16\b/);
});

test('exportLilyPond includes BPM and phase cycle metadata comments', () => {
  const ly = R.exportLilyPond(MIDI_TRACKS, 120, 'Score');
  assert.match(ly, /Tempo: 120 BPM/);
  assert.match(ly, /Polymetric phase cycle: 24 steps/);
});

test('exportLilyPond escapes quotes and braces in the title', () => {
  const ly = R.exportLilyPond(MIDI_TRACKS, 120, 'Bad "Title" {x}');
  assert.match(ly, /title = "Bad Title x"/);
});

test('exportLilyPond ends with a closing score brace and a newline', () => {
  const ly = R.exportLilyPond(MIDI_TRACKS, 120, 'Score');
  assert.ok(ly.endsWith('}\n'));
});

test('exportLilyPond rejects an empty track list', () => {
  assert.throws(() => R.exportLilyPond([], 120, 'Empty'), RangeError);
});

/* ------------------------------------------------------------------ */
/* Presets and module surface                                          */
/* ------------------------------------------------------------------ */

test('PRESETS contains exactly the five documented world rhythms', () => {
  assert.equal(R.PRESETS.length, 5);
  assert.deepEqual(R.PRESETS.map((p) => p.formula), [
    'E(3,8)', 'E(5,8)', 'E(5,16)', 'E(7,12)', 'E(4,9)'
  ]);
});

test('every preset generates the canonical onset vector', () => {
  const expected = {
    'E(3,8)': '10010010',
    'E(5,8)': '10110110',
    'E(5,16)': '1001001001001000',
    'E(7,12)': '101101011010',
    'E(4,9)': '101010100'
  };
  for (const p of R.PRESETS) {
    assert.equal(str(R.euclideanRhythm(p.pulses, p.steps, p.rotation)), expected[p.formula], p.name);
  }
});

test('the module exposes every documented public function', () => {
  const names = [
    'euclideanRhythm', 'analyzePolyrhythm', 'encodeMidiFile', 'exportLilyPond',
    'vlqEncode', 'vlqDecode', 'hexDump', 'describeMidiChunks', 'normalizeTracks',
    'syncopationIndex', 'hammingDistance', 'metricalWeight', 'expandPattern',
    'rotateVector', 'gcd', 'lcm', 'lcmAll', 'microsPerQuarter'
  ];
  for (const name of names) assert.equal(typeof R[name], 'function', name);
  assert.equal(R.VERSION, '1.0.0');
});

test('a full preset set analyzes, encodes, and exports without throwing', () => {
  const tracks = R.PRESETS.map((p) => ({
    name: p.name, pulses: p.pulses, steps: p.steps, rotation: p.rotation, note: p.note
  }));
  const a = R.analyzePolyrhythm(tracks, 108);
  assert.equal(a.cycleSteps, 144);
  const midi = R.encodeMidiFile(tracks, 108, 480);
  assert.equal(String.fromCharCode(...midi.slice(0, 4)), 'MThd');
  assert.equal(R.describeMidiChunks(midi).length, 2);
  assert.match(R.exportLilyPond(tracks, 108, 'All Presets'), /\\new DrumStaff/);
});
