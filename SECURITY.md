# Security policy

## Reporting a vulnerability

Use the private GitHub Security Advisory form at [Report a vulnerability](https://github.com/draarivpatel-ui/beatgrid/security/advisories/new). Do not open a public issue, pull request or discussion with exploit details.

Never include a live secret, token, cookie, private key, victim hostname or proprietary payload in a report. Use synthetic values and redacted transcripts.

## Supported versions

| Version | Status |
| --- | --- |
| latest `main` | Supported |

Security fixes are applied to the latest state of the default branch.

## Scope

This policy covers the static BeatGrid browser studio, including session and pattern JSON import, Euclidean rhythm analysis, MIDI and LilyPond export, polyrhythm brief export, local persistence and URL hash restoration.

In scope:

- A cross-site scripting or HTML injection path through session JSON, pattern descriptors, lab state, share links, exports or browser rendering.
- A share-link decoder or serialization flaw that bypasses validation, corrupts another session or executes attacker-controlled code.
- A MIDI, LilyPond, JSON, CSV or Markdown export flaw that writes attacker-controlled active content or spreadsheet formulas into generated output.
- A local persistence or browser-state flaw that loads attacker-controlled application data across sessions without validation.

Out of scope:

- Browser vulnerabilities, operating system compromise or physical access to the machine.
- Damage caused by modified copies of the static application that do not come from this repository.
- The documented accuracy limits of illustrative rhythm metrics, unless a report shows a specific validation or output integrity failure.

## Coordinated disclosure

- Acknowledgment: within 3 business days.
- Initial triage: within 14 calendar days.
- Fix or mitigation target: within 90 calendar days for confirmed reports.
- Coordinated public disclosure: up to 90 days by default, adjusted by mutual agreement when exploitation or user risk requires a different date.
