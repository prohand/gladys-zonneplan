// -----------------------------------------------------------------------------
// Dynamic prices: GET /api/consumer-prices/charts/<chart>.
//
//   electricity-hourly, electricity-quarter-hourly, gas-daily
//     data.chart.series.prices[] = {
//       start_date, end_date,                      ISO instants
//       price_tax_included.amount,                 in 1e-7 EUR (per kWh or m³)
//       price_tax_excluded.amount,
//       tariff_group,                              'low' | 'normal' | 'high'
//       sustainability_score.permille              share of sustainable energy
//     }
//
// The day-ahead market publishes tomorrow's electricity prices in the
// afternoon; gas prices change once a day, at 06:00 Amsterdam time.
// Everything below is pure: the slots are parsed once, then read at any instant.
// -----------------------------------------------------------------------------

import { formatDate } from '../i18n.js';

// Zonneplan amounts are integers in ten-millionths of a euro.
export const AMOUNT_FACTOR = 1e-7;

export const TARIFF_GROUPS = ['low', 'normal', 'high'];

function amount(value) {
  const raw = typeof value === 'object' && value !== null ? value.amount : value;
  const number = Number(raw);
  return raw === null || raw === undefined || !Number.isFinite(number)
    ? null
    : Math.round(number * AMOUNT_FACTOR * 100000) / 100000;
}

/**
 * The price slots of a chart answer, sorted, without the unusable ones.
 * @param {object} chart the `data` of a consumer-prices chart
 * @returns {Array<{ start: number, end: number, price: number,
 *   priceExclTax: number|null, tariffGroup: string|null,
 *   sustainability: number|null }>}
 */
export function parsePriceSeries(chart) {
  const raw = chart?.chart?.series?.prices ?? [];
  const slots = [];
  for (const entry of raw) {
    const start = Date.parse(entry.start_date);
    const end = Date.parse(entry.end_date);
    const price = amount(entry.price_tax_included);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || price === null) {
      continue;
    }
    const permille = Number(entry.sustainability_score?.permille);
    slots.push({
      start,
      end,
      price,
      priceExclTax: amount(entry.price_tax_excluded),
      tariffGroup: TARIFF_GROUPS.includes(entry.tariff_group) ? entry.tariff_group : null,
      sustainability: Number.isFinite(permille) ? Math.round(permille) / 10 : null,
    });
  }
  return slots.sort((a, b) => a.start - b.start);
}

/** The slot running at `now`, or null. */
export function slotAt(slots, now) {
  return slots.find((slot) => slot.start <= now && now < slot.end) ?? null;
}

/** The first slot starting after the one running at `now`, or null. */
export function nextSlot(slots, now) {
  const current = slotAt(slots, now);
  const after = current ? current.end : now;
  return slots.find((slot) => slot.start >= after) ?? null;
}

/** The slots of the Amsterdam day of `now`. */
export function slotsOfDay(slots, now) {
  const day = formatDate(now);
  return slots.filter((slot) => formatDate(slot.start) === day);
}

/** Cheapest and most expensive slot among `slots`, or nulls. */
export function extremes(slots) {
  if (slots.length === 0) {
    return { cheapest: null, mostExpensive: null };
  }
  let cheapest = slots[0];
  let mostExpensive = slots[0];
  for (const slot of slots) {
    if (slot.price < cheapest.price) cheapest = slot;
    if (slot.price > mostExpensive.price) mostExpensive = slot;
  }
  return { cheapest, mostExpensive };
}

/** Mean price of `slots`, weighted by their duration. */
export function averagePrice(slots) {
  let total = 0;
  let duration = 0;
  for (const slot of slots) {
    total += slot.price * (slot.end - slot.start);
    duration += slot.end - slot.start;
  }
  return duration === 0 ? null : Math.round((total / duration) * 100000) / 100000;
}

/**
 * The cheapest run of consecutive slots lasting at least `durationMs`, starting
 * no earlier than the running slot and ending before `now + withinMs`.
 *
 * "Consecutive" matters: a dishwasher cannot pause between two cheap hours.
 * The running slot counts from its start, so the answer can be "now".
 *
 * @returns {{ start: number, end: number, average: number }|null}
 */
export function cheapestPeriod(slots, { now, durationMs, withinMs }) {
  const current = slotAt(slots, now);
  const from = current ? current.start : now;
  const until = now + withinMs;
  const candidates = slots.filter((slot) => slot.start >= from && slot.end <= until);
  let best = null;
  for (let first = 0; first < candidates.length; first += 1) {
    const run = [];
    for (let index = first; index < candidates.length; index += 1) {
      const slot = candidates[index];
      if (run.length > 0 && slot.start !== run[run.length - 1].end) {
        break; // a hole in the published prices
      }
      run.push(slot);
      if (slot.end - run[0].start >= durationMs) {
        const average = averagePrice(run);
        if (best === null || average < best.average) {
          best = { start: run[0].start, end: slot.end, average };
        }
        break;
      }
    }
  }
  return best;
}

/** The last instant covered by the slots, 0 when there are none. */
export function coveredUntil(slots) {
  return slots.length === 0 ? 0 : slots[slots.length - 1].end;
}
