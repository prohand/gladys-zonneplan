// -----------------------------------------------------------------------------
// Configuration defaults, languages, token storage, the charge point command
// and the changelog roll of the Release workflow.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/config.js';
import { formatDate, formatPrice, formatTime, LANGUAGES, localize, pick } from '../src/i18n.js';
import { createFileTokenStore } from '../src/storage.js';
import { chargePoint } from '../src/devices/chargePoint.js';
import { parseInstallations, INSTALLATION_KINDS } from '../src/zonneplan/account.js';
import { createZonneplanClient } from '../src/zonneplan/client.js';
import { createMemoryTokenStore } from '../src/storage.js';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';
import {
  accountFixture,
  CONNECTION,
  CONTRACTS,
  createFakeFetch,
  NOW,
  SIGNED_IN,
} from './helpers/fakeZonneplan.js';

test('the config is normalized: e-mail trimmed, unknown interval and bounds fixed', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  const config = normalizeConfig({
    email: '  Me@Example.COM ',
    price_interval: 'weekly',
    poll_frequency: '5',
  });
  assert.equal(config.email, 'me@example.com');
  assert.equal(config.price_interval, 'hourly');
  assert.equal(config.poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: 'abc' }).poll_frequency, 300);
  assert.equal(normalizeConfig({ poll_frequency: 99999 }).poll_frequency, 3600);
});

test('the languages are the ones of the Gladys interface, English first', () => {
  assert.deepEqual(LANGUAGES, ['en', 'fr', 'de', 'es']);
  assert.equal(pick('it', { en: 'Stop', fr: 'Stop' }), 'Stop');
  assert.deepEqual(
    localize((l) => l.toUpperCase()),
    { en: 'EN', fr: 'FR', de: 'DE', es: 'ES' },
  );
});

test('times and dates are those of Amsterdam, summer and winter', () => {
  assert.equal(formatTime(Date.parse('2026-07-01T10:00:00Z')), '12:00');
  assert.equal(formatTime(Date.parse('2026-12-01T10:00:00Z')), '11:00');
  assert.equal(formatDate(Date.parse('2026-12-31T23:30:00Z')), '2027-01-01');
  assert.equal(formatPrice(-0.0123), '-0.012');
});

test('the tokens are written owner-only, read back, and cleared', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zonneplan-'));
  try {
    const store = createFileTokenStore(directory);
    assert.equal(await store.load(), null);
    await store.save(SIGNED_IN);
    assert.deepEqual(await store.load(), SIGNED_IN);
    const { mode } = await stat(join(directory, 'zonneplan-tokens.json'));
    assert.equal(mode & 0o777, 0o600);
    await store.clear();
    assert.equal(await store.load(), null);
    // A corrupted file is a lost session, not a crash.
    await writeFile(join(directory, 'zonneplan-tokens.json'), '{oops');
    assert.equal(await store.load(), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the "Charge now" switch starts and stops the charge, the other features refuse', async () => {
  const gladys = createFakeGladys();
  const base = `connections/${CONNECTION}/charge-points/${CONTRACTS.chargePoint}/actions`;
  const fetch = createFakeFetch({
    [`POST ${base}/start_boost`]: () => ({ status: 204 }),
    [`POST ${base}/stop_charging`]: () => ({ status: 204 }),
  });
  const client = createZonneplanClient({
    tokenStore: createMemoryTokenStore(SIGNED_IN),
    fetch,
    now: () => NOW,
  });
  const installation = parseInstallations(accountFixture(), NOW).find(
    (i) => i.kind === INSTALLATION_KINDS.CHARGE_POINT,
  );
  const device = chargePoint.buildDevice(gladys, installation, {});
  const [power, , chargeNow] = device.features;

  await chargePoint.onSetValue(gladys, { installation, feature: chargeNow, value: 1, client });
  await chargePoint.onSetValue(gladys, { installation, feature: chargeNow, value: 0, client });
  assert.deepEqual(
    fetch.requests.map((r) => r.path.split('/').at(-1)),
    ['start_boost', 'stop_charging'],
  );
  await assert.rejects(
    chargePoint.onSetValue(gladys, { installation, feature: power, value: 1, client }),
    /read-only/,
  );
});

test('the Release workflow rolls [Unreleased] under the new version', async () => {
  const text = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '### Added',
    '',
    '- Something.',
    '',
    '[Unreleased]: https://github.com/prohand/gladys-zonneplan/commits/main',
    '',
  ].join('\n');
  const rolled = rollChangelog(text, '1.0.0', '2026-10-20');
  assert.match(
    rolled,
    /## \[Unreleased\]\n\n## \[1\.0\.0\] - 2026-10-20\n\n### Added\n\n- Something\./,
  );
  assert.match(
    rolled,
    /\[1\.0\.0\]: https:\/\/github\.com\/prohand\/gladys-zonneplan\/releases\/tag\/v1\.0\.0/,
  );
  assert.match(rolled, /\[Unreleased\]: .*\/compare\/v1\.0\.0\.\.\.HEAD/);
  // The real changelog has an Unreleased section to roll.
  const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.match(changelog, /^## \[Unreleased\]$/m);
});
