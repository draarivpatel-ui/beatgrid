# Contributing to BeatGrid

Thanks for your interest in BeatGrid. This project is a mathematical Euclidean
rhythm drum computer, polymetric phase-cycle analyzer, Standard MIDI File
Format 0 compiler, and LilyPond percussion score studio. It is deliberately,
strictly silent: it computes, draws, and writes files, and it never opens an
audio context.

## Ground rules

- Be respectful and constructive. This project follows the Contributor
  Covenant, found in `CODE_OF_CONDUCT.md`.
- Keep the project dependency free. No `node_modules`, build steps, or runtime
  libraries. Node builtins and the `node:test` runner are fine.
- Keep it offline and silent. No network requests, no CDN assets, no analytics,
  and no WebAudio calls of any kind.
- Musical output must be exact. Bjorklund patterns, tempo maps, and MIDI byte
  layouts are canonical, so a change to them needs the reference you followed
  and a test that pins the resulting bytes or string.

## Development setup

Requirements:

- Node.js 22 or newer (the test runner is `node --test`)
- A modern browser for manual verification
- Optional: LilyPond and a MIDI monitor to confirm written files

```sh
git clone https://github.com/draarivpatel-ui/beatgrid.git
cd beatgrid
node --test
```

Open `index.html` directly from disk, or serve the folder with any static
server:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

## How the code is organised

| File | Role |
| --- | --- |
| `rhythm.js` | The engine: Bjorklund E(k,n), phase and polymetry analysis, MIDI writing, and LilyPond generation |
| `app.js` | UI wiring: step matrix, phase polygon, and score sheet surfaces |
| `index.html`, `style.css` | The studio shell and its styling |
| `test.js` | The test suite |

`rhythm.js` is a UMD module, so `require('./rhythm.js')` works in Node and
`window.BeatGrid` is available in the browser. Match that pattern in new
modules.

## Coding standards

- Use 2-space indentation and single quotes, matching the surrounding file.
- Prefer `const`, and use `let` only when reassignment is required.
- Keep functions small and single purpose. Name them after what they do.
- No comments that restate the code. Comment the reason, the musical or format
  reference, or the non-obvious trade-off.
- Treat em-dashes and en-dashes as a defect in prose and identifiers. Use
  commas, parentheses, or a plain hyphen instead.
- Never swallow errors silently. Fail loudly with an actionable message.
- Keep rhythm and phase logic pure and deterministic. No randomness, no
  wall-clock reads, no iteration order that depends on object key insertion.

## Testing the engine

Assert canonical named patterns exactly, as the existing suite does for
tresillo, cinquillo, and bossa nova clave. For MIDI and LilyPond output, assert
the actual bytes or strings, not just that a file was produced.

## Opening a pull request

1. Fork the repository and create a branch from `main`.
2. Make your change with tests. Every bug fix should include a regression test
  that fails before your fix.
3. Run the full suite locally: `node --test`.
4. Update documentation where a pattern, format, or default changed.
5. Open the PR against `main` with:
   - a short summary of what changed and why,
   - the commands you ran and their result,
   - screenshots for UI changes,
   - the musical or file-format reference you followed.
6. Keep the PR small enough to review in one sitting, and respond to review
   promptly.

Commit messages: use a short imperative subject line under 72 characters. Put
the reasoning in the body, not the subject.

## Reporting bugs

Open an issue with the smallest reproduction you can manage: the parameters or
script, the steps you ran, what you expected, and what happened instead. State
the canonical pattern or file-format clause you compared against. Security
issues follow `SECURITY.md` instead.
