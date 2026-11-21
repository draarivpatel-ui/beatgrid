/*
 * BeatGrid rhythm engine
 * UMD module: works with CommonJS, AMD, and a plain browser <script> tag.
 * Zero dependencies. Pure computation and binary/text file generation.
 * No audio playback of any kind is performed here.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module && module.exports) {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.BeatGrid = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '1.1.0';
  var DEFAULT_STEPS_PER_BEAT = 4;
  var DEFAULT_PPQ = 480;
  var DEFAULT_BPM = 120;
  var DEFAULT_GATE = 0.5;
  var DEFAULT_CHANNEL = 9;
  var MAX_TRACK_HUES = 8;
  var MAX_STEPS = 64;
  var MAX_CYCLE_STEPS = 4096;

  var DEFAULT_NOTES = [36, 38, 42, 56, 45, 49, 47, 51];

  var DRUM_NAMES = {
    35: 'bd',
    36: 'bd',
    38: 'sn',
    39: 'hc',
    42: 'hh',
    44: 'hh',
    45: 'toml',
    46: 'hho',
    47: 'tomml',
    48: 'tommh',
    49: 'cymc',
    50: 'tomh',
    51: 'cymr',
    53: 'cyms',
    56: 'cb'
  };

  var PRESETS = [
    { name: 'Tresillo', formula: 'E(3,8)', pulses: 3, steps: 8, rotation: 0, note: 36, description: 'Cuban tresillo, 3+3+2' },
    { name: 'Cinquillo', formula: 'E(5,8)', pulses: 5, steps: 8, rotation: 0, note: 38, description: 'Cuban cinquillo, 2+1+2+1+2' },
    { name: 'Five in sixteen', formula: 'E(5,16)', pulses: 5, steps: 16, rotation: 0, note: 42, description: 'Even five-onset study, 3+3+3+3+4' },
    { name: 'Seven in twelve', formula: 'E(7,12)', pulses: 7, steps: 12, rotation: 0, note: 56, description: 'Even seven-onset study, five 2s and two 1s' },
    { name: 'Four in nine', formula: 'E(4,9)', pulses: 4, steps: 9, rotation: 0, note: 45, description: 'Even four-onset study, 2+2+2+3' }
  ];

  /* ---------- numeric helpers ---------- */

  function assertInteger(value, label) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
      throw new TypeError(label + ' must be a safe integer');
    }
    return value;
  }

  function assertPositive(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new RangeError(label + ' must be a positive finite number');
    }
    return value;
  }

  function gcd(a, b) {
    a = Math.abs(assertInteger(a, 'a'));
    b = Math.abs(assertInteger(b, 'b'));
    while (b !== 0) {
      var t = a % b;
      a = b;
      b = t;
    }
    return a;
  }

  function lcm(a, b) {
    assertInteger(a, 'a');
    assertInteger(b, 'b');
    if (a === 0 || b === 0) return 0;
    var value = Math.abs((a / gcd(a, b)) * b);
    if (!Number.isSafeInteger(value)) throw new RangeError('LCM exceeds the safe integer range');
    return value;
  }

  function lcmAll(values) {
    if (!Array.isArray(values)) throw new TypeError('values must be an array');
    var total = 1;
    for (var i = 0; i < values.length; i++) total = lcm(total, values[i]);
    return total;
  }

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  function flatten(groups) {
    var out = [];
    for (var i = 0; i < groups.length; i++) {
      for (var j = 0; j < groups[i].length; j++) out.push(groups[i][j]);
    }
    return out;
  }

  function rotateVector(vector, rotation) {
    if (!Array.isArray(vector)) throw new TypeError('vector must be an array');
    assertInteger(rotation, 'rotation');
    var n = vector.length;
    if (n === 0) return [];
    var shift = ((rotation % n) + n) % n;
    if (shift === 0) return vector.slice();
    var out = new Array(n);
    for (var i = 0; i < n; i++) out[(i + shift) % n] = vector[i];
    return out;
  }

  /* ---------- Bjorklund's algorithm ---------- */

  /*
   * Bjorklund E(k, n): start with k one-groups and (n - k) zero-groups.
   * While more than one zero-side group remains, append the first m groups of
   * the zero side to the first m groups of the one side, where m is the smaller
   * group count. Leftover groups on both sides become the new zero side. The
   * final concatenation of one-side groups followed by zero-side groups is the
   * maximally even distribution of k onsets over n cells.
   *
   * Example E(3,8): [1][1][1] [0][0][0][0][0]
   *   round 1 -> [10][10][10] | [0][0]
   *   round 2 -> [100][100]   | [10]
   *   result  -> 10010010
   */
  function euclideanRhythm(pulses, steps, rotation) {
    assertInteger(pulses, 'pulses');
    assertInteger(steps, 'steps');
    if (steps <= 0 || steps > MAX_STEPS) throw new RangeError('steps must be between 1 and ' + MAX_STEPS);
    if (pulses < 0) throw new RangeError('pulses must not be negative');
    if (arguments.length < 3 || rotation === undefined || rotation === null) rotation = 0;
    assertInteger(rotation, 'rotation');

    if (pulses === 0) return new Array(steps).fill(0);
    if (pulses >= steps) return new Array(steps).fill(1);

    var ones = [];
    var zeros = [];
    var i;
    for (i = 0; i < pulses; i++) ones.push([1]);
    for (i = 0; i < steps - pulses; i++) zeros.push([0]);

    while (zeros.length > 1) {
      var m = Math.min(ones.length, zeros.length);
      var paired = [];
      for (i = 0; i < m; i++) paired.push(ones[i].concat(zeros[i]));
      var leftover = ones.slice(m).concat(zeros.slice(m));
      ones = paired;
      zeros = leftover;
    }

    var result = flatten(ones.concat(zeros));
    return rotateVector(result, rotation);
  }

  /* ---------- track normalization ---------- */

  function safeText(value, fallback, maxLength) {
    if (typeof value !== 'string' || value.length === 0) return fallback;
    return value.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]+/g, ' ').trim().slice(0, maxLength || 80) || fallback;
  }

  function binaryPattern(pattern, allowEmpty) {
    if (!Array.isArray(pattern)) throw new TypeError('pattern must be an array');
    if ((!allowEmpty && pattern.length === 0) || pattern.length > MAX_STEPS) {
      throw new RangeError('pattern needs 1 to ' + MAX_STEPS + ' steps');
    }
    return Array.from(pattern, function (value) {
      if (value !== 0 && value !== 1 && value !== false && value !== true) {
        throw new TypeError('pattern cells must be 0 or 1');
      }
      return value ? 1 : 0;
    });
  }

  function normalizeTracks(tracks) {
    if (!Array.isArray(tracks)) throw new TypeError('tracks must be an array');
    if (tracks.length > MAX_TRACK_HUES) throw new RangeError('at most 8 tracks are supported');
    var out = [];
    for (var i = 0; i < tracks.length; i++) {
      var raw = tracks[i];
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('track ' + i + ' must be an object');
      var pattern;
      var pulses;
      var steps;
      var rotation = 0;
      if (raw.pattern !== undefined) {
        pattern = binaryPattern(raw.pattern);
        pulses = pattern.filter(function (v) { return v === 1; }).length;
        steps = pattern.length;
      } else {
        pulses = assertInteger(raw.pulses, 'pulses');
        steps = assertInteger(raw.steps, 'steps');
        if (raw.rotation !== undefined && raw.rotation !== null) {
          rotation = assertInteger(raw.rotation, 'rotation');
        }
        pattern = euclideanRhythm(pulses, steps, rotation);
        pulses = Math.min(pulses, steps);
        rotation = ((rotation % steps) + steps) % steps;
      }
      if (steps === 0) throw new RangeError('track ' + i + ' needs at least one step');
      var note = raw.note === undefined ? DEFAULT_NOTES[i % DEFAULT_NOTES.length] : assertInteger(raw.note, 'note');
      note = clamp(note, 0, 127);
      var channel = raw.channel === undefined ? DEFAULT_CHANNEL : assertInteger(raw.channel, 'channel');
      channel = clamp(channel, 0, 15);
      var velocity = raw.velocity === undefined ? 96 : assertInteger(raw.velocity, 'velocity');
      velocity = clamp(velocity, 1, 127);
      var name = safeText(raw.name, 'Track ' + (i + 1), 40);
      var formula = safeText(raw.formula, Array.isArray(raw.pattern) ? 'Manual ' + steps + ' steps' : ('E(' + pulses + ',' + steps + ',' + rotation + ')'), 80);
      out.push({
        index: i,
        name: name,
        formula: formula,
        pulses: pulses,
        steps: steps,
        rotation: rotation,
        pattern: pattern,
        note: note,
        channel: channel,
        velocity: velocity,
        colorSlot: i % MAX_TRACK_HUES
      });
    }
    return out;
  }

  function expandPattern(pattern, length) {
    pattern = binaryPattern(pattern);
    assertInteger(length, 'length');
    if (length < 0 || length > MAX_CYCLE_STEPS) throw new RangeError('length must be between 0 and ' + MAX_CYCLE_STEPS);
    var out = new Array(length);
    for (var i = 0; i < length; i++) out[i] = pattern[i % pattern.length];
    return out;
  }

  function hammingDistance(a, b) {
    if (a.length !== b.length) throw new RangeError('Hamming distance needs equal length vectors');
    var d = 0;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
    return d;
  }

  /*
   * Step evenness in [0, 1]. Inter-onset gaps are compared to the ideal gap
   * n/k; the sum of absolute deviations is normalized against the worst
   * packing of the same density (k-1 unit gaps and one long gap). A score of
   * 1 is reached only when every gap equals n/k, which needs k to divide n.
   * Maximally even vectors still score the maximum available for their
   * density when n/k is fractional.
   */
  function evennessIndex(pattern) {
    var vector = binaryPattern(pattern);
    var positions = [];
    vector.forEach(function (value, index) { if (value) positions.push(index); });
    var k = positions.length;
    if (k === 0) return 0;
    var n = vector.length;
    // Integer-scaled deviation: sum of |gap*k - n| equals k times the sum of
    // |gap - n/k|, so the score is exact and identical under rotation.
    var scaled = 0;
    for (var i = 0; i < k; i++) {
      var gap = ((positions[(i + 1) % k] - positions[i] + n) % n) || n;
      scaled += Math.abs(gap * k - n);
    }
    var worst = 2 * (k - 1) * (n - k);
    if (worst === 0) return 1;
    return Math.min(1, Math.max(0, 1 - scaled / worst));
  }

  /*
   * Booth's least-rotation algorithm. Returns the index whose left rotation
   * produces the lexicographically smallest cyclic form of the vector, which
   * is a canonical representative shared by every rotation of the pattern.
   */
  function canonicalRotation(pattern) {
    var vector = binaryPattern(pattern);
    var n = vector.length;
    if (n < 2) return 0;
    var i = 0;
    var j = 1;
    var k = 0;
    while (i < n && j < n && k < n) {
      var a = vector[(i + k) % n];
      var b = vector[(j + k) % n];
      if (a === b) { k++; continue; }
      if (a > b) i = i + k + 1;
      else j = j + k + 1;
      if (i === j) i++;
      k = 0;
    }
    return Math.min(i, j) % n;
  }

  function canonicalVector(pattern) {
    var vector = binaryPattern(pattern);
    var shift = canonicalRotation(vector);
    return vector.slice(shift).concat(vector.slice(0, shift));
  }

  function inspectPattern(pattern) {
    var vector = binaryPattern(pattern);
    var positions = [];
    vector.forEach(function (value, index) { if (value) positions.push(index); });
    var gaps = positions.map(function (position, index) {
      return ((positions[(index + 1) % positions.length] - position + vector.length) % vector.length) || vector.length;
    });
    var period = vector.length;
    for (var candidate = 1; candidate <= vector.length; candidate++) {
      if (vector.length % candidate === 0 && vector.every(function (value, index) { return value === vector[index % candidate]; })) {
        period = candidate;
        break;
      }
    }
    return {
      steps: vector.length, onsets: positions.length, density: positions.length / vector.length,
      positions: positions, gaps: gaps, fundamentalPeriod: period,
      gapSpread: gaps.length ? Math.max.apply(null, gaps) - Math.min.apply(null, gaps) : 0,
      evenness: evennessIndex(vector)
    };
  }

  /* A session preserves both editable Euclidean voices and manual vectors. */
  function validateSession(session) {
    if (!session || typeof session !== 'object' || Array.isArray(session)) throw new TypeError('session must be an object');
    if (session.schema !== 'beatgrid/session' || session.version !== 1) throw new TypeError('unsupported BeatGrid session schema or version');
    if (typeof session.title !== 'string' || !session.title.trim() || session.title.length > 60 || /[\x00-\x1f\x7f]/.test(session.title)) throw new RangeError('title needs 1 to 60 characters without control characters');
    var bpm = assertInteger(session.bpm, 'bpm');
    if (bpm < 20 || bpm > 300) throw new RangeError('session bpm must be between 20 and 300');
    var ppq = assertInteger(session.ppq, 'ppq');
    if (ppq < 24 || ppq > 960) throw new RangeError('session ppq must be between 24 and 960');
    if ([0.25, 0.5, 0.75, 1].indexOf(session.gate) === -1) throw new RangeError('session gate must be 0.25, 0.5, 0.75, or 1');
    var normalized = normalizeTracks(session.tracks);
    if (!normalized.length) throw new RangeError('session needs at least one voice');
    var tracks = normalized.map(function (track, index) {
      var raw = session.tracks[index];
      ['note', 'channel', 'velocity'].forEach(function (field) {
        if (raw[field] !== undefined && raw[field] !== track[field]) throw new RangeError('track ' + (index + 1) + ' ' + field + ' is outside the MIDI range');
      });
      var out = { name: track.name, note: track.note, channel: track.channel, velocity: track.velocity };
      if (raw.pattern !== undefined) out.pattern = track.pattern.slice();
      else {
        if (raw.pulses > raw.steps) throw new RangeError('session pulses must not exceed steps');
        out.pulses = track.pulses;
        out.steps = track.steps;
        out.rotation = track.rotation;
      }
      return out;
    });
    analyzePolyrhythm(tracks, bpm);
    return { schema: 'beatgrid/session', version: 1, title: safeText(session.title, 'BeatGrid Study', 60), bpm: bpm, ppq: ppq, gate: session.gate, tracks: tracks };
  }

  function exportSession(session) { return JSON.stringify(validateSession(session), null, 2); }

  function importSession(text) {
    if (typeof text !== 'string') throw new TypeError('session import needs JSON text');
    if (text.length > 131072) throw new RangeError('session JSON exceeds 128 KiB');
    return validateSession(JSON.parse(text));
  }

  /* ---------- canonical JSON and pattern descriptors ---------- */

  /*
   * Deterministic JSON: object keys serialize in sorted order at every
   * depth, array order is preserved, and insignificant whitespace is
   * removed. Equal inputs always produce identical bytes. Pairs are
   * emitted directly, never through an intermediate plain object, so
   * every own enumerable key survives (including "__proto__") and keys
   * sort in exact lexicographical UTF-16 order: "10" precedes "2".
   */
  function canonicalJson(value) {
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
      throw new TypeError('canonical JSON needs a JSON value');
    }
    return writeCanonical(value);
  }

  function writeCanonical(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (typeof value.toJSON === 'function') return writeCanonical(value.toJSON());
    if (Array.isArray(value)) {
      var cells = new Array(value.length);
      for (var i = 0; i < value.length; i++) {
        var cell = value[i];
        cells[i] = (cell === undefined || typeof cell === 'function' || typeof cell === 'symbol') ? 'null' : writeCanonical(cell);
      }
      return '[' + cells.join(',') + ']';
    }
    var keys = Object.keys(value).sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
    var pairs = [];
    for (var j = 0; j < keys.length; j++) {
      var key = keys[j];
      var member = value[key];
      if (member === undefined || typeof member === 'function' || typeof member === 'symbol') continue;
      pairs.push(JSON.stringify(key) + ':' + writeCanonical(member));
    }
    return '{' + pairs.join(',') + '}';
  }

  /*
   * A pattern descriptor is a self contained record of one binary onset
   * vector: how it was generated, its exact vector, its canonical least
   * rotation, and its measured properties. Two vectors that are rotations
   * of one another share the same canonicalVector and canonicalShift
   * targets, so the descriptor doubles as a rotation aware equality check.
   */
  function describePattern(trackOrPattern, options) {
    var opts = options || {};
    var track;
    if (Array.isArray(trackOrPattern)) {
      track = normalizeTracks([{ pattern: trackOrPattern }])[0];
    } else {
      track = normalizeTracks([trackOrPattern])[0];
    }
    var spb = opts.stepsPerBeat === undefined ? DEFAULT_STEPS_PER_BEAT : assertInteger(opts.stepsPerBeat, 'stepsPerBeat');
    if (spb < 1 || spb > 16) throw new RangeError('stepsPerBeat must be between 1 and 16');
    var info = inspectPattern(track.pattern);
    var shift = canonicalRotation(track.pattern);
    var score = syncopationIndex(track.pattern, spb);
    var evaluatedSteps = lcm(info.steps, spb * 4);
    var evaluatedOnsets = info.onsets * evaluatedSteps / info.steps;
    var descriptor = {
      schema: 'beatgrid/pattern',
      version: 1,
      name: opts.name === undefined ? track.name : safeText(opts.name, track.name, 40),
      generator: Array.isArray(trackOrPattern) || (trackOrPattern && trackOrPattern.pattern !== undefined) ? 'manual' : 'bjorklund',
      steps: info.steps,
      onsets: info.onsets,
      density: info.density,
      vector: track.pattern.join(''),
      canonicalVector: canonicalVector(track.pattern).join(''),
      canonicalShift: shift,
      gaps: info.gaps,
      gapSpread: info.gapSpread,
      evenness: info.evenness,
      fundamentalPeriod: info.fundamentalPeriod,
      note: track.note,
      channel: track.channel,
      velocity: track.velocity,
      syncopation: {
        score: score,
        normalized: evaluatedOnsets === 0 ? 0 : score / evaluatedOnsets,
        evaluatedSteps: evaluatedSteps,
        evaluatedOnsets: evaluatedOnsets,
        stepsPerBeat: spb
      }
    };
    if (descriptor.generator === 'bjorklund') {
      descriptor.pulses = track.pulses;
      descriptor.rotation = track.rotation;
    }
    return descriptor;
  }

  function exportPattern(trackOrPattern, options) {
    return canonicalJson(describePattern(trackOrPattern, options));
  }

  /*
   * Reads a beatgrid/pattern or beatgrid/pattern-set export back into
   * normalized manual voices. The embedded vector strings are
   * authoritative for timing; optional note, channel, and velocity
   * fields are validated against their MIDI ranges and carried through,
   * so a stale or edited descriptor still restores the same onset cells
   * and voice settings it declares. Older timing-only records import
   * with default voice settings. A single pattern returns one voice
   * object, a set returns an array.
   */
  function importPattern(text) {
    if (typeof text !== 'string') throw new TypeError('pattern import needs JSON text');
    if (text.length > 65536) throw new RangeError('pattern JSON exceeds 64 KiB');
    var parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('pattern must be an object');
    if (parsed.schema === 'beatgrid/pattern-set' && parsed.version === 1) {
      if (!Array.isArray(parsed.patterns) || !parsed.patterns.length) throw new RangeError('pattern set needs at least one pattern');
      if (parsed.patterns.length > MAX_TRACK_HUES) throw new RangeError('pattern set holds at most ' + MAX_TRACK_HUES + ' patterns');
      return parsed.patterns.map(readPatternEntry);
    }
    if (parsed.schema !== 'beatgrid/pattern' || parsed.version !== 1) throw new TypeError('unsupported BeatGrid pattern schema or version');
    return readPatternEntry(parsed);
  }

  function readPatternEntry(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError('pattern entry must be an object');
    var pattern;
    if (typeof entry.vector === 'string') {
      if (!/^[01]{1,64}$/.test(entry.vector)) throw new RangeError('pattern vector needs 1 to 64 binary cells');
      pattern = entry.vector.split('').map(function (cell) { return cell === '1' ? 1 : 0; });
    } else if (Array.isArray(entry.pattern)) {
      pattern = binaryPattern(entry.pattern);
    } else {
      throw new TypeError('pattern needs a vector string or a pattern array');
    }
    var voice = { name: safeText(entry.name, 'Pattern', 40), pattern: pattern };
    var ranges = { note: [0, 127], channel: [0, 15], velocity: [1, 127] };
    ['note', 'channel', 'velocity'].forEach(function (field) {
      var value = entry[field];
      if (value === undefined || value === null) return;
      assertInteger(value, 'pattern ' + field);
      if (value < ranges[field][0] || value > ranges[field][1]) {
        throw new RangeError('pattern ' + field + ' must be between ' + ranges[field][0] + ' and ' + ranges[field][1]);
      }
      voice[field] = value;
    });
    return voice;
  }

  /* ---------- metrical weight and syncopation ---------- */

  /*
   * Metrical weight on a fixed sixteenth-note grid. A larger number means a
   * stronger position: 4 for the bar downbeat, 3 for quarter-note beats,
   * 2 for eighth-note divisions, 1 for remaining sixteenths.
   */
  function metricalWeight(stepIndex, stepsPerBeat) {
    assertInteger(stepIndex, 'stepIndex');
    var spb = stepsPerBeat === undefined ? DEFAULT_STEPS_PER_BEAT : assertInteger(stepsPerBeat, 'stepsPerBeat');
    if (spb < 1 || spb > 16) throw new RangeError('stepsPerBeat must be between 1 and 16');
    var bar = spb * 4;
    var pos = ((stepIndex % bar) + bar) % bar;
    if (pos === 0) return 4;
    if (pos % spb === 0) return 3;
    if (spb >= 2 && pos % (spb / 2) === 0) return 2;
    return 1;
  }

  /*
   * Longuet-Higgins and Lee style syncopation with a Keith style weight
   * difference. An onset at a weak position is syncopated when the nearest
   * following metrically stronger position is empty. Its contribution is the
   * difference between the two metrical weights. The downbeat itself can never
   * be syncopated because no stronger position follows it.
   */
  function syncopationIndex(pattern, stepsPerBeat) {
    pattern = binaryPattern(pattern);
    var spb = stepsPerBeat === undefined ? DEFAULT_STEPS_PER_BEAT : assertInteger(stepsPerBeat, 'stepsPerBeat');
    metricalWeight(0, spb);
    var n = pattern.length;
    var score = 0;
    var window = spb * 4;
    // Include every relative phase between the repeating voice and the meter.
    var horizon = lcm(n, window);
    for (var i = 0; i < horizon; i++) {
      if (!pattern[i % n]) continue;
      var wi = metricalWeight(i, spb);
      for (var d = 1; d <= window; d++) {
        var wj = metricalWeight(i + d, spb);
        if (wj > wi) {
          if (!pattern[(i + d) % n]) score += wj - wi;
          break;
        }
      }
    }
    return score;
  }

  /* ---------- polyrhythm analysis ---------- */

  function analyzePolyrhythm(tracks, bpm, options) {
    var opts = options || {};
    var normalized = normalizeTracks(tracks);
    if (normalized.length === 0) throw new RangeError('at least one track is required');
    var rate = bpm === undefined ? DEFAULT_BPM : assertPositive(bpm, 'bpm');
    var spb = opts.stepsPerBeat === undefined ? DEFAULT_STEPS_PER_BEAT : assertInteger(opts.stepsPerBeat, 'stepsPerBeat');
    if (spb < 1 || spb > 16) throw new RangeError('stepsPerBeat must be between 1 and 16');

    var secondsPerStep = 60 / rate / spb;
    var stepCounts = normalized.map(function (t) { return t.steps; });
    var cycleSteps = lcmAll(stepCounts);
    if (cycleSteps > MAX_CYCLE_STEPS) {
      throw new RangeError('shared cycle exceeds ' + MAX_CYCLE_STEPS + ' steps; use track lengths with common factors');
    }
    var cycleSeconds = cycleSteps * secondsPerStep;
    if (!Number.isFinite(cycleSeconds)) throw new RangeError('cycle duration must be finite');
    var cycleBeats = cycleSteps / spb;

    var expanded = normalized.map(function (t) {
      var v = expandPattern(t.pattern, cycleSteps);
      t.expanded = v;
      t.onsets = t.pattern.filter(function (x) { return x === 1; }).length;
      t.evenness = evennessIndex(t.pattern);
      return v;
    });

    var n = normalized.length;
    var coincidenceMatrix = [];
    var coincidenceRates = [];
    var hammingDistances = [];
    var hammingRates = [];
    var i;
    var j;
    var s;
    for (i = 0; i < n; i++) {
      coincidenceMatrix.push(new Array(n).fill(0));
      coincidenceRates.push(new Array(n).fill(0));
      hammingDistances.push(new Array(n).fill(0));
      hammingRates.push(new Array(n).fill(0));
    }
    for (i = 0; i < n; i++) {
      for (j = i; j < n; j++) {
        var coincidences = 0;
        var differences = hammingDistance(expanded[i], expanded[j]);
        for (s = 0; s < cycleSteps; s++) {
          if (expanded[i][s] === 1 && expanded[j][s] === 1) coincidences++;
        }
        coincidenceMatrix[i][j] = coincidences;
        coincidenceMatrix[j][i] = coincidences;
        coincidenceRates[i][j] = coincidences / cycleSteps;
        coincidenceRates[j][i] = coincidences / cycleSteps;
        hammingDistances[i][j] = differences;
        hammingDistances[j][i] = differences;
        hammingRates[i][j] = differences / cycleSteps;
        hammingRates[j][i] = differences / cycleSteps;
      }
    }

    var coincidenceSteps = [];
    for (s = 0; s < cycleSteps; s++) {
      var hits = 0;
      for (i = 0; i < n; i++) if (expanded[i][s] === 1) hits++;
      if (hits >= 2) coincidenceSteps.push(s);
    }

    var perTrack = normalized.map(function (t) {
      var score = syncopationIndex(t.pattern, spb);
      var evaluatedSteps = lcm(t.steps, spb * 4);
      var evaluatedOnsets = t.onsets * evaluatedSteps / t.steps;
      return {
        name: t.name,
        score: score,
        normalized: evaluatedOnsets === 0 ? 0 : score / evaluatedOnsets,
        onsets: t.onsets,
        evenness: t.evenness,
        evaluatedSteps: evaluatedSteps,
        evaluatedOnsets: evaluatedOnsets
      };
    });
    var syncTotal = perTrack.reduce(function (acc, x) { return acc + x.score; }, 0);
    var syncopation = {
      perTrack: perTrack,
      total: syncTotal,
      mean: syncTotal / n,
      method: 'nearest stronger empty position over the joint voice and 4/4 meter cycle; an illustrative metric'
    };

    return {
      version: VERSION,
      bpm: rate,
      stepsPerBeat: spb,
      secondsPerStep: secondsPerStep,
      cycleSteps: cycleSteps,
      lcmSteps: cycleSteps,
      cycleSeconds: cycleSeconds,
      cycleBeats: cycleBeats,
      tracks: normalized,
      coincidenceMatrix: coincidenceMatrix,
      coincidenceRates: coincidenceRates,
      coincidenceSteps: coincidenceSteps,
      coincidenceCount: coincidenceSteps.length,
      coincidenceDensity: coincidenceSteps.length / cycleSteps,
      hammingDistances: hammingDistances,
      hammingRates: hammingRates,
      syncopation: syncopation,
      syncopationIndex: syncTotal
    };
  }

  /* ---------- variable length quantity (VLQ) ---------- */

  function vlqEncode(value) {
    assertInteger(value, 'value');
    if (value < 0 || value > 0x0fffffff) {
      throw new RangeError('VLQ value must be between 0 and 0x0FFFFFFF');
    }
    var out = [value & 0x7f];
    var rest = Math.floor(value / 128);
    while (rest > 0) {
      out.unshift((rest & 0x7f) | 0x80);
      rest = Math.floor(rest / 128);
    }
    return out;
  }

  function vlqDecode(bytes, start) {
    if (!bytes || typeof bytes.length !== 'number') throw new TypeError('bytes must be a byte array');
    var offset = start === undefined ? 0 : assertInteger(start, 'start');
    if (offset < 0 || offset >= bytes.length) throw new RangeError('start is outside the byte array');
    var value = 0;
    var consumed = 0;
    while (offset < bytes.length && consumed < 4) {
      var b = bytes[offset];
      if (!Number.isInteger(b) || b < 0 || b > 255) throw new TypeError('invalid byte in VLQ');
      value = (value * 128) + (b & 0x7f);
      consumed++;
      offset++;
      if ((b & 0x80) === 0) return { value: value, consumed: consumed };
    }
    throw new RangeError('incomplete VLQ');
  }

  /* ---------- byte builders ---------- */

  function asciiBytes(text) {
    var out = [];
    for (var i = 0; i < text.length; i++) out.push(text.charCodeAt(i) & 0x7f);
    return out;
  }

  function u16(value) {
    return [(value >> 8) & 0xff, value & 0xff];
  }

  function u32(value) {
    return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
  }

  function microsPerQuarter(bpm) {
    assertPositive(bpm, 'bpm');
    var value = Math.round(60000000 / bpm);
    if (value < 1 || value > 0xffffff) throw new RangeError('tempo cannot be represented in a MIDI tempo event');
    return value;
  }

  /* ---------- Standard MIDI File, format 0 ---------- */

  /*
   * All events are merged into one MTrk chunk (SMF format 0). Delta times are
   * VLQ encoded. The header is MThd with format 0, one track, and a positive
   * ticks-per-quarter-note division. Every onset becomes a note-on plus a
   * note-off; the tempo meta event sets microseconds per quarter note.
   */
  function encodeMidiFile(tracks, bpm, ppq, options) {
    var resolution;
    var opts = {};
    if (ppq !== undefined && typeof ppq === 'object' && ppq !== null) {
      opts = ppq;
      resolution = opts.ppq === undefined ? DEFAULT_PPQ : opts.ppq;
    } else {
      resolution = ppq === undefined ? DEFAULT_PPQ : ppq;
      opts = options || {};
    }
    assertInteger(resolution, 'ppq');
    if (resolution < 1 || resolution > 32767) throw new RangeError('ppq must be between 1 and 32767');
    var spb = opts.stepsPerBeat === undefined ? DEFAULT_STEPS_PER_BEAT : assertInteger(opts.stepsPerBeat, 'stepsPerBeat');
    if (spb < 1 || spb > 16) throw new RangeError('stepsPerBeat must be between 1 and 16');
    var gate = opts.gate === undefined ? DEFAULT_GATE : opts.gate;
    if (typeof gate !== 'number' || !Number.isFinite(gate) || gate <= 0 || gate > 1) {
      throw new RangeError('gate must be in (0, 1]');
    }

    var analysis = analyzePolyrhythm(tracks, bpm, { stepsPerBeat: spb });
    if (resolution < spb) throw new RangeError('ppq must be at least stepsPerBeat');
    var ticksPerStep = resolution / spb;
    var events = [];

    function addMeta(tick, order, data) {
      events.push({ tick: tick, order: order, data: data });
    }

    var nameBytes = asciiBytes('BeatGrid format 0');
    addMeta(0, -3, [0xff, 0x03].concat(vlqEncode(nameBytes.length), nameBytes));
    var mpq = microsPerQuarter(analysis.bpm);
    addMeta(0, -2, [0xff, 0x51, 0x03, (mpq >> 16) & 0xff, (mpq >> 8) & 0xff, mpq & 0xff]);
    addMeta(0, -1, [0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08]);

    var seen = Object.create(null);
    for (var t = 0; t < analysis.tracks.length; t++) {
      var track = analysis.tracks[t];
      var expanded = track.expanded;
      for (var s = 0; s < analysis.cycleSteps; s++) {
        if (expanded[s] !== 1) continue;
        var tick = Math.round(s * ticksPerStep);
        var nextTick = Math.round((s + 1) * ticksPerStep);
        var gateTicks = Math.max(1, Math.round((nextTick - tick) * gate));
        var onStatus = 0x90 | track.channel;
        var offStatus = 0x80 | track.channel;
        var keyOn = tick + '|1|' + onStatus + '|' + track.note;
        var keyOff = (tick + gateTicks) + '|0|' + offStatus + '|' + track.note;
        if (!seen[keyOn]) {
          var onEvent = { tick: tick, order: 1, data: [onStatus, track.note, track.velocity] };
          seen[keyOn] = onEvent;
          events.push(onEvent);
        } else {
          seen[keyOn].data[2] = Math.max(seen[keyOn].data[2], track.velocity);
        }
        if (!seen[keyOff]) {
          seen[keyOff] = true;
          events.push({ tick: tick + gateTicks, order: 0, data: [offStatus, track.note, 0] });
        }
      }
    }

    var lastTick = Math.round(analysis.cycleSteps * ticksPerStep);
    addMeta(lastTick, 2, [0xff, 0x2f, 0x00]);

    events.sort(function (a, b) {
      if (a.tick !== b.tick) return a.tick - b.tick;
      return a.order - b.order;
    });

    var body = [];
    var previousTick = 0;
    for (var e = 0; e < events.length; e++) {
      var delta = events[e].tick - previousTick;
      var encoded = vlqEncode(delta);
      for (var q = 0; q < encoded.length; q++) body.push(encoded[q]);
      for (var d = 0; d < events[e].data.length; d++) body.push(events[e].data[d]);
      previousTick = events[e].tick;
    }

    var header = asciiBytes('MThd').concat(
      u32(6),
      u16(0),
      u16(1),
      u16(resolution)
    );
    var chunk = asciiBytes('MTrk').concat(u32(body.length), body);
    return Uint8Array.from(header.concat(chunk));
  }

  /* ---------- inspection helpers ---------- */

  function hexDump(bytes, width) {
    validateBytes(bytes);
    var perLine = width === undefined ? 16 : assertInteger(width, 'width');
    if (perLine < 1 || perLine > 256) throw new RangeError('width must be between 1 and 256');
    var lines = [];
    for (var i = 0; i < bytes.length; i += perLine) {
      var hex = [];
      var text = [];
      for (var j = 0; j < perLine; j++) {
        if (i + j < bytes.length) {
          var b = bytes[i + j];
          hex.push((b + 256).toString(16).slice(1).toUpperCase());
          text.push(b >= 32 && b <= 126 ? String.fromCharCode(b) : '.');
        } else {
          hex.push('  ');
          text.push(' ');
        }
      }
      var offset = (i + 0x100000000).toString(16).slice(-8).toUpperCase();
      lines.push(offset + '  ' + hex.join(' ') + '  |' + text.join('') + '|');
    }
    return lines.join('\n');
  }

  function describeMidiChunks(bytes) {
    validateBytes(bytes);
    var chunks = [];
    var offset = 0;
    while (offset + 8 <= bytes.length) {
      var type = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
      var length = (bytes[offset + 4] * 0x1000000) + (bytes[offset + 5] * 0x10000) + (bytes[offset + 6] * 0x100) + bytes[offset + 7];
      if (type !== 'MThd' && type !== 'MTrk') throw new RangeError('unrecognized MIDI chunk');
      if (offset + 8 + length > bytes.length) throw new RangeError('truncated MIDI chunk');
      chunks.push({ type: type, offset: offset, length: length });
      offset += 8 + length;
      if (chunks.length > 64) break;
    }
    if (offset !== bytes.length) throw new RangeError('truncated MIDI chunk header');
    return chunks;
  }

  /* ---------- LilyPond percussion score ---------- */

  function validateBytes(bytes) {
    if (!Array.isArray(bytes) && !ArrayBuffer.isView(bytes)) throw new TypeError('bytes must be an array or typed byte array');
    if (!Number.isSafeInteger(bytes.length) || bytes.length > 4194304) throw new RangeError('byte array exceeds 4 MiB');
    for (var index = 0; index < bytes.length; index++) {
      if (!Number.isInteger(bytes[index]) || bytes[index] < 0 || bytes[index] > 255) throw new TypeError('byte values must be integers from 0 to 255');
    }
  }

  function lilySafe(text, fallback) {
    var value = safeText(text, fallback, 60);
    return value.replace(/["\\{}%]/g, ' ').replace(/\s+/g, ' ').trim() || fallback;
  }

  function exportLilyPond(tracks, bpm, title) {
    var normalized = normalizeTracks(tracks);
    if (normalized.length === 0) throw new RangeError('at least one track is required');
    var rate = bpm === undefined ? DEFAULT_BPM : assertPositive(bpm, 'bpm');
    if (!Number.isInteger(rate)) throw new RangeError('LilyPond tempo must be an integer BPM');
    var analysis = analyzePolyrhythm(normalized, rate);
    var heading = lilySafe(title, 'BeatGrid Study');
    var lines = [];

    lines.push('\\version "2.24.0"');
    lines.push('% BeatGrid ' + VERSION + ' percussion score');
    lines.push('% Silent notation export. Compile with: lilypond score.ly');
    lines.push('% Tempo: ' + rate + ' BPM. Step unit: one sixteenth note.');
    lines.push('% Polymetric phase cycle: ' + analysis.cycleSteps + ' steps, ' + analysis.cycleSeconds.toFixed(3) + ' seconds.');
    normalized.forEach(function (t) {
      lines.push('% ' + t.name + ': ' + t.formula + ', MIDI note ' + t.note);
    });
    lines.push('');
    lines.push('\\header {');
    lines.push('  title = "' + heading + '"');
    lines.push('  subtitle = "Euclidean polymetric study at ' + rate + ' BPM"');
    lines.push('  tagline = ##f');
    lines.push('}');
    lines.push('');
    lines.push('\\score {');
    lines.push('  <<');

    normalized.forEach(function (t) {
      var instrument = lilySafe(t.name, 'Track');
      var shortName = lilySafe('E(' + t.pulses + ',' + t.steps + ')', 'E');
      var drum = DRUM_NAMES[t.note] || 'sn';
      var tokens = [];
      var reps = Math.max(1, Math.round(analysis.cycleSteps / t.steps));
      for (var r = 0; r < reps; r++) {
        for (var s = 0; s < t.steps; s++) {
          tokens.push(t.pattern[s] ? drum + '16' : 'r16');
        }
      }
      lines.push('    \\new DrumStaff \\with {');
      lines.push('      instrumentName = "' + instrument + '"');
      lines.push('      shortInstrumentName = "' + shortName + '"');
      lines.push('    } {');
      lines.push('      \\time ' + t.steps + '/16');
      lines.push('      \\tempo 4 = ' + rate);
      lines.push('      \\drummode {');
      for (var k = 0; k < tokens.length; k += 8) {
        lines.push('        ' + tokens.slice(k, k + 8).join(' '));
      }
      lines.push('        \\bar "|."');
      lines.push('      }');
      lines.push('    }');
    });

    lines.push('  >>');
    lines.push('  \\layout {');
    lines.push('    \\context {');
    lines.push('      \\Score');
    lines.push('      \\remove "Timing_translator"');
    lines.push('      \\remove "Default_bar_line_engraver"');
    lines.push('    }');
    lines.push('    \\context {');
    lines.push('      \\DrumStaff');
    lines.push('      \\consists "Timing_translator"');
    lines.push('      \\consists "Default_bar_line_engraver"');
    lines.push('    }');
    lines.push('  }');
    lines.push('}');
    return lines.join('\n') + '\n';
  }

  /* ---------- public API ---------- */

  return {
    VERSION: VERSION,
    PRESETS: PRESETS,
    DEFAULT_NOTES: DEFAULT_NOTES,
    DEFAULT_PPQ: DEFAULT_PPQ,
    DEFAULT_BPM: DEFAULT_BPM,
    DEFAULT_CHANNEL: DEFAULT_CHANNEL,
    DEFAULT_STEPS_PER_BEAT: DEFAULT_STEPS_PER_BEAT,
    MAX_TRACK_HUES: MAX_TRACK_HUES,
    MAX_STEPS: MAX_STEPS,
    MAX_CYCLE_STEPS: MAX_CYCLE_STEPS,
    DRUM_NAMES: DRUM_NAMES,
    euclideanRhythm: euclideanRhythm,
    rotateVector: rotateVector,
    normalizeTracks: normalizeTracks,
    expandPattern: expandPattern,
    hammingDistance: hammingDistance,
    evennessIndex: evennessIndex,
    canonicalRotation: canonicalRotation,
    canonicalVector: canonicalVector,
    canonicalJson: canonicalJson,
    describePattern: describePattern,
    exportPattern: exportPattern,
    importPattern: importPattern,
    inspectPattern: inspectPattern,
    validateSession: validateSession,
    exportSession: exportSession,
    importSession: importSession,
    metricalWeight: metricalWeight,
    syncopationIndex: syncopationIndex,
    analyzePolyrhythm: analyzePolyrhythm,
    encodeMidiFile: encodeMidiFile,
    exportLilyPond: exportLilyPond,
    vlqEncode: vlqEncode,
    vlqDecode: vlqDecode,
    hexDump: hexDump,
    describeMidiChunks: describeMidiChunks,
    microsPerQuarter: microsPerQuarter,
    gcd: gcd,
    lcm: lcm,
    lcmAll: lcmAll
  };
});
