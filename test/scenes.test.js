// -----------------------------------------------------------------------------
// Scene actions and the data of the scene triggers: only declared keys, one
// event per transition.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { chargingEvents, priceEvents, SCENE_ACTIONS } from '../src/capabilities/scenes.js';
import { parseInstallations } from '../src/zonneplan/account.js';
import { parsePriceSeries } from '../src/zonneplan/prices.js';
import { createZonneplanClient } from '../src/zonneplan/client.js';
import { createMemoryTokenStore } from '../src/storage.js';
import {
  accountFixture,
  CONNECTION,
  CONTRACTS,
  createFakeFetch,
  HOUR_MS,
  NOW,
  priceChartFixture,
  SIGNED_IN,
} from './helpers/fakeZonneplan.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const declaredOutputs = (key) =>
  manifest.scene_actions.find((a) => a.key === key).outputs.map((o) => o.key);
const declaredData = (key) => {
  const trigger = manifest.scene_triggers.find((t) => t.key === key);
  return [...(trigger.fields ?? []), ...(trigger.variables ?? [])].map((f) => f.key);
};

const slots = parsePriceSeries(priceChartFixture());

function fakeSync(routes = {}) {
  const gladys = createFakeGladys();
  const fetch = createFakeFetch(routes);
  const client = createZonneplanClient({
    tokenStore: createMemoryTokenStore(SIGNED_IN),
    fetch,
    now: () => NOW,
  });
  let readingsRequested = 0;
  const sync = {
    client,
    installations: parseInstallations(accountFixture(), NOW),
    electricityPrices: slots,
    requestReadingsSoon: () => {
      readingsRequested += 1;
    },
  };
  return { gladys, sync, fetch, readingsRequested: () => readingsRequested };
}

test('get_current_price returns exactly the declared outputs', async () => {
  const { gladys, sync } = fakeSync();
  const outputs = await SCENE_ACTIONS.get_current_price(gladys, { fields: {}, sync, now: NOW });
  assert.deepEqual(Object.keys(outputs).sort(), declaredOutputs('get_current_price').sort());
  assert.equal(outputs.price, 0.32);
  assert.equal(outputs.next_price, 0.33);
  assert.equal(outputs.tariff_group, 'normal');
  assert.equal(outputs.cheapest_time_today, '00:00');
});

test('find_cheapest_period returns the declared outputs, found or not', async () => {
  const { gladys, sync } = fakeSync();
  const found = await SCENE_ACTIONS.find_cheapest_period(gladys, {
    fields: { duration_hours: 2, within_hours: 6 },
    sync,
    now: NOW,
  });
  assert.deepEqual(Object.keys(found).sort(), declaredOutputs('find_cheapest_period').sort());
  assert.equal(found.found, true);
  assert.equal(found.start_time, '12:00');
  assert.equal(found.end_time, '14:00');
  assert.equal(found.starts_now, true);
  assert.equal(found.starts_in_minutes, 0);

  const none = await SCENE_ACTIONS.find_cheapest_period(gladys, {
    fields: { duration_hours: 12, within_hours: 2 },
    sync,
    now: NOW,
  });
  assert.deepEqual(Object.keys(none).sort(), declaredOutputs('find_cheapest_period').sort());
  assert.equal(none.found, false);
});

test('start_boost_charging posts start_boost on the chosen charge point', async () => {
  const path = `connections/${CONNECTION}/charge-points/${CONTRACTS.chargePoint}/actions/start_boost`;
  const { gladys, sync, fetch, readingsRequested } = fakeSync({
    [`POST ${path}`]: () => ({ status: 204 }),
  });
  const device = gladys.externalIds('charge-point', CONTRACTS.chargePoint).device;
  assert.deepEqual(await SCENE_ACTIONS.start_boost_charging(gladys, { fields: { device }, sync }), {
    sent: true,
  });
  assert.equal(fetch.requests[0].path, path);
  assert.equal(readingsRequested(), 1);
});

test('a charge action on another device sends nothing', async () => {
  const { gladys, sync, fetch } = fakeSync();
  const device = gladys.externalIds('solar', CONTRACTS.pv).device;
  assert.deepEqual(await SCENE_ACTIONS.stop_charging(gladys, { fields: { device }, sync }), {
    sent: false,
  });
  assert.equal(fetch.requests.length, 0);
});

test('the trigger data only carries declared keys', () => {
  const first = priceEvents(null, slots, NOW);
  assert.deepEqual(first.events, []);
  // Next slot boundaries until the evening, plus a negative slot.
  const negative = parsePriceSeries(priceChartFixture({ price: (h) => (h === 18 ? -0.1 : 0.2) }));
  let memory = priceEvents(null, negative, NOW).memory;
  const events = [];
  for (let at = NOW; at < NOW + 10 * HOUR_MS; at += HOUR_MS) {
    const result = priceEvents(memory, negative, at);
    memory = result.memory;
    events.push(...result.events);
  }
  assert.ok(events.length >= 2);
  for (const { key, data } of events) {
    for (const dataKey of Object.keys(data)) {
      assert.ok(declaredData(key).includes(dataKey), `${key}.${dataKey} is not declared`);
    }
  }
});

test('one charging event per transition, none on the first reading', () => {
  const gladys = createFakeGladys();
  const installations = parseInstallations(accountFixture(), NOW);
  const id = (_g, i) => `ext:test-integration:charge-point:${i.contractUuid}`;
  const reading = (power) =>
    new Map([[CONTRACTS.chargePoint, { power, sessionEnergy: 1, charging: power > 0 }]]);

  let state = chargingEvents(gladys, new Map(), installations, reading(0), id);
  assert.equal(state.events.length, 0);
  state = chargingEvents(gladys, state.memory, installations, reading(7000), id);
  assert.equal(state.events.length, 1);
  for (const dataKey of Object.keys(state.events[0].data)) {
    assert.ok(declaredData('charging_started').includes(dataKey), dataKey);
  }
  state = chargingEvents(gladys, state.memory, installations, reading(7200), id);
  assert.equal(state.events.length, 0, 'still charging: no new event');
});
