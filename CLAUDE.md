# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and to human
contributors working in this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one runtime
dependency: `@gladysassistant/integration-sdk`) for **Zonneplan**, the Dutch energy
supplier with dynamic prices. It reads the account through the Zonneplan app API
(`https://app-api.zonneplan.nl`, the API of the mobile app — there is no public API) and
publishes one Gladys device per installation: electricity price, gas price, P1 meter,
solar panels, home battery, charge point. Gladys 5.1+ adds scene triggers, scene actions
and two dashboard widgets. Cloud only (`"transports": ["cloud"]`).

Started from the official template
[GladysAssistant/integration-template-js](https://github.com/GladysAssistant/integration-template-js);
the workflows are the ones of [prohand/gladys-devmel](https://github.com/prohand/gladys-devmel).

## Commands

```bash
npm install
npm test                                    # node --test (built-in runner)
node --test test/sync.test.js               # one file
node --test --test-name-pattern "tariff"    # tests whose name matches
npm run lint                                # eslint .
npm run format:check                        # prettier --check . (CI gate)
npm run format                              # prettier --write .
npx github:GladysAssistant/integration-store .   # store admission checks
```

CI runs `format:check`, `lint`, `test` on Node 22 and 24; pull requests also run the store
checks and build the image. Releases: **Actions → Release** only (bumps `package.json`,
manifest `version` + `docker_image`, rolls the changelog, tags, builds, publishes the
GitHub Release).

## Architecture

```
index.js                     SDK wiring only: handlers registered before connect()
src/config.js                DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/i18n.js                  LANGUAGES (en, fr, de, es), pick/localize, Amsterdam time formats
src/storage.js               token file in /data (0600), in-memory store for the tests
src/zonneplan/client.js      HTTP client: e-mailed code sign-in (PKCE), refresh, 429 pause
src/zonneplan/account.js     user-accounts/me -> installations (one per supported contract)
src/zonneplan/prices.js      price charts -> slots; slot at, next, extremes, cheapest period
src/zonneplan/readings.js    P1 / solar / battery / charge point reads + charge commands
src/devices/<kind>.js        one blueprint per installation kind (buildDevice, states...)
src/sync.js                  the minute loop: read, publish states, badges, status, triggers
src/session.js               the sign-in actions of the Configuration screen
src/capabilities/scenes.js   scene triggers (detection) and scene actions
src/capabilities/widgets.js  the energy_prices and zonneplan_overview widgets
docs/{en,fr,de,es}.md        user documentation, re-hosted by Gladys (kept in sync)
test/                        node --test, SDK fake Gladys + test/helpers/fakeZonneplan.js
```

### Invariants worth knowing

- **Sign-in has no password.** `POST /oauth/authorize-challenge` with a PKCE challenge
  answers **403 `otp_required`** (the nominal case: the code is e-mailed), then the code
  gives an `authorization_code` exchanged at `/oauth/token`. The pending sign-in lives in
  memory only (15 minutes).
- **Tokens are not configuration.** They live in `/data/zonneplan-tokens.json` (mode
  0600), are refreshed 60 s before expiry and once on a 401, one refresh at a time (the
  refresh token is single-use). A refused refresh deletes them: the user signs in again.
  Never log a token, a code or the body of an error answer.
- **Amounts are 1e-7 EUR** (`AMOUNT_FACTOR`), the sustainability score is per mille, the
  battery level per mille, energies in Wh: convert in `prices.js` / `readings.js` only.
- **Times are Amsterdam's** (`ZONNEPLAN_TIME_ZONE`): "today", `HH:mm` outputs.
- **The price changes on the clock, not on the API**: states are recomputed every minute
  from the cached slots; the API is read every 15 min (prices), at `poll_frequency`
  (installations) and every hour (account). `publishChangedStates` with a 30 min
  heartbeat keeps under the 300 states/minute of Gladys.
- **A 429 pauses every call** until `Retry-After`: the badge stays `cloud` with
  `degraded: true`, the connection status says until when.
- **No Gladys polling**: devices are published without `should_poll`; the loop is ours.
- **External ids are forever**: tariffs are keyed on the connection uuid (a renewed
  contract changes uuid), equipment on its contract uuid. Never a label.
- **Every feature declares `min`/`max`** (NOT NULL in Gladys).
- **Scene triggers fire once per transition**; the first look after a start only records
  the situation. Scene actions never fire triggers (no loops).
- **Widget budget**: ≤ 8 components, 6 tiles, 1 focal, 1 status, 4 buttons —
  `test/widgets.test.js` asserts `validateWidgetContent(content)` is `[]`.
- Trigger, action, widget, config and feature keys are stored by users: never rename them.

## Rules

- **Versions belong to the Release workflow.** Never edit `version` in `package.json` or
  in the manifest, nor the `docker_image` tag, by hand. `test/manifest.test.js` checks
  they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`). Never write a
  version heading: the Release workflow moves the section.
- **Manifest.** Texts are multi-language objects `{ en, fr, de, es }` — `label`,
  `description`, `placeholder` alike. The catalog `description` holds 10 to 100
  characters per language. `test/manifest.test.js` ties the manifest to the code
  (defaults, actions, scene and widget handlers): change both sides together.
- **User-facing text** is in English, French, German and Spanish: action messages,
  statuses, widget texts (built with `src/i18n.js`), and `docs/en.md`, `docs/fr.md`,
  `docs/de.md`, `docs/es.md`, kept in sync.
- **The container rootfs is read-only**: write only under `/data`.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why, in English.
  Tests never touch the network.
