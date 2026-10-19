// -----------------------------------------------------------------------------
// Device: HOME BATTERY (Zonneplan Nexus).
//
// Level, charge power and discharge power. The API reports one signed AC
// power (positive while charging): Gladys has a feature for each direction,
// the other one reads 0.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { INSTALLATION_KINDS } from '../zonneplan/account.js';
import { deviceName, numericState, sensorFeature } from './helpers.js';

const DEVICE_TYPE = 'home-battery';

export const FEATURE = {
  LEVEL: 'level',
  CHARGE_POWER: 'charge-power',
  DISCHARGE_POWER: 'discharge-power',
};

const POWER_BOUNDS = { min: 0, max: 30000 };

function ids(gladys, installation) {
  return gladys.externalIds(DEVICE_TYPE, installation.contractUuid);
}

export const homeBattery = {
  kind: INSTALLATION_KINDS.BATTERY,

  deviceExternalId(gladys, installation) {
    return ids(gladys, installation).device;
  },

  buildDevice(gladys, installation, context) {
    const { device, feature } = ids(gladys, installation);
    const storage = { category: DEVICE_FEATURE_CATEGORIES.BATTERY_STORAGE };
    return {
      name: deviceName('Zonneplan home battery', installation, context),
      external_id: device,
      features: [
        sensorFeature({
          ...storage,
          name: 'Battery level',
          externalId: feature(FEATURE.LEVEL),
          type: DEVICE_FEATURE_TYPES.BATTERY_STORAGE.BATTERY_LEVEL,
          unit: DEVICE_FEATURE_UNITS.PERCENT,
          min: 0,
          max: 100,
        }),
        sensorFeature({
          ...storage,
          ...POWER_BOUNDS,
          name: 'Charge power',
          externalId: feature(FEATURE.CHARGE_POWER),
          type: DEVICE_FEATURE_TYPES.BATTERY_STORAGE.CHARGE_POWER,
          unit: DEVICE_FEATURE_UNITS.WATT,
        }),
        sensorFeature({
          ...storage,
          ...POWER_BOUNDS,
          name: 'Discharge power',
          externalId: feature(FEATURE.DISCHARGE_POWER),
          type: DEVICE_FEATURE_TYPES.BATTERY_STORAGE.DISCHARGE_POWER,
          unit: DEVICE_FEATURE_UNITS.WATT,
        }),
      ],
    };
  },

  states(gladys, installation, { readings }) {
    const reading = readings.get(installation.id);
    if (!reading) {
      return [];
    }
    const { feature } = ids(gladys, installation);
    const power = reading.power;
    return [
      ...numericState(feature(FEATURE.LEVEL), reading.level),
      ...numericState(feature(FEATURE.CHARGE_POWER), power === null ? null : Math.max(power, 0)),
      ...numericState(
        feature(FEATURE.DISCHARGE_POWER),
        power === null ? null : Math.max(-power, 0),
      ),
    ];
  },
};
