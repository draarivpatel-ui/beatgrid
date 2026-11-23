'use strict';

// Wave 5 coverage: the polyrhythm necklace and phase-rotation lab module.
// Every claim is checked against the rhythm engine, Node crypto, or an
// independent brute-force reference so the lab cannot drift from truth.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const R = require('./rhythm.js');
const L = require('./polyrhythm-lab.js');

const vec = (s) => Array.from(s, (c) => (c === '1' ? 1 : 0));
const str = (v) => v.join('');

const ENSEMBLE_IDS = ['default-study', 'tresillo-cinquillo-poly', 'balkan-compound', 'prime-phase-drift', 'binary-grid-control'];

/* ------------------------------------------------------------------ */
/* FIPS 180-4 SHA-256                                                  */
/* ------------------------------------------------------------------ */

test('sha256 of the empty string matches the FIPS known answer', () => {
  assert.equal(L.sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('sha256 of abc matches the FIPS known answer', () => {
  assert.equal(L.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('sha256 of the two-block 56 byte FIPS message matches', () => {
  const msg = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
  assert.equal(L.sha256Hex(msg), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
});

test('sha256 of the 112 byte FIPS message matches', () => {
  const msg = 'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu';
  assert.equal(L.sha256Hex(msg), 'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1');
});

test('sha256 of the quick brown fox sentence matches', () => {
  assert.equal(L.sha256Hex('The quick brown fox jumps over the lazy dog'), 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592');
});

test('sha256 of one million a characters matches the FIPS answer', () => {
  assert.equal(L.sha256Hex('a'.repeat(1000000)), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});

const SHA_PARITY_STRINGS = [
  'x', 'ab', 'padding-55-chars:' + 'p'.repeat(36), 's'.repeat(55), 's'.repeat(56),
  's'.repeat(57), 's'.repeat(63), 's'.repeat(64), 's'.repeat(65), 's'.repeat(119),
  's'.repeat(120), 's'.repeat(127), 's'.repeat(128), 's'.repeat(129),
  'line1\nline2', 'tab\tcell', 'unicode:é€', 'digits 0123456789',
  JSON.stringify({ a: [1, 2, 3], b: 'z' }), 's'.repeat(1000)
];
for (const sample of SHA_PARITY_STRINGS) {
  test(`sha256 matches node crypto for input of ${sample.length} chars`, () => {
    const expected = crypto.createHash('sha256').update(sample, 'utf8').digest('hex');
    assert.equal(L.sha256Hex(sample), expected);
  });
}

test('sha256 accepts typed byte arrays', () => {
  const bytes = new TextEncoder().encode('abc');
  assert.equal(L.sha256BytesHex(bytes), L.sha256Hex('abc'));
  assert.equal(L.sha256BytesHex([97, 98, 99]), L.sha256Hex('abc'));
});

test('sha256 rejects hostile byte input', () => {
  assert.throws(() => L.sha256BytesHex('abc'), TypeError);
  assert.throws(() => L.sha256BytesHex([97, 256]), TypeError);
  assert.throws(() => L.sha256BytesHex([-1]), TypeError);
  assert.throws(() => L.sha256BytesHex([1.5]), TypeError);
  assert.throws(() => L.sha256BytesHex(null), TypeError);
});

/* ------------------------------------------------------------------ */
/* UTF-8 and base64url primitives                                      */
/* ------------------------------------------------------------------ */

const UTF8_BOUNDARIES = [0x41, 0x7f, 0x80, 0x7ff, 0x800, 0xffff, 0x10000, 0x10ffff];
for (const code of UTF8_BOUNDARIES) {
  test(`utf8 round-trips code point U+${code.toString(16).toUpperCase()}`, () => {
    const text = String.fromCodePoint(code);
    assert.equal(L.utf8Decode(L.utf8Encode(text)), text);
  });
}

test('utf8 round-trips a mixed BMP and astral string', () => {
  const text = 'AZz0\t\n' + String.fromCodePoint(0x20ac, 0x1d11e, 0x1f600);
  assert.equal(L.utf8Decode(L.utf8Encode(text)), text);
});

test('utf8 encoder replaces stray surrogate halves', () => {
  const bytes = L.utf8Encode('a�b');
  assert.equal(L.utf8Decode(bytes), 'a�b');
  const hi = L.utf8Encode('x\uD800y');
  assert.equal(L.utf8Decode(hi), 'x\uFFFDy');
});

test('utf8 decoder rejects a stray continuation byte', () => {
  assert.equal(L.utf8Decode([0x80]), null);
});

test('utf8 decoder rejects an overlong two byte encoding', () => {
  assert.equal(L.utf8Decode([0xc0, 0x80]), null);
  assert.equal(L.utf8Decode([0xc1, 0xbf]), null);
});

test('utf8 decoder rejects encoded surrogate halves', () => {
  assert.equal(L.utf8Decode([0xed, 0xa0, 0x80]), null);
  assert.equal(L.utf8Decode([0xed, 0xbf, 0xbf]), null);
});

test('utf8 decoder rejects truncated multibyte sequences', () => {
  assert.equal(L.utf8Decode([0xe2, 0x82]), null);
  assert.equal(L.utf8Decode([0xf0, 0x9d, 0x84]), null);
});

test('utf8 decoder rejects code points above U+10FFFF', () => {
  assert.equal(L.utf8Decode([0xf4, 0x90, 0x80, 0x80]), null);
  assert.equal(L.utf8Decode([0xf5, 0x80, 0x80, 0x80]), null);
});

for (const len of [1, 2, 3, 4, 5, 8, 64]) {
  test(`base64url round-trips ${len} bytes without padding`, () => {
    const bytes = [];
    for (let i = 0; i < len; i++) bytes.push((i * 37 + 11) & 0xff);
    const encoded = L.b64urlEncode(bytes);
    assert.doesNotMatch(encoded, /[+/=]/);
    assert.deepEqual(L.b64urlDecode(encoded), bytes);
  });
}

test('base64url decoder rejects hostile input', () => {
  assert.equal(L.b64urlDecode('!!!'), null);
  assert.equal(L.b64urlDecode('a+b'), null);
  assert.equal(L.b64urlDecode('a/b'), null);
  assert.equal(L.b64urlDecode('a'), null); // length % 4 === 1 is impossible
  assert.equal(L.b64urlDecode(''), null);
  assert.equal(L.b64urlDecode(null), null);
  assert.equal(L.b64urlDecode({}), null);
});

/* ------------------------------------------------------------------ */
/* Ensemble registry                                                   */
/* ------------------------------------------------------------------ */

test('the registry holds exactly the five named ensembles', () => {
  assert.equal(L.ENSEMBLES.length, 5);
  for (const id of ENSEMBLE_IDS) assert.ok(L.ensembleById(id), 'missing ' + id);
  assert.equal(L.ensembleById('nope'), null);
});

for (const id of ENSEMBLE_IDS) {
  test(`ensemble ${id} is well formed`, () => {
    const ens = L.ensembleById(id);
    assert.ok(ens.name.length > 0);
    assert.ok(ens.summary.length > 0);
    assert.ok(ens.tracks.length >= 2 && ens.tracks.length <= 8);
    for (const track of ens.tracks) {
      assert.ok(Number.isSafeInteger(track.pulses));
      assert.ok(Number.isSafeInteger(track.steps));
      assert.ok(track.pulses >= 0 && track.steps >= 1 && track.steps <= 64);
      assert.ok(track.name.length > 0);
    }
  });

  test(`ensemble ${id} horizon stays under the 4096 cap`, () => {
    const a = L.analyzeEnsemble(L.ensembleById(id).tracks, 120);
    assert.ok(a.horizon <= R.MAX_CYCLE_STEPS, a.horizon + ' over cap');
  });
}

/* ------------------------------------------------------------------ */
/* analyzeEnsemble parity with the engine                              */
/* ------------------------------------------------------------------ */

for (const id of ENSEMBLE_IDS) {
  const ens = L.ensembleById(id);

  test(`${id}: horizon equals the engine LCM cycle`, () => {
    const a = L.analyzeEnsemble(ens.tracks, 120);
    const e = R.analyzePolyrhythm(ens.tracks, 120);
    assert.equal(a.horizon, e.cycleSteps);
    assert.equal(a.cycleSeconds, e.cycleSeconds);
    assert.equal(a.bpm, 120);
  });

  test(`${id}: every voice carries the engine canonical necklace`, () => {
    const a = L.analyzeEnsemble(ens.tracks, 120);
    assert.equal(a.voices.length, ens.tracks.length);
    a.voices.forEach((v, i) => {
      const pattern = R.normalizeTracks([ens.tracks[i]])[0].pattern;
      assert.equal(v.vector, str(pattern), 'voice ' + i + ' vector');
      assert.equal(v.canonicalVector, str(R.canonicalVector(pattern)), 'voice ' + i + ' necklace');
      assert.equal(v.canonicalShift, R.canonicalRotation(pattern), 'voice ' + i + ' shift');
      assert.equal(v.gaps.join('+'), R.inspectPattern(pattern).gaps.join('+'), 'voice ' + i + ' gaps');
      assert.equal(v.onsets, pattern.filter((x) => x === 1).length);
    });
  });

  test(`${id}: canonical form is invariant across every rotation`, () => {
    const a = L.analyzeEnsemble(ens.tracks, 120);
    for (const v of a.voices) {
      const base = vec(v.vector);
      for (let r = 1; r < v.steps; r++) {
        assert.equal(str(R.canonicalVector(R.rotateVector(base, r))), v.canonicalVector, `voice ${v.index} rotation ${r}`);
      }
    }
  });

  test(`${id}: gaps tile the period and fundamental period divides it`, () => {
    const a = L.analyzeEnsemble(ens.tracks, 120);
    for (const v of a.voices) {
      const gapSum = v.gaps.reduce((acc, g) => acc + g, 0);
      assert.equal(gapSum, v.steps, 'voice ' + v.index + ' gaps tile');
      assert.equal(v.steps % v.fundamentalPeriod, 0, 'voice ' + v.index + ' period divides');
      assert.equal(v.vector.length, v.steps);
    }
  });

  test(`${id}: mean evenness is the mean of per voice evenness`, () => {
    const a = L.analyzeEnsemble(ens.tracks, 120);
    const expected = a.voices.reduce((acc, v) => acc + v.evenness, 0) / a.voices.length;
    assert.ok(Math.abs(a.meanEvenness - expected) < 1e-12);
    for (const v of a.voices) assert.ok(v.evenness >= 0 && v.evenness <= 1);
  });

  test(`${id}: pair table covers all i<j and matches the engine matrix`, () => {
    const a = L.analyzeEnsemble(ens.tracks, 120);
    const e = R.analyzePolyrhythm(ens.tracks, 120);
    const n = a.voices.length;
    assert.equal(a.pairs.length, (n * (n - 1)) / 2);
    for (const p of a.pairs) {
      assert.equal(p.coincidence, e.coincidenceMatrix[p.a][p.b]);
      assert.equal(p.density, e.coincidenceRates[p.a][p.b]);
      assert.equal(p.hamming, e.hammingDistances[p.a][p.b]);
    }
  });

  test(`${id}: coincidence count and density match the engine`, () => {
    const a = L.analyzeEnsemble(ens.tracks, 120);
    const e = R.analyzePolyrhythm(ens.tracks, 120);
    assert.equal(a.coincidenceCount, e.coincidenceCount);
    assert.equal(a.coincidenceDensity, e.coincidenceDensity);
    assert.equal(a.coincidenceSteps.length, e.coincidenceSteps.length);
    assert.ok(Math.abs(a.coincidenceDensity - a.coincidenceCount / a.horizon) < 1e-12);
  });

  test(`${id}: mean Hamming is the pairwise mean`, () => {
    const a = L.analyzeEnsemble(ens.tracks, 120);
    const expected = a.pairs.reduce((acc, p) => acc + p.hamming, 0) / a.pairs.length;
    assert.ok(Math.abs(a.meanHamming - expected) < 1e-12);
  });

  test(`${id}: MIDI byte length matches the Format-0 encoder exactly`, () => {
    const a = L.analyzeEnsemble(ens.tracks, 96);
    const bytes = R.encodeMidiFile(ens.tracks, 96, 480, { gate: 0.5 });
    assert.equal(a.midiBytes, bytes.length);
    assert.ok(bytes.length > 22);
    assert.equal(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]), 'MThd');
  });

  test(`${id}: per onset syncopation is score divided by onsets`, () => {
    const a = L.analyzeEnsemble(ens.tracks, 120);
    const e = R.analyzePolyrhythm(ens.tracks, 120);
    a.voices.forEach((v, i) => {
      assert.equal(v.syncopation, e.syncopation.perTrack[i].score);
      assert.equal(v.syncPerOnset, e.syncopation.perTrack[i].normalized);
      const raw = R.syncopationIndex(vec(v.vector));
      assert.equal(v.syncopation, raw);
    });
    assert.equal(a.syncopationTotal, e.syncopation.total);
  });
}

/* ------------------------------------------------------------------ */
/* analyzeEnsemble hostile inputs                                      */
/* ------------------------------------------------------------------ */

test('analyzeEnsemble honors manual pattern tracks', () => {
  const a = L.analyzeEnsemble([{ name: 'Manual', pattern: [1, 0, 0, 1, 0, 1] }, { pulses: 3, steps: 8 }], 120);
  assert.equal(a.voices[0].vector, '100101');
  assert.equal(a.voices[0].onsets, 3);
  assert.equal(a.horizon, 24);
});

test('analyzeEnsemble rejects an empty track list', () => {
  assert.throws(() => L.analyzeEnsemble([], 120), RangeError);
});

test('analyzeEnsemble rejects more than eight tracks', () => {
  const tracks = Array.from({ length: 9 }, () => ({ pulses: 1, steps: 4 }));
  assert.throws(() => L.analyzeEnsemble(tracks, 120), RangeError);
});

test('analyzeEnsemble rejects a horizon above 4096 steps', () => {
  const tracks = [61, 59, 53].map((steps) => ({ pulses: 1, steps }));
  assert.throws(() => L.analyzeEnsemble(tracks, 120), /4096/);
});

test('analyzeEnsemble rejects hostile tempos', () => {
  const tracks = [{ pulses: 3, steps: 8 }];
  for (const bpm of [NaN, Infinity, -Infinity, 0, -5]) {
    assert.throws(() => L.analyzeEnsemble(tracks, bpm), /bpm|positive/);
  }
});

test('analyzeEnsemble rejects non array and hostile track shapes', () => {
  assert.throws(() => L.analyzeEnsemble('x', 120), TypeError);
  assert.throws(() => L.analyzeEnsemble([null], 120), TypeError);
  assert.throws(() => L.analyzeEnsemble([[1, 0, 1]], 120), TypeError);
  assert.throws(() => L.analyzeEnsemble([{ pulses: NaN, steps: 8 }], 120), TypeError);
});

test('analyzeEnsemble saturates pulses above steps like the engine', () => {
  const a = L.analyzeEnsemble([{ pulses: 20, steps: 8 }], 120);
  assert.equal(a.voices[0].vector, '11111111');
  assert.equal(a.voices[0].onsets, 8);
});

test('analyzeEnsemble rejects fractional and unsafe step counts', () => {
  assert.throws(() => L.analyzeEnsemble([{ pulses: 1, steps: 7.5 }], 120), TypeError);
  assert.throws(() => L.analyzeEnsemble([{ pulses: 1, steps: 0 }], 120), /steps|least one/);
  assert.throws(() => L.analyzeEnsemble([{ pulses: 1, steps: 65 }], 120), RangeError);
});

/* ------------------------------------------------------------------ */
/* rotationSweep                                                       */
/* ------------------------------------------------------------------ */

for (const id of ENSEMBLE_IDS) {
  const ens = L.ensembleById(id);
  ens.tracks.forEach((track, voice) => {
    test(`${id} voice ${voice}: sweep reports every integer rotation`, () => {
      const sweep = L.rotationSweep(ens.tracks, voice, 120);
      assert.equal(sweep.points.length, track.steps);
      assert.equal(sweep.voiceIndex, voice);
      assert.equal(sweep.steps, track.steps);
      assert.ok(sweep.inPhase.length >= 1);
      assert.ok(sweep.hocket.length >= 1);
      assert.ok(sweep.maxCoincidences >= sweep.minCoincidences);
      sweep.points.forEach((p, r) => {
        assert.equal(p.rotation, r);
        assert.ok(p.coincidences >= 0 && p.coincidences <= sweep.horizon);
        assert.ok(p.density >= 0 && p.density <= 1);
        assert.ok(Number.isFinite(p.syncopation));
        assert.ok(Number.isFinite(p.meanHamming));
      });
    });
  });
}

test('sweep in-phase and hocket flags are consistent with the point counts', () => {
  for (const id of ENSEMBLE_IDS) {
    const ens = L.ensembleById(id);
    for (let voice = 0; voice < ens.tracks.length; voice++) {
      const sweep = L.rotationSweep(ens.tracks, voice, 120);
      const counts = sweep.points.map((p) => p.coincidences);
      assert.equal(Math.max(...counts), sweep.maxCoincidences, id + ' voice ' + voice + ' max');
      assert.equal(Math.min(...counts), sweep.minCoincidences, id + ' voice ' + voice + ' min');
      for (const r of sweep.inPhase) assert.equal(sweep.points[r].coincidences, sweep.maxCoincidences);
      for (const r of sweep.hocket) assert.equal(sweep.points[r].coincidences, sweep.minCoincidences);
    }
  }
});

test('sweep coincidence counts equal an independent brute force scan', () => {
  for (const id of ENSEMBLE_IDS) {
    const ens = L.ensembleById(id);
    const normalized = R.normalizeTracks(ens.tracks);
    const horizon = R.lcmAll(normalized.map((t) => t.steps));
    for (let voice = 0; voice < normalized.length; voice++) {
      const sweep = L.rotationSweep(ens.tracks, voice, 120);
      const others = normalized.filter((_, i) => i !== voice).map((t) => R.expandPattern(t.pattern, horizon));
      for (const p of sweep.points) {
        const rotated = R.rotateVector(normalized[voice].pattern, p.rotation);
        const expanded = R.expandPattern(rotated, horizon);
        let brute = 0;
        for (let s = 0; s < horizon; s++) {
          if (expanded[s] !== 1) continue;
          if (others.some((o) => o[s] === 1)) brute++;
        }
        assert.equal(p.coincidences, brute, `${id} voice ${voice} r=${p.rotation}`);
        assert.equal(p.vector, str(rotated));
      }
    }
  }
});

test('sweep mean Hamming equals the mean over other voices', () => {
  const ens = L.ensembleById('default-study');
  const normalized = R.normalizeTracks(ens.tracks);
  const horizon = R.lcmAll(normalized.map((t) => t.steps));
  const sweep = L.rotationSweep(ens.tracks, 0, 120);
  const others = normalized.slice(1).map((t) => R.expandPattern(t.pattern, horizon));
  for (const p of sweep.points) {
    const expanded = R.expandPattern(R.rotateVector(normalized[0].pattern, p.rotation), horizon);
    const expected = others.reduce((acc, o) => acc + R.hammingDistance(expanded, o), 0) / others.length;
    assert.ok(Math.abs(p.meanHamming - expected) < 1e-12, 'r=' + p.rotation);
  }
});

test('sweep syncopation equals the engine syncopation of the rotated vector', () => {
  const ens = L.ensembleById('balkan-compound');
  const sweep = L.rotationSweep(ens.tracks, 2, 120);
  const base = R.normalizeTracks([ens.tracks[2]])[0].pattern;
  for (const p of sweep.points) {
    assert.equal(p.syncopation, R.syncopationIndex(R.rotateVector(base, p.rotation)));
    const onsets = base.filter((x) => x === 1).length;
    assert.ok(Math.abs(p.syncPerOnset - p.syncopation / onsets) < 1e-12);
  }
});

test('rotationSweep rejects a hostile voice index', () => {
  const tracks = L.ensembleById('default-study').tracks;
  for (const bad of [-1, 3, 99, NaN, 1.5, '0', Infinity]) {
    assert.throws(() => L.rotationSweep(tracks, bad, 120), /voiceIndex|integer|outside/);
  }
});

test('rotationSweep rejects empty and oversized horizons', () => {
  assert.throws(() => L.rotationSweep([], 0, 120), /required|track/);
  const huge = [61, 59, 53].map((steps) => ({ pulses: 1, steps }));
  assert.throws(() => L.rotationSweep(huge, 0, 120), /4096/);
});

test('rotationSweep on a solo voice reports zero collisions', () => {
  const sweep = L.rotationSweep([{ pulses: 3, steps: 8 }], 0, 120);
  for (const p of sweep.points) {
    assert.equal(p.coincidences, 0);
    assert.equal(p.meanHamming, 0);
  }
  assert.deepEqual(sweep.inPhase, sweep.hocket);
});

test('sweep honors manual pattern voices', () => {
  const sweep = L.rotationSweep([{ pattern: [1, 0, 0, 1] }, { pattern: [0, 1, 0, 1] }], 0, 120);
  assert.equal(sweep.points.length, 4);
  assert.equal(sweep.points[0].vector, '1001');
  assert.equal(sweep.points[1].vector, '1100');
});

/* ------------------------------------------------------------------ */
/* lab state normalization and track rotation                          */
/* ------------------------------------------------------------------ */

test('normalizeLabState fills defaults and keeps a normalized copy', () => {
  const n = L.normalizeLabState({});
  assert.deepEqual(n, { e: 'default-study', bpm: 120, voice: 0, rot: 0, rotations: {} });
  const n2 = L.normalizeLabState({ e: 'live-workspace', bpm: 200, voice: 7, rot: -4096 });
  assert.deepEqual(n2, { e: 'live-workspace', bpm: 200, voice: 7, rot: -4096, rotations: {} });
});

test('normalizeLabState validates the rotation map', () => {
  const n = L.normalizeLabState({ e: 'default-study', rotations: { 2: 4 } });
  assert.deepEqual(n.rotations, { 2: 4 });
  assert.throws(() => L.normalizeLabState({ e: 'default-study', rotations: [1] }), TypeError);
  assert.throws(() => L.normalizeLabState({ e: 'default-study', rotations: 'x' }), TypeError);
  assert.throws(() => L.normalizeLabState({ e: 'default-study', rotations: { 8: 1 } }), RangeError);
  assert.throws(() => L.normalizeLabState({ e: 'default-study', rotations: { 0: 'r' } }), TypeError);
  assert.throws(() => L.normalizeLabState({ e: 'default-study', rotations: { 0: 5000 } }), RangeError);
});

test('normalizeLabState rejects hostile values', () => {
  assert.throws(() => L.normalizeLabState(null), TypeError);
  assert.throws(() => L.normalizeLabState('x'), TypeError);
  assert.throws(() => L.normalizeLabState([1]), TypeError);
  assert.throws(() => L.normalizeLabState({ e: 'nope' }), RangeError);
  assert.throws(() => L.normalizeLabState({ e: 5 }), RangeError);
  assert.throws(() => L.normalizeLabState({ bpm: 19 }), RangeError);
  assert.throws(() => L.normalizeLabState({ bpm: 301 }), RangeError);
  assert.throws(() => L.normalizeLabState({ bpm: 120.5 }), TypeError);
  assert.throws(() => L.normalizeLabState({ bpm: '120' }), TypeError);
  assert.throws(() => L.normalizeLabState({ bpm: NaN }), TypeError);
  assert.throws(() => L.normalizeLabState({ voice: -1 }), RangeError);
  assert.throws(() => L.normalizeLabState({ voice: 8 }), RangeError);
  assert.throws(() => L.normalizeLabState({ rot: 4097 }), RangeError);
  assert.throws(() => L.normalizeLabState({ rot: -4097 }), RangeError);
  assert.throws(() => L.normalizeLabState({ rot: 1.5 }), TypeError);
});

test('tracksForState applies integer rotations to Euclidean voices', () => {
  const tracks = L.tracksForState({ e: 'default-study', rotations: { 1: 5 } });
  const base = R.normalizeTracks(L.ensembleById('default-study').tracks);
  assert.equal(tracks[0].rotation, base[0].rotation);
  assert.equal(tracks[1].rotation, 5);
  const norm = R.normalizeTracks(tracks);
  assert.equal(str(norm[1].pattern), str(R.rotateVector(base[1].pattern, 5)));
});

test('tracksForState rotates manual pattern vectors in place', () => {
  const tracks = L.tracksForState({ e: 'live-workspace', rotations: { 0: -1 } }, [{ pattern: [1, 0, 0, 1] }]);
  assert.deepEqual(tracks[0].pattern, R.rotateVector([1, 0, 0, 1], -1));
  assert.deepEqual(tracks[0].pattern, [0, 0, 1, 1]);
});

test('tracksForState rejects a non integer rotation entry', () => {
  assert.throws(() => L.tracksForState({ e: 'default-study', rotations: { 0: 'x' } }), TypeError);
});

test('tracksForState clones tracks so ensemble data is never mutated', () => {
  const ens = L.ensembleById('default-study');
  const tracks = L.tracksForState({ e: 'default-study', rotations: { 0: 3 } });
  tracks[0].rotation = 99;
  assert.equal(ens.tracks[0].rotation, 0);
  assert.equal(L.tracksForState({ e: 'default-study' })[0].rotation, 0);
});

/* ------------------------------------------------------------------ */
/* Audited brief exporter                                              */
/* ------------------------------------------------------------------ */

test('briefFor caches one digest stamped payload per state key', () => {
  const state = { e: 'default-study', bpm: 120, voice: 0, rot: 0 };
  const a = L.briefFor(state);
  const b = L.briefFor(state);
  assert.equal(a, b);
  const c = L.briefFor({ e: 'default-study', bpm: 121, voice: 0, rot: 0 });
  assert.notEqual(c.digest, a.digest);
});

test('brief digest equals sha256 of the canonical payload', () => {
  const brief = L.briefFor({ e: 'tresillo-cinquillo-poly', bpm: 90, voice: 1, rot: 0 });
  const expected = L.sha256Hex(R.canonicalJson(brief.payload));
  assert.equal(brief.digest, expected);
  assert.equal(brief.stamped.sha256, brief.digest);
});

test('JSON export is canonical, parses, and carries the digest', () => {
  const brief = L.briefFor({ e: 'balkan-compound', bpm: 132, voice: 2, rot: 1 });
  const parsed = JSON.parse(brief.json);
  assert.equal(parsed.schema, 'beatgrid/poly-brief');
  assert.equal(parsed.version, 1);
  assert.equal(parsed.sha256, brief.digest);
  assert.equal(parsed.ensemble.id, 'balkan-compound');
  assert.equal(parsed.bpm, 132);
  assert.equal(parsed.horizon, 693);
  assert.ok(brief.json.endsWith('\n'));
  assert.equal(brief.json.slice(0, -1), R.canonicalJson(parsed));
});

test('CSV provenance header and Markdown footer carry the same digest', () => {
  const brief = L.briefFor({ e: 'prime-phase-drift', bpm: 88, voice: 1, rot: 0 });
  assert.ok(brief.csv.includes('# sha256: ' + brief.digest));
  assert.ok(brief.csv.startsWith('# BeatGrid Polyrhythm Brief'));
  assert.ok(brief.markdown.includes('`' + brief.digest + '`'));
  assert.ok(brief.markdown.startsWith('# BeatGrid Polyrhythm Brief'));
});

test('all three exports plus the on page digest share one fingerprint', () => {
  const brief = L.briefFor({ e: 'binary-grid-control', bpm: 120, voice: 0, rot: 0 });
  assert.ok(brief.json.includes(brief.digest));
  assert.ok(brief.csv.includes(brief.digest));
  assert.ok(brief.markdown.includes(brief.digest));
});

test('CSV escapes formula leading characters with a single quote', () => {
  const cells = ['=CMD()', '+SUM(A1)', '-10', '@handle', '\tlead', '=1+1'];
  for (const cell of cells) {
    const out = L.csvCell(cell);
    assert.equal(out.charAt(0), "'", cell + ' not neutralized');
  }
  assert.equal(L.csvCell('safe text'), 'safe text');
  assert.equal(L.csvCell('42'), '42');
});

test('CSV quoting doubles quotes and wraps separators', () => {
  assert.equal(L.csvCell('a,b'), '"a,b"');
  assert.equal(L.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(L.csvCell('line\nbreak'), '"line\nbreak"');
});

test('CSV table sections keep consistent column counts', () => {
  // Quote-aware field counter: a comma inside a quoted cell is not a
  // separator and a doubled quote is an escaped literal quote.
  function fieldCount(line) {
    let count = 1;
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') i++;
        else if (ch === '"') quoted = false;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') count++;
    }
    return count;
  }
  const brief = L.briefFor({ e: 'default-study', bpm: 120, voice: 0, rot: 0 });
  const sections = [];
  let current = null;
  for (const line of brief.csv.split('\n')) {
    if (!line) { current = null; continue; }
    if (line.startsWith('#')) continue;
    const cols = fieldCount(line);
    if (current === null) { current = cols; sections.push(cols); continue; }
    assert.equal(cols, current, 'ragged CSV section: ' + line);
  }
  assert.equal(sections.length, 3);
});

test('verifyBrief accepts the untouched brief', () => {
  const brief = L.briefFor({ e: 'default-study', bpm: 120, voice: 0, rot: 0 });
  const result = L.verifyBrief(brief.json);
  assert.equal(result.ok, true);
  assert.equal(result.actual, brief.digest);
  assert.equal(result.expected, brief.digest);
});

test('verifyBrief rejects a perturbed payload with evidence', () => {
  const brief = L.briefFor({ e: 'default-study', bpm: 120, voice: 0, rot: 0 });
  const tampered = { ...brief.stamped, bpm: 121 };
  const result = L.verifyBrief(R.canonicalJson(tampered));
  assert.equal(result.ok, false);
  assert.equal(result.expected, brief.digest);
  assert.notEqual(result.actual, brief.digest);
});

test('verifyBrief reports a missing or malformed digest', () => {
  assert.equal(L.verifyBrief('{"a":1}').ok, false);
  assert.equal(L.verifyBrief('{"sha256":"xyz"}').ok, false);
  assert.equal(L.verifyBrief('{"sha256":"' + 'A'.repeat(64) + '"}').ok, false);
});

test('verifyBrief is key order independent through canonicalJson', () => {
  const brief = L.briefFor({ e: 'balkan-compound', bpm: 100, voice: 0, rot: 0 });
  const parsed = JSON.parse(brief.json);
  const reordered = {};
  for (const key of Object.keys(parsed).reverse()) reordered[key] = parsed[key];
  const result = L.verifyBrief(JSON.stringify(reordered));
  assert.equal(result.ok, true);
});

test('verifyBrief rejects hostile input types and sizes', () => {
  assert.throws(() => L.verifyBrief(5), TypeError);
  assert.throws(() => L.verifyBrief(null), TypeError);
  assert.throws(() => L.verifyBrief('[1,2]'), TypeError);
  assert.throws(() => L.verifyBrief('x'.repeat(2097153)), RangeError);
});

test('tamperCheck flips verification false while preserving the claimed digest', () => {
  const brief = L.briefFor({ e: 'default-study', bpm: 300, voice: 0, rot: 0 });
  const result = L.tamperCheck(brief);
  assert.equal(result.ok, false);
  assert.equal(result.expected, brief.digest);
  assert.notEqual(result.actual, brief.digest);
});

test('brief content reflects the applied rotation', () => {
  const base = L.briefFor({ e: 'default-study', bpm: 120, voice: 1, rot: 0 });
  const rotated = L.briefFor({ e: 'default-study', bpm: 120, voice: 1, rot: 2, rotations: { 1: 2 } });
  assert.notEqual(base.digest, rotated.digest);
  const a = L.analyzeEnsemble(L.tracksForState({ e: 'default-study', rotations: { 1: 2 } }), 120);
  assert.equal(rotated.payload.voices[1].vector, a.voices[1].vector);
});

test('live workspace brief embeds the caller supplied tracks', () => {
  const live = [{ name: 'Studio', pulses: 5, steps: 16, note: 42 }];
  const brief = L.briefFor({ e: 'live-workspace', bpm: 100, voice: 0, rot: 0 }, live);
  assert.equal(brief.payload.voices[0].vector, '1001001001001000');
  assert.equal(brief.payload.ensemble.id, 'live-workspace');
});

test('live workspace brief without tracks fails closed', () => {
  assert.throws(() => L.briefFor({ e: 'live-workspace' }), TypeError);
});

/* ------------------------------------------------------------------ */
/* #bg= bookmark codec                                                 */
/* ------------------------------------------------------------------ */

for (const id of ENSEMBLE_IDS) {
  test(`bookmark round-trips ensemble ${id}`, () => {
    const state = { e: id, bpm: 144, voice: 1, rot: 3 };
    const decoded = L.decodeShareHash(L.encodeShareState(state));
    assert.deepEqual(decoded, state);
  });
}

test('bookmark round-trips the live workspace id', () => {
  const decoded = L.decodeShareHash(L.encodeShareState({ e: 'live-workspace', bpm: 60, voice: 4, rot: -9 }));
  assert.deepEqual(decoded, { e: 'live-workspace', bpm: 60, voice: 4, rot: -9 });
});

test('bookmark encode is deterministic', () => {
  const s = { e: 'balkan-compound', bpm: 132, voice: 2, rot: -5 };
  assert.equal(L.encodeShareState(s), L.encodeShareState(s));
});

test('bookmark hash uses the #bg= prefix and clean base64url', () => {
  const hash = L.encodeShareState({ e: 'default-study' });
  assert.ok(hash.startsWith('#bg='));
  assert.doesNotMatch(hash.slice(4), /[+/=]/);
});

const HOSTILE_HASHES = [
  ['empty string', ''],
  ['missing prefix', 'eyJ2IjoxfQ'],
  ['wrong prefix', '#bh=eyJ2IjoxfQ'],
  ['bare prefix', '#bg='],
  ['invalid base64 chars', '#bg=!!!***'],
  ['base64 with plus', '#bg=ab+c'],
  ['base64 with slash', '#bg=ab/c'],
  ['impossible length', '#bg=a'],
  ['oversized body', '#bg=' + 'A'.repeat(513)],
  ['prefix not at start', 'x#bg=eyJ2IjoxfQ'],
  ['double hash', '##bg=eyJ2IjoxfQ']
];
for (const [label, hash] of HOSTILE_HASHES) {
  test(`hostile hash rejected: ${label}`, () => {
    assert.equal(L.decodeShareHash(hash), null);
  });
}

const HOSTILE_BODIES = [
  ['non json text', 'not json'],
  ['json array', '[1,2,3]'],
  ['json number', '42'],
  ['json string', '"x"'],
  ['json null', 'null'],
  ['proto key', '{"__proto__":{"x":1},"v":1,"e":"default-study"}'],
  ['constructor key', '{"v":1,"e":"default-study","constructor":{}}'],
  ['prototype key', '{"v":1,"e":"default-study","prototype":1}'],
  ['unknown key', '{"v":1,"e":"default-study","evil":1}'],
  ['missing version', '{"e":"default-study"}'],
  ['version two', '{"v":2,"e":"default-study"}'],
  ['string version', '{"v":"1","e":"default-study"}'],
  ['missing ensemble', '{"v":1}'],
  ['numeric ensemble', '{"v":1,"e":5}'],
  ['unknown ensemble', '{"v":1,"e":"nope"}'],
  ['bpm too low', '{"v":1,"e":"default-study","bpm":19}'],
  ['bpm too high', '{"v":1,"e":"default-study","bpm":301}'],
  ['bpm string', '{"v":1,"e":"default-study","bpm":"120"}'],
  ['bpm fractional', '{"v":1,"e":"default-study","bpm":120.5}'],
  ['voice negative', '{"v":1,"e":"default-study","voice":-1}'],
  ['voice over max', '{"v":1,"e":"default-study","voice":8}'],
  ['voice string', '{"v":1,"e":"default-study","voice":"0"}'],
  ['rot string', '{"v":1,"e":"default-study","rot":"5"}'],
  ['rot fractional', '{"v":1,"e":"default-study","rot":1.5}'],
  ['rot over bound', '{"v":1,"e":"default-study","rot":4097}'],
  ['rot under bound', '{"v":1,"e":"default-study","rot":-4097}']
];
for (const [label, body] of HOSTILE_BODIES) {
  test(`hostile payload rejected: ${label}`, () => {
    const hash = '#bg=' + L.b64urlEncode(L.utf8Encode(body));
    assert.equal(L.decodeShareHash(hash), null);
  });
}

test('bookmark decode rejects malformed utf8 inside the payload', () => {
  const bytes = L.b64urlDecode(L.encodeShareState({ e: 'default-study' }).slice(4));
  bytes[2] = 0xff;
  bytes[3] = 0xff;
  const hash = '#bg=' + L.b64urlEncode(bytes);
  assert.equal(L.decodeShareHash(hash), null);
});

test('bookmark decode accepts omitted optional fields with defaults', () => {
  const hash = '#bg=' + L.b64urlEncode(L.utf8Encode('{"v":1,"e":"prime-phase-drift"}'));
  const decoded = L.decodeShareHash(hash);
  assert.deepEqual(decoded, { e: 'prime-phase-drift', bpm: 120, voice: 0, rot: 0 });
});

test('bookmark decode rejects non string input', () => {
  assert.equal(L.decodeShareHash(null), null);
  assert.equal(L.decodeShareHash(42), null);
  assert.equal(L.decodeShareHash({}), null);
  assert.equal(L.decodeShareHash(undefined), null);
});

test('bookmark encode rejects hostile state', () => {
  assert.throws(() => L.encodeShareState({ e: 'nope' }), RangeError);
  assert.throws(() => L.encodeShareState({ bpm: 301 }), RangeError);
  assert.throws(() => L.encodeShareState({ voice: 8 }), RangeError);
  assert.throws(() => L.encodeShareState({ rot: 'x' }), TypeError);
});

/* ------------------------------------------------------------------ */
/* In-page self-test runner                                            */
/* ------------------------------------------------------------------ */

test('self-test runner reports at least sixteen checks, all passing', () => {
  const report = L.runSelfTests();
  assert.ok(report.total >= 16, 'only ' + report.total + ' self-tests');
  assert.equal(report.passed, report.total);
  for (const item of report.results) {
    assert.equal(item.ok, true, item.name + ' failed: ' + item.detail);
  }
});

for (const entry of L.SELF_TESTS) {
  test(`self-test ${entry.name} is registered and passes`, () => {
    const report = L.runSelfTests();
    const found = report.results.find((item) => item.name === entry.name);
    assert.ok(found, 'self-test missing from report');
    assert.equal(found.ok, true, found.detail || '');
  });
}

test('self-test runner is deterministic across repeated runs', () => {
  const a = L.runSelfTests();
  const b = L.runSelfTests();
  assert.deepEqual(a.results.map((r) => r.ok), b.results.map((r) => r.ok));
  assert.equal(a.total, b.total);
});
