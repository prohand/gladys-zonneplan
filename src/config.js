// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user from the `config_schema` of
// gladys-assistant-integration.json; this module provides the defaults and
// normalizes the received object, so the rest of the code never deals with
// `undefined` or with numbers typed as strings.
//
// The Zonneplan tokens are NOT configuration: they come from the sign-in
// actions and live in /data (see src/storage.js).
// -----------------------------------------------------------------------------

export const PRICE_INTERVALS = { HOURLY: 'hourly', QUARTER_HOURLY: 'quarter_hourly' };

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (checked by test/manifest.test.js).
export const DEFAULT_CONFIG = {
  email: '',
  price_interval: PRICE_INTERVALS.HOURLY,
  // Seconds between two reads of the installations (P1 meter, solar panels,
  // battery, charge point). The Zonneplan app API is rate-limited: five
  // minutes is what the app itself uses.
  poll_frequency: 300,
};

const MIN_POLL_FREQUENCY = 60;
const MAX_POLL_FREQUENCY = 3600;

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const pollFrequency = Number(raw.poll_frequency ?? DEFAULT_CONFIG.poll_frequency);
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    email: String(raw.email ?? '')
      .trim()
      .toLowerCase(),
    price_interval: Object.values(PRICE_INTERVALS).includes(raw.price_interval)
      ? raw.price_interval
      : DEFAULT_CONFIG.price_interval,
    poll_frequency: Number.isFinite(pollFrequency)
      ? Math.min(MAX_POLL_FREQUENCY, Math.max(MIN_POLL_FREQUENCY, pollFrequency))
      : DEFAULT_CONFIG.poll_frequency,
  };
}
