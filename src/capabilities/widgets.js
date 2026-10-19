// -----------------------------------------------------------------------------
// Dashboard widgets (Gladys 5.1+).
//
//   energy_prices        the price now and next, the share of sustainable
//                        energy, the price curve of the coming hours and
//                        the cheapest / most expensive slot of the day;
//   zonneplan_overview   live tiles of the installations (grid, solar,
//                        battery, charge point), the connection, and the
//                        charge buttons.
//
// The contents are declarative (no HTML): the core renders them with its own
// theme. The price tiles are computed (the slot moves on the clock), the
// installation tiles are bound to device features and follow the published
// states live. index.js nudges the widgets (requestWidgetRefresh) when the
// slot or the data changes; `ttl_seconds` is only the safety net.
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_TYPES,
  WIDGET_COLORS,
} from '@gladysassistant/integration-sdk';
import { INSTALLATION_KINDS } from '../zonneplan/account.js';
import { extremes, nextSlot, slotAt, slotsOfDay } from '../zonneplan/prices.js';
import { blueprintOf, findInstallation } from '../devices/index.js';
import { setCharging } from '../devices/chargePoint.js';
import { formatPrice, formatTime, localize, pick } from '../i18n.js';

const logger = createLogger({ name: 'widgets' });

export const PRICES_WIDGET = 'energy_prices';
export const OVERVIEW_WIDGET = 'zonneplan_overview';

const ACTIONS = { REFRESH: 'refresh', START_BOOST: 'start_boost', STOP_CHARGING: 'stop_charging' };

const HOUR_MS = 3_600_000;
// How far back the curve starts: the slot before the current one gives the
// "it just dropped" context; the rest is the future, as far as published.
const CHART_HISTORY_MS = 2 * HOUR_MS;
const CHART_MAX_POINTS = 300;
const PRICE_UNIT = '€/kWh';
// The content budget of the core: more components are dropped.
const MAX_COMPONENTS = 8;

const TARIFF_GROUPS = {
  low: { label: { en: 'Low', fr: 'Bas', de: 'Niedrig', es: 'Bajo' }, color: WIDGET_COLORS.SUCCESS },
  normal: {
    label: { en: 'Normal', fr: 'Normal', de: 'Normal', es: 'Normal' },
    color: WIDGET_COLORS.NEUTRAL,
  },
  high: { label: { en: 'High', fr: 'Élevé', de: 'Hoch', es: 'Alto' }, color: WIDGET_COLORS.DANGER },
};

const STATUS_TEXTS = {
  ok: {
    label: { en: 'Connected', fr: 'Connecté', de: 'Verbunden', es: 'Conectado' },
    color: WIDGET_COLORS.SUCCESS,
  },
  rate_limited: {
    label: { en: 'Slowed down', fr: 'Ralenti', de: 'Gedrosselt', es: 'Ralentizado' },
    color: WIDGET_COLORS.WARNING,
  },
  unreachable: {
    label: { en: 'Unreachable', fr: 'Injoignable', de: 'Nicht erreichbar', es: 'Inaccesible' },
    color: WIDGET_COLORS.DANGER,
  },
  session_expired: {
    label: {
      en: 'Session expired',
      fr: 'Session expirée',
      de: 'Sitzung abgelaufen',
      es: 'Sesión caducada',
    },
    color: WIDGET_COLORS.DANGER,
  },
  not_signed_in: {
    label: { en: 'Not signed in', fr: 'Non connecté', de: 'Nicht angemeldet', es: 'Sin sesión' },
    color: WIDGET_COLORS.WARNING,
  },
};

const SIGN_IN_HINT = {
  type: 'text',
  variant: 'body',
  text: {
    en: 'Sign in to Zonneplan from the configuration of the integration.',
    fr: "Connectez-vous à Zonneplan depuis la configuration de l'intégration.",
    de: 'Melde dich in der Konfiguration der Integration bei Zonneplan an.',
    es: 'Inicie sesión en Zonneplan desde la configuración de la integración.',
  },
};

const REFRESH_BUTTON = {
  type: 'button',
  label: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  icon: 'refresh-cw',
  style: 'secondary',
  action: { key: ACTIONS.REFRESH },
};

function priceColor(slot) {
  if (!slot) return WIDGET_COLORS.NEUTRAL;
  if (slot.price < 0) return WIDGET_COLORS.INFO;
  return TARIFF_GROUPS[slot.tariffGroup]?.color ?? WIDGET_COLORS.NEUTRAL;
}

function slotText(slot) {
  return slot ? `${formatTime(slot.start)} · ${formatPrice(slot.price)} €` : '—';
}

function priceChart(slots, now) {
  const from = now - CHART_HISTORY_MS;
  const shown = slots.filter((slot) => slot.end > from).slice(0, CHART_MAX_POINTS);
  const today = slotsOfDay(slots, now);
  const { cheapest, mostExpensive } = extremes(today);
  const annotations = [];
  if (cheapest) {
    annotations.push({
      t: new Date(cheapest.start).toISOString(),
      value: cheapest.price,
      label: { en: 'Cheapest', fr: 'Le moins cher', de: 'Am günstigsten', es: 'Más barato' },
      color: WIDGET_COLORS.SUCCESS,
    });
  }
  if (mostExpensive && mostExpensive !== cheapest) {
    annotations.push({
      t: new Date(mostExpensive.start).toISOString(),
      value: mostExpensive.price,
      label: { en: 'Most expensive', fr: 'Le plus cher', de: 'Am teuersten', es: 'Más caro' },
      color: WIDGET_COLORS.DANGER,
    });
  }
  return {
    type: 'chart',
    chart_type: 'stepline',
    title: {
      en: 'Electricity price',
      fr: "Prix de l'électricité",
      de: 'Strompreis',
      es: 'Precio de la luz',
    },
    unit: PRICE_UNIT,
    now_marker: true,
    series: [
      {
        name: { en: 'Price', fr: 'Prix', de: 'Preis', es: 'Precio' },
        points: shown.map((slot) => ({ t: new Date(slot.start).toISOString(), v: slot.price })),
      },
    ],
    annotations,
  };
}

/** Content of the energy_prices widget. */
export function pricesContent(sync, now = sync.now()) {
  const slots = sync.electricityPrices;
  if (slots.length === 0) {
    return { ttl_seconds: 300, components: [SIGN_IN_HINT, REFRESH_BUTTON] };
  }
  const current = slotAt(slots, now);
  const next = nextSlot(slots, now);
  const { cheapest, mostExpensive } = extremes(slotsOfDay(slots, now));
  const group = TARIFF_GROUPS[current?.tariffGroup];
  const components = [
    {
      type: 'value',
      label: { en: 'Now', fr: 'Maintenant', de: 'Jetzt', es: 'Ahora' },
      icon: 'zap',
      value: current ? Number(formatPrice(current.price)) : '—',
      unit: PRICE_UNIT,
      color: priceColor(current),
    },
    {
      type: 'value',
      label: next
        ? localize(
            (language) =>
              `${pick(language, { en: 'From', fr: 'Dès', de: 'Ab', es: 'Desde' })} ${formatTime(next.start)}`,
          )
        : { en: 'Next', fr: 'Ensuite', de: 'Danach', es: 'Después' },
      icon: 'clock',
      value: next ? Number(formatPrice(next.price)) : '—',
      unit: PRICE_UNIT,
      color: priceColor(next),
    },
  ];
  if (current?.sustainability !== null && current?.sustainability !== undefined) {
    components.push({
      type: 'value',
      label: { en: 'Sustainable', fr: 'Durable', de: 'Nachhaltig', es: 'Sostenible' },
      icon: 'sun',
      value: Math.round(current.sustainability),
      unit: '%',
      color: WIDGET_COLORS.SUCCESS,
    });
  }
  components.push(priceChart(slots, now));
  components.push({
    type: 'status',
    items: [
      {
        label: {
          en: 'Tariff group',
          fr: 'Tranche tarifaire',
          de: 'Tarifgruppe',
          es: 'Tramo tarifario',
        },
        icon: 'tag',
        value: group?.label ?? '—',
        color: group?.color ?? WIDGET_COLORS.NEUTRAL,
      },
      {
        label: {
          en: 'Cheapest today',
          fr: "Le moins cher aujourd'hui",
          de: 'Heute am günstigsten',
          es: 'Más barato hoy',
        },
        icon: 'trending-down',
        value: slotText(cheapest),
        color: WIDGET_COLORS.SUCCESS,
      },
      {
        label: {
          en: 'Most expensive today',
          fr: "Le plus cher aujourd'hui",
          de: 'Heute am teuersten',
          es: 'Más caro hoy',
        },
        icon: 'trending-up',
        value: slotText(mostExpensive),
        color: WIDGET_COLORS.DANGER,
      },
    ],
  });
  components.push(REFRESH_BUTTON);
  return { ttl_seconds: 300, components };
}

function firstOf(sync, kind) {
  return sync.installations.find((installation) => installation.kind === kind) ?? null;
}

function liveTile(sync, kind, type, { label, icon }) {
  const installation = firstOf(sync, kind);
  if (!installation) return null;
  const device = blueprintOf(installation).buildDevice(sync.gladys, installation, {});
  const feature = device.features.find((f) => f.type === type);
  return { type: 'value', label, icon, device_feature: feature.external_id };
}

/** Content of the zonneplan_overview widget. */
export function overviewContent(sync) {
  if (sync.installations.length === 0) {
    const status = STATUS_TEXTS[sync.status] ?? STATUS_TEXTS.unreachable;
    return {
      ttl_seconds: 300,
      components: [
        sync.status === 'ok'
          ? {
              type: 'text',
              variant: 'body',
              text: {
                en: 'No Zonneplan installation found on this account.',
                fr: 'Aucune installation Zonneplan sur ce compte.',
                de: 'Keine Zonneplan-Anlage in diesem Konto.',
                es: 'No hay ninguna instalación Zonneplan en esta cuenta.',
              },
            }
          : SIGN_IN_HINT,
        {
          type: 'status',
          items: [{ label: 'Zonneplan', icon: 'cloud', value: status.label, color: status.color }],
        },
        REFRESH_BUTTON,
      ],
    };
  }

  const tiles = [
    liveTile(sync, INSTALLATION_KINDS.P1, DEVICE_FEATURE_TYPES.GRID_SENSOR.INPUT_POWER, {
      label: { en: 'From the grid', fr: 'Depuis le réseau', de: 'Aus dem Netz', es: 'De la red' },
      icon: 'activity',
    }),
    liveTile(sync, INSTALLATION_KINDS.P1, DEVICE_FEATURE_TYPES.GRID_SENSOR.OUTPUT_POWER, {
      label: { en: 'To the grid', fr: 'Vers le réseau', de: 'Ins Netz', es: 'A la red' },
      icon: 'corner-up-left',
    }),
    liveTile(sync, INSTALLATION_KINDS.PV, DEVICE_FEATURE_TYPES.ENERGY_PRODUCTION_SENSOR.POWER, {
      label: { en: 'Solar', fr: 'Solaire', de: 'Solar', es: 'Solar' },
      icon: 'sun',
    }),
    liveTile(sync, INSTALLATION_KINDS.BATTERY, DEVICE_FEATURE_TYPES.BATTERY_STORAGE.BATTERY_LEVEL, {
      label: { en: 'Battery', fr: 'Batterie', de: 'Batterie', es: 'Batería' },
      icon: 'battery-charging',
    }),
    liveTile(
      sync,
      INSTALLATION_KINDS.CHARGE_POINT,
      DEVICE_FEATURE_TYPES.ELECTRICAL_VEHICLE_CHARGE.CHARGE_POWER,
      {
        label: { en: 'Charging', fr: 'Recharge', de: 'Laden', es: 'Recarga' },
        icon: 'battery',
      },
    ),
  ].filter(Boolean);

  const status = STATUS_TEXTS[sync.status] ?? STATUS_TEXTS.unreachable;
  const items = [{ label: 'Zonneplan', icon: 'cloud', value: status.label, color: status.color }];
  if (sync.lastSuccessAt) {
    items.push({
      label: {
        en: 'Last update',
        fr: 'Dernière mise à jour',
        de: 'Letzte Aktualisierung',
        es: 'Última actualización',
      },
      icon: 'clock',
      value: formatTime(sync.lastSuccessAt),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  const battery = firstOf(sync, INSTALLATION_KINDS.BATTERY);
  const batteryState = battery && sync.readings.get(battery.id)?.state;
  if (batteryState) {
    items.push({
      label: { en: 'Battery', fr: 'Batterie', de: 'Batterie', es: 'Batería' },
      icon: 'battery',
      value: String(batteryState).slice(0, 40),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  const charger = firstOf(sync, INSTALLATION_KINDS.CHARGE_POINT);
  const chargerReading = charger && sync.readings.get(charger.id);
  if (chargerReading?.state) {
    items.push({
      label: { en: 'Charge point', fr: 'Borne', de: 'Ladestation', es: 'Punto de recarga' },
      icon: 'zap',
      value: String(chargerReading.state).slice(0, 40),
      color: chargerReading.charging ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    });
  }

  const components = [...tiles, { type: 'status', items }];
  if (charger) {
    const device = blueprintOf(charger).deviceExternalId(sync.gladys, charger);
    components.push(
      {
        type: 'button',
        label: {
          en: 'Charge now',
          fr: 'Recharger maintenant',
          de: 'Jetzt laden',
          es: 'Cargar ahora',
        },
        icon: 'zap',
        style: 'primary',
        action: { key: ACTIONS.START_BOOST, params: { device }, confirm: true },
      },
      {
        type: 'button',
        label: {
          en: 'Stop charging',
          fr: 'Arrêter la recharge',
          de: 'Laden stoppen',
          es: 'Parar la recarga',
        },
        icon: 'square',
        style: 'danger',
        action: { key: ACTIONS.STOP_CHARGING, params: { device }, confirm: true },
      },
    );
  }
  // The core keeps 8 components: the refresh button comes last, when there
  // is room left (the charge buttons matter more).
  if (components.length < MAX_COMPONENTS) {
    components.push(REFRESH_BUTTON);
  }
  return { ttl_seconds: 300, components };
}

const TOASTS = {
  refreshed: { en: 'Refreshed', fr: 'Actualisé', de: 'Aktualisiert', es: 'Actualizado' },
  boost: {
    en: 'Boost charge requested',
    fr: 'Recharge immédiate demandée',
    de: 'Sofortladen angefordert',
    es: 'Carga inmediata solicitada',
  },
  stop: {
    en: 'Stop requested',
    fr: 'Arrêt demandé',
    de: 'Stopp angefordert',
    es: 'Parada solicitada',
  },
};

async function act(gladys, { actionKey, params, sync }) {
  logger.info(`Widget action ${actionKey}`);
  if (actionKey === ACTIONS.REFRESH) {
    sync.invalidate();
    await sync.tick();
    return TOASTS.refreshed;
  }
  if (actionKey === ACTIONS.START_BOOST || actionKey === ACTIONS.STOP_CHARGING) {
    const installation = findInstallation(gladys, sync.installations, params?.device);
    if (installation?.kind !== INSTALLATION_KINDS.CHARGE_POINT) {
      throw new Error('Unknown charge point');
    }
    const on = actionKey === ACTIONS.START_BOOST;
    await setCharging(sync.client, installation, on);
    sync.requestReadingsSoon();
    return on ? TOASTS.boost : TOASTS.stop;
  }
  // Throwing acks the action as failed: the message reaches the user.
  throw new Error(`Unknown widget action: ${actionKey}`);
}

export const WIDGETS = {
  [PRICES_WIDGET]: {
    async get(_gladys, { sync }) {
      return pricesContent(sync);
    },
    action: act,
  },
  [OVERVIEW_WIDGET]: {
    async get(_gladys, { sync }) {
      return overviewContent(sync);
    },
    action: act,
  },
};

/** Ask the core to re-pull every widget now (rate-limited core-side). */
export function refreshWidgets(gladys) {
  for (const key of Object.keys(WIDGETS)) {
    gladys.requestWidgetRefresh(key);
  }
}
