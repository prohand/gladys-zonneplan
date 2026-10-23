# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.2] - 2026-10-19

- Maintenance release, no functional change.

## [0.1.1] - 2026-10-19

### Added

- Zonneplan sign-in with the code Zonneplan e-mails (no password), from the
  Configuration screen: "Send me a sign-in code", then "Sign in with the code".
  The tokens are kept in `/data`, owner-only, and refreshed automatically.
- One Gladys device per installation of the account: electricity price (now,
  next slot, tariff group, sustainable share), gas price, P1 meter (power drawn
  from and returned to the grid), solar panels (power, total production), home
  battery (level, charge and discharge power) and charge point (power, energy of
  the session, "Charge now" switch).
- Hourly or quarter-hourly electricity prices.
- Scene triggers: tariff group changed, price below zero, tomorrow's prices
  published, charging started, charging stopped.
- Scene actions: read the price, find the cheapest period of a given length,
  charge now, stop charging.
- Dashboard widgets: "Zonneplan prices" (price curve, cheapest and most expensive
  slot) and "Zonneplan overview" (live grid, solar, battery and charge point,
  charge buttons).
- Cloud transport badge on every device, flagged degraded while Zonneplan slows
  the calls down.
- English, French, German and Spanish texts and documentation.
- CI (Prettier, ESLint, tests on Node 22 and 24, store admission checks, Docker
  build), Release workflow, multi-arch image build, GitHub Releases and
  Dependabot.
- `SECURITY.md` and `CLAUDE.md`.

[Unreleased]: https://github.com/prohand/gladys-zonneplan/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/prohand/gladys-zonneplan/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/prohand/gladys-zonneplan/releases/tag/v0.1.1
