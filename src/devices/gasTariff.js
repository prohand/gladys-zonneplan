// -----------------------------------------------------------------------------
// Device: GAS TARIFF (one per connection with a Zonneplan gas contract).
//
// The gas price changes once a day, at 06:00 Amsterdam time.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { INSTALLATION_KINDS } from '../zonneplan/account.js';
import { nextSlot, slotAt } from '../zonneplan/prices.js';
import { deviceName, numericState, sensorFeature } from './helpers.js';

const DEVICE_TYPE = 'gas-tariff';

export const FEATURE = { PRICE: 'price', NEXT_PRICE: 'next-price' };

function ids(gladys, installation) {
  return gladys.externalIds(DEVICE_TYPE, installation.connectionUuid);
}

export const gasTariff = {
  kind: INSTALLATION_KINDS.GAS,

  deviceExternalId(gladys, installation) {
    return ids(gladys, installation).device;
  },

  buildDevice(gladys, installation, context) {
    const { device, feature } = ids(gladys, installation);
    const price = {
      category: DEVICE_FEATURE_CATEGORIES.CURRENCY,
      type: DEVICE_FEATURE_TYPES.CURRENCY.DECIMAL,
      unit: DEVICE_FEATURE_UNITS.EURO,
      min: 0,
      max: 10,
    };
    return {
      name: deviceName('Zonneplan gas price', installation, context),
      external_id: device,
      features: [
        sensorFeature({
          ...price,
          name: 'Price per m³ (today)',
          externalId: feature(FEATURE.PRICE),
        }),
        sensorFeature({
          ...price,
          name: 'Price per m³ (next day)',
          externalId: feature(FEATURE.NEXT_PRICE),
          history: false,
        }),
      ],
    };
  },

  states(gladys, installation, { gasPrices, now }) {
    const { feature } = ids(gladys, installation);
    return [
      ...numericState(feature(FEATURE.PRICE), slotAt(gasPrices, now)?.price),
      ...numericState(feature(FEATURE.NEXT_PRICE), nextSlot(gasPrices, now)?.price),
    ];
  },
};
