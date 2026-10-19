# Zonneplan for Gladys Assistant

External integration for [Gladys Assistant](https://gladysassistant.com) that brings a
[Zonneplan](https://www.zonneplan.nl) account into Gladys: the dynamic electricity and gas
prices, the P1 meter (Zonneplan Connect), solar panels, the home battery (Nexus) and the
charge point. Built on the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js) and the
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

- **Cloud** integration (`"transports": ["cloud"]`): it talks to `app-api.zonneplan.nl`, the
  API of the Zonneplan app. Nothing to install on the network.
- **Gladys 5.1+** (scene triggers, scene actions, dashboard widgets).
- Texts and documentation in **English, French, German and Spanish**.

User documentation: [English](docs/en.md) · [Français](docs/fr.md) ·
[Deutsch](docs/de.md) · [Español](docs/es.md).

## What it does

| Surface           | Content                                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in           | E-mailed one-time code (no password), from two buttons of the Configuration screen; tokens in `/data`, refreshed automatically                            |
| Devices           | Electricity price (now, next slot, tariff group, sustainable %), gas price, P1 meter, solar panels, home battery, charge point with a "Charge now" switch |
| Scene triggers    | `tariff_group_changed`, `negative_price_started`, `next_day_prices_available`, `charging_started`, `charging_stopped`                                     |
| Scene actions     | `get_current_price`, `find_cheapest_period`, `start_boost_charging`, `stop_charging`                                                                      |
| Dashboard widgets | `energy_prices` (price curve, cheapest / most expensive slot), `zonneplan_overview` (live grid, solar, battery, charge point, charge buttons)             |
| Transport badge   | `cloud` on every device, `degraded` while Zonneplan rate-limits, `unreachable` when the session is lost                                                   |

## Project structure

```
.
├─ index.js                          # SDK bootstrap + wiring (no Zonneplan logic)
├─ src/
│  ├─ zonneplan/                     # the Zonneplan app API
│  │  ├─ client.js                   #   sign-in (e-mailed code, PKCE), refresh, 429 pause
│  │  ├─ account.js                  #   user-accounts/me -> installations
│  │  ├─ prices.js                   #   price charts -> slots, cheapest period
│  │  └─ readings.js                 #   P1, solar, battery, charge point
│  ├─ devices/                       # one Gladys device blueprint per installation kind
│  ├─ capabilities/
│  │  ├─ scenes.js                   #   scene triggers + scene actions
│  │  └─ widgets.js                  #   dashboard widgets
│  ├─ sync.js                        # the minute loop: read, publish, fire the triggers
│  ├─ session.js                     # sign-in actions of the Configuration screen
│  ├─ storage.js                     # token file in /data (0600)
│  ├─ config.js                      # defaults + normalization
│  └─ i18n.js                        # en / fr / de / es helpers, Amsterdam time
├─ docs/{en,fr,de,es}.md             # user documentation (re-hosted by Gladys)
├─ test/                             # node --test, SDK fake Gladys + fake Zonneplan API
├─ gladys-assistant-integration.json # manifest
├─ Dockerfile                        # Node 24 Alpine, non-root, read-only rootfs ready
├─ CHANGELOG.md                      # Keep a Changelog, rolled by the Release workflow
├─ CLAUDE.md                         # project rules for coding assistants & contributors
├─ SECURITY.md                       # how to report a vulnerability privately
└─ .github/
   ├─ workflows/ci.yml               # format, lint, tests (Node 22 + 24); PR: store checks + Docker build
   ├─ workflows/release.yml          # UI-driven release: bump + changelog + tag + build + GitHub Release
   ├─ workflows/build.yml            # multi-arch image (amd64 + arm64) to ghcr.io
   ├─ workflows/github-release.yml   # GitHub Release of every version tag
   ├─ scripts/changelog-release.mjs  # rolls [Unreleased] under the released version
   └─ dependabot.yml                 # npm weekly, GitHub Actions and Docker monthly
```

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="zonneplan" \
ZONNEPLAN_DATA_DIR="./data" \
LOG_LEVEL=debug \
npm start
```

The three `GLADYS_*` variables are injected by the Gladys supervisor in the container.
`ZONNEPLAN_DATA_DIR` (default `/data`) is where the tokens are kept.

## Quality checks

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # node --test: no network, no Zonneplan account needed
npx github:GladysAssistant/integration-store .   # store admission checks
```

The tests run the code against the fake Gladys of the SDK (which refuses what the host API
refuses) and a fake Zonneplan API (`test/helpers/fakeZonneplan.js`); the widget contents are
checked with `validateWidgetContent`, the manifest against the code by
`test/manifest.test.js`.

## Release

1. Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
2. **Actions → Release → Run workflow**, pick `patch`, `minor` or `major` (the first public
   release: `major`, from 0.1.0 to 1.0.0).
3. The workflow bumps `package.json` and the manifest (`version` + `docker_image`), rolls the
   changelog, pushes the `vX.Y.Z` tag, builds the `linux/amd64` + `linux/arm64` image to
   `ghcr.io/prohand/gladys-zonneplan` and publishes the GitHub Release.

For the store: add the GitHub topic `gladys-assistant-integration` to the repository, make
the `ghcr.io` package public, and turn on **Private vulnerability reporting** (see
[`SECURITY.md`](SECURITY.md)).

## Disclaimer

This integration is not made, endorsed nor supported by Zonneplan. It uses the same API as
the Zonneplan app, which may change without notice.

## License

Apache-2.0
