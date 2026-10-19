// -----------------------------------------------------------------------------
// Dashboard widgets: the contents are rendered exactly as sent
// (validateWidgetContent returns []), live tiles point at published features,
// every button action is handled.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { ZonneplanSync } from '../src/sync.js';
import { normalizeConfig } from '../src/config.js';
import { createZonneplanClient } from '../src/zonneplan/client.js';
import { createMemoryTokenStore } from '../src/storage.js';
import {
  OVERVIEW_WIDGET,
  PRICES_WIDGET,
  WIDGETS,
  overviewContent,
  pricesContent,
} from '../src/capabilities/widgets.js';
import {
  accountRoutes,
  CONNECTION,
  CONTRACTS,
  createFakeFetch,
  NOW,
  SIGNED_IN,
} from './helpers/fakeZonneplan.js';

async function setup({ tokens = SIGNED_IN, routes = accountRoutes() } = {}) {
  const gladys = createFakeGladys();
  await gladys.connect();
  const fetch = createFakeFetch(routes);
  const client = createZonneplanClient({
    tokenStore: createMemoryTokenStore(tokens),
    fetch,
    now: () => NOW,
  });
  const sync = new ZonneplanSync({
    gladys,
    client,
    getConfig: () => normalizeConfig({ email: 'me@example.com' }),
    now: () => NOW,
  });
  await sync.tick();
  return { gladys, sync, fetch };
}

function components(content, type) {
  return content.components.filter((c) => c.type === type);
}

test('energy_prices: valid content, now / next / sustainable, chart and status', async () => {
  const { sync } = await setup();
  const content = pricesContent(sync);
  assert.deepEqual(validateWidgetContent(content), []);
  const [now, next, sustainable] = components(content, 'value');
  assert.equal(now.value, 0.32);
  assert.equal(next.value, 0.33);
  assert.equal(next.label.en, 'From 13:00');
  assert.equal(next.label.de, 'Ab 13:00');
  assert.equal(sustainable.value, 51);
  const [chart] = components(content, 'chart');
  assert.equal(chart.now_marker, true);
  assert.equal(chart.series[0].points[0].v, 0.3, 'starts two hours back');
  assert.equal(components(content, 'status')[0].items[1].value, '00:00 · 0.200 €');
});

test('the price tiles are colored by tariff group', async () => {
  const { sync } = await setup();
  const evening = Date.parse('2026-10-14T17:30:00Z'); // 19:30, high
  const [now] = components(pricesContent(sync, evening), 'value');
  assert.equal(now.color, 'danger');
});

test('energy_prices without prices: a valid sign-in hint', async () => {
  const { sync } = await setup({ tokens: null });
  const content = pricesContent(sync);
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(components(content, 'text').length, 1);
});

test('zonneplan_overview: valid content, live tiles on published features', async () => {
  const { gladys, sync } = await setup();
  const content = overviewContent(sync);
  assert.deepEqual(validateWidgetContent(content), []);
  const published = new Set(
    gladys.fake.discoveredDevices.flatMap((d) => d.features.map((f) => f.external_id)),
  );
  const tiles = components(content, 'value');
  assert.equal(tiles.length, 5);
  assert.ok(content.components.length <= 8, 'within the content budget');
  for (const tile of tiles) {
    assert.ok(published.has(tile.device_feature), tile.device_feature);
  }
  const buttons = components(content, 'button').map((b) => b.action.key);
  assert.deepEqual(buttons, ['start_boost', 'stop_charging']);
});

test('zonneplan_overview signed out: a valid content with the status', async () => {
  const { sync } = await setup({ tokens: null });
  const content = overviewContent(sync);
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(components(content, 'status')[0].items[0].value.en, 'Not signed in');
});

test('the widgets answer through the fake Gladys, and every button is handled', async () => {
  const { gladys, sync, fetch } = await setup();
  const boost = `connections/${CONNECTION}/charge-points/${CONTRACTS.chargePoint}/actions/start_boost`;
  fetch.routes[`POST ${boost}`] = () => ({ status: 204 });
  fetch.routes[`POST ${boost.replace('start_boost', 'stop_charging')}`] = () => ({ status: 204 });
  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(key, (request) => widget.get(gladys, { ...request, sync }));
    gladys.onWidgetAction(key, (actionKey, params, { settings }) =>
      widget.action(gladys, { actionKey, params, settings, sync }),
    );
  }
  for (const key of [PRICES_WIDGET, OVERVIEW_WIDGET]) {
    const ack = await gladys.fake.widgetGet(key, { settings: {}, language: 'fr', units: 'metric' });
    assert.equal(ack.success, true, key);
    for (const button of components(ack.data.content, 'button')) {
      const answer = await gladys.fake.widgetAction(
        key,
        button.action.key,
        button.action.params ?? {},
        {
          settings: {},
        },
      );
      assert.equal(answer.success, true, `${key}.${button.action.key}: ${answer.error}`);
    }
  }
  assert.ok(fetch.requests.some((r) => r.path === boost));
});

test('an unknown widget action fails', async () => {
  const { gladys, sync } = await setup();
  await assert.rejects(
    WIDGETS[PRICES_WIDGET].action(gladys, { actionKey: 'nope', params: {}, sync }),
    /Unknown widget action/,
  );
});
