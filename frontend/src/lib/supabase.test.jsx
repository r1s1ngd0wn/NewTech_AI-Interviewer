import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const projectUrl = 'https://oauth-fixture.supabase.co';
const storageKey = 'sb-oauth-fixture-auth-token';
const verifierKey = `${storageKey}-code-verifier`;
const clients = [];
let fetchMock;

async function loadClient() {
  const { supabase, previewAuth } = await import('./supabase.js');
  expect(previewAuth).toBe(false);
  clients.push(supabase);
  return supabase;
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_URL', projectUrl);
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'synthetic-public-key-for-offline-tests');
  vi.stubEnv('VITE_AUTH_MODE', 'supabase');
  localStorage.clear();
  window.history.replaceState({}, '', '/login');
  // Every request is intercepted, including unexpected URLs: never use real fetch.
  fetchMock = vi.fn(async (url) => {
    throw new Error(`Unexpected offline OAuth request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  // The real SDK owns refresh timers, visibility listeners and a broadcast channel.
  for (const client of clients.splice(0)) await client.auth.dispose();
  localStorage.clear();
  window.history.replaceState({}, '', '/login');
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test('the configured real SDK creates a Google PKCE authorize URL and stores its verifier', async () => {
  const client = await loadClient();
  await client.auth.initialize();
  const redirectTo = `${window.location.origin}/login`;
  const { data, error } = await client.auth.signInWithOAuth({
    provider: 'google', options: { redirectTo, skipBrowserRedirect: true },
  });

  expect(error).toBeNull();
  const authorize = new URL(data.url);
  expect(`${authorize.origin}${authorize.pathname}`).toBe(`${projectUrl}/auth/v1/authorize`);
  expect(authorize.searchParams.get('provider')).toBe('google');
  expect(authorize.searchParams.get('redirect_to')).toBe(redirectTo);
  const verifier = JSON.parse(localStorage.getItem(verifierKey));
  expect(verifier).toEqual(expect.any(String));
  expect(verifier.length).toBeGreaterThanOrEqual(43);
  const method = authorize.searchParams.get('code_challenge_method');
  expect(['s256', 'plain']).toContain(method);
  // JSDOM can lack SubtleCrypto; check the SDK's actual challenge in either environment.
  const challenge = method === 's256'
    ? createHash('sha256').update(verifier).digest('base64url') : verifier;
  expect(authorize.searchParams.get('code_challenge')).toBe(challenge);
  expect(fetchMock).not.toHaveBeenCalled();
});

test('a PKCE callback automatically exchanges the code, persists the Google session and cleans the URL', async () => {
  const verifier = 'offline-callback-verifier-'.repeat(3);
  localStorage.setItem(verifierKey, JSON.stringify(verifier));
  window.history.replaceState({}, '', '/login?code=fake-google-code&keep=present');
  const user = {
    id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated',
    email: 'google-user@example.test', created_at: '2026-01-01T00:00:00.000Z',
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { full_name: 'Google Fixture' },
  };
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const accessToken = [btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    btoa(JSON.stringify({ sub: user.id, exp: expiresAt })), 'offline-signature'].join('.');
  fetchMock.mockImplementation(async (url, options) => {
    if (String(url) !== `${projectUrl}/auth/v1/token?grant_type=pkce`) {
      throw new Error(`Unexpected offline OAuth request: ${url}`);
    }
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ auth_code: 'fake-google-code', code_verifier: verifier });
    return new Response(JSON.stringify({
      access_token: accessToken, refresh_token: 'offline-refresh-token',
      token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, user,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });

  const client = await loadClient();
  expect((await client.auth.initialize()).error).toBeNull();
  const { data, error } = await client.auth.getSession();
  expect(error).toBeNull();
  expect(data.session.access_token).toBe(accessToken);
  expect(data.session.user).toEqual(user);
  expect(JSON.parse(localStorage.getItem(storageKey)).access_token).toBe(accessToken);
  expect(localStorage.getItem(verifierKey)).toBeNull();
  expect(window.location.pathname + window.location.search).toBe('/login?keep=present');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('a denied OAuth callback is reported by SDK initialization without making a request', async () => {
  window.history.replaceState({}, '', '/login?error=access_denied&error_description=Google%20access%20denied');
  const client = await loadClient();
  const { error } = await client.auth.initialize();
  expect(error).toMatchObject({ message: 'Google access denied' });
  expect((await client.auth.getSession()).data.session).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});
