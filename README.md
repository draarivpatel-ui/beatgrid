# BeatGrid

An offline, silent studio for Euclidean rhythms, cycle analysis, and MIDI and LilyPond file export. Open [index.html](index.html) directly in a browser. There is no build step, dependency install, audio playback, or network request from the application.

**Live demo:** [https://aariv.me/beatgrid/](https://aariv.me/beatgrid/)

## What you can do

- Add up to eight voices from presets or editable pulse, length, rotation, and MIDI note settings.
- Toggle individual pads into a manual pattern and restore a voice to its Euclidean form. Arrow keys move between pads, Space or Enter toggles, and every edit is announced in a live region.
- Inspect cyclic onset gaps, onset density, step evenness, and the shortest repeating vector.
- Compare full-cycle coincidence counts, Hamming distances, and an illustrative syncopation score.
- Download a validated session JSON file that preserves manual and Euclidean voices, tempo, title, gate, notes, channels, and velocities. Paste the JSON to restore it.
- Download a canonical pattern JSON set recording each voice's vector, least-rotation canonical form, gap layout, evenness, syncopation, and MIDI voice settings. Paste it back to restore the voices as manual tracks.
- Export MIDI Format 0, inspect its chunk lengths and bytes, or download LilyPond percussion source.
- Switch themes, show a step ledger, enable hatch fills, print the workspace, and drive the whole studio from the keyboard (shortcut list in the editor panel). Single-key shortcuts can be switched off; the choice persists.

## Presets

Each preset adds a voice. These are algorithmic patterns; the neutral study names do not claim to reproduce a complete musical tradition.

| Preset | Formula | Vector | Cyclic onset gaps |
| --- | --- | --- | --- |
| Tresillo | E(3,8) | `10010010` | 3 + 3 + 2 |
| Cinquillo | E(5,8) | `10110110` | 2 + 1 + 2 + 1 + 2 |
| Five in sixteen | E(5,16) | `1001001001001000` | 3 + 3 + 3 + 3 + 4 |
| Seven in twelve | E(7,12) | `101101011010` | 2 + 1 + 2 + 2 + 1 + 2 + 2 |
| Four in nine | E(4,9) | `101010100` | 2 + 2 + 2 + 3 |

The initial session contains Tresillo, Seven in twelve, and Four in nine. Their declared lengths align after 72 steps, which is 9 seconds at 120 BPM.

## Computation and limits

Bjorklund's grouping algorithm generates a binary onset vector. Rotation moves it right, with negative rotations wrapping around. The engine supports lengths from 1 to 64. Direct engine calls saturate pulses above the length; session imports reject that input.

The shared analysis horizon is the LCM of the declared voice lengths. A pattern can repeat sooner, which the shortest-repeat inspector reports. Horizons above 4096 steps are rejected before expansion. Use lengths with common factors to reduce the horizon.

One step lasts `60 / (BPM * stepsPerBeat)` seconds. The UI uses four steps per beat. Coincidence and Hamming matrices use every step in the shared horizon. The ledger shows the first 96 steps. Long wheel diagrams sample markers at a disclosed stride, with at most about 128 markers per ring.

Syncopation uses weights 4, 3, 2, and 1 for progressively weaker positions in 4/4. A hit contributes a weight difference if its nearest stronger following position is empty. Each voice is evaluated over the joint cycle of its length and the 16-step meter. This is an illustrative metric, not a claimed implementation of a published index. Compare per-onset values when voice meter cycles differ. Small adjacent gap spread is a useful diagnostic and alone does not prove maximal evenness.

Step evenness is a normalized score in [0, 1]: the summed absolute deviation of cyclic onset gaps from the ideal gap n/k, divided by the worst packing of the same density. A score of 1 requires k to divide n. Euclidean vectors always attain the maximum for their density, verified exhaustively up to length 12 in the test suite.

### Pattern descriptors

`describePattern` and `exportPattern` record one voice as a `beatgrid/pattern` JSON object: its vector as entered, the canonical least rotation from Booth's algorithm (shared by every rotation of the pattern), onset gaps, evenness, the syncopation score, and its MIDI note, channel, and velocity. `canonicalJson` sorts object keys at every depth, so equal descriptors serialize to identical bytes. `importPattern` reads a single descriptor or a `beatgrid/pattern-set` back into manual voices, with the vector string as the authoritative content; voice fields are validated and carried through, and older timing-only records import with default voice settings. The workspace export button writes the whole voice list as one canonical set.

### Export correctness

MIDI contains one MThd header and one MTrk chunk, tempo and 4/4 metadata, note-on and note-off pairs, and end-of-track. Absolute step boundaries are rounded from rational PPQ positions, which avoids accumulated per-step rounding drift. End-of-track is at the cycle boundary, without an extra gate tail. Coincident duplicate channel/note events use the highest velocity, and note-offs precede retriggers at the same tick.

The UI and session format accept integer tempos from 20 to 300 BPM, integer PPQ from 24 to 960, and gates 0.25, 0.5, 0.75, or 1. The MIDI API supports PPQ up to 32767, requires at least one tick per step, and rejects unrepresentable tempo metadata.

LilyPond source targets version 2.24, emits an independent n/16 DrumStaff for each voice, includes tempo declarations, and repeats voices to the shared horizon. Source structure and note/rest counts are tested. The LilyPond compiler has not been run.

### Session format

```json
{
  "schema": "beatgrid/session",
  "version": 1,
  "title": "Study",
  "bpm": 120,
  "ppq": 480,
  "gate": 0.5,
  "tracks": [
    { "name": "Kick", "pulses": 3, "steps": 8, "rotation": 0, "note": 36 },
    { "name": "Manual", "pattern": [0, 1, 0, 1], "note": 42 }
  ]
}
```

Channel and velocity default to 9 and 96. Imports validate schema, version, numeric bounds, binary cells, MIDI ranges, voice count, and shared horizon before changing the workspace. Unknown fields are dropped. Session text is limited to 128 KiB, pattern text to 64 KiB. Invalid controls clear previews and disable exports until corrected. A rejected import leaves the workspace, previews, and downloads untouched; after a successful import the textarea is rewritten to the canonical session file that was applied.

## Node usage

```js
const R = require('./rhythm.js');
const tracks = [
  { name: 'Tresillo', pulses: 3, steps: 8, note: 36 },
  { name: 'Seven in twelve', pulses: 7, steps: 12, note: 56 },
  { name: 'Four in nine', pulses: 4, steps: 9, note: 45 }
];
const analysis = R.analyzePolyrhythm(tracks, 120);
console.log(analysis.cycleSteps, analysis.cycleSeconds); // 72, 9
console.log(R.inspectPattern(R.euclideanRhythm(3, 8)).gaps); // [3, 3, 2]
console.log(R.evennessIndex(R.euclideanRhythm(3, 8))); // 0.8
const midi = R.encodeMidiFile(tracks, 120, 480, { gate: 0.5 });
const lily = R.exportLilyPond(tracks, 120, 'Study');
const patternJson = R.exportPattern(tracks[0]); // canonical beatgrid/pattern JSON
const restored = R.importPattern(patternJson); // { name, pattern, note, channel, velocity }
```

## Verification

Run from this repository:

```sh
node --test
```

**221 tests pass, with zero failures or skipped tests.** The suite covers canonical patterns, rotations, arithmetic limits, meter phases, MIDI event timing and duplicate handling, chunk validation, LilyPond source, session round-trips, and browser controller regressions including the silent cycle playhead.

[ui.test.js](ui.test.js) executes the actual HTML and scripts with a deterministic DOM harness. It checks IDs and accessibility references, startup in both readiness states, pad editing, import rejection, invalid-input recovery, voice limits, themes, and real Blob downloads. The harness does not perform browser layout or visual rendering.

[wave3.test.js](wave3.test.js) adds property-style checks for Bjorklund invariants (including an independent slope reference compared as a canonical necklace), step evenness bounds and rotation invariance, Booth least-rotation correctness against a brute-force scan, canonical JSON determinism, SMF byte structure parsed with an independent decoder, roving-tabindex keyboard navigation, aria-live announcements, and atomic import recovery.

[wave4.test.js](wave4.test.js) covers the strict-review fixes: pattern imports validate the prospective session before mutating the workspace, pattern records round-trip MIDI voice fields and expose them on manual rows, the single-key shortcut toggle disables the global letter bindings and persists, and `canonicalJson` preserves own `__proto__` keys with exact lexicographical key order.

| File | Purpose |
| --- | --- |
| [rhythm.js](rhythm.js) | Pure UMD engine and export/session/pattern APIs |
| [app.js](app.js) | Browser controller |
| [index.html](index.html), [style.css](style.css) | Workspace and responsive/print styles |
| [test.js](test.js), [regression.test.js](regression.test.js), [ui.test.js](ui.test.js), [wave3.test.js](wave3.test.js), [wave4.test.js](wave4.test.js) | Automated verification |
| [dom-harness.cjs](dom-harness.cjs) | Local DOM, event, clock, and download fixtures |

## License

MIT. See [LICENSE](LICENSE).
