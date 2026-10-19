// -----------------------------------------------------------------------------
// Client of the Zonneplan app API (https://app-api.zonneplan.nl).
//
// It is the API the Zonneplan mobile app talks to: there is no public API.
// Sign-in has no password: Zonneplan e-mails a one-time code.
//
//   1. requestCode(email)   POST /oauth/authorize-challenge with a PKCE
//      challenge. The expected answer is a 403 `otp_required` carrying an
//      `auth_session`: Zonneplan has just e-mailed the code.
//   2. submitCode(...)      POST /oauth/authorize-challenge { auth_session,
//      otp } -> an `authorization_code`, exchanged at POST /oauth/token
//      (grant authorization_code + the PKCE verifier) for the tokens.
//   3. Every later call carries the access token; it is refreshed (grant
//      refresh_token) shortly before it expires, and once on a 401.
//
// The API answers 429 with a Retry-After when called too often: the client
// then refuses every call until that delay is over, so a scene or the widget
// cannot dig the hole deeper.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';

export const API_BASE_URL = 'https://app-api.zonneplan.nl';
// The API refuses requests without an app version it knows.
export const APP_VERSION = '5.10.1';
// Shown by Zonneplan in the e-mail and in the list of signed-in devices.
const SOURCE_NAME = 'Gladys Assistant';

const REQUEST_TIMEOUT_MS = 15_000;
// Refresh a little before the expiry, so a slow request never carries a token
// that expires on the way.
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const DEFAULT_RETRY_AFTER_S = 60;

const logger = createLogger({ name: 'zonneplan-api' });

/** Any refused or failed call. `status` is the HTTP status, 0 for a network error. */
export class ZonneplanApiError extends Error {
  constructor(message, { status = 0, retryAfter = null } = {}) {
    super(message);
    this.name = 'ZonneplanApiError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** The session is gone (never signed in, refresh refused): sign in again. */
export class ZonneplanAuthError extends ZonneplanApiError {
  constructor(message, options) {
    super(message, options);
    this.name = 'ZonneplanAuthError';
  }
}

/** The API asked to slow down; `until` is when calls are allowed again. */
export class ZonneplanRateLimitError extends ZonneplanApiError {
  constructor(until) {
    super('Zonneplan rate limit reached', { status: 429 });
    this.name = 'ZonneplanRateLimitError';
    this.until = until;
  }
}

/** A PKCE pair (RFC 7636, S256), fresh for every sign-in attempt. */
export function generatePkcePair() {
  const verifier = randomBytes(96).toString('base64url').slice(0, 128);
  const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
  return { verifier, challenge };
}

function parseRetryAfter(value) {
  const seconds = Number.parseInt(value ?? '', 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_RETRY_AFTER_S;
}

/**
 * @param {object} options
 * @param {{ load(): Promise<object|null>, save(o: object): Promise<void>, clear(): Promise<void> }} options.tokenStore
 * @param {typeof fetch} [options.fetch]
 * @param {() => number} [options.now]
 */
export function createZonneplanClient({
  tokenStore,
  fetch: fetchImpl = globalThis.fetch,
  now = Date.now,
}) {
  let tokens = null;
  let tokensLoaded = false;
  let blockedUntil = 0;
  // One refresh at a time: parallel calls wait for the same new token instead
  // of burning the single-use refresh token twice.
  let refreshing = null;

  const baseHeaders = {
    'content-type': 'application/json;charset=utf-8',
    accept: 'application/json',
    'x-app-version': APP_VERSION,
    'x-app-environment': 'production',
  };

  async function loadTokens() {
    if (!tokensLoaded) {
      tokens = await tokenStore.load();
      tokensLoaded = true;
    }
    return tokens;
  }

  async function storeTokens(answer) {
    if (!answer || typeof answer.access_token !== 'string') {
      throw new ZonneplanAuthError('Zonneplan returned no access token');
    }
    tokens = {
      access_token: answer.access_token,
      // A refresh answer may omit the refresh token: keep the current one.
      refresh_token: answer.refresh_token ?? tokens?.refresh_token ?? null,
      expires_at: now() + Number(answer.expires_in ?? 3600) * 1000,
    };
    tokensLoaded = true;
    await tokenStore.save(tokens);
    return tokens;
  }

  function checkRateLimit() {
    if (now() < blockedUntil) {
      throw new ZonneplanRateLimitError(blockedUntil);
    }
  }

  async function send(method, path, { body, headers = {}, acceptStatus = [] } = {}) {
    checkRateLimit();
    const url = path.startsWith('http') ? path : `${API_BASE_URL}/${path.replace(/^\//, '')}`;
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: { ...baseHeaders, ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new ZonneplanApiError(`Zonneplan unreachable: ${err.message}`);
    }

    if (response.status === 429) {
      const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
      blockedUntil = now() + retryAfter * 1000;
      logger.warn(`Zonneplan rate limit reached, pausing calls for ${retryAfter} s`);
      throw new ZonneplanRateLimitError(blockedUntil);
    }

    let payload = null;
    if (response.status !== 204) {
      const text = await response.text();
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = null;
        }
      }
    }

    if (!response.ok && !acceptStatus.includes(response.status)) {
      // The body of an error may echo what was sent: log the status only.
      throw new ZonneplanApiError(`Zonneplan ${method} ${path} answered HTTP ${response.status}`, {
        status: response.status,
      });
    }
    return { status: response.status, payload };
  }

  async function refreshTokens() {
    const current = await loadTokens();
    if (!current?.refresh_token) {
      throw new ZonneplanAuthError('Not signed in to Zonneplan');
    }
    if (!refreshing) {
      refreshing = (async () => {
        try {
          const { payload } = await send('POST', 'oauth/token', {
            body: { grant_type: 'refresh_token', refresh_token: current.refresh_token },
          });
          logger.debug('Zonneplan access token refreshed');
          return await storeTokens(payload);
        } catch (err) {
          if (err instanceof ZonneplanApiError && [400, 401, 403].includes(err.status)) {
            // The refresh token was revoked (signed out from the app, too old):
            // only a new sign-in brings the session back.
            await clearTokens();
            throw new ZonneplanAuthError('Zonneplan session expired, sign in again', {
              status: err.status,
            });
          }
          throw err;
        } finally {
          refreshing = null;
        }
      })();
    }
    return refreshing;
  }

  async function validAccessToken() {
    const current = await loadTokens();
    if (!current?.access_token) {
      throw new ZonneplanAuthError('Not signed in to Zonneplan');
    }
    if (current.expires_at && now() >= current.expires_at - TOKEN_REFRESH_MARGIN_MS) {
      return (await refreshTokens()).access_token;
    }
    return current.access_token;
  }

  async function authorized(method, path, body) {
    const token = await validAccessToken();
    try {
      return await send(method, path, { body, headers: { authorization: `Bearer ${token}` } });
    } catch (err) {
      if (!(err instanceof ZonneplanApiError) || err.status !== 401) {
        throw err;
      }
      // Revoked or expired early: refresh once and replay.
      const fresh = await refreshTokens();
      return send(method, path, {
        body,
        headers: { authorization: `Bearer ${fresh.access_token}` },
      });
    }
  }

  async function clearTokens() {
    tokens = null;
    tokensLoaded = true;
    await tokenStore.clear();
  }

  return {
    /** Ask Zonneplan to e-mail a sign-in code. Resolves what submitCode needs. */
    async requestCode(email) {
      const { verifier, challenge } = generatePkcePair();
      const { payload } = await send('POST', 'oauth/authorize-challenge', {
        body: {
          response_type: 'code',
          email,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          source_name: SOURCE_NAME,
        },
        // 403 + otp_required is the nominal answer: the code is on its way.
        acceptStatus: [403],
      });
      if (!payload?.otp_required || typeof payload.auth_session !== 'string') {
        throw new ZonneplanApiError('Unexpected answer from Zonneplan to the code request');
      }
      return { authSession: payload.auth_session, codeVerifier: verifier, email };
    },

    /** Exchange the e-mailed code for the tokens, stored in the token store. */
    async submitCode({ authSession, codeVerifier, code }) {
      let payload;
      try {
        ({ payload } = await send('POST', 'oauth/authorize-challenge', {
          body: { auth_session: authSession, otp: String(code).trim() },
        }));
      } catch (err) {
        if (err instanceof ZonneplanApiError && err.status >= 400 && err.status < 500) {
          throw new ZonneplanAuthError('Wrong or expired code', { status: err.status });
        }
        throw err;
      }
      if (typeof payload?.authorization_code !== 'string') {
        throw new ZonneplanAuthError('Zonneplan did not accept the code');
      }
      const { payload: answer } = await send('POST', 'oauth/token', {
        body: {
          grant_type: 'authorization_code',
          code: payload.authorization_code,
          code_verifier: codeVerifier,
        },
      });
      await storeTokens(answer);
    },

    async isSignedIn() {
      return Boolean((await loadTokens())?.access_token);
    },

    async signOut() {
      await clearTokens();
    },

    /** GET an API path; resolves the `data` member of the answer. */
    async get(path) {
      const { payload } = await authorized('GET', path);
      return payload?.data ?? null;
    },

    /** POST an action; resolves the whole answer (`{ ok: true }` for a 204). */
    async post(path, body = {}) {
      const { status, payload } = await authorized('POST', path, body);
      return status === 204 ? { ok: true } : (payload ?? { ok: true });
    },

    /** Calls refused until then (ms epoch), 0 when not rate-limited. */
    rateLimitedUntil() {
      return now() < blockedUntil ? blockedUntil : 0;
    },
  };
}
