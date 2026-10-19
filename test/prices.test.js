// -----------------------------------------------------------------------------
// Price slots: parsing (1e-7 EUR), the slot at an instant, the cheapest period.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  averagePrice,
  cheapestPeriod,
  extremes,
  nextSlot,
  parsePriceSeries,
  slotAt,
  slotsOfDay,
} from '../src/zonneplan/prices.js';
import { formatDate, formatTime } from '../src/i18n.js';
import { HOUR_MS, NOW, priceChartFixture } from './helpers/fakeZonneplan.js';

const slots = parsePriceSeries(priceChartFixture());

test('amounts are ten-millionths of a euro, the permille becomes a percentage', () => {
  assert.equal(slots.length, 24);
  assert.equal(slots[0].price, 0.2);
  assert.equal(slots[0].tariffGroup, 'low');
  assert.equal(slots[0].sustainability, 50);
  assert.equal(slots[0].end - slots[0].start, HOUR_MS);
});

test('unusable entries are dropped and the slots come back sorted', () => {
  const chart = priceChartFixture({ hours: 3 });
  const prices = chart.chart.series.prices;
  prices.reverse();
  prices.push({ start_date: 'nope', end_date: 'nope', price_tax_included: { amount: 1 } });
  prices.push({ ...prices[0], price_tax_included: { amount: null } });
  const parsed = parsePriceSeries(chart);
  assert.equal(parsed.length, 3);
  assert.ok(parsed[0].start < parsed[1].start);
  assert.deepEqual(parsePriceSeries(undefined), []);
});

test('the slot at an instant and the next one', () => {
  // NOW is 12:10 in Amsterdam.
  assert.equal(formatTime(NOW), '12:10');
  assert.equal(slotAt(slots, NOW).price, 0.32);
  assert.equal(formatTime(nextSlot(slots, NOW).start), '13:00');
  assert.equal(slotAt(slots, NOW + 48 * HOUR_MS), null);
  assert.equal(nextSlot(slots, slots.at(-1).start), null);
});

test('the day of an instant is the Amsterdam day', () => {
  assert.equal(formatDate(Date.parse('2026-10-14T22:30:00Z')), '2026-10-15');
  assert.equal(slotsOfDay(slots, NOW).length, 24);
  const { cheapest, mostExpensive } = extremes(slots);
  assert.equal(formatTime(cheapest.start), '00:00');
  assert.equal(formatTime(mostExpensive.start), '23:00');
  assert.deepEqual(extremes([]), { cheapest: null, mostExpensive: null });
});

test('the average is weighted by duration', () => {
  assert.equal(averagePrice(slots.slice(0, 2)), 0.205);
  assert.equal(averagePrice([]), null);
});

test('the cheapest period is a run of consecutive slots, from the running one on', () => {
  // A dip at 15:00-17:00 (h 15 and 16).
  const dip = parsePriceSeries(
    priceChartFixture({ price: (h) => (h === 15 || h === 16 ? 0.05 : 0.3) }),
  );
  const period = cheapestPeriod(dip, { now: NOW, durationMs: 2 * HOUR_MS, withinMs: 24 * HOUR_MS });
  assert.equal(formatTime(period.start), '15:00');
  assert.equal(formatTime(period.end), '17:00');
  assert.equal(period.average, 0.05);

  // Too far: out of the window.
  assert.equal(
    cheapestPeriod(dip, { now: NOW, durationMs: 2 * HOUR_MS, withinMs: 3 * HOUR_MS }).average,
    0.3,
  );
  // Nothing long enough.
  assert.equal(
    cheapestPeriod(dip, { now: NOW, durationMs: 30 * HOUR_MS, withinMs: 48 * HOUR_MS }),
    null,
  );
});

test('a hole in the prices breaks the run', () => {
  const holed = slots.filter((_slot, index) => index !== 14);
  const period = cheapestPeriod(holed, {
    now: NOW,
    durationMs: 3 * HOUR_MS,
    withinMs: 12 * HOUR_MS,
  });
  // 12-15 would be cheapest but 14:00 is missing: 15-18 is the first full run.
  assert.equal(formatTime(period.start), '15:00');
});

test('the running slot counts from its start, so a period can start now', () => {
  const period = cheapestPeriod(slots, { now: NOW, durationMs: HOUR_MS, withinMs: 6 * HOUR_MS });
  assert.equal(formatTime(period.start), '12:00');
});
