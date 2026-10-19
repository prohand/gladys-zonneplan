// -----------------------------------------------------------------------------
// What the Zonneplan account holds: GET /user-accounts/me.
//
//   address_groups[]           one per address
//     connections[]            one per grid connection (EAN)
//       contracts[]            what Zonneplan supplies or monitors there:
//         electricity, gas                    -> the dynamic tariffs
//         p1_installation                     -> the Connect P1 dongle
//         pv_installation                     -> solar panels
//         home_battery_installation           -> the Nexus home battery
//         charge_point_installation           -> the charge point
//
// Each supported contract becomes one installation, and each installation one
// Gladys device. The tariffs are keyed on the CONNECTION (a renewed contract
// gets a new uuid, the connection stays); the equipment on its contract uuid.
// -----------------------------------------------------------------------------

export const INSTALLATION_KINDS = {
  ELECTRICITY: 'electricity',
  GAS: 'gas',
  P1: 'p1_installation',
  PV: 'pv_installation',
  BATTERY: 'home_battery_installation',
  CHARGE_POINT: 'charge_point_installation',
};

const TARIFF_KINDS = [INSTALLATION_KINDS.ELECTRICITY, INSTALLATION_KINDS.GAS];
const SUPPORTED_KINDS = Object.values(INSTALLATION_KINDS);

function addressLabel(addressGroup) {
  const address = addressGroup?.address ?? {};
  const parts = [address.street, [address.number, address.addition].filter(Boolean).join('')];
  const label = parts.filter(Boolean).join(' ').trim();
  return label || address.city || null;
}

function hasEnded(contract, now) {
  if (!contract.end_date) {
    return false;
  }
  const end = Date.parse(contract.end_date);
  return Number.isFinite(end) && end < now;
}

/**
 * The installations of an account, in a stable order.
 *
 * @param {object} account the `data` of GET /user-accounts/me
 * @param {number} now ms epoch, to leave the ended contracts out
 * @returns {Array<{ id: string, kind: string, connectionUuid: string,
 *   contractUuid: string, label: string|null, address: string|null,
 *   meta: object }>}
 */
export function parseInstallations(account, now = Date.now()) {
  const installations = [];
  const seen = new Set();
  for (const group of account?.address_groups ?? []) {
    const address = addressLabel(group);
    for (const connection of group.connections ?? []) {
      for (const contract of connection.contracts ?? []) {
        if (!SUPPORTED_KINDS.includes(contract.type) || hasEnded(contract, now)) {
          continue;
        }
        const isTariff = TARIFF_KINDS.includes(contract.type);
        // One tariff device per connection and energy, whatever the number of
        // successive contracts listed for it.
        const id = isTariff ? `${contract.type}:${connection.uuid}` : contract.uuid;
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        installations.push({
          id,
          kind: contract.type,
          connectionUuid: connection.uuid,
          contractUuid: contract.uuid,
          label: contract.label ?? null,
          address,
          meta: contract.meta ?? {},
        });
      }
    }
  }
  return installations;
}

/** The connections that carry at least one installation of `kind`. */
export function connectionsWith(installations, kind) {
  return [...new Set(installations.filter((i) => i.kind === kind).map((i) => i.connectionUuid))];
}
