// -----------------------------------------------------------------------------
// The Zonneplan client: sign-in by e-mailed code, token refresh, rate limit.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createZonneplanClient,
  generatePkcePair,
  ZonneplanAuthError,
  ZonneplanRateLimitError,
} from '../src/zonneplan/client.js';
import { createMemoryTokenStore } from '../src/storage.js';
import { createFakeFetch, HOUR_MS, NOW, SIGNED_IN } from './helpers/fakeZonneplan.js';

function setup(routes, tokens = null, clock = { now: NOW }) {
  const fetch = createFakeFetch(routes);
  const tokenStore = createMemoryTokenStore(tokens);
  const client = createZonneplanClient({ tokenStore, fetch, now: () => clock.now });
  return { fetch, tokenStore, client, clock };
}

test('the PKCE challenge is the S256 of the verifier', () => {
  const { verifier, challenge } = generatePkcePair();
  assert.ok(verifier.length >= 43 && verifier.length <= 128);
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
});

test('sign-in: the code request expects 403 otp_required, the code is exchanged for tokens', async () => {
  let challenge;
  const { client, fetch, tokenStore } = setup({
    'POST oauth/authorize-challenge': ({ body }) => {
      if (body.email) {
        challenge = body.code_challenge;
        assert.equal(body.code_challenge_method, 'S256');
        assert.equal(body.response_type, 'code');
        return { status: 403, body: { otp_required: true, auth_session: 'session-1' } };
      }
      assert.deepEqual(body, { auth_session: 'session-1', otp: '123456' });
      return { body: { authorization_code: 'auth-code' } };
    },
    'POST oauth/token': ({ body }) => {
      assert.equal(body.grant_type, 'authorization_code');
      assert.equal(body.code, 'auth-code');
      assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'), challenge);
      return { body: { access_token: 'a', refresh_token: 'r', expires_in: 3600 } };
    },
  });

  const pending = await client.requestCode('me@example.com');
  assert.equal(pending.authSession, 'session-1');
  await client.submitCode({ ...pending, code: ' 123456 ' });

  assert.deepEqual(await tokenStore.load(), {
    access_token: 'a',
    refresh_token: 'r',
    expires_at: NOW + HOUR_MS,
  });
  assert.equal(await client.isSignedIn(), true);
  assert.equal(fetch.requests[0].headers['x-app-version'] !== undefined, true);
});

test('a wrong code is an auth error, the session stays signed out', async () => {
  const { client } = setup({
    'POST oauth/authorize-challenge': () => ({ status: 422, body: { message: 'invalid otp' } }),
  });
  await assert.rejects(
    client.submitCode({ authSession: 's', codeVerifier: 'v', code: '000000' }),
    ZonneplanAuthError,
  );
  assert.equal(await client.isSignedIn(), false);
});

test('calls carry the bearer token and resolve the data member', async () => {
  const { client, fetch } = setup(
    { 'GET user-accounts/me': () => ({ body: { data: { ok: 1 } } }) },
    SIGNED_IN,
  );
  assert.deepEqual(await client.get('user-accounts/me'), { ok: 1 });
  assert.equal(fetch.requests[0].headers.authorization, 'Bearer access-1');
});

test('an expiring token is refreshed before the call, and the new one is stored', async () => {
  const clock = { now: SIGNED_IN.expires_at - 30_000 };
  const { client, fetch, tokenStore } = setup(
    {
      'POST oauth/token': ({ body }) => {
        assert.deepEqual(body, { grant_type: 'refresh_token', refresh_token: 'refresh-1' });
        return { body: { access_token: 'access-2', expires_in: 3600 } };
      },
      'GET user-accounts/me': () => ({ body: { data: {} } }),
    },
    SIGNED_IN,
    clock,
  );
  await client.get('user-accounts/me');
  assert.equal(fetch.requests.at(-1).headers.authorization, 'Bearer access-2');
  // A refresh answer without a refresh token keeps the current one.
  assert.equal((await tokenStore.load()).refresh_token, 'refresh-1');
});

test('a 401 refreshes once and replays the call', async () => {
  let calls = 0;
  const { client } = setup(
    {
      'POST oauth/token': () => ({
        body: { access_token: 'access-2', refresh_token: 'refresh-2' },
      }),
      'GET user-accounts/me': ({ headers }) => {
        calls += 1;
        return headers.authorization === 'Bearer access-2'
          ? { body: { data: { ok: true } } }
          : { status: 401 };
      },
    },
    SIGNED_IN,
  );
  assert.deepEqual(await client.get('user-accounts/me'), { ok: true });
  assert.equal(calls, 2);
});

test('parallel calls on an expired token share one refresh', async () => {
  let refreshes = 0;
  const clock = { now: SIGNED_IN.expires_at };
  const { client } = setup(
    {
      'POST oauth/token': () => {
        refreshes += 1;
        return { body: { access_token: 'access-2', refresh_token: 'refresh-2' } };
      },
      'GET a': () => ({ body: { data: 1 } }),
      'GET b': () => ({ body: { data: 2 } }),
    },
    SIGNED_IN,
    clock,
  );
  assert.deepEqual(await Promise.all([client.get('a'), client.get('b')]), [1, 2]);
  assert.equal(refreshes, 1);
});

test('a refused refresh signs out: an auth error, and the tokens are deleted', async () => {
  const clock = { now: SIGNED_IN.expires_at };
  const { client, tokenStore } = setup(
    { 'POST oauth/token': () => ({ status: 401, body: { error: 'invalid_grant' } }) },
    SIGNED_IN,
    clock,
  );
  await assert.rejects(client.get('user-accounts/me'), ZonneplanAuthError);
  assert.equal(await tokenStore.load(), null);
  assert.equal(await client.isSignedIn(), false);
});

test('a 429 pauses every call until Retry-After is over', async () => {
  const clock = { now: NOW };
  const { client, fetch } = setup(
    { 'GET a': () => ({ status: 429, headers: { 'Retry-After': '120' } }) },
    SIGNED_IN,
    clock,
  );
  await assert.rejects(client.get('a'), (err) => {
    assert.ok(err instanceof ZonneplanRateLimitError);
    assert.equal(err.until, NOW + 120_000);
    return true;
  });
  await assert.rejects(client.get('a'), ZonneplanRateLimitError);
  assert.equal(fetch.requests.length, 1, 'the second call never left');
  assert.equal(client.rateLimitedUntil(), NOW + 120_000);

  clock.now += 121_000;
  fetch.routes['GET a'] = () => ({ body: { data: 'back' } });
  assert.equal(await client.get('a'), 'back');
  assert.equal(client.rateLimitedUntil(), 0);
});

test('a POST answered 204 resolves ok', async () => {
  const { client, fetch } = setup(
    { 'POST x/actions/start_boost': () => ({ status: 204 }) },
    SIGNED_IN,
  );
  assert.deepEqual(await client.post('x/actions/start_boost'), { ok: true });
  assert.deepEqual(fetch.requests[0].body, {});
});

test('sign-out deletes the tokens', async () => {
  const { client, tokenStore } = setup({}, SIGNED_IN);
  await client.signOut();
  assert.equal(await tokenStore.load(), null);
  await assert.rejects(client.get('user-accounts/me'), ZonneplanAuthError);
});
