// -----------------------------------------------------------------------------
// Device: SOLAR PANELS (a Zonneplan inverter).
//
// The production power and the lifetime yield. The yield is an index: Gladys
// derives the daily production from it, nothing to compute here.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { INSTALLATION_KINDS } from '../zonneplan/account.js';
import { deviceName, numericState, sensorFeature } from './helpers.js';

const DEVICE_TYPE = 'solar';

export const FEATURE = { POWER: 'power', TOTAL_ENERGY: 'total-energy' };

function ids(gladys, installation) {
  return gladys.externalIds(DEVICE_TYPE, installation.contractUuid);
}

export const solarPanels = {
  kind: INSTALLATION_KINDS.PV,

  deviceExternalId(gladys, installation) {
    return ids(gladys, installation).device;
  },

  buildDevice(gladys, installation, context) {
    const { device, feature } = ids(gladys, installation);
    // The installed peak power, when Zonneplan knows it, bounds the reading.
    const peak = Number(installation.meta?.installation_wp);
    return {
      name: deviceName('Zonneplan solar panels', installation, context),
      external_id: device,
      features: [
        sensorFeature({
          name: 'Production power',
          externalId: feature(FEATURE.POWER),
          category: DEVICE_FEATURE_CATEGORIES.ENERGY_PRODUCTION_SENSOR,
          type: DEVICE_FEATURE_TYPES.ENERGY_PRODUCTION_SENSOR.POWER,
          unit: DEVICE_FEATURE_UNITS.WATT,
          min: 0,
          max: Number.isFinite(peak) && peak > 0 ? Math.ceil(peak * 1.2) : 30000,
        }),
        sensorFeature({
          name: 'Total production',
          externalId: feature(FEATURE.TOTAL_ENERGY),
          category: DEVICE_FEATURE_CATEGORIES.ENERGY_PRODUCTION_SENSOR,
          type: DEVICE_FEATURE_TYPES.ENERGY_PRODUCTION_SENSOR.INDEX,
          unit: DEVICE_FEATURE_UNITS.KILOWATT_HOUR,
          min: 0,
          max: 10000000,
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
    return [
      ...numericState(feature(FEATURE.POWER), reading.power),
      ...numericState(feature(FEATURE.TOTAL_ENERGY), reading.totalEnergy),
    ];
  },
};
