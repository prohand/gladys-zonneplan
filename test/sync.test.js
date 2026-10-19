// -----------------------------------------------------------------------------
// The synchronisation loop, against the fake Gladys of the SDK (which refuses
// what the host API refuses) and the fake Zonneplan API.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ZonneplanSync } from '../src/sync.js';
import { normalizeConfig } from '../src/config.js';
import { createZonneplanClient } from '../src/zonneplan/client.js';
import { createMemoryTokenStore } from '../src/storage.js';
import { SCENE_TRIGGERS } from '../src/capabilities/scenes.js';
import {
  accountRoutes,
  CONNECTION,
  CONTRACTS,
  createFakeFetch,
  HOUR_MS,
  NOW,
  readingsRoutes,
  SIGNED_IN,
  priceChartFixture,
} from './helpers/fakeZonneplan.js';

async function setup({ tokens = SIGNED_IN, routes = accountRoutes(), config = {} } = {}) {
  const clock = { now: NOW };
  const gladys = createFakeGladys();
  await gladys.connect();
  const fetch = createFakeFetch(routes);
  const client = createZonneplanClient({
    tokenStore: createMemoryTokenStore(tokens),
    fetch,
    now: () => clock.now,
  });
  let nudges = 0;
  const sync = new ZonneplanSync({
    gladys,
    client,
    getConfig: () => normalizeConfig({ email: 'me@example.com', ...config }),
    now: () => clock.now,
    onDataChanged: () => {
      nudges += 1;
    },
  });
  return { gladys, fetch, client, sync, clock, nudges: () => nudges };
}

const feature = (gladys, type, platformId, key) =>
  gladys.externalIds(type, platformId).feature(key);

test('a first round publishes one device per installation, accepted by Gladys', async () => {
  const { gladys, sync } = await setup();
  await sync.tick();
  const names = gladys.fake.discoveredDevices.map((device) => device.name);
  assert.deepEqual(names, [
    'Zonneplan electricity price',
    'Zonneplan gas price',
    'Zonneplan P1 meter',
    'Zonneplan solar panels',
    'Zonneplan home battery',
    'Zonneplan charge point',
  ]);
  for (const device of gladys.fake.discoveredDevices) {
    for (const f of device.features) {
      assert.notEqual(f.min, undefined, `${f.external_id}: min`);
      assert.notEqual(f.max, undefined, `${f.external_id}: max`);
    }
  }
  assert.equal(sync.status, 'ok');
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('the states follow the price slot and the readings', async () => {
  const { gladys, sync } = await setup();
  await sync.tick();
  const last = (id) => gladys.fake.lastState(id);
  assert.equal(last(feature(gladys, 'electricity-tariff', CONNECTION, 'price')), 0.32);
  assert.equal(last(feature(gladys, 'electricity-tariff', CONNECTION, 'next-price')), 0.33);
  assert.equal(last(feature(gladys, 'electricity-tariff', CONNECTION, 'sustainability')), 51.2);
  assert.equal(last(feature(gladys, 'gas-tariff', CONNECTION, 'price')), 1.25);
  assert.equal(last(feature(gladys, 'p1-meter', CONTRACTS.p1, 'delivery-power')), 450);
  assert.equal(last(feature(gladys, 'solar', CONTRACTS.pv, 'power')), 1830);
  assert.equal(last(feature(gladys, 'solar', CONTRACTS.pv, 'total-energy')), 12345.678);
  assert.equal(last(feature(gladys, 'home-battery', CONTRACTS.battery, 'level')), 73.5);
  assert.equal(last(feature(gladys, 'home-battery', CONTRACTS.battery, 'charge-power')), 0);
  assert.equal(last(feature(gladys, 'home-battery', CONTRACTS.battery, 'discharge-power')), 1200);
  assert.equal(last(feature(gladys, 'charge-point', CONTRACTS.chargePoint, 'charge-now')), 0);
  const group = gladys.fake.states.find(
    (s) =>
      s.device_feature_external_id ===
      feature(gladys, 'electricity-tariff', CONNECTION, 'tariff-group'),
  );
  assert.equal(group.text, 'normal');
});

test('the prices move on the slot boundary without a new API call', async () => {
  const { gladys, sync, clock, fetch } = await setup({ config: { poll_frequency: 3600 } });
  clock.now += 40 * 60_000; // 12:50
  await sync.tick();
  const requests = fetch.requests.length;
  clock.now += 11 * 60_000; // 13:01
  await sync.tick();
  assert.equal(fetch.requests.length, requests, 'no call: nothing due yet');
  assert.equal(
    gladys.fake.lastState(feature(gladys, 'electricity-tariff', CONNECTION, 'price')),
    0.33,
  );
});

test('the installations are read at the configured interval, the prices every 15 minutes', async () => {
  const { sync, clock, fetch } = await setup({ config: { poll_frequency: 600 } });
  await sync.tick();
  const count = (path) => fetch.requests.filter((r) => r.path.includes(path)).length;
  clock.now += 5 * 60_000;
  await sync.tick();
  assert.equal(count('pv-installation'), 1);
  clock.now += 10 * 60_000;
  await sync.tick();
  assert.equal(count('pv-installation'), 2);
  assert.equal(count('electricity-hourly'), 2);
  assert.equal(count('user-accounts/me'), 1, 'the account is read hourly');
});

test('the quarter-hourly setting reads the quarter-hourly chart', async () => {
  const { sync, fetch } = await setup({ config: { price_interval: 'quarter_hourly' } });
  await sync.tick();
  assert.ok(fetch.requests.some((r) => r.path.endsWith('electricity-quarter-hourly')));
});

test('a tariff group change fires the trigger once; the first look fires nothing', async () => {
  const { gladys, sync, clock } = await setup();
  await sync.tick(); // 12:10, normal
  assert.equal(gladys.fake.sceneEvents.length, 0);
  clock.now = Date.parse('2026-10-14T16:00:30Z'); // 18:00:30 -> high
  await sync.tick();
  await sync.tick();
  const events = gladys.fake.sceneEvents.filter(
    (e) => e.key === SCENE_TRIGGERS.TARIFF_GROUP_CHANGED,
  );
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data, {
    tariff_group: 'high',
    previous_tariff_group: 'normal',
    price: 0.38,
  });
});

test('a negative price fires negative_price_started', async () => {
  const routes = accountRoutes({ prices: { price: (h) => (h === 13 ? -0.02 : 0.2) } });
  const { gladys, sync, clock } = await setup({ routes });
  await sync.tick();
  clock.now = Date.parse('2026-10-14T11:01:00Z'); // 13:01
  await sync.tick();
  const [event] = gladys.fake.sceneEvents;
  assert.equal(event.key, SCENE_TRIGGERS.NEGATIVE_PRICE_STARTED);
  assert.deepEqual(event.data, { price: -0.02, ends_at: '14:00' });
});

test("tomorrow's publication fires next_day_prices_available", async () => {
  const routes = accountRoutes();
  const { gladys, sync, clock, fetch } = await setup({ routes });
  await sync.tick();
  // The afternoon: the chart now holds 48 hours.
  fetch.routes['GET api/consumer-prices/charts/electricity-hourly'] = () => ({
    body: { data: priceChartFixture({ hours: 48, price: (h) => (h === 27 ? 0.01 : 0.25) }) },
  });
  clock.now += 15 * 60_000;
  await sync.tick();
  const event = gladys.fake.sceneEvents.find(
    (e) => e.key === SCENE_TRIGGERS.NEXT_DAY_PRICES_AVAILABLE,
  );
  assert.ok(event, 'fired');
  assert.equal(event.data.date, '2026-10-15');
  assert.equal(event.data.cheapest_time, '03:00');
  assert.equal(event.data.cheapest_price, 0.01);
});

test('charging transitions fire charging_started / charging_stopped with the device', async () => {
  const { gladys, sync, clock, fetch } = await setup();
  await sync.tick();
  Object.assign(fetch.routes, readingsRoutes({ chargePower: 7400 }));
  clock.now += 5 * 60_000;
  await sync.tick();
  Object.assign(fetch.routes, readingsRoutes({ chargePower: 0 }));
  clock.now += 5 * 60_000;
  await sync.tick();
  const device = gladys.externalIds('charge-point', CONTRACTS.chargePoint).device;
  assert.deepEqual(
    gladys.fake.sceneEvents.map((e) => [e.key, e.data.device]),
    [
      [SCENE_TRIGGERS.CHARGING_STARTED, device],
      [SCENE_TRIGGERS.CHARGING_STOPPED, device],
    ],
  );
});

test('not signed in: disconnected status with the sign-in hint, no API call', async () => {
  const { gladys, sync, fetch } = await setup({ tokens: null });
  await sync.tick();
  assert.equal(fetch.requests.length, 0);
  assert.equal(sync.status, 'not_signed_in');
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /Send me a sign-in code/);
});

test('a rate limit keeps the devices on cloud, flagged degraded', async () => {
  const routes = accountRoutes();
  const { gladys, sync, clock, fetch } = await setup({ routes });
  await sync.tick();
  fetch.routes[`GET connections/${CONNECTION}/pv-installation`] = () => ({
    status: 429,
    headers: { 'retry-after': '600' },
  });
  clock.now += 5 * 60_000;
  await sync.tick();
  assert.equal(sync.status, 'rate_limited');
  const entry = gladys.fake.transports.at(-1);
  assert.equal(entry.transport, 'cloud');
  assert.equal(entry.degraded, true);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('an expired session turns the badges unreachable and asks to sign in again', async () => {
  const routes = accountRoutes();
  routes['POST oauth/token'] = () => ({ status: 401 });
  const { gladys, sync, clock } = await setup({
    routes,
    tokens: { ...SIGNED_IN, expires_at: NOW + HOUR_MS },
  });
  await sync.tick();
  clock.now += HOUR_MS;
  await sync.tick();
  assert.equal(sync.status, 'session_expired');
  await sync.tick();
  assert.equal(sync.status, 'session_expired', 'stays expired, not "never signed in"');
  assert.equal(gladys.fake.transports.at(-1).transport, 'unreachable');
  assert.match(gladys.fake.connectionStatus.message.fr, /expiré/);
});

test('a network failure is "unreachable" and the next round retries', async () => {
  const routes = accountRoutes();
  const { sync, clock, fetch } = await setup({ routes });
  const failing = async () => {
    throw new Error('ECONNRESET');
  };
  const original = fetch.routes['GET user-accounts/me'];
  const client = sync.client;
  sync.client = {
    ...client,
    get: failing,
    isSignedIn: client.isSignedIn,
    rateLimitedUntil: () => 0,
  };
  await sync.tick();
  assert.equal(sync.status, 'unreachable');
  sync.client = client;
  fetch.routes['GET user-accounts/me'] = original;
  clock.now += 60_000;
  await sync.tick();
  assert.equal(sync.status, 'ok');
});
