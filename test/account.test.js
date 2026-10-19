// -----------------------------------------------------------------------------
// The account: which installations become devices, and their readings.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INSTALLATION_KINDS, parseInstallations } from '../src/zonneplan/account.js';
import {
  extractBattery,
  extractChargePoint,
  extractP1,
  extractPv,
  fetchReadings,
} from '../src/zonneplan/readings.js';
import { createZonneplanClient } from '../src/zonneplan/client.js';
import { createMemoryTokenStore } from '../src/storage.js';
import {
  accountFixture,
  accountRoutes,
  CONNECTION,
  CONTRACTS,
  createFakeFetch,
  NOW,
  SIGNED_IN,
} from './helpers/fakeZonneplan.js';

test('every supported contract is one installation; ended ones are left out', () => {
  const installations = parseInstallations(accountFixture({ withEnded: true }), NOW);
  assert.deepEqual(
    installations.map((i) => i.kind),
    Object.values(INSTALLATION_KINDS),
  );
  assert.equal(installations[0].address, 'Zonnestraat 1A');
});

test('tariffs are keyed on the connection, equipment on the contract', () => {
  const account = accountFixture();
  // A renewed electricity contract: a second one on the same connection.
  account.address_groups[0].connections[0].contracts.push({
    uuid: 'contract-elec-2027',
    type: 'electricity',
    end_date: null,
  });
  const installations = parseInstallations(account, NOW);
  const tariffs = installations.filter((i) => i.kind === INSTALLATION_KINDS.ELECTRICITY);
  assert.equal(tariffs.length, 1);
  assert.equal(tariffs[0].id, `electricity:${CONNECTION}`);
  assert.equal(installations.find((i) => i.kind === INSTALLATION_KINDS.PV).id, CONTRACTS.pv);
});

test('unknown contract types and empty accounts are ignored', () => {
  assert.deepEqual(parseInstallations(null), []);
  assert.deepEqual(
    parseInstallations({
      address_groups: [
        { connections: [{ uuid: 'c', contracts: [{ uuid: 'x', type: 'heat_pump' }] }] },
      ],
    }),
    [],
  );
});

test('readings come in Gladys units, null when not reported', () => {
  assert.deepEqual(extractP1({ meta: { electricity_last_measured_delivery_value: '450' } }), {
    deliveryPower: 450,
    productionPower: null,
    measuredAt: null,
  });
  assert.equal(extractPv({ meta: { total_power_measured: 12345678 } }).totalEnergy, 12345.678);
  assert.deepEqual(extractBattery({ meta: { state_of_charge: 735, power_ac: -1200 } }), {
    level: 73.5,
    power: -1200,
    state: null,
    cycles: null,
  });
  const charger = extractChargePoint({
    state: { power_actual: 7400, energy_delivered_session: 5400 },
  });
  assert.equal(charger.charging, true);
  assert.equal(charger.sessionEnergy, 5.4);
  assert.equal(extractChargePoint(null).charging, false);
});

test('fetchReadings reads each installation once, and a failing one does not stop the others', async () => {
  const routes = accountRoutes();
  delete routes[`GET connections/${CONNECTION}/pv-installation`];
  const fetch = createFakeFetch(routes);
  const client = createZonneplanClient({
    tokenStore: createMemoryTokenStore(SIGNED_IN),
    fetch,
    now: () => NOW,
  });
  const installations = parseInstallations(accountFixture(), NOW);
  const { readings, errors } = await fetchReadings(client, installations);

  assert.equal(errors.length, 1);
  assert.equal(readings.get(CONTRACTS.p1).deliveryPower, 450);
  assert.equal(readings.has(CONTRACTS.pv), false);
  assert.equal(readings.get(CONTRACTS.battery).level, 73.5);
  assert.equal(readings.get(CONTRACTS.chargePoint).charging, false);
  // The tariffs have no live reading: four requests, no more.
  assert.equal(fetch.requests.length, 4);
});
