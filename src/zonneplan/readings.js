// -----------------------------------------------------------------------------
// Live readings of the installations.
//
//   P1 dongle      GET /connections/<c>/electricity-delivered
//   solar panels   GET /connections/<c>/pv-installation
//   home battery   GET /connections/<c>/home-battery-installation/<contract>
//   charge point   GET /connections/<c>/charge-points/<contract>
//
// The P1 and solar answers cover every contract of the connection at once
// (`contracts[]`, one per dongle or inverter): one call per connection, then
// each installation picks its own contract — by uuid, by position when the
// answer carries none.
//
// The `extract*` functions are pure and turn an answer into plain numbers in
// Gladys units (W, kWh, %); `null` means "not reported", never 0.
// -----------------------------------------------------------------------------

import { INSTALLATION_KINDS, connectionsWith } from './account.js';

function number(value, factor = 1) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * factor * 1000) / 1000 : null;
}

function contractOf(answer, installation, siblings) {
  const contracts = answer?.contracts ?? [];
  return (
    contracts.find((contract) => contract.uuid === installation.contractUuid) ??
    contracts[siblings.findIndex((sibling) => sibling.id === installation.id)] ??
    null
  );
}

/** P1 dongle: power drawn from and returned to the grid, in W. */
export function extractP1(contract) {
  const meta = contract?.meta ?? {};
  return {
    deliveryPower: number(meta.electricity_last_measured_delivery_value),
    productionPower: number(meta.electricity_last_measured_production_value),
    measuredAt: meta.electricity_last_measured_at ?? null,
  };
}

/** Solar panels: power in W, lifetime yield in kWh (the API counts Wh). */
export function extractPv(contract) {
  const meta = contract?.meta ?? {};
  return {
    power: number(meta.last_measured_power_value),
    totalEnergy: number(meta.total_power_measured, 0.001),
    measuredAt: meta.last_measured_at ?? null,
  };
}

/**
 * Home battery: level in % (the API counts per mille), AC power in W —
 * positive while charging, negative while discharging.
 */
export function extractBattery(contract) {
  const meta = contract?.meta ?? {};
  return {
    level: number(meta.state_of_charge, 0.1),
    power: number(meta.power_ac),
    state: meta.battery_state ?? null,
    cycles: number(meta.cycle_count),
  };
}

/** Charge point: power in W, energy of the session in kWh (the API counts Wh). */
export function extractChargePoint(contract) {
  const state = contract?.state ?? {};
  const power = number(state.power_actual);
  return {
    power,
    sessionEnergy: number(state.energy_delivered_session, 0.001),
    state: state.state ?? null,
    connectivity: state.connectivity_state ?? null,
    charging: power !== null && power > 0,
  };
}

/**
 * Read every installation that has live readings.
 *
 * A failing read leaves that installation out of the result (its last value
 * stays in Gladys) and is reported in `errors`; the others go on.
 *
 * @returns {Promise<{ readings: Map<string, object>, errors: Error[] }>}
 */
export async function fetchReadings(client, installations) {
  const readings = new Map();
  const errors = [];
  const byKind = (kind) => installations.filter((i) => i.kind === kind);

  async function perConnection(kind, path, extract) {
    const all = byKind(kind);
    for (const connectionUuid of connectionsWith(installations, kind)) {
      const siblings = all.filter((i) => i.connectionUuid === connectionUuid);
      try {
        const answer = await client.get(`connections/${connectionUuid}/${path}`);
        for (const installation of siblings) {
          readings.set(installation.id, extract(contractOf(answer, installation, siblings)));
        }
      } catch (err) {
        errors.push(err);
      }
    }
  }

  async function perContract(kind, path, extract) {
    for (const installation of byKind(kind)) {
      try {
        const answer = await client.get(
          `connections/${installation.connectionUuid}/${path}/${installation.contractUuid}`,
        );
        readings.set(installation.id, extract(contractOf(answer, installation, [installation])));
      } catch (err) {
        errors.push(err);
      }
    }
  }

  // Sequential on purpose: the API rate limit counts requests, and a burst
  // at every poll is what gets an account throttled.
  await perConnection(INSTALLATION_KINDS.P1, 'electricity-delivered', extractP1);
  await perConnection(INSTALLATION_KINDS.PV, 'pv-installation', extractPv);
  await perContract(INSTALLATION_KINDS.BATTERY, 'home-battery-installation', extractBattery);
  await perContract(INSTALLATION_KINDS.CHARGE_POINT, 'charge-points', extractChargePoint);
  return { readings, errors };
}

/** Start a boost charge (charge now at full power, whatever the price). */
export function startBoost(client, installation) {
  return client.post(
    `connections/${installation.connectionUuid}/charge-points/${installation.contractUuid}/actions/start_boost`,
  );
}

/** Stop the running charge. */
export function stopCharging(client, installation) {
  return client.post(
    `connections/${installation.connectionUuid}/charge-points/${installation.contractUuid}/actions/stop_charging`,
  );
}
