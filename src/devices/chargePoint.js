// -----------------------------------------------------------------------------
// Device: CHARGE POINT (a Zonneplan charging station).
//
// Charge power, energy of the running session, and a "Charge now" switch:
// ON starts a boost charge (full power now, whatever the price), OFF stops
// the charge. Outside a boost, Zonneplan charges on the cheap hours by
// itself; the switch follows the measured power, so it also reads ON while
// such a planned charge runs.
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { INSTALLATION_KINDS } from '../zonneplan/account.js';
import { startBoost, stopCharging } from '../zonneplan/readings.js';
import { deviceName, numericState, sensorFeature } from './helpers.js';

const DEVICE_TYPE = 'charge-point';

const logger = createLogger({ name: DEVICE_TYPE });

export const FEATURE = {
  POWER: 'power',
  SESSION_ENERGY: 'session-energy',
  CHARGE_NOW: 'charge-now',
};

function ids(gladys, installation) {
  return gladys.externalIds(DEVICE_TYPE, installation.contractUuid);
}

export const chargePoint = {
  kind: INSTALLATION_KINDS.CHARGE_POINT,

  deviceExternalId(gladys, installation) {
    return ids(gladys, installation).device;
  },

  buildDevice(gladys, installation, context) {
    const { device, feature } = ids(gladys, installation);
    const charge = { category: DEVICE_FEATURE_CATEGORIES.ELECTRICAL_VEHICLE_CHARGE };
    return {
      name: deviceName('Zonneplan charge point', installation, context),
      external_id: device,
      features: [
        sensorFeature({
          ...charge,
          name: 'Charge power',
          externalId: feature(FEATURE.POWER),
          type: DEVICE_FEATURE_TYPES.ELECTRICAL_VEHICLE_CHARGE.CHARGE_POWER,
          unit: DEVICE_FEATURE_UNITS.WATT,
          min: 0,
          max: 25000,
        }),
        sensorFeature({
          ...charge,
          name: 'Energy of the session',
          externalId: feature(FEATURE.SESSION_ENERGY),
          type: DEVICE_FEATURE_TYPES.ELECTRICAL_VEHICLE_CHARGE.LAST_CHARGE_ENERGY_ADDED,
          unit: DEVICE_FEATURE_UNITS.KILOWATT_HOUR,
          min: 0,
          max: 500,
        }),
        {
          name: 'Charge now (boost)',
          external_id: feature(FEATURE.CHARGE_NOW),
          ...charge,
          type: DEVICE_FEATURE_TYPES.ELECTRICAL_VEHICLE_CHARGE.CHARGE_ON,
          min: 0,
          max: 1,
          read_only: false,
          // The state comes from the next reading, not from the order.
          has_feedback: true,
          keep_history: true,
        },
      ],
    };
  },

  states(gladys, installation, { readings }) {
    const reading = readings.get(installation.id);
    if (!reading) {
      return [];
    }
    const { feature } = ids(gladys, installation);
    return [
      ...numericState(feature(FEATURE.POWER), reading.power),
      ...numericState(feature(FEATURE.SESSION_ENERGY), reading.sessionEnergy),
      ...numericState(
        feature(FEATURE.CHARGE_NOW),
        reading.power === null ? null : reading.charging ? 1 : 0,
      ),
    ];
  },

  async onSetValue(gladys, { installation, feature, value, client }) {
    if (feature.external_id !== ids(gladys, installation).feature(FEATURE.CHARGE_NOW)) {
      throw new Error(`${feature.external_id} is read-only`);
    }
    await setCharging(client, installation, value === 1);
  },
};

/** Start (boost) or stop the charge of a charge point. */
export async function setCharging(client, installation, on) {
  logger.info(`${on ? 'Starting a boost charge' : 'Stopping the charge'} on ${installation.id}`);
  if (on) {
    await startBoost(client, installation);
  } else {
    await stopCharging(client, installation);
  }
}
