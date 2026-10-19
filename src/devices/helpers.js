// -----------------------------------------------------------------------------
// Shared bits of the device blueprints.
// -----------------------------------------------------------------------------

/**
 * A read-only measured feature. Every feature declares `min`/`max`: Gladys
 * stores them NOT NULL.
 */
export function sensorFeature({
  name,
  externalId,
  category,
  type,
  unit,
  min,
  max,
  history = true,
}) {
  return {
    name,
    external_id: externalId,
    category,
    type,
    ...(unit === undefined ? {} : { unit }),
    min,
    max,
    read_only: true,
    has_feedback: false,
    keep_history: history,
  };
}

/** A device name, followed by the address when the account holds several. */
export function deviceName(base, installation, context) {
  return context.multipleAddresses && installation.address
    ? `${base} (${installation.address})`
    : base;
}

/** One `publishChangedStates` entry, or none when the value is unknown. */
export function numericState(externalId, value) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? []
    : [{ device_feature_external_id: externalId, state: value }];
}

export function textState(externalId, text) {
  return typeof text === 'string' && text.length > 0
    ? [{ device_feature_external_id: externalId, text }]
    : [];
}
