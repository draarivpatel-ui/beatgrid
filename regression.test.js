'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('./rhythm.js');

const session = overrides => ({ schema: 'beatgrid/session', version: 1, title: 'Study', bpm: 120, ppq: 480, gate: 0.5,
  tracks: [{ name: 'Kick', pulses: 3, steps: 8, rotation: 0, note: 36 }], ...overrides });

function midiEvents(bytes) {
  let offset = 22, tick = 0;
  const events = [];
  // Independent VLQ decoder so encoder and decoder cannot hide the same bug.
  function vlq() {
    let value = 0, byte;
    do { byte = bytes[offset++]; assert.notEqual(byte, undefined); value = value * 128 + (byte & 127); } while (byte & 128);
    return value;
  }
  while (offset < bytes.length) {
    tick += vlq();
    const status = bytes[offset++];
    if (status === 255) {
      const type = bytes[offset++], length = vlq();
      const data = [...bytes.slice(offset, offset + length)]; offset += length;
      events.push({ tick, status, type, data });
    } else events.push({ tick, status, data: [bytes[offset++], bytes[offset++]] });
  }
  assert.equal(offset, bytes.length);
  return events;
}

test('GCD and LCM reject non-finite, fractional, and unsafe integers', () => {
  for (const value of [NaN, Infinity, '4', 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => R.gcd(value, 4), TypeError);
    assert.throws(() => R.lcm(4, value), TypeError);
  }
  assert.throws(() => R.lcm(Number.MAX_SAFE_INTEGER, 2), RangeError);
});

test('voice lengths and cycle expansion are bounded before allocating', () => {
  assert.throws(() => R.euclideanRhythm(1, 65), RangeError);
  assert.throws(() => R.normalizeTracks(Array.from({ length: 9 }, () => ({ pulses: 1, steps: 4 }))), RangeError);
  assert.throws(() => R.analyzePolyrhythm([61, 59, 53].map(steps => ({ pulses: 1, steps }))), /4096/);
  assert.throws(() => R.expandPattern([1], R.MAX_CYCLE_STEPS + 1), RangeError);
});

test('manual vectors reject truthy strings, invalid cells, holes, and wrong shapes', () => {
  for (const pattern of [[2, 0], ['0', '1'], [null], Array(4), null, '1010']) assert.throws(() => R.normalizeTracks([{ pattern }]), TypeError);
  assert.throws(() => R.normalizeTracks([{ pattern: [] }]), RangeError);
  assert.deepEqual(R.normalizeTracks([{ pattern: [true, false, 1, 0] }])[0].pattern, [1, 0, 1, 0]);
});

test('normalized Euclidean metadata reports actual onsets and wrapped rotation', () => {
  const track = R.normalizeTracks([{ pulses: 20, steps: 8, rotation: -1 }])[0];
  assert.equal(track.pulses, 8);
  assert.equal(track.rotation, 7);
  assert.equal(track.pattern.reduce((sum, value) => sum + value, 0), 8);
});

test('pattern inspector finds cyclic gaps, onset density, and primitive repeats', () => {
  assert.deepEqual(R.inspectPattern([1, 0, 1, 0]).gaps, [2, 2]);
  assert.equal(R.inspectPattern([1, 0, 1, 0]).fundamentalPeriod, 2);
  assert.equal(R.inspectPattern([0, 0, 0]).fundamentalPeriod, 1);
  assert.equal(R.inspectPattern([1, 0, 0, 0]).density, 0.25);
  assert.deepEqual(R.inspectPattern([1, 0, 0, 0]).gaps, [4]);
  assert.deepEqual(R.inspectPattern([0, 0]).gaps, []);
});

test('all supported Euclidean vectors retain even gaps under rotation', () => {
  for (let steps = 1; steps <= 64; steps++) for (let pulses = 0; pulses <= steps; pulses++) {
    const vector = R.euclideanRhythm(pulses, steps, -13);
    const info = R.inspectPattern(vector);
    assert.equal(info.onsets, pulses);
    assert.ok(info.gapSpread <= 1, `E(${pulses},${steps})`);
    if (pulses) assert.equal(info.gaps.reduce((sum, gap) => sum + gap, 0), steps);
  }
});

test('syncopation evaluates every voice and meter phase with an independent reference', () => {
  function weight(step) { if (step % 16 === 0) return 4; if (step % 4 === 0) return 3; if (step % 2 === 0) return 2; return 1; }
  for (const pattern of [[1, 0, 0], [0, 1, 0, 0, 1], R.euclideanRhythm(4, 9)]) {
    const horizon = R.lcm(pattern.length, 16);
    let score = 0;
    for (let index = 0; index < horizon; index++) if (pattern[index % pattern.length]) {
      for (let distance = 1; distance <= 16; distance++) if (weight(index + distance) > weight(index)) {
        if (!pattern[(index + distance) % pattern.length]) score += weight(index + distance) - weight(index);
        break;
      }
    }
    assert.equal(R.syncopationIndex(pattern), score);
    const report = R.analyzePolyrhythm([{ pattern }]).syncopation.perTrack[0];
    assert.equal(report.evaluatedSteps, horizon);
    assert.equal(report.normalized, score / report.evaluatedOnsets);
  }
});

test('metrical helpers reject invalid grid sizes and non-integer positions', () => {
  for (const grid of [0, -1, 17, NaN, 0.5]) assert.throws(() => R.syncopationIndex([1, 0], grid));
  assert.throws(() => R.metricalWeight(0.5, 4), TypeError);
});

test('MIDI rational step boundaries avoid cumulative PPQ rounding drift', () => {
  const bytes = R.encodeMidiFile([{ pulses: 16, steps: 16 }], 120, 25, { gate: 1 });
  const events = midiEvents(bytes);
  assert.deepEqual(events.filter(event => (event.status & 240) === 144).map(event => event.tick), Array.from({ length: 16 }, (_, step) => Math.round(step * 25 / 4)));
  assert.equal(events.at(-1).tick, 100);
  assert.equal(events.at(-1).type, 47);
});

test('MIDI loop length has no extra silent gate tail at any supported gate', () => {
  for (const gate of [0.25, 0.5, 0.75, 1]) {
    const events = midiEvents(R.encodeMidiFile([{ pulses: 3, steps: 8 }], 120, 480, { gate }));
    assert.equal(events.at(-1).tick, 960);
    assert.ok(events.filter(event => event.status === 137).every(event => event.tick <= 960));
  }
});

test('simultaneous duplicate MIDI notes use the strongest velocity regardless of voice order', () => {
  const tracks = [40, 110].map(velocity => ({ pulses: 4, steps: 4, note: 36, velocity }));
  const a = R.encodeMidiFile(tracks, 120), b = R.encodeMidiFile(tracks.slice().reverse(), 120);
  assert.deepEqual(a, b);
  const events = midiEvents(a);
  const on = events.filter(event => event.status === 153), off = events.filter(event => event.status === 137);
  assert.equal(on.length, 4); assert.equal(off.length, 4);
  assert.ok(on.every(event => event.data[1] === 110));
});

test('note-offs precede retriggered note-ons at the same tick', () => {
  const notes = midiEvents(R.encodeMidiFile([{ pulses: 4, steps: 4 }], 120, 480, { gate: 1 })).filter(event => event.status !== 255);
  const at120 = notes.filter(event => event.tick === 120);
  assert.deepEqual(at120.map(event => event.status), [137, 153]);
});

test('MIDI rejects tempos and resolution that cannot represent the requested grid', () => {
  for (const bpm of [0, NaN, Infinity, 1, 1e9]) assert.throws(() => R.microsPerQuarter(bpm));
  assert.throws(() => R.encodeMidiFile([{ pulses: 1, steps: 4 }], 120, 1), /stepsPerBeat/);
});

test('VLQ and hex inspectors reject malformed bytes, offsets, and widths', () => {
  assert.throws(() => R.vlqDecode([256]), TypeError);
  assert.throws(() => R.vlqDecode([1], -1), RangeError);
  assert.throws(() => R.vlqDecode([1], 0.5), TypeError);
  for (const width of [0, -1, 1.5, Infinity, 257]) assert.throws(() => R.hexDump([1], width));
});

test('chunk inspector detects truncated bodies and trailing partial headers', () => {
  const midi = R.encodeMidiFile([{ pulses: 1, steps: 4 }]);
  assert.throws(() => R.describeMidiChunks(midi.slice(0, -1)), /truncated/);
  assert.throws(() => R.describeMidiChunks(Uint8Array.from([...midi, 0])), /truncated/);
});

test('LilyPond exports tempo and sanitizes control characters in metadata', () => {
  const ly = R.exportLilyPond([{ name: 'Track\n}\\header', pulses: 1, steps: 4, formula: 'safe\n\\evil' }], 90, 'Title');
  assert.match(ly, /\\tempo 4 = 90/);
  assert.doesNotMatch(ly, /\n\\evil/);
  assert.match(ly, /instrumentName = "Track header"/);
});

test('session JSON round-trips Euclidean and manual voices deterministically', () => {
  const original = session({ tracks: [{ name: 'Rotate', pulses: 3, steps: 8, rotation: -1, note: 38 }, { name: 'Manual', pattern: [0, 1, 1, 0], note: 56, channel: 4, velocity: 70 }] });
  const text = R.exportSession(original);
  const restored = R.importSession(text);
  assert.equal(restored.tracks[0].rotation, 7);
  assert.equal(R.exportSession(restored), text);
  assert.deepEqual(R.encodeMidiFile(original.tracks, original.bpm), R.encodeMidiFile(restored.tracks, restored.bpm));
});

test('session validator rejects unknown versions, invalid bounds, and MIDI coercion', () => {
  for (const overrides of [{ version: 2 }, { schema: 'other' }, { title: '' }, { bpm: 301 }, { ppq: 0 }, { gate: 0.1 }, { tracks: [] }, { tracks: [{ pulses: 9, steps: 8 }] }, { tracks: [{ pulses: 1, steps: 4, note: 200 }] }]) assert.throws(() => R.validateSession(session(overrides)));
  assert.throws(() => R.importSession(' '.repeat(131073)), /128 KiB/);
  assert.throws(() => R.importSession('null'), TypeError);
  assert.throws(() => R.validateSession(session({ title: 'Title\nline' })), RangeError);
});

test('score and session exports reject fractional tempo and malformed byte arrays', () => {
  assert.throws(() => R.exportLilyPond([{ pulses: 1, steps: 4 }], 120.5), /integer BPM/);
  assert.throws(() => R.validateSession(session({ bpm: 120.5 })), TypeError);
  for (const bytes of [[NaN], [-1], [256], Array(4), 'MThd']) {
    assert.throws(() => R.hexDump(bytes));
    assert.throws(() => R.describeMidiChunks(bytes));
  }
});
