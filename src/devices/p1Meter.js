// -----------------------------------------------------------------------------
// Device: P1 METER (the Zonneplan Connect dongle on the smart meter).
//
// Power drawn from the grid and power returned to it, as last measured by the
// dongle. Zonneplan relays it through its cloud every few minutes: this is not
// a second-by-second P1 reading.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { INSTALLATION_KINDS } from '../zonneplan/account.js';
import { deviceName, numericState, sensorFeature } from './helpers.js';

const DEVICE_TYPE = 'p1-meter';

export const FEATURE = { DELIVERY_POWER: 'delivery-power', PRODUCTION_POWER: 'production-power' };

// A Dutch 3 x 25 A connection tops out around 17 kW; leave room for 3 x 80 A.
const POWER_BOUNDS = { min: 0, max: 60000 };

function ids(gladys, installation) {
  return gladys.externalIds(DEVICE_TYPE, installation.contractUuid);
}

export const p1Meter = {
  kind: INSTALLATION_KINDS.P1,

  deviceExternalId(gladys, installation) {
    return ids(gladys, installation).device;
  },

  buildDevice(gladys, installation, context) {
    const { device, feature } = ids(gladys, installation);
    const power = {
      category: DEVICE_FEATURE_CATEGORIES.GRID_SENSOR,
      unit: DEVICE_FEATURE_UNITS.WATT,
    };
    return {
      name: deviceName('Zonneplan P1 meter', installation, context),
      external_id: device,
      features: [
        sensorFeature({
          ...power,
          ...POWER_BOUNDS,
          name: 'Power drawn from the grid',
          externalId: feature(FEATURE.DELIVERY_POWER),
          type: DEVICE_FEATURE_TYPES.GRID_SENSOR.INPUT_POWER,
        }),
        sensorFeature({
          ...power,
          ...POWER_BOUNDS,
          name: 'Power returned to the grid',
          externalId: feature(FEATURE.PRODUCTION_POWER),
          type: DEVICE_FEATURE_TYPES.GRID_SENSOR.OUTPUT_POWER,
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
      ...numericState(feature(FEATURE.DELIVERY_POWER), reading.deliveryPower),
      ...numericState(feature(FEATURE.PRODUCTION_POWER), reading.productionPower),
    ];
  },
};
