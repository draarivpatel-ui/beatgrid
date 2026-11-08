# BeatGrid

A mathematical Euclidean rhythm studio, polymetric phase-cycle analyzer, Standard MIDI File compiler, and LilyPond percussion notation exporter.

BeatGrid is a strictly silent tool. It computes binary onset vectors, draws visual analysis, and writes `.mid` and `.ly` files. It never plays sound, never opens an audio context, and never uses WebAudio. It has zero dependencies, makes zero network requests, and runs fully offline from a local `file://` open or any static host.

Open [`index.html`](index.html) directly in a browser, or serve the folder with any static file server. The live deployment is on GitHub Pages at `https://draarivpatel-ui.github.io/beatgrid/`.

## Contents

| File | Purpose |
| --- | --- |
| `rhythm.js` | UMD engine. Bjorklund, phase analysis, SMF encoder, LilyPond exporter, presets. |
| `index.html` | Workspace markup. |
| `style.css` | Light and dark themes, responsive layout, print stylesheet. |
| `app.js` | Browser controller for the editor, charts, tables, and downloads. |
| `test.js` | 97 `node:test` cases. |
| `LICENSE` | MIT. |

## The mathematics

### Bjorklund's algorithm, E(k, n, rot)

A Euclidean rhythm distributes `k` onsets as evenly as possible over `n` equal time cells. Bjorklund's algorithm, borrowed from the Euclidean algorithm for the greatest common divisor and from spallation source physics, produces the maximally even binary word.

Start with `k` singleton groups containing `1` and `n - k` singleton groups containing `0`. Call these the one side and the zero side:

```
E(3,8):  [1] [1] [1]   |   [0] [0] [0] [0] [0]
```

While the zero side holds more than one group, let `m` be the smaller of the two group counts. Append the first `m` zero-side groups to the first `m` one-side groups. Leftover groups from both sides become the new zero side. This is the interleaving step:

```
round 1:  [1 0] [1 0] [1 0]  |  [0] [0]        m = 3
round 2:  [1 0 0] [1 0 0]    |  [1 0]          m = 2 (zero side now has 1 group)
```

Concatenate the one side followed by the zero side. Flattening gives the result:

```
E(3,8) = 1 0 0 1 0 0 1 0     the Cuban tresillo, 3 + 3 + 2
```

For the West African bell E(7,12) the same procedure yields `101101011010`, a word of five `10` groups and two `1` groups. In general the inter-onset gaps take at most two distinct values that differ by exactly one, which is the formal definition of maximal evenness. When `gcd(k, n) = 1`, the distribution is a perfect necklace.

`euclideanRhythm(pulses, steps, rotation)` accepts a third argument `rot` that cyclically shifts the finished word right by `rot` cells. Negative rotations wrap. Rotation preserves the multiset of inter-onset gaps, so it changes the phase of the rhythm without changing its shape. All `n` rotations of E(k, n) are available, which is what makes the phase wheel useful.

Canonical results, all covered by the test suite:

| Rhythm | Vector | Grouping |
| --- | --- | --- |
| Tresillo E(3,8) | `10010010` | 3 + 3 + 2 |
| Cinquillo E(5,8) | `10110110` | 2 + 1 + 2 + 1 + 2 |
| Bossa Nova E(5,16) | `1001001001001000` | 3 + 3 + 3 + 3 + 4 |
| West African Bell E(7,12) | `101101011010` | 2 + 2 + 1 + 2 + 2 + 2 + 1 |
| Aksak 9/8 E(4,9) | `101010100` | 2 + 2 + 2 + 3 |

### Polymetric phase cycles

Each track has its own period `n_i`. A set of tracks repeats together only after

```
L = lcm(n_1, n_2, ..., n_m)
```

steps, the least common multiple of the step counts. With `s` steps per beat and tempo `B` beats per minute, one step lasts `60 / (B * s)` seconds, so the full phase cycle lasts `L * 60 / (B * s)` seconds. The default grid uses `s = 4` sixteenth notes per beat. For E(3,8), E(7,12), and E(4,9) the cycle is `lcm(8, 12, 9) = 72` steps, or 9 seconds at 120 BPM.

Each pattern is tiled out to `L` steps. From these expanded vectors the analyzer computes:

* **Coincidence matrix**: `C[i][j]` counts steps where both tracks `i` and `j` have an onset. The diagonal `C[i][i]` is track `i`'s own onset count over the cycle. It is symmetric and bounded by `L`.
* **Pairwise Hamming distance**: the number of the `L` positions where the two expanded vectors disagree, with the disagreement rate as distance divided by `L`.
* **Coincidence steps**: positions where two or more tracks strike together, plus the density of such steps over the cycle.
* **Syncopation index**: a Keith style weighted version of the Longuet-Higgins and Lee measure. Metrical weight on the sixteenth grid is 4 for the bar downbeat, 3 for quarter-note beats, 2 for eighth-note divisions, and 1 for remaining sixteenths. An onset at a weak position is syncopated when the nearest following metrically stronger position is empty; it contributes the difference of the two weights. The downbeat cannot be syncopated because no stronger position follows it.

### Standard MIDI File encoding

`encodeMidiFile` produces an SMF **Format 0** file: one header chunk and exactly one track chunk, with all events merged into a single time-ordered stream. Layout:

```
MThd  00 00 00 06  00 00  00 01  dd dd
MTrk  ll ll ll ll  <events>
```

* `MThd` declares length 6, format `0`, one track, and a positive 16-bit division `dd dd` equal to ticks per quarter note (PPQ). The high bit of the first division byte is clear, so this is metrical time rather than SMPTE.
* `MTrk` declares its payload length in four big-endian bytes.
* Every event is preceded by a **variable-length quantity (VLQ)** delta time. A VLQ is a base-128 big-endian integer: the low 7 bits of each byte hold data and bit 7 is set on every byte except the last. For example 0 is `00`, 127 is `7F`, 128 is `81 00`, 8192 is `C0 00`, and `0x0FFFFFFF` is `FF FF FF 7F`.
* Tempo meta event `FF 51 03 tt tt tt` carries microseconds per quarter note as `round(60,000,000 / BPM)`. At 120 BPM that is 500000, encoded `07 A1 20`. Time signature `FF 58 04 04 02 18 08` and a track name `FF 03` are also included.
* Each onset becomes `9c nn vv` (note-on) at its step tick and `8c nn 00` (note-off) at `tick + gate * ticksPerStep`. Channel `c = 9` is the General MIDI percussion channel, index 9 in the status byte. Duplicate events at the same tick, status, and note are deduplicated.
* The stream ends with `FF 2F 00`, end of track.

Events are sorted by absolute tick, then by a fixed order so note-offs at a tick precede note-ons and meta events keep their intended position. The encoder returns a `Uint8Array`; nothing is written to disk by the library itself.

### LilyPond export

`exportLilyPond` emits one `DrumStaff` per track in `\drummode`, with `bd16`, `sn16`, `hh16`, `cb16`, and similar drum names mapped from MIDI note numbers. Rests are `r16`. Each staff uses `\time n/16` for its own step count and repeats its pattern out to the shared LCM length, so all staves end together. Timing translators are moved from the Score context to each DrumStaff so independent time signatures are legal. The output is plain text with no sound.

## Node and CLI examples

Everything is CommonJS compatible, and there is nothing to install.

```js
const R = require('./rhythm.js');

// 1. Generate a canonical Euclidean vector.
console.log(R.euclideanRhythm(3, 8).join(''));             // 10010010
console.log(R.euclideanRhythm(7, 12, 1).join(''));         // rotated bell

// 2. Analyze a polymetric set.
const tracks = [
  { name: 'Tresillo', pulses: 3, steps: 8, note: 36 },
  { name: 'Bell',     pulses: 7, steps: 12, note: 56 },
  { name: 'Aksak',    pulses: 4, steps: 9, note: 45 }
];
const a = R.analyzePolyrhythm(tracks, 120);
console.log(a.cycleSteps, a.cycleSeconds);                 // 72, 9
console.log(a.coincidenceMatrix);
console.log(a.hammingDistances);
console.log(a.syncopation.perTrack);

// 3. Compile a Standard MIDI File and write it.
const fs = require('node:fs');
const midi = R.encodeMidiFile(tracks, 120, 480, { gate: 0.5 });
fs.writeFileSync('study.mid', midi);
console.log(R.describeMidiChunks(midi));
console.log(R.hexDump(midi, 16));

// 4. Export LilyPond notation.
fs.writeFileSync('score.ly', R.exportLilyPond(tracks, 120, 'Phase Study'));

// 5. Inspect VLQ round trips.
const bytes = Uint8Array.from(R.vlqEncode(12345));
console.log(bytes, R.vlqDecode(bytes, 0));
```

Run the whole suite:

```sh
node --test test.js
```

Compile the notation locally if LilyPond is installed:

```sh
lilypond score.ly
```

In the browser, load `rhythm.js` with a script tag and use the global `BeatGrid`:

```html
<script src="rhythm.js"></script>
<script>
  console.log(BeatGrid.euclideanRhythm(5, 16).join(''));
</script>
```

The module also registers with AMD when a `define` function is present.

## Workspace features

* Multi-track step grid editor. Click a cell to toggle an onset; a manual vector replaces the generated Euclidean pattern for that track. Edit `k`, `n`, `rot`, and the MIDI note directly.
* Concentric SVG phase polygon wheel. One ring per track over a shared angular axis of one full LCM cycle, with per-dot hover and keyboard focus tooltips, a legend, and a table-view twin.
* Coincidence matrix with a single-hue sequential scale, pairwise Hamming distance table, and a per-track syncopation chart with a data table.
* LilyPond source preview with copy and `.ly` download.
* `.mid` binary download plus a hex inspector with adjustable line width, chunk filtering, and a chunk layout table.
* Light and dark themes, a selected dark palette rather than an inverted one, an optional texture fill for print and color vision accessibility, and a print stylesheet.
* Up to eight tracks, using eight fixed categorical color slots in a validated order.

## Validation

`node --test test.js` runs 97 tests covering canonical Bjorklund vectors across all `k` and `n` up to 32, maximal evenness of inter-onset gaps, edge cases and argument validation, rotation invariance, GCD and LCM, cycle seconds, coincidence and Hamming math against brute force counts, syncopation, VLQ round trips and boundaries, every SMF header field, a full parse of the MTrk event stream, tempo bytes at multiple BPM values, LilyPond structure and escaping, presets, and the public API.

The categorical palette was checked with a six-check validator in both light and dark modes for lightness band, chroma floor, protanopia and deuteranopia separation, normal-vision separation, and contrast against the chart surface. Light mode carries a contrast warning for three slots, so the workspace ships direct labels and a table view as the relief channel.

## License

MIT. See [`LICENSE`](LICENSE).
