/*
 * BeatGrid Polyrhythm Necklace and Phase-Rotation Lab
 * UMD module: works with CommonJS, AMD, and a plain browser <script> tag.
 * Zero dependencies beyond the local rhythm engine. Pure computation.
 * No audio playback and no network access of any kind is performed here.
 */
(function (root, factory) {
  'use strict';
  var engine;
  if (typeof module === 'object' && module && module.exports) {
    engine = require('./rhythm.js');
    module.exports = factory(engine);
  } else if (typeof define === 'function' && define.amd) {
    define(['./rhythm.js'], factory);
  } else {
    engine = root.BeatGrid;
    root.BeatGridLab = factory(engine);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
  'use strict';

  var LAB_VERSION = '1.0.0';
  var LIVE_ID = 'live-workspace';
  var HASH_PREFIX = '#bg=';
  var MIDI_PPQ = 480;
  var MIDI_GATE = 0.5;

  /*
   * Five deterministic ensembles for the comparator. Step periods stay at or
   * below the engine cap of 4096 steps for the shared horizon: the drift
   * study uses prime lengths 7, 11, and 13 for a 1001 step cycle.
   */
  var ENSEMBLES = [
    {
      id: 'default-study',
      name: 'Default study',
      summary: 'Tresillo, seven in twelve, and four in nine: the studio starter session.',
      tracks: [
        { name: 'Tresillo', pulses: 3, steps: 8, rotation: 0, note: 36 },
        { name: 'Seven in twelve', pulses: 7, steps: 12, rotation: 0, note: 56 },
        { name: 'Four in nine', pulses: 4, steps: 9, rotation: 0, note: 45 }
      ]
    },
    {
      id: 'tresillo-cinquillo-poly',
      name: 'Tresillo and cinquillo poly',
      summary: 'Three over eight against five over eight plus two longer even studies.',
      tracks: [
        { name: 'Tresillo', pulses: 3, steps: 8, rotation: 0, note: 36 },
        { name: 'Cinquillo', pulses: 5, steps: 8, rotation: 0, note: 38 },
        { name: 'Five in sixteen', pulses: 5, steps: 16, rotation: 0, note: 42 },
        { name: 'Seven in twelve', pulses: 7, steps: 12, rotation: 0, note: 56 }
      ]
    },
    {
      id: 'balkan-compound',
      name: 'Balkan compound study',
      summary: 'Aksak flavored compound cells over prime seven, nine, and eleven step periods.',
      tracks: [
        { name: 'Aksak seven', pulses: 3, steps: 7, rotation: 0, note: 45 },
        { name: 'Nine cell', pulses: 4, steps: 9, rotation: 0, note: 47 },
        { name: 'Eleven cell', pulses: 5, steps: 11, rotation: 0, note: 49 }
      ]
    },
    {
      id: 'prime-phase-drift',
      name: 'Prime phase drift',
      summary: 'Prime step periods 7, 11, and 13 drift once through a 1001 step horizon.',
      tracks: [
        { name: 'Prime seven', pulses: 3, steps: 7, rotation: 0, note: 36 },
        { name: 'Prime eleven', pulses: 5, steps: 11, rotation: 0, note: 42 },
        { name: 'Prime thirteen', pulses: 6, steps: 13, rotation: 0, note: 51 }
      ]
    },
    {
      id: 'binary-grid-control',
      name: 'Binary grid control',
      summary: 'Powers of two fold every onset back onto one 16 step control grid.',
      tracks: [
        { name: 'Quarter grid', pulses: 2, steps: 4, rotation: 0, note: 36 },
        { name: 'Tresillo', pulses: 3, steps: 8, rotation: 0, note: 38 },
        { name: 'Five in sixteen', pulses: 5, steps: 16, rotation: 0, note: 42 },
        { name: 'Single sixteenth', pulses: 1, steps: 16, rotation: 0, note: 46 }
      ]
    }
  ];

  function requireEngine() {
    if (!R) throw new Error('BeatGrid rhythm engine is unavailable');
    return R;
  }

  function ensembleById(id) {
    for (var i = 0; i < ENSEMBLES.length; i++) if (ENSEMBLES[i].id === id) return ENSEMBLES[i];
    return null;
  }

  function integerOr(value, label) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
      throw new TypeError(label + ' must be a safe integer');
    }
    return value;
  }

  /* ---------- UTF-8 and base64url primitives ---------- */

  /*
   * Strict UTF-8: the encoder emits replacement characters for stray
   * surrogate halves, and the decoder rejects overlong sequences, stray
   * continuations, encoded surrogates, and code points above U+10FFFF so a
   * hostile bookmark hash can never decode ambiguous bytes into state.
   */
  function utf8Encode(text) {
    var out = [];
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
        var next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
          i++;
        } else {
          code = 0xfffd;
        }
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        code = 0xfffd;
      }
      if (code < 0x80) out.push(code);
      else if (code < 0x800) {
        out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else if (code < 0x10000) {
        out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      } else {
        out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      }
    }
    return out;
  }

  function utf8Decode(bytes) {
    var out = [];
    var i = 0;
    while (i < bytes.length) {
      var b = bytes[i];
      var code;
      var need;
      if (b < 0x80) { code = b; need = 0; }
      else if (b >= 0xc2 && b < 0xe0) { code = b & 0x1f; need = 1; }
      else if (b >= 0xe0 && b < 0xf0) { code = b & 0x0f; need = 2; }
      else if (b >= 0xf0 && b < 0xf5) { code = b & 0x07; need = 3; }
      else return null;
      if (i + need >= bytes.length) return null;
      for (var k = 1; k <= need; k++) {
        var cont = bytes[i + k];
        if ((cont & 0xc0) !== 0x80) return null;
        code = (code << 6) | (cont & 0x3f);
      }
      var min = need === 0 ? 0 : need === 1 ? 0x80 : need === 2 ? 0x800 : 0x10000;
      if (code < min || (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff) return null;
      i += need + 1;
      if (code > 0xffff) {
        code -= 0x10000;
        out.push(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
      } else {
        out.push(code);
      }
    }
    var text = '';
    for (var c = 0; c < out.length; c += 8192) {
      text += String.fromCharCode.apply(null, out.slice(c, c + 8192));
    }
    return text;
  }

  var B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var B64_LOOKUP = null;

  function b64urlEncode(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i];
      var b1 = i + 1 < bytes.length ? bytes[i + 1] : -1;
      var b2 = i + 2 < bytes.length ? bytes[i + 2] : -1;
      out += B64_ALPHABET[b0 >> 2];
      out += B64_ALPHABET[((b0 & 3) << 4) | (b1 >= 0 ? b1 >> 4 : 0)];
      out += b1 >= 0 ? B64_ALPHABET[((b1 & 15) << 2) | (b2 >= 0 ? b2 >> 6 : 0)] : '';
      out += b2 >= 0 ? B64_ALPHABET[b2 & 63] : '';
    }
    return out;
  }

  function b64urlDecode(text) {
    if (!B64_LOOKUP) {
      B64_LOOKUP = {};
      for (var i = 0; i < B64_ALPHABET.length; i++) B64_LOOKUP[B64_ALPHABET[i]] = i;
    }
    if (typeof text !== 'string' || !/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) return null;
    var out = [];
    for (var j = 0; j < text.length; j += 4) {
      var c0 = B64_LOOKUP[text[j]];
      var c1 = B64_LOOKUP[text[j + 1]];
      var c2 = j + 2 < text.length ? B64_LOOKUP[text[j + 2]] : -1;
      var c3 = j + 3 < text.length ? B64_LOOKUP[text[j + 3]] : -1;
      if (c0 === undefined || c1 === undefined) return null;
      if (c2 === -1 && j + 2 < text.length) return null;
      if (c3 === -1 && j + 3 < text.length) return null;
      if (c2 < 0 && (c1 & 0x0f) !== 0) return null;
      if (c2 >= 0 && c3 < 0 && (c2 & 0x03) !== 0) return null;
      var triple = (c0 << 18) | (c1 << 12) | ((c2 < 0 ? 0 : c2) << 6) | (c3 < 0 ? 0 : c3);
      out.push((triple >> 16) & 0xff);
      if (c2 >= 0) out.push((triple >> 8) & 0xff);
      if (c3 >= 0) out.push(triple & 0xff);
    }
    return out;
  }

  /* ---------- FIPS 180-4 SHA-256 ---------- */

  var SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  function sha256Digest(bytes) {
    var bitLengthHi = Math.floor(bytes.length / 0x20000000);
    var bitLengthLo = (bytes.length * 8) >>> 0;
    var msg = bytes.slice();
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    msg.push((bitLengthHi >>> 16) & 0xff, (bitLengthHi >>> 8) & 0xff, bitLengthHi & 0xff, 0);
    msg.push((bitLengthLo >>> 24) & 0xff, (bitLengthLo >>> 16) & 0xff, (bitLengthLo >>> 8) & 0xff, bitLengthLo & 0xff);
    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Array(64);
    for (var block = 0; block < msg.length; block += 64) {
      var t;
      for (t = 0; t < 16; t++) {
        w[t] = ((msg[block + t * 4] << 24) | (msg[block + t * 4 + 1] << 16) | (msg[block + t * 4 + 2] << 8) | msg[block + t * 4 + 3]) >>> 0;
      }
      for (t = 16; t < 64; t++) {
        var s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        var s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (t = 0; t < 64; t++) {
        var s1e = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var temp1 = (hh + s1e + ch + SHA256_K[t] + w[t]) >>> 0;
        var s0a = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var temp2 = (s0a + maj) >>> 0;
        hh = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }
    return h;
  }

  function wordsToHex(words) {
    var out = '';
    for (var i = 0; i < words.length; i++) {
      var word = words[i] >>> 0;
      for (var b = 3; b >= 0; b--) out += ((word >>> (b * 8)) & 0xff).toString(16).padStart(2, '0');
    }
    return out;
  }

  function sha256BytesHex(bytes) {
    if (!Array.isArray(bytes) && !ArrayBuffer.isView(bytes)) throw new TypeError('sha256 needs a byte array');
    var flat = new Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i];
      if (!Number.isInteger(b) || b < 0 || b > 255) throw new TypeError('byte values must be 0 to 255');
      flat[i] = b;
    }
    return wordsToHex(sha256Digest(flat));
  }

  function sha256Hex(text) {
    return sha256BytesHex(utf8Encode(String(text)));
  }

  /* ---------- ensemble analysis ---------- */

  /*
   * Full comparator record for one ensemble. Drives the rhythm engine for
   * the shared LCM horizon, Booth canonical necklaces, pairwise coincidence
   * and Hamming tables, evenness, per-onset syncopation, and the exact
   * Format-0 MIDI byte length at the fixed lab division and gate.
   */
  function analyzeEnsemble(tracks, bpm) {
    requireEngine();
    var rate = bpm === undefined ? 120 : bpm;
    var analysis = R.analyzePolyrhythm(tracks, rate);
    var midi = R.encodeMidiFile(tracks, rate, MIDI_PPQ, { gate: MIDI_GATE });
    var n = analysis.tracks.length;

    var voices = analysis.tracks.map(function (track, i) {
      var info = R.inspectPattern(track.pattern);
      var syncRow = analysis.syncopation.perTrack[i];
      return {
        index: i,
        name: track.name,
        formula: track.formula,
        steps: track.steps,
        pulses: track.pulses,
        rotation: track.rotation,
        onsets: info.onsets,
        density: info.density,
        vector: track.pattern.join(''),
        canonicalVector: R.canonicalVector(track.pattern).join(''),
        canonicalShift: R.canonicalRotation(track.pattern),
        gaps: info.gaps.slice(),
        gapSpread: info.gapSpread,
        evenness: info.evenness,
        fundamentalPeriod: info.fundamentalPeriod,
        syncopation: syncRow.score,
        syncPerOnset: syncRow.normalized,
        note: track.note,
        channel: track.channel,
        velocity: track.velocity
      };
    });

    var pairs = [];
    var hammingTotal = 0;
    for (var a = 0; a < n; a++) {
      for (var b = a + 1; b < n; b++) {
        var ham = analysis.hammingDistances[a][b];
        hammingTotal += ham;
        pairs.push({
          a: a,
          b: b,
          coincidence: analysis.coincidenceMatrix[a][b],
          density: analysis.coincidenceRates[a][b],
          hamming: ham
        });
      }
    }
    var pairCount = pairs.length;
    var evennessTotal = voices.reduce(function (acc, v) { return acc + v.evenness; }, 0);
    var syncPerOnsetTotal = voices.reduce(function (acc, v) { return acc + v.syncPerOnset; }, 0);

    return {
      schema: 'beatgrid/poly-analysis',
      version: 1,
      bpm: analysis.bpm,
      horizon: analysis.cycleSteps,
      cycleSeconds: analysis.cycleSeconds,
      cycleBeats: analysis.cycleBeats,
      voices: voices,
      pairs: pairs,
      coincidenceCount: analysis.coincidenceCount,
      coincidenceDensity: analysis.coincidenceDensity,
      coincidenceSteps: analysis.coincidenceSteps.slice(),
      meanEvenness: n ? evennessTotal / n : 0,
      meanHamming: pairCount ? hammingTotal / pairCount : 0,
      meanSyncPerOnset: n ? syncPerOnsetTotal / n : 0,
      syncopationTotal: analysis.syncopation.total,
      midiBytes: midi.length,
      midiPpq: MIDI_PPQ,
      midiGate: MIDI_GATE,
      expanded: analysis.tracks.map(function (track) { return track.expanded; })
    };
  }

  /*
   * Phase-rotation sweep. Rotates the selected voice through every integer
   * phase r = 0..steps-1 against the untouched ensemble voices and reports
   * exact shared-hit coincidences, mean pairwise Hamming distance, and
   * illustrative syncopation at each rotation. inPhase collects every r
   * reaching the maximum lock and hocket every r reaching the minimum.
   */
  function rotationSweep(tracks, voiceIndex, bpm) {
    requireEngine();
    var rate = bpm === undefined ? 120 : bpm;
    var normalized = R.normalizeTracks(tracks);
    if (!normalized.length) throw new RangeError('at least one track is required');
    var index = integerOr(voiceIndex, 'voiceIndex');
    if (index < 0 || index >= normalized.length) throw new RangeError('voiceIndex is outside the ensemble');
    var horizon = R.lcmAll(normalized.map(function (t) { return t.steps; }));
    if (horizon > R.MAX_CYCLE_STEPS) {
      throw new RangeError('shared cycle exceeds ' + R.MAX_CYCLE_STEPS + ' steps; use track lengths with common factors');
    }
    var base = normalized[index].pattern;
    var steps = base.length;
    var onsets = base.filter(function (v) { return v === 1; }).length;
    var others = [];
    for (var t = 0; t < normalized.length; t++) {
      if (t !== index) others.push(R.expandPattern(normalized[t].pattern, horizon));
    }
    var points = [];
    var meterSteps = R.lcm(steps, 16);
    var evaluatedOnsets = onsets * meterSteps / steps;
    for (var r = 0; r < steps; r++) {
      var rotated = R.rotateVector(base, r);
      var expanded = R.expandPattern(rotated, horizon);
      var coincidences = 0;
      var s;
      for (s = 0; s < horizon; s++) {
        if (expanded[s] !== 1) continue;
        for (var o = 0; o < others.length; o++) {
          if (others[o][s] === 1) { coincidences++; break; }
        }
      }
      var hammingSum = 0;
      for (o = 0; o < others.length; o++) hammingSum += R.hammingDistance(expanded, others[o]);
      var sync = R.syncopationIndex(rotated);
      points.push({
        rotation: r,
        vector: rotated.join(''),
        coincidences: coincidences,
        density: coincidences / horizon,
        syncopation: sync,
        syncPerOnset: evaluatedOnsets === 0 ? 0 : sync / evaluatedOnsets,
        meanHamming: others.length ? hammingSum / others.length : 0
      });
    }
    var max = -1;
    var min = horizon + 1;
    for (var p = 0; p < points.length; p++) {
      if (points[p].coincidences > max) max = points[p].coincidences;
      if (points[p].coincidences < min) min = points[p].coincidences;
    }
    var inPhase = [];
    var hocket = [];
    for (p = 0; p < points.length; p++) {
      if (points[p].coincidences === max) inPhase.push(p);
      if (points[p].coincidences === min) hocket.push(p);
    }
    return {
      schema: 'beatgrid/rotation-sweep',
      version: 1,
      bpm: rate,
      voiceIndex: index,
      voiceName: normalized[index].name,
      steps: steps,
      onsets: onsets,
      horizon: horizon,
      points: points,
      inPhase: inPhase,
      hocket: hocket,
      maxCoincidences: max,
      minCoincidences: min
    };
  }

  /* ---------- digest-stamped audited brief ---------- */

  /*
   * One canonical digest-stamped payload per state key. The on-page
   * fingerprint, the JSON export, the CSV provenance header, and the
   * Markdown footer all read the same cached brief, so they can never
   * drift into different digests for identical state.
   */
  var briefCache = Object.create(null);

  function normalizeLabState(state) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('lab state must be an object');
    var out = {};
    out.e = state.e === undefined ? ENSEMBLES[0].id : state.e;
    if (typeof out.e !== 'string' || (!ensembleById(out.e) && out.e !== LIVE_ID)) {
      throw new RangeError('unknown ensemble id');
    }
    out.bpm = state.bpm === undefined ? 120 : integerOr(state.bpm, 'bpm');
    if (out.bpm < 20 || out.bpm > 300) throw new RangeError('bpm must be an integer from 20 to 300');
    out.voice = state.voice === undefined ? 0 : integerOr(state.voice, 'voice');
    if (out.voice < 0 || out.voice > 7) throw new RangeError('voice must be an integer from 0 to 7');
    out.rot = state.rot === undefined ? 0 : integerOr(state.rot, 'rot');
    if (out.rot < -4096 || out.rot > 4096) throw new RangeError('rot must be an integer from -4096 to 4096');
    out.rotations = {};
    if (state.rotations !== undefined && state.rotations !== null) {
      if (typeof state.rotations !== 'object' || Array.isArray(state.rotations)) throw new TypeError('rotations must be an object map');
      for (var rk in state.rotations) {
        if (!Object.prototype.hasOwnProperty.call(state.rotations, rk)) continue;
        var ri = Number(rk);
        if (!Number.isSafeInteger(ri) || ri < 0 || ri > 7) throw new RangeError('rotation map keys must be voice indexes 0 to 7');
        var rv = integerOr(state.rotations[rk], 'rotation ' + rk);
        if (rv < -4096 || rv > 4096) throw new RangeError('rotations must be integers from -4096 to 4096');
        out.rotations[ri] = rv;
      }
    }
    return out;
  }

  /*
   * The lab analyzes the state exactly as encoded: a preset ensemble, or a
   * caller supplied track list for the live workspace. rotations maps voice
   * index to the applied integer phase.
   */
  function tracksForState(state, liveTracks) {
    var normalized = normalizeLabState(state);
    var base;
    if (normalized.e === LIVE_ID) {
      if (!Array.isArray(liveTracks)) throw new TypeError('live workspace tracks must be an array');
      base = liveTracks;
    } else {
      base = ensembleById(normalized.e).tracks;
    }
    var rotations = normalized.rotations;
    return base.map(function (raw, i) {
      var track = {};
      for (var key in raw) {
        if (Object.prototype.hasOwnProperty.call(raw, key)) track[key] = raw[key];
      }
      var extra = rotations[i];
      if (extra !== undefined && extra !== null) {
        extra = integerOr(extra, 'rotation');
        if (track.pattern) {
          track.pattern = R.rotateVector(track.pattern, extra);
        } else {
          var steps = integerOr(track.steps, 'steps');
          var r = ((extra % steps) + steps) % steps;
          track.rotation = ((track.rotation || 0) + r) % steps;
        }
      }
      return track;
    });
  }

  function buildBriefPayload(state, liveTracks) {
    var normalized = normalizeLabState(state);
    var tracks = tracksForState(state, liveTracks);
    var analysis = analyzeEnsemble(tracks, normalized.bpm);
    var voiceIndex = normalized.voice;
    if (voiceIndex >= analysis.voices.length) voiceIndex = 0;
    var sweep = rotationSweep(tracks, voiceIndex, normalized.bpm);
    return {
      schema: 'beatgrid/poly-brief',
      version: 1,
      labVersion: LAB_VERSION,
      ensemble: { id: normalized.e, name: normalized.e === LIVE_ID ? 'Live workspace' : ensembleById(normalized.e).name },
      bpm: analysis.bpm,
      voiceIndex: voiceIndex,
      rotation: normalized.rot,
      horizon: analysis.horizon,
      cycleSeconds: analysis.cycleSeconds,
      voices: analysis.voices.map(function (v) {
        return {
          index: v.index, name: v.name, formula: v.formula, steps: v.steps, pulses: v.pulses,
          rotation: v.rotation, onsets: v.onsets, vector: v.vector, canonicalVector: v.canonicalVector,
          canonicalShift: v.canonicalShift, gaps: v.gaps, evenness: v.evenness,
          syncopation: v.syncopation, syncPerOnset: v.syncPerOnset
        };
      }),
      pairs: analysis.pairs,
      coincidenceCount: analysis.coincidenceCount,
      coincidenceDensity: analysis.coincidenceDensity,
      meanEvenness: analysis.meanEvenness,
      meanHamming: analysis.meanHamming,
      meanSyncPerOnset: analysis.meanSyncPerOnset,
      midiBytes: analysis.midiBytes,
      midiPpq: analysis.midiPpq,
      midiGate: analysis.midiGate,
      sweep: {
        voiceIndex: sweep.voiceIndex,
        voiceName: sweep.voiceName,
        steps: sweep.steps,
        horizon: sweep.horizon,
        points: sweep.points.map(function (p) {
          return { rotation: p.rotation, coincidences: p.coincidences, density: p.density, syncopation: p.syncopation, syncPerOnset: p.syncPerOnset, meanHamming: p.meanHamming };
        }),
        inPhase: sweep.inPhase,
        hocket: sweep.hocket
      }
    };
  }

  function briefFor(state, liveTracks) {
    var normalized = normalizeLabState(state);
    var key = R.canonicalJson({ e: normalized.e, bpm: normalized.bpm, voice: normalized.voice, rot: normalized.rot, rotations: normalized.rotations, live: normalized.e === LIVE_ID ? liveTracks : null });
    var cached = briefCache[key];
    if (cached) return cached;
    var payload = buildBriefPayload(normalized, liveTracks);
    var digest = sha256Hex(R.canonicalJson(payload));
    var stamped = { schema: payload.schema };
    for (var prop in payload) {
      if (Object.prototype.hasOwnProperty.call(payload, prop) && prop !== 'schema') stamped[prop] = payload[prop];
    }
    stamped.sha256 = digest;
    var brief = {
      key: key,
      digest: digest,
      payload: payload,
      stamped: stamped,
      json: R.canonicalJson(stamped) + '\n',
      csv: briefToCsv(stamped),
      markdown: briefToMarkdown(stamped)
    };
    briefCache[key] = brief;
    return brief;
  }

  /*
   * CSV cells that start with =, +, -, @, a tab, or a carriage return are
   * formula injection vectors in spreadsheet apps; a leading single quote
   * neutralizes them before quoting rules apply.
   */
  function csvCell(value) {
    var s = value === null || value === undefined ? '' : String(value);
    var formula = /^[\t\r\n]/.test(s) || /^[\p{White_Space}\p{Cc}\p{Cf}\p{M}]*[=+\-@]/u.test(s);
    if (typeof value !== 'number' && formula) s = "'" + s;
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function csvRow(values) {
    return values.map(csvCell).join(',');
  }

  function briefToCsv(stamped) {
    var lines = [];
    lines.push('# BeatGrid Polyrhythm Brief');
    lines.push('# schema: ' + stamped.schema + ' v' + stamped.version);
    lines.push('# ensemble: ' + stamped.ensemble.id + ' (' + stamped.ensemble.name + ')');
    lines.push('# bpm: ' + stamped.bpm + ', horizon: ' + stamped.horizon + ' steps, midi bytes: ' + stamped.midiBytes);
    lines.push('# sha256: ' + stamped.sha256);
    lines.push('');
    lines.push(csvRow(['voice_index', 'name', 'formula', 'steps', 'pulses', 'rotation', 'onsets', 'vector', 'canonical_vector', 'canonical_shift', 'gaps', 'evenness', 'syncopation', 'sync_per_onset']));
    stamped.voices.forEach(function (v) {
      lines.push(csvRow([v.index, v.name, v.formula, v.steps, v.pulses, v.rotation, v.onsets, v.vector, v.canonicalVector, v.canonicalShift, v.gaps.join('+'), v.evenness, v.syncopation, v.syncPerOnset]));
    });
    lines.push('');
    lines.push(csvRow(['pair_a', 'pair_b', 'coincidence', 'density', 'hamming']));
    stamped.pairs.forEach(function (p) {
      lines.push(csvRow([p.a, p.b, p.coincidence, p.density, p.hamming]));
    });
    lines.push('');
    lines.push(csvRow(['sweep_rotation', 'coincidences', 'density', 'syncopation', 'sync_per_onset', 'mean_hamming']));
    stamped.sweep.points.forEach(function (p) {
      lines.push(csvRow([p.rotation, p.coincidences, p.density, p.syncopation, p.syncPerOnset, p.meanHamming]));
    });
    return lines.join('\n') + '\n';
  }

  function markdownTableCell(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
  }

  function briefToMarkdown(stamped) {
    var lines = [];
    lines.push('# BeatGrid Polyrhythm Brief');
    lines.push('');
    lines.push('- Ensemble: ' + stamped.ensemble.name + ' (`' + stamped.ensemble.id + '`)');
    lines.push('- Tempo: ' + stamped.bpm + ' BPM, horizon ' + stamped.horizon + ' steps, ' + stamped.cycleSeconds + ' s per cycle');
    lines.push('- Coincidences: ' + stamped.coincidenceCount + ' (' + stamped.coincidenceDensity + '), mean evenness ' + stamped.meanEvenness + ', mean Hamming ' + stamped.meanHamming);
    lines.push('- Format-0 MIDI bytes: ' + stamped.midiBytes + ' at ppq ' + stamped.midiPpq + ', gate ' + stamped.midiGate);
    lines.push('');
    lines.push('| Voice | Formula | Steps | Onsets | Vector | Canonical | Evenness | Sync/onset |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    stamped.voices.forEach(function (v) {
      lines.push('| ' + markdownTableCell(v.name) + ' | ' + markdownTableCell(v.formula) + ' | ' + v.steps + ' | ' + v.onsets + ' | `' + v.vector + '` | `' + v.canonicalVector + '` | ' + v.evenness + ' | ' + v.syncPerOnset + ' |');
    });
    lines.push('');
    lines.push('Rotation sweep over voice ' + stamped.sweep.voiceIndex + ' (' + stamped.sweep.voiceName + '), ' + stamped.sweep.steps + ' rotations. In-phase maxima at r = ' + stamped.sweep.inPhase.join(', ') + '; hocket minima at r = ' + stamped.sweep.hocket.join(', ') + '.');
    lines.push('');
    lines.push('| r | Coincidences | Density | Syncopation | Per onset | Mean Hamming |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    stamped.sweep.points.forEach(function (p) {
      lines.push('| ' + p.rotation + ' | ' + p.coincidences + ' | ' + p.density + ' | ' + p.syncopation + ' | ' + p.syncPerOnset + ' | ' + p.meanHamming + ' |');
    });
    lines.push('');
    lines.push('SHA-256 digest: `' + stamped.sha256 + '`');
    return lines.join('\n') + '\n';
  }

  /*
   * Verify a stamped brief JSON: remove the sha256 field, re-hash the exact
   * canonical form of what remains, and compare. Returns the expected and
   * actual digests so a caller can report the tamper evidence verbatim.
   */
  function verifyBrief(jsonText) {
    if (typeof jsonText !== 'string') throw new TypeError('brief verification needs JSON text');
    if (jsonText.length > 2097152) throw new RangeError('brief JSON exceeds 2 MiB');
    var parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('brief must be an object');
    var claimed = parsed.sha256;
    if (typeof claimed !== 'string' || !/^[0-9a-f]{64}$/.test(claimed)) {
      return { ok: false, expected: null, actual: null, reason: 'missing or malformed sha256 field' };
    }
    var payload = {};
    for (var key in parsed) {
      if (Object.prototype.hasOwnProperty.call(parsed, key) && key !== 'sha256') payload[key] = parsed[key];
    }
    var actual = sha256Hex(R.canonicalJson(payload));
    return { ok: actual === claimed, expected: claimed, actual: actual, reason: actual === claimed ? null : 'digest mismatch' };
  }

  /*
   * Deterministic tamper demonstration: the same payload with one field
   * perturbed but the original digest reattached, which must verify false.
   */
  function tamperCheck(stampedOrBrief) {
    var stamped = stampedOrBrief && stampedOrBrief.stamped ? stampedOrBrief.stamped : stampedOrBrief;
    var tampered = {};
    for (var key in stamped) {
      if (Object.prototype.hasOwnProperty.call(stamped, key)) tampered[key] = stamped[key];
    }
    tampered.bpm = (tampered.bpm === 300) ? 299 : tampered.bpm + 1;
    return verifyBrief(R.canonicalJson(tampered));
  }

  /* ---------- #bg= bookmark codec ---------- */

  var HASH_KEYS = { v: true, e: true, bpm: true, voice: true, rot: true };
  var hasHashKey = Object.prototype.hasOwnProperty;

  function encodeShareState(state) {
    var normalized = normalizeLabState(state);
    var body = JSON.stringify({ v: 1, e: normalized.e, bpm: normalized.bpm, voice: normalized.voice, rot: normalized.rot });
    return HASH_PREFIX + b64urlEncode(utf8Encode(body));
  }

  /*
   * Fail-closed decode. Anything malformed returns null: wrong prefix, bad
   * base64url, undecodable UTF-8, invalid JSON, non-object, any disallowed
   * own or inherited key (including __proto__ and constructor), or out of
   * range values. Only allowlisted own keys are copied into the result.
   */
  function decodeShareHash(hash) {
    if (typeof hash !== 'string' || hash.indexOf(HASH_PREFIX) !== 0) return null;
    var body = hash.slice(HASH_PREFIX.length);
    if (!body || body.length > 512) return null;
    var bytes = b64urlDecode(body);
    if (!bytes) return null;
    var text = utf8Decode(bytes);
    if (text === null) return null;
    var parsed;
    try { parsed = JSON.parse(text); } catch (error) { return null; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    var has = Object.prototype.hasOwnProperty;
    for (var key in parsed) {
      if (!has.call(parsed, key)) continue;
      if (!hasHashKey.call(HASH_KEYS, key)) return null;
    }
    if (!has.call(parsed, 'v') || parsed.v !== 1) return null;
    if (!has.call(parsed, 'e') || typeof parsed.e !== 'string' || (!ensembleById(parsed.e) && parsed.e !== LIVE_ID)) return null;
    var out = { e: parsed.e, bpm: 120, voice: 0, rot: 0 };
    if (has.call(parsed, 'bpm')) {
      if (typeof parsed.bpm !== 'number' || !Number.isSafeInteger(parsed.bpm) || parsed.bpm < 20 || parsed.bpm > 300) return null;
      out.bpm = parsed.bpm;
    }
    if (has.call(parsed, 'voice')) {
      if (typeof parsed.voice !== 'number' || !Number.isSafeInteger(parsed.voice) || parsed.voice < 0 || parsed.voice > 7) return null;
      out.voice = parsed.voice;
    }
    if (has.call(parsed, 'rot')) {
      if (typeof parsed.rot !== 'number' || !Number.isSafeInteger(parsed.rot) || parsed.rot < -4096 || parsed.rot > 4096) return null;
      out.rot = parsed.rot;
    }
    return out;
  }

  /* ---------- in-page deterministic self-tests ---------- */

  function vec(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) out.push(s[i] === '1' ? 1 : 0);
    return out;
  }

  function bruteMaxEvenness(n, k) {
    var best = -1;
    var bestVector = null;
    var total = 1 << n;
    for (var mask = 0; mask < total; mask++) {
      var count = 0;
      var v = [];
      for (var i = 0; i < n; i++) {
        var bit = (mask >> i) & 1;
        v.push(bit);
        count += bit;
      }
      if (count !== k) continue;
      var score = R.evennessIndex(v);
      if (score > best + 1e-12) { best = score; bestVector = v; }
    }
    return { score: best, vector: bestVector };
  }

  var SELF_TESTS = [
    { name: 'sha256-empty-vector', run: function () {
      if (sha256Hex('') !== 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') return 'empty string digest mismatch';
    } },
    { name: 'sha256-abc-vector', run: function () {
      if (sha256Hex('abc') !== 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') return 'abc digest mismatch';
    } },
    { name: 'sha256-56-byte-vector', run: function () {
      var msg = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
      if (sha256Hex(msg) !== '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1') return 'two block digest mismatch';
    } },
    { name: 'sha256-long-vector', run: function () {
      var msg = 'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu';
      if (sha256Hex(msg) !== 'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1') return 'long message digest mismatch';
    } },
    { name: 'bjorklund-pulse-counts', run: function () {
      var cases = [[3, 8], [5, 8], [5, 16], [7, 12], [4, 9], [2, 5], [6, 13], [1, 4], [13, 16]];
      for (var i = 0; i < cases.length; i++) {
        var v = R.euclideanRhythm(cases[i][0], cases[i][1]);
        var count = v.filter(function (x) { return x === 1; }).length;
        if (count !== cases[i][0]) return 'E(' + cases[i] + ') pulse count ' + count;
      }
    } },
    { name: 'booth-rotation-invariance', run: function () {
      var bases = [R.euclideanRhythm(5, 8), R.euclideanRhythm(3, 7), vec('10010110')];
      for (var i = 0; i < bases.length; i++) {
        var canonical = R.canonicalVector(bases[i]).join('');
        for (var r = 1; r < bases[i].length; r++) {
          if (R.canonicalVector(R.rotateVector(bases[i], r)).join('') !== canonical) return 'canonical form drifted at rotation ' + r;
        }
      }
    } },
    { name: 'euclidean-maximal-evenness', run: function () {
      for (var n = 1; n <= 12; n++) {
        for (var k = 0; k <= n; k++) {
          var e = R.evennessIndex(R.euclideanRhythm(k, n));
          var best = bruteMaxEvenness(n, k).score;
          if (e < best - 1e-12) {
            return 'E(' + k + ',' + n + ') evenness ' + e + ' below density max ' + best;
          }
        }
      }
    } },
    { name: 'lcm-horizon-cap', run: function () {
      var tracks = [61, 59, 53].map(function (steps) { return { pulses: 1, steps: steps }; });
      var threw = false;
      try { analyzeEnsemble(tracks, 120); } catch (error) {
        threw = error instanceof RangeError && /4096/.test(error.message);
      }
      if (!threw) return 'horizon over 4096 was not rejected';
    } },
    { name: 'midi-format0-structure', run: function () {
      var bytes = R.encodeMidiFile([{ pulses: 3, steps: 8 }, { pulses: 4, steps: 9 }], 120, 480, { gate: 0.5 });
      if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'MThd') return 'missing MThd';
      var chunks = R.describeMidiChunks(bytes);
      if (chunks.length !== 2 || chunks[0].type !== 'MThd' || chunks[1].type !== 'MTrk') return 'unexpected chunk layout';
      var tail = bytes.slice(bytes.length - 4);
      if (tail[1] !== 0xff || tail[2] !== 0x2f || tail[3] !== 0x00) return 'missing end of track';
    } },
    { name: 'canonicaljson-determinism', run: function () {
      var value = { b: [3, { z: 1, a: 2 }], a: 'x', m: { y: true, x: null } };
      var first = R.canonicalJson(value);
      var second = R.canonicalJson(value);
      if (first !== second) return 'non deterministic serialization';
      if (first !== '{"a":"x","b":[3,{"a":2,"z":1}],"m":{"x":null,"y":true}}') return 'unexpected canonical order: ' + first;
    } },
    { name: 'csv-formula-escape', run: function () {
      var cases = ['=CMD()', '+SUM(1)', '-10', '@mention'];
      for (var i = 0; i < cases.length; i++) {
        var cell = csvCell(cases[i]);
        if (cell.charAt(0) !== "'") return 'dangerous cell not escaped: ' + cell;
      }
      if (csvCell('plain') !== 'plain') return 'plain cell altered';
    } },
    { name: 'digest-tamper-detection', run: function () {
      var brief = briefFor({ e: 'default-study', bpm: 120, voice: 0, rot: 0 });
      var result = tamperCheck(brief);
      if (result.ok) return 'tampered payload verified true';
      var legit = verifyBrief(brief.json);
      if (!legit.ok) return 'legit brief failed verification';
    } },
    { name: 'hash-round-trip', run: function () {
      var state = { e: 'balkan-compound', bpm: 132, voice: 2, rot: -5 };
      var decoded = decodeShareHash(encodeShareState(state));
      if (!decoded) return 'decode returned null';
      if (decoded.e !== state.e || decoded.bpm !== state.bpm || decoded.voice !== state.voice || decoded.rot !== state.rot) return 'round trip drift';
    } },
    { name: 'hash-hostile-rejection', run: function () {
      var bad = ['', '#bg=', '#bg=!!!', '#bg=AAAA', 'x#bg=' + encodeShareState({}).slice(4)];
      bad.push('#bg=' + b64urlEncode(utf8Encode('{"__proto__":{"x":1},"v":1,"e":"default-study"}')));
      bad.push('#bg=' + b64urlEncode(utf8Encode('{"v":1,"e":"default-study","constructor":{}}')));
      bad.push('#bg=' + b64urlEncode(utf8Encode('[1,2,3]')));
      bad.push('#bg=' + b64urlEncode(utf8Encode('{"v":2,"e":"default-study"}')));
      bad.push('#bg=' + b64urlEncode(utf8Encode('{"v":1,"e":"nope"}')));
      bad.push('#bg=' + b64urlEncode(utf8Encode('{"v":1,"e":"default-study","bpm":301}')));
      for (var i = 0; i < bad.length; i++) {
        if (decodeShareHash(bad[i]) !== null) return 'hostile hash accepted at index ' + i;
      }
    } },
    { name: 'sweep-point-count', run: function () {
      var sweep = rotationSweep(ensembleById('balkan-compound').tracks, 1, 120);
      if (sweep.points.length !== 9) return 'sweep length ' + sweep.points.length;
      if (!sweep.inPhase.length || !sweep.hocket.length) return 'missing extrema';
    } },
    { name: 'sweep-coincidence-brute-force', run: function () {
      var tracks = ensembleById('default-study').tracks;
      var sweep = rotationSweep(tracks, 0, 120);
      var normalized = R.normalizeTracks(tracks);
      var others = [1, 2].map(function (i) { return R.expandPattern(normalized[i].pattern, sweep.horizon); });
      for (var r = 0; r < sweep.points.length; r++) {
        var rotated = R.rotateVector(normalized[0].pattern, r);
        var expanded = R.expandPattern(rotated, sweep.horizon);
        var count = 0;
        for (var s = 0; s < sweep.horizon; s++) {
          if (expanded[s] === 1 && (others[0][s] === 1 || others[1][s] === 1)) count++;
        }
        if (count !== sweep.points[r].coincidences) return 'brute force mismatch at r=' + r;
      }
    } },
    { name: 'engine-parity', run: function () {
      var tracks = ensembleById('tresillo-cinquillo-poly').tracks;
      var lab = analyzeEnsemble(tracks, 100);
      var engine = R.analyzePolyrhythm(tracks, 100);
      if (lab.horizon !== engine.cycleSteps) return 'horizon mismatch';
      if (lab.coincidenceCount !== engine.coincidenceCount) return 'coincidence mismatch';
      if (lab.midiBytes !== R.encodeMidiFile(tracks, 100, 480, { gate: 0.5 }).length) return 'midi length mismatch';
    } },
    { name: 'ensemble-registry', run: function () {
      if (ENSEMBLES.length !== 5) return 'registry size ' + ENSEMBLES.length;
      var ids = {};
      for (var i = 0; i < ENSEMBLES.length; i++) {
        if (ids[ENSEMBLES[i].id]) return 'duplicate id ' + ENSEMBLES[i].id;
        ids[ENSEMBLES[i].id] = true;
        var a = analyzeEnsemble(ENSEMBLES[i].tracks, 120);
        if (a.horizon > R.MAX_CYCLE_STEPS) return ENSEMBLES[i].id + ' horizon over cap';
      }
    } },
    { name: 'digest-parity-across-exports', run: function () {
      var brief = briefFor({ e: 'prime-phase-drift', bpm: 90, voice: 1, rot: 3 });
      if (brief.json.indexOf(brief.digest) === -1) return 'json missing digest';
      if (brief.csv.indexOf('# sha256: ' + brief.digest) === -1) return 'csv missing digest';
      if (brief.markdown.indexOf('`' + brief.digest + '`') === -1) return 'markdown missing digest';
      if (briefFor({ e: 'prime-phase-drift', bpm: 90, voice: 1, rot: 3 }) !== brief) return 'cache miss for identical state';
    } },
    { name: 'utf8-strict-codec', run: function () {
      var round = utf8Decode(utf8Encode('a\tz' + String.fromCharCode(0x20ac) + String.fromCharCode(0x1d11e)));
      if (round !== 'a\tz' + String.fromCharCode(0x20ac) + String.fromCharCode(0x1d11e)) return 'utf8 round trip drift';
      if (utf8Decode([0x80]) !== null) return 'stray continuation accepted';
      if (utf8Decode([0xc0, 0x80]) !== null) return 'overlong accepted';
      if (utf8Decode([0xed, 0xa0, 0x80]) !== null) return 'surrogate half accepted';
    } },
    { name: 'midi-byte-length-report', run: function () {
      var tracks = ensembleById('binary-grid-control').tracks;
      var a = analyzeEnsemble(tracks, 120);
      var expected = R.encodeMidiFile(tracks, 120, 480, { gate: 0.5 }).length;
      if (a.midiBytes !== expected) return 'reported ' + a.midiBytes + ' expected ' + expected;
    } }
  ];

  function runSelfTests() {
    requireEngine();
    var results = [];
    var passed = 0;
    for (var i = 0; i < SELF_TESTS.length; i++) {
      var failure = null;
      try {
        failure = SELF_TESTS[i].run() || null;
      } catch (error) {
        failure = (error && error.message) || String(error);
      }
      if (failure === null) passed++;
      results.push({ name: SELF_TESTS[i].name, ok: failure === null, detail: failure });
    }
    return { total: results.length, passed: passed, results: results };
  }

  return {
    LAB_VERSION: LAB_VERSION,
    LIVE_ID: LIVE_ID,
    HASH_PREFIX: HASH_PREFIX,
    ENSEMBLES: ENSEMBLES,
    ensembleById: ensembleById,
    analyzeEnsemble: analyzeEnsemble,
    rotationSweep: rotationSweep,
    normalizeLabState: normalizeLabState,
    tracksForState: tracksForState,
    buildBriefPayload: buildBriefPayload,
    briefFor: briefFor,
    verifyBrief: verifyBrief,
    tamperCheck: tamperCheck,
    encodeShareState: encodeShareState,
    decodeShareHash: decodeShareHash,
    sha256Hex: sha256Hex,
    sha256BytesHex: sha256BytesHex,
    utf8Encode: utf8Encode,
    utf8Decode: utf8Decode,
    b64urlEncode: b64urlEncode,
    b64urlDecode: b64urlDecode,
    csvCell: csvCell,
    runSelfTests: runSelfTests,
    SELF_TESTS: SELF_TESTS,
    clearBriefCache: function () { briefCache = Object.create(null); }
  };
});
