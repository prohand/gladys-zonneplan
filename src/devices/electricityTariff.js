// -----------------------------------------------------------------------------
// Device: ELECTRICITY TARIFF (one per connection with a Zonneplan electricity
// contract).
//
// The dynamic price of the running slot (hour or quarter-hour, see the
// `price_interval` setting), the next slot's, the tariff group Zonneplan gives
// the slot (low / normal / high) and the share of sustainable energy.
// Computed from the published price list: it moves at every slot boundary,
// not at every API call (see src/sync.js).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { INSTALLATION_KINDS } from '../zonneplan/account.js';
import { nextSlot, slotAt } from '../zonneplan/prices.js';
import { deviceName, numericState, sensorFeature, textState } from './helpers.js';

const DEVICE_TYPE = 'electricity-tariff';

export const FEATURE = {
  PRICE: 'price',
  NEXT_PRICE: 'next-price',
  TARIFF_GROUP: 'tariff-group',
  SUSTAINABILITY: 'sustainability',
};

// Generous bounds: day-ahead prices went past 0.80 EUR/kWh in 2022, and below
// zero on sunny Sundays.
const PRICE_BOUNDS = { min: -5, max: 5 };

function ids(gladys, installation) {
  return gladys.externalIds(DEVICE_TYPE, installation.connectionUuid);
}

export const electricityTariff = {
  kind: INSTALLATION_KINDS.ELECTRICITY,

  deviceExternalId(gladys, installation) {
    return ids(gladys, installation).device;
  },

  buildDevice(gladys, installation, context) {
    const { device, feature } = ids(gladys, installation);
    const price = {
      category: DEVICE_FEATURE_CATEGORIES.CURRENCY,
      type: DEVICE_FEATURE_TYPES.CURRENCY.DECIMAL,
      unit: DEVICE_FEATURE_UNITS.EURO,
      ...PRICE_BOUNDS,
    };
    return {
      name: deviceName('Zonneplan electricity price', installation, context),
      external_id: device,
      features: [
        sensorFeature({
          ...price,
          name: 'Price per kWh (now)',
          externalId: feature(FEATURE.PRICE),
        }),
        sensorFeature({
          ...price,
          name: 'Price per kWh (next slot)',
          externalId: feature(FEATURE.NEXT_PRICE),
          history: false,
        }),
        sensorFeature({
          name: 'Tariff group',
          externalId: feature(FEATURE.TARIFF_GROUP),
          category: DEVICE_FEATURE_CATEGORIES.TEXT,
          type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
          min: 0,
          max: 0,
        }),
        sensorFeature({
          name: 'Sustainable energy',
          externalId: feature(FEATURE.SUSTAINABILITY),
          category: DEVICE_FEATURE_CATEGORIES.GRID_CARBON_SENSOR,
          type: DEVICE_FEATURE_TYPES.GRID_CARBON_SENSOR.RENEWABLE_PERCENTAGE,
          unit: DEVICE_FEATURE_UNITS.PERCENT,
          min: 0,
          max: 100,
        }),
      ],
    };
  },

  states(gladys, installation, { electricityPrices, now }) {
    const { feature } = ids(gladys, installation);
    const current = slotAt(electricityPrices, now);
    const next = nextSlot(electricityPrices, now);
    return [
      ...numericState(feature(FEATURE.PRICE), current?.price),
      ...numericState(feature(FEATURE.NEXT_PRICE), next?.price),
      ...textState(feature(FEATURE.TARIFF_GROUP), current?.tariffGroup),
      ...numericState(feature(FEATURE.SUSTAINABILITY), current?.sustainability),
    ];
  },
};
