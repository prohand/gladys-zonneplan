// -----------------------------------------------------------------------------
// A fake Zonneplan app API: a `fetch` answering from a route table, recording
// every request. No network in the tests.
// -----------------------------------------------------------------------------

import { API_BASE_URL } from '../../src/zonneplan/client.js';

export const HOUR_MS = 3_600_000;

/** A fixed "now": Wednesday 2026-10-14 12:10 in Amsterdam (10:10 UTC). */
export const NOW = Date.parse('2026-10-14T10:10:00Z');

function jsonResponse(status, body, headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    async text() {
      return body === undefined ? '' : JSON.stringify(body);
    },
  };
}

/**
 * @param {Record<string, (request) => ({ status?, body?, headers? })>} routes
 *   keyed by "METHOD path" (path without the base URL, query string included)
 */
export function createFakeFetch(routes = {}) {
  const requests = [];
  async function fetch(url, init = {}) {
    const path = url.replace(`${API_BASE_URL}/`, '');
    const method = init.method ?? 'GET';
    const request = {
      method,
      path,
      headers: init.headers ?? {},
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);
    const route = routes[`${method} ${path}`];
    if (!route) {
      return jsonResponse(404, { message: 'not found' });
    }
    const { status = 200, body, headers } = route(request) ?? {};
    return jsonResponse(status, body, headers);
  }
  fetch.requests = requests;
  fetch.routes = routes;
  return fetch;
}

export const CONNECTION = 'conn-1111';
export const CONTRACTS = {
  electricity: 'contract-elec',
  gas: 'contract-gas',
  p1: 'contract-p1',
  pv: 'contract-pv',
  battery: 'contract-battery',
  chargePoint: 'contract-charger',
};

/** GET /user-accounts/me with every kind of installation. */
export function accountFixture({ withEnded = false } = {}) {
  const contract = (uuid, type, extra = {}) => ({
    uuid,
    type,
    label: type,
    start_date: '2024-01-01T00:00:00.000000Z',
    end_date: null,
    meta: {},
    ...extra,
  });
  const contracts = [
    contract(CONTRACTS.electricity, 'electricity'),
    contract(CONTRACTS.gas, 'gas'),
    contract(CONTRACTS.p1, 'p1_installation'),
    contract(CONTRACTS.pv, 'pv_installation', { meta: { installation_wp: 4000 } }),
    contract(CONTRACTS.battery, 'home_battery_installation'),
    contract(CONTRACTS.chargePoint, 'charge_point_installation'),
  ];
  if (withEnded) {
    contracts.push(
      contract('contract-old-pv', 'pv_installation', { end_date: '2025-01-01T00:00:00Z' }),
    );
  }
  return {
    user_account: { uuid: 'user-1', email: 'me@example.com' },
    address_groups: [
      {
        uuid: 'address-1',
        address: { street: 'Zonnestraat', number: '1', addition: 'A', city: 'Zwolle' },
        connections: [{ uuid: CONNECTION, ean: '871', contracts }],
      },
    ],
  };
}

/**
 * Hourly prices from 00:00 to 24:00 Amsterdam of 2026-10-14 (CEST, UTC+2),
 * `price(hour)` in EUR. Amounts are sent the Zonneplan way (1e-7 EUR).
 */
export function priceChartFixture({
  day = '2026-10-13T22:00:00Z',
  hours = 24,
  price = (h) => 0.2 + h / 100,
  group = (h) => (h < 6 ? 'low' : h < 18 ? 'normal' : 'high'),
} = {}) {
  const start = Date.parse(day);
  const prices = Array.from({ length: hours }, (_, h) => ({
    start_date: new Date(start + h * HOUR_MS).toISOString(),
    end_date: new Date(start + (h + 1) * HOUR_MS).toISOString(),
    price_tax_included: { amount: Math.round(price(h) * 1e7) },
    price_tax_excluded: { amount: Math.round((price(h) / 1.21) * 1e7) },
    tariff_group: group(h),
    sustainability_score: { permille: 500 + h },
  }));
  return { chart: { series: { prices } } };
}

export function readingsRoutes({ chargePower = 0 } = {}) {
  return {
    [`GET connections/${CONNECTION}/electricity-delivered`]: () => ({
      body: {
        data: {
          contracts: [
            {
              uuid: CONTRACTS.p1,
              meta: {
                electricity_last_measured_delivery_value: 450,
                electricity_last_measured_production_value: 0,
              },
            },
          ],
        },
      },
    }),
    [`GET connections/${CONNECTION}/pv-installation`]: () => ({
      body: {
        data: {
          contracts: [
            {
              uuid: CONTRACTS.pv,
              meta: { last_measured_power_value: 1830, total_power_measured: 12345678 },
            },
          ],
        },
      },
    }),
    [`GET connections/${CONNECTION}/home-battery-installation/${CONTRACTS.battery}`]: () => ({
      body: {
        data: {
          contracts: [
            {
              uuid: CONTRACTS.battery,
              meta: { state_of_charge: 735, power_ac: -1200, battery_state: 'discharging' },
            },
          ],
        },
      },
    }),
    [`GET connections/${CONNECTION}/charge-points/${CONTRACTS.chargePoint}`]: () => ({
      body: {
        data: {
          contracts: [
            {
              uuid: CONTRACTS.chargePoint,
              state: {
                power_actual: chargePower,
                energy_delivered_session: 5400,
                state: chargePower > 0 ? 'Charging' : 'VehicleDetected',
              },
            },
          ],
        },
      },
    }),
  };
}

/** Every route of a signed-in account. */
export function accountRoutes(options = {}) {
  return {
    'GET user-accounts/me': () => ({ body: { data: accountFixture() } }),
    'GET api/consumer-prices/charts/electricity-hourly': () => ({
      body: { data: priceChartFixture(options.prices) },
    }),
    'GET api/consumer-prices/charts/electricity-quarter-hourly': () => ({
      body: { data: priceChartFixture(options.prices) },
    }),
    'GET api/consumer-prices/charts/gas-daily': () => ({
      body: {
        // One slot a day, from 06:00 Amsterdam.
        data: {
          chart: {
            series: {
              prices: [
                {
                  start_date: '2026-10-14T04:00:00Z',
                  end_date: '2026-10-15T04:00:00Z',
                  price_tax_included: { amount: 12_500_000 },
                },
              ],
            },
          },
        },
      },
    }),
    ...readingsRoutes(options),
  };
}

export const SIGNED_IN = {
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  expires_at: NOW + 48 * HOUR_MS,
};
