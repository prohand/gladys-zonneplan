// -----------------------------------------------------------------------------
// The sign-in actions of the Configuration screen.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createSession, accountSummary } from '../src/session.js';
import { ZonneplanSync } from '../src/sync.js';
import { normalizeConfig } from '../src/config.js';
import { createZonneplanClient } from '../src/zonneplan/client.js';
import { createMemoryTokenStore } from '../src/storage.js';
import { LANGUAGES } from '../src/i18n.js';
import { accountRoutes, createFakeFetch, NOW, SIGNED_IN } from './helpers/fakeZonneplan.js';

async function setup({ tokens = null, email = 'me@example.com', routes = {} } = {}) {
  const clock = { now: NOW };
  const gladys = createFakeGladys();
  await gladys.connect();
  const fetch = createFakeFetch({
    ...accountRoutes(),
    'POST oauth/authorize-challenge': ({ body }) =>
      body.email
        ? { status: 403, body: { otp_required: true, auth_session: 'session-1' } }
        : body.otp === '123456'
          ? { body: { authorization_code: 'code-1' } }
          : { status: 422 },
    'POST oauth/token': () => ({
      body: { access_token: 'a', refresh_token: 'r', expires_in: 3600 },
    }),
    ...routes,
  });
  const tokenStore = createMemoryTokenStore(tokens);
  const client = createZonneplanClient({ tokenStore, fetch, now: () => clock.now });
  const getConfig = () => normalizeConfig({ email });
  const sync = new ZonneplanSync({ gladys, client, getConfig, now: () => clock.now });
  const session = createSession({ client, sync, getConfig, now: () => clock.now });
  return { gladys, fetch, tokenStore, session, sync, clock };
}

function inEveryLanguage(message) {
  for (const language of LANGUAGES) {
    assert.ok(message[language], `${language} missing`);
  }
}

test('the whole sign-in: code e-mailed, code typed, devices published', async () => {
  const { gladys, session, tokenStore } = await setup();
  const sent = await session.requestCode();
  inEveryLanguage(sent);
  assert.match(sent.en, /me@example.com/);

  const done = await session.submitCode('123456');
  inEveryLanguage(done);
  assert.match(done.en, /electricity, gas, P1 meter, solar panels, home battery, charge point/);
  assert.equal((await tokenStore.load()).access_token, 'a');
  assert.equal(gladys.fake.discoveredDevices.length, 6);
});

test('no e-mail in the configuration: say so, send nothing', async () => {
  const { session, fetch } = await setup({ email: '' });
  assert.match((await session.requestCode()).en, /e-mail address/);
  assert.equal(fetch.requests.length, 0);
});

test('a code without a request, or after 15 minutes, asks for a new code', async () => {
  const { session, clock } = await setup();
  assert.match((await session.submitCode('123456')).en, /No code requested/);
  await session.requestCode();
  clock.now += 16 * 60_000;
  assert.match((await session.submitCode('123456')).en, /No code requested/);
});

test('a wrong code is reported, and the next try still works', async () => {
  const { session } = await setup();
  await session.requestCode();
  assert.match((await session.submitCode('000000')).en, /refused this code/);
  assert.match((await session.submitCode('123456')).en, /Connected/);
});

test('test_connection: not signed in, then what the account holds', async () => {
  const signedOut = await setup();
  assert.match((await signedOut.session.testConnection()).en, /Not signed in/);
  const signedIn = await setup({ tokens: SIGNED_IN });
  assert.match((await signedIn.session.testConnection()).fr, /Connecté à Zonneplan/);
});

test('Zonneplan unreachable or rate-limited: a message, not a crash', async () => {
  const { session } = await setup({
    routes: {
      'POST oauth/authorize-challenge': () => ({ status: 429, headers: { 'retry-after': '60' } }),
    },
  });
  assert.match((await session.requestCode()).en, /slow down/);
  const down = await setup({
    routes: { 'POST oauth/authorize-challenge': () => ({ status: 503 }) },
  });
  assert.match((await down.session.requestCode()).en, /cannot be reached/);
});

test('sign_out deletes the tokens and turns the status to "not signed in"', async () => {
  const { session, tokenStore, gladys } = await setup({ tokens: SIGNED_IN });
  inEveryLanguage(await session.signOut());
  assert.equal(await tokenStore.load(), null);
  assert.equal(gladys.fake.connectionStatus.connected, false);
});

test('the summary of an empty account still reads well', () => {
  assert.match(accountSummary([]).es, /nada todavía/);
});
