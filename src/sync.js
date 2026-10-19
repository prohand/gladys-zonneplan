// -----------------------------------------------------------------------------
// The synchronisation loop: Zonneplan -> Gladys.
//
// One timer, ticking every minute while Gladys is connected:
//   - the account (which installations exist) is read at start-up, then
//     every hour: a new installation shows up in the Discovery tab;
//   - the prices are read every 15 minutes (they are known a day ahead, the
//     reads only catch the next day's publication);
//   - the installations are read at the user's refresh interval;
//   - the states are recomputed at EVERY tick from what is cached, so the
//     price changes on the slot boundary, not at the next API call.
// publishChangedStates only sends what changed (the host API takes 300
// states a minute), plus a heartbeat every 30 minutes.
//
// A failure never stops the loop: the next tick retries, a 429 pauses the
// calls until the delay Zonneplan asked for, and a lost session (refresh
// refused) waits for the user to sign in again.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { PRICE_INTERVALS } from './config.js';
import { INSTALLATION_KINDS, parseInstallations } from './zonneplan/account.js';
import { ZonneplanAuthError, ZonneplanRateLimitError } from './zonneplan/client.js';
import { parsePriceSeries } from './zonneplan/prices.js';
import { fetchReadings } from './zonneplan/readings.js';
import { blueprintOf, buildDiscoveredDevices, buildStates } from './devices/index.js';
import { chargingEvents, priceEvents } from './capabilities/scenes.js';
import { localize, pick, formatTime } from './i18n.js';

const logger = createLogger({ name: 'sync' });

const MINUTE_MS = 60_000;
export const TICK_MS = MINUTE_MS;
const ACCOUNT_REFRESH_MS = 60 * MINUTE_MS;
const PRICES_REFRESH_MS = 15 * MINUTE_MS;
const HEARTBEAT_MS = 30 * MINUTE_MS;
// Gladys ticks drift by a few milliseconds: a read due within the next
// half-minute runs now, so a 300 s interval does not slip to 360 s.
const DUE_TOLERANCE_MS = MINUTE_MS / 2;

const PRICE_CHARTS = {
  [PRICE_INTERVALS.HOURLY]: 'electricity-hourly',
  [PRICE_INTERVALS.QUARTER_HOURLY]: 'electricity-quarter-hourly',
};

export const STATUS_MESSAGES = {
  notSignedIn: {
    en: 'Not signed in: enter your e-mail, then use "Send me a sign-in code".',
    fr: 'Non connecté : saisissez votre e-mail, puis utilisez « M’envoyer un code de connexion ».',
    de: 'Nicht angemeldet: Gib deine E-Mail-Adresse ein und nutze dann „Anmeldecode senden“.',
    es: 'Sin sesión: introduzca su e-mail y luego use «Enviarme un código de acceso».',
  },
  sessionExpired: {
    en: 'The Zonneplan session expired: request a new sign-in code.',
    fr: 'La session Zonneplan a expiré : demandez un nouveau code de connexion.',
    de: 'Die Zonneplan-Sitzung ist abgelaufen: Fordere einen neuen Anmeldecode an.',
    es: 'La sesión de Zonneplan ha caducado: pida un nuevo código de acceso.',
  },
  unreachable: {
    en: 'Zonneplan cannot be reached, retrying every minute.',
    fr: 'Zonneplan est injoignable, nouvel essai chaque minute.',
    de: 'Zonneplan ist nicht erreichbar, neuer Versuch jede Minute.',
    es: 'No se puede contactar con Zonneplan, se reintenta cada minuto.',
  },
};

function rateLimitedMessage(until) {
  const time = formatTime(until);
  return localize((language) =>
    pick(language, {
      en: `Zonneplan asked to slow down: calls paused until ${time}.`,
      fr: `Zonneplan demande de ralentir : appels suspendus jusqu’à ${time}.`,
      de: `Zonneplan bittet um weniger Anfragen: Pause bis ${time}.`,
      es: `Zonneplan pide reducir las consultas: pausa hasta las ${time}.`,
    }),
  );
}

export class ZonneplanSync {
  /**
   * @param {object} options
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} options.gladys
   * @param {ReturnType<import('./zonneplan/client.js').createZonneplanClient>} options.client
   * @param {() => object} options.getConfig the current normalized config
   * @param {() => number} [options.now]
   * @param {(key: string) => void} [options.onDataChanged] called when the
   *   widget contents may have changed
   */
  constructor({ gladys, client, getConfig, now = Date.now, onDataChanged = () => {} }) {
    this.gladys = gladys;
    this.client = client;
    this.getConfig = getConfig;
    this.now = now;
    this.onDataChanged = onDataChanged;

    this.installations = [];
    this.electricityPrices = [];
    this.gasPrices = [];
    this.readings = new Map();

    this.lastAccountAt = 0;
    this.lastPricesAt = 0;
    this.lastReadingsAt = 0;
    this.lastSuccessAt = 0;
    this.priceInterval = null;
    // 'ok' | 'not_signed_in' | 'session_expired' | 'unreachable' | 'rate_limited'
    this.status = 'not_signed_in';

    this.priceMemory = null;
    this.chargingMemory = new Map();
    this.timer = null;
    this.running = null;
    this.lastStatusKey = null;
    this.lastTransports = null;
  }

  start() {
    this.stop();
    this.timer = setInterval(() => {
      this.tick().catch((err) => logger.error('Synchronisation tick failed', err));
    }, TICK_MS);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Read everything again at the next tick (after a sign-in, a config save). */
  invalidate() {
    this.lastAccountAt = 0;
    this.lastPricesAt = 0;
    this.lastReadingsAt = 0;
  }

  /** Read the installations at the next tick (after a command). */
  requestReadingsSoon() {
    this.lastReadingsAt = 0;
  }

  /**
   * One synchronisation round. Concurrent calls share the round in progress,
   * so a sign-in during a tick never runs two rounds side by side.
   */
  tick() {
    if (!this.running) {
      this.running = this.#round().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  async #round() {
    const config = this.getConfig();
    const now = this.now();
    const previousStatus = this.status;

    if (!(await this.client.isSignedIn())) {
      await this.#setStatus(
        this.status === 'session_expired' ? 'session_expired' : 'not_signed_in',
      );
      await this.#publishTransports();
      return;
    }

    try {
      if (now - this.lastAccountAt >= ACCOUNT_REFRESH_MS) {
        await this.#refreshAccount();
      }
      const priceIntervalChanged = this.priceInterval !== config.price_interval;
      if (priceIntervalChanged || now - this.lastPricesAt >= PRICES_REFRESH_MS) {
        await this.#refreshPrices(config.price_interval);
      }
      if (now - this.lastReadingsAt >= config.poll_frequency * 1000 - DUE_TOLERANCE_MS) {
        await this.#refreshReadings();
      }
      this.lastSuccessAt = this.now();
      await this.#setStatus('ok');
    } catch (err) {
      await this.#handleError(err);
    }

    await this.#publishStates();
    await this.#fireEvents();
    await this.#publishTransports();
    if (previousStatus !== this.status) {
      this.onDataChanged();
    }
  }

  async #refreshAccount() {
    const account = await this.client.get('user-accounts/me');
    const installations = parseInstallations(account, this.now());
    const changed =
      JSON.stringify(installations.map((i) => i.id)) !==
      JSON.stringify(this.installations.map((i) => i.id));
    this.installations = installations;
    this.lastAccountAt = this.now();
    if (changed) {
      logger.info(
        `Zonneplan account: ${installations.map((i) => i.kind).join(', ') || 'no installation'}`,
      );
      await this.publishDevices();
      this.onDataChanged();
    }
  }

  /** Publish the discovered devices (one per installation). */
  async publishDevices() {
    await this.gladys.publishDiscoveredDevices(
      buildDiscoveredDevices(this.gladys, this.installations),
    );
  }

  async #refreshPrices(priceInterval) {
    const hasKind = (kind) => this.installations.some((i) => i.kind === kind);
    // An account without an electricity contract (solar panels only) still
    // gets the prices: the widget and the scene actions use them.
    const electricity = await this.client.get(
      `api/consumer-prices/charts/${PRICE_CHARTS[priceInterval]}`,
    );
    this.electricityPrices = parsePriceSeries(electricity);
    if (hasKind(INSTALLATION_KINDS.GAS)) {
      this.gasPrices = parsePriceSeries(
        await this.client.get('api/consumer-prices/charts/gas-daily'),
      );
    }
    if (this.priceInterval !== priceInterval) {
      // Another slot length: the old memory would read as a price event.
      this.priceMemory = null;
    }
    this.priceInterval = priceInterval;
    this.lastPricesAt = this.now();
    this.onDataChanged();
  }

  async #refreshReadings() {
    const { readings, errors } = await fetchReadings(this.client, this.installations);
    for (const [id, reading] of readings) {
      this.readings.set(id, reading);
    }
    this.lastReadingsAt = this.now();
    // One installation failing is not the account failing: report it, and
    // let the others publish. An auth or rate-limit error is the account's.
    const fatal = errors.find(
      (err) => err instanceof ZonneplanAuthError || err instanceof ZonneplanRateLimitError,
    );
    if (fatal) {
      throw fatal;
    }
    for (const err of errors) {
      logger.warn(`Installation read failed: ${err.message}`);
    }
  }

  async #handleError(err) {
    if (err instanceof ZonneplanRateLimitError) {
      await this.#setStatus('rate_limited', err.until);
    } else if (err instanceof ZonneplanAuthError) {
      logger.warn(err.message);
      await this.#setStatus('session_expired');
    } else {
      logger.error('Zonneplan synchronisation failed', err);
      await this.#setStatus('unreachable');
    }
  }

  async #setStatus(status, until = null) {
    this.status = status;
    // Sent on change only: the Configuration screen needs no minute-by-minute
    // reminder of the same thing.
    const key = `${status}:${until ?? ''}`;
    if (key === this.lastStatusKey) {
      return;
    }
    this.lastStatusKey = key;
    const messages = {
      not_signed_in: STATUS_MESSAGES.notSignedIn,
      session_expired: STATUS_MESSAGES.sessionExpired,
      unreachable: STATUS_MESSAGES.unreachable,
    };
    try {
      if (status === 'ok') {
        await this.gladys.setConnectionStatus(true);
      } else if (status === 'rate_limited') {
        // Rate-limited is "connected, slowed down": the data keeps flowing.
        await this.gladys.setConnectionStatus(true, rateLimitedMessage(until));
      } else {
        await this.gladys.setConnectionStatus(false, messages[status]);
      }
    } catch (err) {
      logger.warn(`Connection status not sent: ${err.message}`);
    }
  }

  /** What the device blueprints read their states from. */
  data() {
    return {
      electricityPrices: this.electricityPrices,
      gasPrices: this.gasPrices,
      readings: this.readings,
      now: this.now(),
    };
  }

  async #publishStates() {
    const states = buildStates(this.gladys, this.installations, this.data());
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
    } catch (err) {
      // The SDK sends the refused states again at the next call.
      logger.warn(`States not published: ${err.message}`);
    }
  }

  async #fireEvents() {
    const now = this.now();
    const priceSlotBefore = this.priceMemory?.slotStart ?? null;
    const prices = priceEvents(this.priceMemory, this.electricityPrices, now);
    this.priceMemory = prices.memory;
    const charging = chargingEvents(
      this.gladys,
      this.chargingMemory,
      this.installations,
      this.readings,
      (gladys, installation) => blueprintOf(installation).deviceExternalId(gladys, installation),
    );
    this.chargingMemory = charging.memory;

    for (const { key, data } of [...prices.events, ...charging.events]) {
      try {
        await this.gladys.publishSceneEvent(key, data);
        logger.info(`Scene event ${key}`);
      } catch (err) {
        logger.warn(`Scene event ${key} not sent: ${err.message}`);
      }
    }
    // A new slot changes the widget's "now" and its next prices.
    if (prices.memory.slotStart !== priceSlotBefore || charging.events.length > 0) {
      this.onDataChanged();
    }
  }

  /** The transport badge of every device: Zonneplan is cloud-only. */
  transportEntries() {
    const until = this.client.rateLimitedUntil();
    let entry;
    if (this.status === 'ok') {
      entry = { transport: DEVICE_TRANSPORTS.CLOUD };
    } else if (this.status === 'rate_limited' && until) {
      entry = {
        transport: DEVICE_TRANSPORTS.CLOUD,
        degraded: true,
        message: rateLimitedMessage(until),
      };
    } else {
      entry = { transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    return this.installations.map((installation) => ({
      external_id: blueprintOf(installation).deviceExternalId(this.gladys, installation),
      ...entry,
    }));
  }

  async #publishTransports() {
    const entries = this.transportEntries();
    const key = JSON.stringify(entries);
    if (entries.length === 0 || key === this.lastTransports) {
      return;
    }
    try {
      for (let index = 0; index < entries.length; index += 100) {
        await this.gladys.publishTransports(entries.slice(index, index + 100));
      }
      this.lastTransports = key;
    } catch (err) {
      logger.warn(`Transport badges not published: ${err.message}`);
    }
  }

  /**
   * Forget the published badges and status, so the next round sends them
   * again: Gladys lost them if it restarted while the socket was down.
   */
  resetPublished() {
    this.lastTransports = null;
    this.lastStatusKey = null;
  }
}
