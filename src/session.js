// -----------------------------------------------------------------------------
// Sign-in, from the Configuration screen.
//
// Zonneplan has no password: it e-mails a one-time code. Two buttons (the
// manifest `actions`) carry the two steps:
//   request_code   e-mails the code to the address of the configuration;
//   submit_code    takes the code typed by the user, and signs in.
// The pending sign-in (session + PKCE verifier) only lives in memory: a code
// is valid for a few minutes, a restart in between asks for a new one.
//
// Plus test_connection (what the account holds) and sign_out.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import {
  ZonneplanApiError,
  ZonneplanAuthError,
  ZonneplanRateLimitError,
} from './zonneplan/client.js';
import { INSTALLATION_KINDS, parseInstallations } from './zonneplan/account.js';
import { formatTime, localize, pick } from './i18n.js';
import { STATUS_MESSAGES } from './sync.js';

const logger = createLogger({ name: 'session' });

// The code e-mailed by Zonneplan expires; past this, ask for a new one.
const PENDING_SIGN_IN_MS = 15 * 60_000;

const KIND_NAMES = {
  [INSTALLATION_KINDS.ELECTRICITY]: {
    en: 'electricity',
    fr: 'électricité',
    de: 'Strom',
    es: 'electricidad',
  },
  [INSTALLATION_KINDS.GAS]: { en: 'gas', fr: 'gaz', de: 'Gas', es: 'gas' },
  [INSTALLATION_KINDS.P1]: {
    en: 'P1 meter',
    fr: 'compteur P1',
    de: 'P1-Zähler',
    es: 'contador P1',
  },
  [INSTALLATION_KINDS.PV]: {
    en: 'solar panels',
    fr: 'panneaux solaires',
    de: 'Solaranlage',
    es: 'paneles solares',
  },
  [INSTALLATION_KINDS.BATTERY]: {
    en: 'home battery',
    fr: 'batterie domestique',
    de: 'Heimspeicher',
    es: 'batería doméstica',
  },
  [INSTALLATION_KINDS.CHARGE_POINT]: {
    en: 'charge point',
    fr: 'borne de recharge',
    de: 'Ladestation',
    es: 'punto de recarga',
  },
};

const MESSAGES = {
  noEmail: {
    en: 'Enter the e-mail address of your Zonneplan account in the configuration and save it first.',
    fr: "Saisissez d'abord l'adresse e-mail de votre compte Zonneplan dans la configuration et enregistrez.",
    de: 'Trage zuerst die E-Mail-Adresse deines Zonneplan-Kontos in die Konfiguration ein und speichere sie.',
    es: 'Primero introduzca el e-mail de su cuenta Zonneplan en la configuración y guárdela.',
  },
  noPending: {
    en: 'No code requested yet (or it expired): use "Send me a sign-in code" first.',
    fr: "Aucun code demandé (ou il a expiré) : utilisez d'abord « M’envoyer un code de connexion ».",
    de: 'Noch kein Code angefordert (oder er ist abgelaufen): Nutze zuerst „Anmeldecode senden“.',
    es: 'Aún no se ha pedido ningún código (o ha caducado): use primero «Enviarme un código de acceso».',
  },
  wrongCode: {
    en: 'Zonneplan refused this code: check it, or request a new one.',
    fr: 'Zonneplan a refusé ce code : vérifiez-le, ou demandez-en un nouveau.',
    de: 'Zonneplan hat diesen Code abgelehnt: Prüfe ihn oder fordere einen neuen an.',
    es: 'Zonneplan ha rechazado este código: compruébelo o pida uno nuevo.',
  },
  notSignedIn: {
    en: 'Not signed in to Zonneplan yet.',
    fr: 'Pas encore connecté à Zonneplan.',
    de: 'Noch nicht bei Zonneplan angemeldet.',
    es: 'Aún no ha iniciado sesión en Zonneplan.',
  },
  signedOut: {
    en: 'Signed out. The tokens were deleted from this Gladys.',
    fr: 'Déconnecté. Les jetons ont été supprimés de ce Gladys.',
    de: 'Abgemeldet. Die Tokens wurden aus diesem Gladys gelöscht.',
    es: 'Sesión cerrada. Los tokens se han borrado de este Gladys.',
  },
  unreachable: {
    en: 'Zonneplan cannot be reached right now, try again in a moment.',
    fr: 'Zonneplan est injoignable pour le moment, réessayez dans un instant.',
    de: 'Zonneplan ist gerade nicht erreichbar, versuche es gleich noch einmal.',
    es: 'No se puede contactar con Zonneplan ahora mismo, inténtelo de nuevo en un momento.',
  },
};

function codeSent(email) {
  return localize((language) =>
    pick(language, {
      en: `Code sent to ${email}. Type it in "Sign in with the code".`,
      fr: `Code envoyé à ${email}. Saisissez-le dans « Se connecter avec le code ».`,
      de: `Code an ${email} gesendet. Gib ihn bei „Mit dem Code anmelden“ ein.`,
      es: `Código enviado a ${email}. Introdúzcalo en «Iniciar sesión con el código».`,
    }),
  );
}

function rateLimited(until) {
  const time = formatTime(until);
  return localize((language) =>
    pick(language, {
      en: `Zonneplan asked to slow down, try again after ${time}.`,
      fr: `Zonneplan demande de ralentir, réessayez après ${time}.`,
      de: `Zonneplan bittet um weniger Anfragen, versuche es nach ${time} erneut.`,
      es: `Zonneplan pide reducir las consultas, inténtelo después de las ${time}.`,
    }),
  );
}

/** "Connected: electricity, solar panels." for the installations found. */
export function accountSummary(installations) {
  return localize((language) => {
    const kinds = [...new Set(installations.map((i) => i.kind))];
    const names = kinds.map((kind) => pick(language, KIND_NAMES[kind]));
    const found = names.length
      ? names.join(', ')
      : pick(language, {
          en: 'nothing yet',
          fr: 'rien pour l’instant',
          de: 'noch nichts',
          es: 'nada todavía',
        });
    return pick(language, {
      en: `Connected to Zonneplan. Found: ${found}. The devices are in the Discovery tab.`,
      fr: `Connecté à Zonneplan. Trouvé : ${found}. Les appareils sont dans l’onglet Découverte.`,
      de: `Mit Zonneplan verbunden. Gefunden: ${found}. Die Geräte sind im Tab „Entdecken“.`,
      es: `Conectado a Zonneplan. Encontrado: ${found}. Los dispositivos están en la pestaña Descubrimiento.`,
    });
  });
}

function failure(err) {
  if (err instanceof ZonneplanRateLimitError) {
    return rateLimited(err.until);
  }
  if (err instanceof ZonneplanAuthError) {
    return MESSAGES.wrongCode;
  }
  if (err instanceof ZonneplanApiError) {
    return MESSAGES.unreachable;
  }
  throw err;
}

/**
 * The handlers of the sign-in actions.
 * @param {{ client: object, sync: import('./sync.js').ZonneplanSync,
 *   getConfig: () => object, now?: () => number }} options
 */
export function createSession({ client, sync, getConfig, now = Date.now }) {
  let pending = null;

  return {
    async requestCode() {
      const { email } = getConfig();
      if (!email || !email.includes('@')) {
        return MESSAGES.noEmail;
      }
      try {
        pending = { ...(await client.requestCode(email)), at: now() };
        logger.info('Sign-in code requested');
        return codeSent(email);
      } catch (err) {
        logger.warn(`Sign-in code request failed: ${err.message}`);
        return failure(err);
      }
    },

    async submitCode(code) {
      if (!pending || now() - pending.at > PENDING_SIGN_IN_MS) {
        pending = null;
        return MESSAGES.noPending;
      }
      try {
        await client.submitCode({ ...pending, code });
      } catch (err) {
        logger.warn(`Sign-in refused: ${err.message}`);
        return failure(err);
      }
      pending = null;
      logger.info('Signed in to Zonneplan');
      // Read everything now rather than at the next tick: the user is
      // looking at the screen.
      sync.invalidate();
      await sync.tick();
      if (sync.status !== 'ok') {
        // The round we joined may have started before the sign-in.
        await sync.tick();
      }
      return accountSummary(sync.installations);
    },

    async testConnection() {
      if (!(await client.isSignedIn())) {
        return MESSAGES.notSignedIn;
      }
      try {
        const account = await client.get('user-accounts/me');
        return accountSummary(parseInstallations(account, now()));
      } catch (err) {
        if (err instanceof ZonneplanAuthError) {
          return STATUS_MESSAGES.sessionExpired;
        }
        return failure(err);
      }
    },

    async signOut() {
      pending = null;
      await client.signOut();
      logger.info('Signed out of Zonneplan');
      await sync.tick();
      return MESSAGES.signedOut;
    },
  };
}
