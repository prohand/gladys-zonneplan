// -----------------------------------------------------------------------------
// Entry point of the Zonneplan integration for Gladys Assistant.
//
// Role of this file: wire the SDK to the Zonneplan client and the
// synchronisation loop. It holds no Zonneplan logic:
//   src/zonneplan/   the app API (sign-in, account, prices, installations)
//   src/devices/     one Gladys device per installation
//   src/sync.js      the minute loop: read, publish, fire the scene triggers
//   src/session.js   the sign-in actions of the Configuration screen
//   src/capabilities the scene actions and the dashboard widgets
//
// The SDK reads GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN and
// GLADYS_INTEGRATION_SELECTOR, injected by the Gladys supervisor.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { createFileTokenStore } from './src/storage.js';
import { createZonneplanClient } from './src/zonneplan/client.js';
import { ZonneplanSync } from './src/sync.js';
import { createSession } from './src/session.js';
import { blueprintOf, findInstallation } from './src/devices/index.js';
import { SCENE_ACTIONS } from './src/capabilities/scenes.js';
import { WIDGETS, refreshWidgets } from './src/capabilities/widgets.js';

const gladys = new GladysIntegration();

// Current configuration (hot-reloaded via onConfigUpdated).
let config = normalizeConfig();

const client = createZonneplanClient({ tokenStore: createFileTokenStore() });
const sync = new ZonneplanSync({
  gladys,
  client,
  getConfig: () => config,
  // Nudges are fire-and-forget and rate-limited core-side: sending one at
  // every slot boundary or reading is cheap.
  onDataChanged: () => refreshWidgets(gladys),
});
const session = createSession({ client, sync, getConfig: () => config });

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> publishing the Zonneplan installations');
  sync.invalidate();
  await sync.tick();
  await sync.publishDevices();
});

// --- Command: the user acts on a controllable feature ------------------------
// Only the "Charge now" switch of a charge point is controllable.
gladys.onSetValue(async (device, feature, value) => {
  logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
  const installation = findInstallation(gladys, sync.installations, device.external_id);
  const blueprint = installation && blueprintOf(installation);
  if (!blueprint || typeof blueprint.onSetValue !== 'function') {
    // Throw: the SDK sends a success:false acknowledgement to Gladys.
    throw new Error(`No command handler for ${device.external_id}`);
  }
  await blueprint.onSetValue(gladys, { installation, feature, value, client });
  sync.requestReadingsSoon();
});

// --- Manifest actions: buttons in the Configuration screen -------------------
gladys.onAction('request_code', () => session.requestCode());
gladys.onAction('submit_code', (fields) => session.submitCode(fields.code));
gladys.onAction('test_connection', () => session.testConnection());
gladys.onAction('sign_out', () => session.signOut());

// --- Scene actions -----------------------------------------------------------
for (const [actionKey, handler] of Object.entries(SCENE_ACTIONS)) {
  gladys.onSceneAction(actionKey, (fields) => handler(gladys, { fields, sync }));
}

// --- Dashboard widgets -------------------------------------------------------
for (const [widgetKey, widget] of Object.entries(WIDGETS)) {
  gladys.onWidgetGet(widgetKey, (request) => widget.get(gladys, { ...request, sync }));
  gladys.onWidgetAction(widgetKey, (actionKey, params, { settings }) =>
    widget.action(gladys, { actionKey, params, settings, sync }),
  );
}

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  config = normalizeConfig(newConfig);
  // The price interval or the refresh interval may have changed.
  sync.invalidate();
  await sync.tick();
  refreshWidgets(gladys);
});

// --- Connection lifecycle ----------------------------------------------------
gladys.on('connected', async () => {
  try {
    config = normalizeConfig(await gladys.getConfig());
    // Gladys may have restarted while the socket was down: send the devices,
    // the badges and the status again.
    sync.resetPublished();
    sync.invalidate();
    await sync.tick();
    await sync.publishDevices();
    sync.start();
    refreshWidgets(gladys);
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
        de: 'Die Initialisierung ist fehlgeschlagen, prüfe die Logs der Integration.',
        es: 'La inicialización ha fallado, consulte los registros de la integración.',
      })
      .catch(() => {});
  }
});

gladys.on('disconnected', () => {
  sync.stop();
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  sync.stop();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Zonneplan integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
