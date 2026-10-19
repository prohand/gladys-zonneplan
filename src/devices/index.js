// -----------------------------------------------------------------------------
// Device registry.
//
// One blueprint per installation kind (see src/zonneplan/account.js). Each
// blueprint exposes:
//   - kind                                        the installation kind it serves
//   - deviceExternalId(gladys, installation)      the device external_id
//   - buildDevice(gladys, installation, context)  the discovery payload
//   - states(gladys, installation, data)          the states to publish now
//   - onSetValue(gladys, {...})      (optional)   run a user command
//
// Devices are not hard-coded: the account says which installations exist,
// and every one of them becomes a device.
// -----------------------------------------------------------------------------

import { electricityTariff } from './electricityTariff.js';
import { gasTariff } from './gasTariff.js';
import { p1Meter } from './p1Meter.js';
import { solarPanels } from './solarPanels.js';
import { homeBattery } from './homeBattery.js';
import { chargePoint } from './chargePoint.js';

export const DEVICE_BLUEPRINTS = [
  electricityTariff,
  gasTariff,
  p1Meter,
  solarPanels,
  homeBattery,
  chargePoint,
];

export function blueprintOf(installation) {
  return DEVICE_BLUEPRINTS.find((bp) => bp.kind === installation.kind) ?? null;
}

function context(installations) {
  return { multipleAddresses: new Set(installations.map((i) => i.address)).size > 1 };
}

/** The discovery payload: one device per installation. */
export function buildDiscoveredDevices(gladys, installations) {
  const ctx = context(installations);
  return installations.map((installation) =>
    blueprintOf(installation).buildDevice(gladys, installation, ctx),
  );
}

/** The installation behind a Gladys device external_id, or null. */
export function findInstallation(gladys, installations, externalId) {
  return (
    installations.find(
      (installation) =>
        blueprintOf(installation).deviceExternalId(gladys, installation) === externalId,
    ) ?? null
  );
}

/** Every state the devices should show now. */
export function buildStates(gladys, installations, data) {
  return installations.flatMap((installation) =>
    blueprintOf(installation).states(gladys, installation, data),
  );
}
