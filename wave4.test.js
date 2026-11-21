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

test('canonicalJson drops members whose toJSON resolves to an unserializable value', () => {
  for (const bad of [undefined, () => 1, Symbol('x')]) {
    const text = R.canonicalJson({ a: { toJSON() { return bad; } }, b: 2 });
    assert.equal(text, '{"b":2}');
    assert.deepEqual(JSON.parse(text), { b: 2 });
  }
  assert.equal(R.canonicalJson({ a: { toJSON() { return undefined; } }, b: 2 }), JSON.stringify({ a: { toJSON() { return undefined; } }, b: 2 }));
  assert.throws(() => R.canonicalJson({ toJSON() { return undefined; } }), TypeError);
});

test('canonicalJson writes null for array cells whose toJSON resolves to an unserializable value', () => {
  for (const bad of [undefined, () => 1, Symbol('x')]) {
    const text = R.canonicalJson([1, { toJSON() { return bad; } }, 3]);
    assert.equal(text, '[1,null,3]');
    assert.deepEqual(JSON.parse(text), [1, null, 3]);
  }
  assert.equal(R.canonicalJson([NaN, Infinity, -Infinity, undefined]), '[null,null,null,null]');
});

test('canonicalJson resolves toJSON once per member with the member key, then sorts result keys', () => {
  const seen = [];
  const value = {
    z: { toJSON(key) { seen.push(key); return { '2': 2, '10': 10 }; } },
    a: [{ toJSON(key) { seen.push(key); return 'k' + key; } }]
  };
  assert.equal(R.canonicalJson(value), '{"a":["k0"],"z":{"10":10,"2":2}}');
  assert.deepEqual([...seen].sort(), ['0', 'z']);
  // A toJSON result's own toJSON is not consulted again (ECMA-262 resolves it once).
  assert.equal(R.canonicalJson({ a: { toJSON() { return { toJSON() { return 9; }, x: 5 }; } } }), '{"a":{"x":5}}');
});

test('canonicalJson unboxes Number, String, Boolean, and Date objects like JSON.stringify', () => {
  const text = R.canonicalJson({ a: new Number(3), b: new String('hi'), c: new Boolean(true), d: new Number(NaN) });
  assert.equal(text, '{"a":3,"b":"hi","c":true,"d":null}');
  assert.equal(R.canonicalJson(new Date('2026-01-02T03:04:05.000Z')), '"2026-01-02T03:04:05.000Z"');
});

test('canonicalJson rejects BigInt values and circular structures with a TypeError', () => {
  assert.throws(() => R.canonicalJson({ a: 10n }), TypeError);
  assert.throws(() => R.canonicalJson([10n]), TypeError);
  assert.throws(() => R.canonicalJson({ toJSON() { return 10n; } }), TypeError);
  const circ = { a: {} };
  circ.a.b = circ.a;
  assert.throws(() => R.canonicalJson(circ), TypeError);
  const self = { toJSON() { return circ; } };
  assert.throws(() => R.canonicalJson(self), TypeError);
  assert.throws(() => R.canonicalJson({ a: { toJSON() { return circ; } } }), TypeError);
});

test('canonicalJson output is always valid JSON for JSON.stringify round trips', () => {
  const values = [
    { a: { toJSON() { return undefined; } }, b: 2 },
    [{ toJSON() { return undefined; } }, new Date('2026-11-21T00:00:00.000Z')],
    { n: new Number(7), s: new String('x'), ok: new Boolean(false), d: new Date(0) },
    { deep: [{ toJSON() { return { '9': 9, '10': 10 }; } }, NaN, Infinity] },
    { f: () => 1, s: Symbol('y'), u: undefined, keep: 'yes' }
  ];
  for (const value of values) {
    const text = R.canonicalJson(value);
    assert.equal(typeof text, 'string');
    const expected = JSON.parse(JSON.stringify(value));
    const sortDeep = (node) => Array.isArray(node)
      ? node.map(sortDeep)
      : (node && typeof node === 'object'
        ? Object.fromEntries(Object.keys(node).sort().map((k) => [k, sortDeep(node[k])]))
        : node);
    assert.deepEqual(JSON.parse(text), sortDeep(expected));
  }
});

test('canonicalJson captures array length once so mid-write mutation never corrupts the output', () => {
  let a = [{ toJSON() { a.length = 1; return 9; } }, 2, 3];
  let text = R.canonicalJson(a);
  assert.equal(text, '[9,null,null]');
  assert.deepEqual(JSON.parse(text), [9, null, null]);

  a = [{ toJSON() { a.push('new'); return 9; } }, 2, 3];
  text = R.canonicalJson(a);
  assert.equal(text, '[9,2,3]');
  assert.deepEqual(JSON.parse(text), [9, 2, 3]);

  for (const fakeLength of ['abc', {}, 2.5, -1, 0, '5']) {
    const proxy = new Proxy([1, 2, 3], { get: (t, k) => (k === 'length' ? fakeLength : t[k]) });
    text = R.canonicalJson(proxy);
    assert.equal(text, JSON.stringify(proxy));
    assert.doesNotThrow(() => JSON.parse(text));
  }

  a = [1, 2, 3];
  let reads = 0;
  Object.defineProperty(a, 1, {
    enumerable: true,
    get() { reads += 1; return reads === 1 ? (a.length = 2, 'G') : 'G'; }
  });
  text = R.canonicalJson(a);
  assert.equal(text, '[1,"G",null]');
  assert.doesNotThrow(() => JSON.parse(text));
});

test('canonicalJson consults toJSON on function values like JSON.stringify does', () => {
  const f = function () {};
  f.toJSON = (key) => 'fn-' + key;
  assert.equal(R.canonicalJson({ a: f, b: 1 }), '{"a":"fn-a","b":1}');
  assert.equal(R.canonicalJson([1, f, 3]), '[1,"fn-1",3]');
  assert.equal(R.canonicalJson(f), '"fn-"');
  f.toJSON = () => ({ z: 1, a: 2 });
  assert.equal(R.canonicalJson({ k: f }), '{"k":{"a":2,"z":1}}');
  assert.equal(R.canonicalJson({ a: function () {}, b: 1 }), '{"b":1}');
});

test('canonicalJson unboxes wrappers by internal slot, not by prototype shape', () => {
  assert.equal(R.canonicalJson({ a: Object.create(Number.prototype) }), '{"a":{}}');
  assert.equal(R.canonicalJson({ a: Object.create(String.prototype) }), '{"a":{}}');
  assert.throws(() => R.canonicalJson({ a: Object.setPrototypeOf(new Number(5), null) }), TypeError);
  const n = new Number(5);
  n.valueOf = () => 'str';
  assert.equal(R.canonicalJson({ a: n }), '{"a":null}');
  const n2 = new Number(5);
  n2.valueOf = () => ({ x: 1 });
  assert.equal(R.canonicalJson({ a: n2 }), '{"a":5}');
  const s = new String('hi');
  s.valueOf = () => 'V';
  assert.equal(R.canonicalJson({ a: s }), '{"a":"hi"}');
  const b = new Boolean(true);
  b.valueOf = () => false;
  assert.equal(R.canonicalJson({ a: b }), '{"a":true}');
  const vm = require('vm');
  assert.equal(R.canonicalJson({ n: vm.runInNewContext('new Number(5)') }), '{"n":5}');
});

test('canonicalJson slot checks survive tag forgery and prototype tampering', () => {
  const tagged = new Number(5);
  tagged[Symbol.toStringTag] = 'Foo';
  assert.equal(R.canonicalJson({ a: tagged }), '{"a":5}');
  const taggedStr = new String('xy');
  taggedStr[Symbol.toStringTag] = 'Foo';
  assert.equal(R.canonicalJson({ a: taggedStr }), '{"a":"xy"}');
  assert.equal(R.canonicalJson({ a: { [Symbol.toStringTag]: 'Number' } }), '{"a":{}}');
  assert.equal(R.canonicalJson({ a: { [Symbol.toStringTag]: 'Number', valueOf() { return 42; } } }), '{"a":{}}');

  const boolValueOf = Boolean.prototype.valueOf;
  Boolean.prototype.valueOf = () => 'x';
  try {
    assert.equal(R.canonicalJson({ a: new Boolean(true) }), '{"a":true}');
  } finally {
    Boolean.prototype.valueOf = boolValueOf;
  }
  const numValueOf = Number.prototype.valueOf;
  Number.prototype.valueOf = () => 'polluted';
  try {
    assert.equal(R.canonicalJson({ a: new Number(5) }), '{"a":null}');
  } finally {
    Number.prototype.valueOf = numValueOf;
  }

  // ToNumber and ToString reject primitives their conversions cannot hold.
  const big = new Number(5);
  big.valueOf = () => 10n;
  assert.throws(() => R.canonicalJson({ a: big }), TypeError);
  const sym = new String('x');
  sym.toString = () => Symbol('s');
  assert.throws(() => R.canonicalJson({ a: sym }), TypeError);
  const bigLen = new Proxy([1, 2, 3], { get: (t, k) => (k === 'length' ? 5n : t[k]) });
  assert.throws(() => R.canonicalJson(bigLen), TypeError);
});

test('canonicalJson honours Symbol.toPrimitive on wrapper unboxing like ToPrimitive', () => {
  const n = new Number(5);
  n[Symbol.toPrimitive] = () => 42;
  assert.equal(R.canonicalJson({ a: n }), '{"a":42}');
  const s = new String('x');
  s[Symbol.toPrimitive] = () => 7;
  assert.equal(R.canonicalJson({ a: s }), '{"a":"7"}');
  const both = new Number(5);
  both.valueOf = () => 11;
  both[Symbol.toPrimitive] = () => 22;
  assert.equal(R.canonicalJson({ a: both }), '{"a":22}');
  const hinted = new Number(5);
  hinted[Symbol.toPrimitive] = (h) => (h === 'number' ? 'numhint' : 'strhint');
  assert.equal(R.canonicalJson({ a: hinted }), '{"a":null}');
  class MyNum extends Number { [Symbol.toPrimitive]() { return 33; } }
  assert.equal(R.canonicalJson({ a: new MyNum(5) }), '{"a":33}');

  const bad = new Number(5);
  bad[Symbol.toPrimitive] = () => ({});
  assert.throws(() => R.canonicalJson({ a: bad }), TypeError);
  const nonCall = new Number(5);
  nonCall[Symbol.toPrimitive] = 5;
  assert.throws(() => R.canonicalJson({ a: nonCall }), TypeError);
  const bigRes = new Number(5);
  bigRes[Symbol.toPrimitive] = () => 10n;
  assert.throws(() => R.canonicalJson({ a: bigRes }), TypeError);
  const symRes = new String('x');
  symRes[Symbol.toPrimitive] = () => Symbol('s');
  assert.throws(() => R.canonicalJson({ a: symRes }), TypeError);
});

test('canonicalJson invokes methods through Call(), not a forgeable call property', () => {
  const exotic = () => 42;
  exotic.call = () => 'forged';
  const n = new Number(5);
  n[Symbol.toPrimitive] = exotic;
  assert.equal(R.canonicalJson({ a: n }), '{"a":42}');
  const toJson = () => ({ real: 1 });
  toJson.call = () => ({ forged: true });
  assert.equal(R.canonicalJson({ a: { toJSON: toJson } }), '{"a":{"real":1}}');
  const valueOf = () => 111;
  valueOf.call = () => 'forged';
  const n2 = new Number(5);
  n2.valueOf = valueOf;
  assert.equal(R.canonicalJson({ a: n2 }), '{"a":111}');
  const realCall = Function.prototype.call;
  Function.prototype.call = function () { return 'forged'; };
  try {
    assert.equal(R.canonicalJson({ a: new Number(5) }), '{"a":5}');
    assert.equal(R.canonicalJson({ a: { x: 1 } }), '{"a":{"x":1}}');
    assert.equal(R.canonicalJson([1, 2]), '[1,2]');
  } finally {
    Function.prototype.call = realCall;
  }
});

test('canonicalJson survives platform method tampering after load', () => {
  const origSort = Array.prototype.sort;
  Array.prototype.sort = () => [];
  try {
    assert.equal(R.canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
  } finally {
    Array.prototype.sort = origSort;
  }
  const origJoin = Array.prototype.join;
  Array.prototype.join = () => 'PWN';
  try {
    assert.equal(R.canonicalJson({ a: 1, b: 2 }), '{"a":1,"b":2}');
    assert.equal(R.canonicalJson([1, 2]), '[1,2]');
  } finally {
    Array.prototype.join = origJoin;
  }
  const origSetHas = Set.prototype.has;
  Set.prototype.has = () => true;
  try {
    assert.equal(R.canonicalJson({ a: 1 }), '{"a":1}', 'polluted Set.has cannot forge a circular hit');
  } finally {
    Set.prototype.has = origSetHas;
  }
  const origStringify = JSON.stringify;
  JSON.stringify = () => 'PWN';
  try {
    assert.equal(R.canonicalJson({ q: 'a"b' }), '{"q":"a\\"b"}');
  } finally {
    JSON.stringify = origStringify;
  }
});

test('canonicalJson emits rawJSON text verbatim like the IsRawJSON slot', () => {
  if (typeof JSON.rawJSON !== 'function') return;
  assert.equal(R.canonicalJson({ x: JSON.rawJSON('123') }), '{"x":123}');
  assert.equal(R.canonicalJson([JSON.rawJSON('"s"'), 1]), '["s",1]');
  assert.equal(R.canonicalJson({ x: { toJSON: () => JSON.rawJSON('null') } }), '{"x":null}');
  assert.equal(R.canonicalJson({ x: { rawJSON: '123' } }), '{"x":{"rawJSON":"123"}}',
    'a plain object with a rawJSON property is not a slot holder');
});

test('canonicalJson serializes nesting far deeper than the call stack', () => {
  let value = 1;
  for (let i = 0; i < 100000; i += 1) value = [value];
  const text = R.canonicalJson(value);
  assert.equal(text.length, 200001);
  assert.equal(text[0], '[');
  assert.equal(text[text.length - 1], ']');
});

test('canonicalJson treats Symbol wrapper objects as plain objects like JSON.stringify', () => {
  const wrapped = Object.assign(Object(Symbol('x')), { keep: 7 });
  assert.equal(R.canonicalJson({ w: wrapped }), '{"w":{"keep":7}}');
  assert.equal(R.canonicalJson({ w: wrapped }), JSON.stringify({ w: wrapped }));
  assert.equal(R.canonicalJson(Object(Symbol('x'))), '{}');
  assert.equal(R.canonicalJson(Object(Symbol('x'))), JSON.stringify(Object(Symbol('x'))));
  assert.equal(R.canonicalJson([Object(Symbol('x'))]), '[{}]');
  assert.equal(R.canonicalJson([Object(Symbol('x'))]), JSON.stringify([Object(Symbol('x'))]));
});

test('canonicalJson array length uses ToNumber so BigInt lengths throw like native', () => {
  const bigWrapper = new Proxy([1, 2, 3], { get: (t, k) => (k === 'length' ? Object(3n) : t[k]) });
  assert.throws(() => R.canonicalJson(bigWrapper), TypeError);
  assert.throws(() => JSON.stringify(bigWrapper), TypeError);
  const bigPrimitive = new Proxy([1, 2, 3], { get: (t, k) => (k === 'length' ? 3n : t[k]) });
  assert.throws(() => R.canonicalJson(bigPrimitive), TypeError);
  assert.throws(() => JSON.stringify(bigPrimitive), TypeError);
  const numberWrapper = new Proxy([1, 2, 3], { get: (t, k) => (k === 'length' ? Object(3) : t[k]) });
  assert.equal(R.canonicalJson(numberWrapper), '[1,2,3]');
  assert.equal(R.canonicalJson(numberWrapper), JSON.stringify(numberWrapper));
  const symbolLength = new Proxy([1, 2, 3], { get: (t, k) => (k === 'length' ? Symbol('n') : t[k]) });
  assert.throws(() => R.canonicalJson(symbolLength), TypeError);
  assert.throws(() => JSON.stringify(symbolLength), TypeError);
});

test('canonicalJson internals survive Array.prototype numeric accessor pollution', () => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'rhythm.js'), 'utf8'), ctx);
  // The poisoned prototype lives only inside this realm, so the
  // node --test runner's own Array.prototype is never touched.
  const api = vm.runInContext(`
    Object.defineProperty(Array.prototype, '0', {
      get() { return 'inherited'; },
      set() {},
      configurable: true
    });
    BeatGrid
  `, ctx);
  // Sanity check: the poison is live, a plain push at index 0 is swallowed.
  assert.equal(vm.runInContext('(() => { const a = []; a.push(1); return a[0]; })()', ctx), 'inherited');
  assert.equal(api.canonicalJson({ a: 1 }), '{"a":1}');
  assert.equal(api.canonicalJson([1, 2, 3]), '[1,2,3]');
  const nested = vm.runInContext('({ a: [1, { b: [2, 3], c: "x" }], d: { e: {} } })', ctx);
  const expected = R.canonicalJson({ a: [1, { b: [2, 3], c: 'x' }], d: { e: {} } });
  assert.equal(api.canonicalJson(nested), expected);
  assert.deepEqual(JSON.parse(api.canonicalJson(nested)), { a: [1, { b: [2, 3], c: 'x' }], d: { e: {} } });
});
