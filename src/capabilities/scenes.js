// -----------------------------------------------------------------------------
// Scene triggers and scene actions (Gladys 5.1+).
//
// TRIGGERS — something happened, fired with gladys.publishSceneEvent:
//   tariff_group_changed      the new slot is in another tariff group
//   negative_price_started    the price just went below zero
//   next_day_prices_available tomorrow's electricity prices are published
//   charging_started          a charge point started charging
//   charging_stopped          ... and stopped
// Each one fires once per transition, from what the integration saw: the
// first look after a (re)start only records the situation, so a restart
// never replays an event.
//
// ACTIONS — an operation a scene runs, keyed like the manifest
// `scene_actions`, registered by index.js with gladys.onSceneAction:
//   get_current_price, find_cheapest_period, start_boost_charging,
//   stop_charging
// They never fire a trigger themselves: a scene bound to it would loop.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { INSTALLATION_KINDS } from '../zonneplan/account.js';
import {
  averagePrice,
  cheapestPeriod,
  coveredUntil,
  extremes,
  nextSlot,
  slotAt,
  slotsOfDay,
} from '../zonneplan/prices.js';
import { formatDate, formatTime } from '../i18n.js';
import { findInstallation } from '../devices/index.js';
import { setCharging } from '../devices/chargePoint.js';

const logger = createLogger({ name: 'scenes' });

export const SCENE_TRIGGERS = {
  TARIFF_GROUP_CHANGED: 'tariff_group_changed',
  NEGATIVE_PRICE_STARTED: 'negative_price_started',
  NEXT_DAY_PRICES_AVAILABLE: 'next_day_prices_available',
  CHARGING_STARTED: 'charging_started',
  CHARGING_STOPPED: 'charging_stopped',
};

const HOUR_MS = 3_600_000;

/**
 * Compare what was seen before with the prices now, and list the events.
 *
 * @param {object|null} previous what `memory` held after the last call
 *   (null on the first look)
 * @returns {{ events: Array<{ key: string, data: object }>, memory: object }}
 */
export function priceEvents(previous, slots, now) {
  const current = slotAt(slots, now);
  const memory = {
    tariffGroup: current?.tariffGroup ?? previous?.tariffGroup ?? null,
    negative: current ? current.price < 0 : (previous?.negative ?? false),
    coveredUntil: Math.max(coveredUntil(slots), previous?.coveredUntil ?? 0),
    slotStart: current?.start ?? previous?.slotStart ?? null,
  };
  const events = [];
  if (!previous || !current) {
    return { events, memory };
  }
  if (current.tariffGroup && previous.tariffGroup && current.tariffGroup !== previous.tariffGroup) {
    events.push({
      key: SCENE_TRIGGERS.TARIFF_GROUP_CHANGED,
      data: {
        tariff_group: current.tariffGroup,
        previous_tariff_group: previous.tariffGroup,
        price: current.price,
      },
    });
  }
  if (current.price < 0 && !previous.negative) {
    events.push({
      key: SCENE_TRIGGERS.NEGATIVE_PRICE_STARTED,
      data: { price: current.price, ends_at: formatTime(current.end) },
    });
  }
  // The day-ahead auction publishes a whole new day: the prices now reach
  // further than before by more than a few slots.
  const newDayStart = previous.coveredUntil;
  if (previous.coveredUntil > 0 && memory.coveredUntil - previous.coveredUntil >= 12 * HOUR_MS) {
    const newDay = slots.filter((slot) => slot.start >= newDayStart);
    const { cheapest, mostExpensive } = extremes(newDay);
    if (cheapest) {
      events.push({
        key: SCENE_TRIGGERS.NEXT_DAY_PRICES_AVAILABLE,
        data: {
          date: formatDate(cheapest.start),
          cheapest_time: formatTime(cheapest.start),
          cheapest_price: cheapest.price,
          most_expensive_time: formatTime(mostExpensive.start),
          most_expensive_price: mostExpensive.price,
          average_price: averagePrice(newDay),
        },
      });
    }
  }
  return { events, memory };
}

/**
 * Charge point transitions between two readings.
 * @param {Map<string, boolean>} previous charging flag per installation id
 */
export function chargingEvents(gladys, previous, installations, readings, deviceExternalId) {
  const memory = new Map(previous);
  const events = [];
  for (const installation of installations) {
    if (installation.kind !== INSTALLATION_KINDS.CHARGE_POINT) continue;
    const reading = readings.get(installation.id);
    if (!reading || reading.power === null) continue;
    const before = previous.get(installation.id);
    memory.set(installation.id, reading.charging);
    if (before === undefined || before === reading.charging) continue;
    events.push({
      key: reading.charging ? SCENE_TRIGGERS.CHARGING_STARTED : SCENE_TRIGGERS.CHARGING_STOPPED,
      data: {
        device: deviceExternalId(gladys, installation),
        power: reading.power,
        session_energy: reading.sessionEnergy,
      },
    });
  }
  return { events, memory };
}

function chargePointFor(gladys, sync, externalId) {
  const installation = findInstallation(gladys, sync.installations, externalId);
  return installation?.kind === INSTALLATION_KINDS.CHARGE_POINT ? installation : null;
}

export const SCENE_ACTIONS = {
  async get_current_price(_gladys, { sync, now = Date.now() }) {
    const slots = sync.electricityPrices;
    const current = slotAt(slots, now);
    const next = nextSlot(slots, now);
    const { cheapest } = extremes(slotsOfDay(slots, now));
    return {
      price: current?.price ?? null,
      next_price: next?.price ?? null,
      tariff_group: current?.tariffGroup ?? null,
      sustainability: current?.sustainability ?? null,
      cheapest_time_today: cheapest ? formatTime(cheapest.start) : null,
      cheapest_price_today: cheapest?.price ?? null,
    };
  },

  async find_cheapest_period(_gladys, { fields, sync, now = Date.now() }) {
    const durationHours = Number(fields.duration_hours ?? 1);
    const withinHours = Number(fields.within_hours ?? 24);
    const period = cheapestPeriod(sync.electricityPrices, {
      now,
      durationMs: durationHours * HOUR_MS,
      withinMs: withinHours * HOUR_MS,
    });
    logger.info(
      `find_cheapest_period ${durationHours} h within ${withinHours} h -> ${period ? formatTime(period.start) : 'none'}`,
    );
    if (!period) {
      return {
        found: false,
        start_time: null,
        end_time: null,
        average_price: null,
        starts_in_minutes: null,
        starts_now: false,
      };
    }
    const startsIn = Math.max(0, Math.round((period.start - now) / 60_000));
    return {
      found: true,
      start_time: formatTime(period.start),
      end_time: formatTime(period.end),
      average_price: period.average,
      starts_in_minutes: startsIn,
      starts_now: period.start <= now,
    };
  },

  async start_boost_charging(gladys, { fields, sync }) {
    const installation = chargePointFor(gladys, sync, fields.device);
    if (!installation) {
      return { sent: false };
    }
    await setCharging(sync.client, installation, true);
    sync.requestReadingsSoon();
    return { sent: true };
  },

  async stop_charging(gladys, { fields, sync }) {
    const installation = chargePointFor(gladys, sync, fields.device);
    if (!installation) {
      return { sent: false };
    }
    await setCharging(sync.client, installation, false);
    sync.requestReadingsSoon();
    return { sent: true };
  },
};
