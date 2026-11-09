# BeatGrid

A mathematical Euclidean rhythm drum computer, polymetric phase-cycle analyzer, Standard MIDI File Format 0 compiler, and LilyPond percussion score studio.

BeatGrid is a strictly silent instrument. It computes binary onset vectors, draws geometric phase analysis on a hardware-inspired step matrix and engraved paper sheet surface, and writes `.mid` and `.ly` files. It never plays sound, never opens an audio context, and never calls WebAudio. It has zero dependencies, makes zero network requests, and runs completely offline from a local `file://` open or any static file server.

Open [`index.html`](index.html) directly in a browser, or serve the folder with any static server. The live deployment is at `https://aariv.me/beatgrid/` and mirrored on GitHub Pages at `https://draarivpatel-ui.github.io/beatgrid/`.

## Contents

| File | Purpose |
| --- | --- |
| `rhythm.js` | UMD engine: Bjorklund `E(k, n, rot)`, LCM phase analysis, SMF Format 0 encoder, LilyPond exporter, world presets. |
| `index.html` | Hardware drum-computer and engraved score studio markup. |
| `style.css` | Anodized aluminum and warm sheet-music paper themes, sharp 1px step matrix, print stylesheet. |
| `app.js` | Browser controller for the step matrix, concentric phase polygon wheel, tables, and binary exports. |
| `test.js` | 97 `node:test` cases verifying every algorithm and byte boundary. |
| `LICENSE` | MIT. |

## The mathematics

### Bjorklund's algorithm, E(k, n, rot)

A Euclidean rhythm distributes `k` onsets as evenly as possible across `n` equal time cells. Bjorklund's algorithm, adapted from the Euclidean greatest common divisor algorithm and spallation neutron source timing hardware, constructs the maximally even binary necklace.

Start with `k` singleton groups containing `1` and `n - k` singleton groups containing `0`. Call these the one side and the zero side:

```
E(3,8):  [1] [1] [1]   |   [0] [0] [0] [0] [0]
```

While the zero side holds more than one group, let `m` be the smaller of the two group counts. Append the first `m` zero-side groups to the first `m` one-side groups. Leftover groups from both sides become the new zero side:

```
round 1:  [1 0] [1 0] [1 0]  |  [0] [0]        m = 3
round 2:  [1 0 0] [1 0 0]    |  [1 0]          m = 2 (zero side now has 1 group)
```

Concatenate the one side followed by the zero side. Flattening gives the result:

```
E(3,8) = 1 0 0 1 0 0 1 0     Cuban tresillo, 3 + 3 + 2
```

For the West African bell `E(7,12)` the same procedure yields `101101011010`, a word of five `10` groups and two `1` groups. In general the inter-onset gaps take at most two distinct integer values that differ by at most 1, which is the formal definition of maximal evenness. When `gcd(k, n) = 1`, the distribution forms a prime necklace.

`euclideanRhythm(pulses, steps, rotation)` accepts a third argument `rot` that cyclically shifts the finished word right by `rot` cells. Negative rotations wrap cleanly. Rotation preserves the multiset of inter-onset gaps, changing the phase of the rhythm without altering its interval geometry.

Canonical results verified in the test suite:

| Rhythm | Vector | Grouping |
| --- | --- | --- |
| Tresillo E(3,8) | `10010010` | 3 + 3 + 2 |
| Cinquillo E(5,8) | `10110110` | 2 + 1 + 2 + 1 + 2 |
| Bossa Nova E(5,16) | `1001001001001000` | 3 + 3 + 3 + 3 + 4 |
| West African Bell E(7,12) | `101101011010` | 2 + 2 + 1 + 2 + 2 + 2 + 1 |
| Aksak 9/8 E(4,9) | `101010100` | 2 + 2 + 2 + 3 |

### Polymetric phase cycles

Each voice has its own period `n_i`. A polymetric ensemble repeats together only after

```
L = lcm(n_1, n_2, ..., n_m)
```

steps, the least common multiple of the track lengths. With `s` steps per beat and tempo `B` beats per minute, one step lasts `60 / (B * s)` seconds, so the full phase horizon lasts `L * 60 / (B * s)` seconds. The studio uses `s = 4` sixteenth notes per beat. For `E(3,8)`, `E(7,12)`, and `E(4,9)` the horizon is `lcm(8, 12, 9) = 72` steps, or `9.00` seconds at `120` BPM.

Each base pattern is tiled out to `L` steps. From these expanded vectors the analyzer computes:

* **Coincidence matrix**: `C[i][j]` counts steps where both voices `i` and `j` strike simultaneously. The diagonal `C[i][i]` is voice `i`'s total onset count across the cycle.
* **Pairwise Hamming distance**: the number of the `L` positions where two expanded vectors disagree, plus the normalized disagreement rate `distance / L`.
* **Coincidence steps**: exact step indices where two or more voices strike together, plus the overall coincidence density.
* **Syncopation index**: a Keith-weighted formulation of the Longuet-Higgins and Lee metric. Metrical weight on the sixteenth grid is `4` for the bar downbeat, `3` for quarter-note beats, `2` for eighth-note divisions, and `1` for remaining sixteenths. An onset at a weak position is syncopated when the nearest following metrically stronger position is empty, contributing the weight difference `w_strong - w_weak`.

### Standard MIDI File encoding

`encodeMidiFile` compiles a binary SMF **Format 0** file: one `MThd` header chunk and one `MTrk` track chunk with all events merged into a single time-ordered stream:

```
MThd  00 00 00 06  00 00  00 01  dd dd
MTrk  ll ll ll ll  <events>
```

* `MThd` declares length `6`, format `0`, one track, and a positive 16-bit division `dd dd` equal to ticks per quarter note (PPQ).
* `MTrk` declares its byte length as a 32-bit big-endian integer.
* Every event is preceded by a **variable-length quantity (VLQ)** delta time in base-128 big-endian form: bits `0..6` carry payload bits and bit `7` is set on every continuation byte before the final byte (`0` is `00`, `127` is `7F`, `128` is `81 00`, `8192` is `C0 00`, `0x0FFFFFFF` is `FF FF FF 7F`).
* Tempo meta event `FF 51 03 tt tt tt` encodes microseconds per quarter note as `round(60,000,000 / BPM)` (`07 A1 20` for `500,000` us at `120` BPM). Time signature `FF 58 04 04 02 18 08` and track name `FF 03` are written at tick `0`.
* Each onset emits `99 nn vv` (note-on, channel 10 / index 9) at its step tick and `89 nn 00` (note-off) at `tick + gate * ticksPerStep`.
* The stream closes with `FF 2F 00` (end of track).

### LilyPond export

`exportLilyPond` emits one `DrumStaff` per voice in `\drummode`, mapping General MIDI percussion notes to `bd16`, `sn16`, `hh16`, `cb16`, and `toml16` with `r16` rests. Each staff carries its own `\time n/16` signature and repeats out to the shared LCM horizon. `Timing_translator` and `Default_bar_line_engraver` are moved from `Score` to `DrumStaff` so polymetric staves compile cleanly in a single score.

## Node and CLI usage

```js
const R = require('./rhythm.js');

console.log(R.euclideanRhythm(3, 8).join(''));             // 10010010
console.log(R.euclideanRhythm(7, 12, 1).join(''));         // rotated bell

const tracks = [
  { name: 'Tresillo', pulses: 3, steps: 8, note: 36 },
  { name: 'Bell',     pulses: 7, steps: 12, note: 56 },
  { name: 'Aksak',    pulses: 4, steps: 9, note: 45 }
];
const a = R.analyzePolyrhythm(tracks, 120);
console.log(a.cycleSteps, a.cycleSeconds);                 // 72, 9

const fs = require('node:fs');
const midi = R.encodeMidiFile(tracks, 120, 480, { gate: 0.5 });
fs.writeFileSync('study.mid', midi);
fs.writeFileSync('score.ly', R.exportLilyPond(tracks, 120, 'Phase Study'));
```

Run the automated test suite:

```sh
node --test test.js
```

## License

MIT. See [`LICENSE`](LICENSE).
