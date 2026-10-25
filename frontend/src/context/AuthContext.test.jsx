import React from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const fake = vi.hoisted(() => ({ session: null, listener: null, signIn: null, profileResult: undefined }));
vi.mock('../lib/supabase.js', () => {
  const supabase = { auth: {
    initialize: async () => ({ error: null }),
    getSession: async () => ({ data: { session: fake.session } }),
    onAuthStateChange: listener => { fake.listener = listener; return { data: { subscription: { unsubscribe() {} } } }; },
    signOut: async () => { fake.session = null; fake.listener?.('SIGNED_OUT', null); return {}; },
    signInWithPassword: async () => fake.signIn ? fake.signIn() : ({ data: { user: { id: 'bob' } }, error: null }),
  } };
  return { previewAuth: false, supabase, requireSupabase: () => supabase };
});
import { AuthProvider, useAuth } from './AuthContext.jsx';
import { api, getToken } from '../lib/api.js';
function Identity() { const { user, loading } = useAuth(); return <p>{loading ? 'Loading' : user?.name || 'Signed out'}</p>; }
function AuthControls() {
  const auth = useAuth();
  return <><button onClick={() => auth.updateProfile({ name: 'Changed' }).then(result => { fake.profileResult = result; })}>Save profile</button><button onClick={() => auth.refreshUser()}>Refresh profile</button><button onClick={() => auth.login('bob@example.test', 'secret').catch(() => {})}>Switch account</button><button onClick={() => auth.logout().catch(() => {})}>Log out</button></>;
}
beforeEach(() => { fake.session = { access_token: 'first-jwt' }; fake.listener = null; fake.signIn = null; fake.profileResult = undefined; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test('a 401 clears the Supabase session as well as the displayed user', async () => {
  let expired = false;
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(expired ? { error: 'session ended' } : { user: { id: 'alice', name: 'Alice' } }), { status: expired ? 401 : 200 }));
  render(<AuthProvider><Identity /></AuthProvider>);
  await screen.findByText('Alice');
  expired = true;
  await act(async () => { await api.me().catch(() => {}); });
  await screen.findByText('Signed out');
  await waitFor(async () => expect(await getToken()).toBe(null));
});

test('token refresh updates authorization without retaining the old session', async () => {
  vi.stubGlobal('fetch', async (url, options) => new Response(JSON.stringify({ user: { id: 'alice', name: options.headers.Authorization === 'Bearer refreshed-jwt' ? 'Refreshed Alice' : 'Alice' } })));
  render(<AuthProvider><Identity /></AuthProvider>);
  await screen.findByText('Alice');
  await act(async () => { fake.session = { access_token: 'refreshed-jwt' }; fake.listener('TOKEN_REFRESHED', fake.session); });
  await screen.findByText('Refreshed Alice');
});

test('a profile response arriving after logout cannot restore the logged-out user', async () => {
  let finishProfile;
  vi.stubGlobal('fetch', async (url) => {
    if (url.endsWith('/auth/me')) return new Response(JSON.stringify({ user: { id: 'alice', name: 'Alice' } }));
    if (url.endsWith('/users/me')) return new Promise(resolve => { finishProfile = () => resolve(new Response(JSON.stringify({ user: { id: 'alice', name: 'Changed' } }))); });
    if (url.endsWith('/auth/logout')) return new Response(JSON.stringify({ ok: true }));
    throw new Error(`unexpected request: ${url}`);
  });
  render(<AuthProvider><Identity /><AuthControls /></AuthProvider>);
  await screen.findByText('Alice');
  fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  await waitFor(() => expect(finishProfile).toBeTypeOf('function'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log out' })); });
  await screen.findByText('Signed out');
  await act(async () => { finishProfile(); });
  expect(screen.getByText('Signed out')).toBeTruthy();
});

test('a login continuation finishing after logout is rejected and cannot authenticate', async () => {
  let finishSignIn;
  vi.stubGlobal('fetch', async (url) => {
    if (url.endsWith('/auth/me')) return new Response(JSON.stringify({ user: { id: 'alice', name: 'Alice' } }));
    if (url.endsWith('/auth/logout')) return new Response(JSON.stringify({ ok: true }));
    throw new Error(`unexpected request: ${url}`);
  });
  fake.signIn = () => new Promise(resolve => { finishSignIn = () => resolve({ data: { user: { id: 'bob' } }, error: null }); });
  render(<AuthProvider><Identity /><AuthControls /></AuthProvider>);
  await screen.findByText('Alice');
  fireEvent.click(screen.getByRole('button', { name: 'Switch account' }));
  await waitFor(() => expect(finishSignIn).toBeTypeOf('function'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log out' })); });
  await screen.findByText('Signed out');
  await act(async () => { finishSignIn(); });
  expect(screen.getByText('Signed out')).toBeTruthy();
});

test('a refreshUser response arriving after logout cannot restore the logged-out user', async () => {
  let finishRefresh;
  let meCalls = 0;
  vi.stubGlobal('fetch', async (url) => {
    if (url.endsWith('/auth/me')) {
      if (++meCalls === 1) return new Response(JSON.stringify({ user: { id: 'alice', name: 'Alice' } }));
      return new Promise(resolve => { finishRefresh = () => resolve(new Response(JSON.stringify({ user: { id: 'alice', name: 'Refreshed Alice' } }))); });
    }
    if (url.endsWith('/auth/logout')) return new Response(JSON.stringify({ ok: true }));
    throw new Error(`unexpected request: ${url}`);
  });
  render(<AuthProvider><Identity /><AuthControls /></AuthProvider>);
  await screen.findByText('Alice');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh profile' }));
  await waitFor(() => expect(finishRefresh).toBeTypeOf('function'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log out' })); });
  await screen.findByText('Signed out');
  await act(async () => { finishRefresh(); });
  expect(screen.getByText('Signed out')).toBeTruthy();
});

test('a failed server logout keeps the signed-in user visible', async () => {
  vi.stubGlobal('fetch', async (url) => {
    if (url.endsWith('/auth/me')) return new Response(JSON.stringify({ user: { id: 'alice', name: 'Alice' } }));
    if (url.endsWith('/auth/logout')) return new Response(JSON.stringify({ error: 'temporary failure' }), { status: 503 });
    throw new Error(`unexpected request: ${url}`);
  });
  render(<AuthProvider><Identity /><AuthControls /></AuthProvider>);
  await screen.findByText('Alice');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log out' })); });
  expect(screen.getByText('Alice')).toBeTruthy();
});

test('an Alice profile response cannot overwrite Bob after an account switch', async () => {
  let finishProfile;
  let meCalls = 0;
  vi.stubGlobal('fetch', async (url) => {
    if (url.endsWith('/auth/me')) {
      meCalls++;
      return new Response(JSON.stringify({ user: meCalls === 1 ? { id: 'alice', name: 'Alice' } : { id: 'bob', name: 'Bob' } }));
    }
    if (url.endsWith('/users/me')) return new Promise(resolve => { finishProfile = () => resolve(new Response(JSON.stringify({ user: { id: 'alice', name: 'Changed' } }))); });
    throw new Error(`unexpected request: ${url}`);
  });
  render(<AuthProvider><Identity /><AuthControls /></AuthProvider>);
  await screen.findByText('Alice');
  fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  await waitFor(() => expect(finishProfile).toBeTypeOf('function'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Switch account' })); });
  await screen.findByText('Bob');
  await act(async () => { finishProfile(); });
  expect(screen.getByText('Bob')).toBeTruthy();
});

test('a profile response arriving after token expiry cannot restore the expired user', async () => {
  let finishProfile;
  vi.stubGlobal('fetch', async (url) => {
    if (url.endsWith('/auth/me')) return new Response(JSON.stringify({ user: { id: 'alice', name: 'Alice' } }));
    if (url.endsWith('/users/me')) return new Promise(resolve => { finishProfile = () => resolve(new Response(JSON.stringify({ user: { id: 'alice', name: 'Changed' } }))); });
    throw new Error(`unexpected request: ${url}`);
  });
  render(<AuthProvider><Identity /><AuthControls /></AuthProvider>);
  await screen.findByText('Alice');
  fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  await waitFor(() => expect(finishProfile).toBeTypeOf('function'));
  await act(async () => { window.dispatchEvent(new Event('interviewai:auth-expired')); });
  await screen.findByText('Signed out');
  await act(async () => { finishProfile(); });
  expect(screen.getByText('Signed out')).toBeTruthy();
});

test('a profile response after unmount is ignored', async () => {
  let finishProfile;
  vi.stubGlobal('fetch', async (url) => {
    if (url.endsWith('/auth/me')) return new Response(JSON.stringify({ user: { id: 'alice', name: 'Alice' } }));
    if (url.endsWith('/users/me')) return new Promise(resolve => { finishProfile = () => resolve(new Response(JSON.stringify({ user: { id: 'alice', name: 'Changed' } }))); });
    throw new Error(`unexpected request: ${url}`);
  });
  const view = render(<AuthProvider><Identity /><AuthControls /></AuthProvider>);
  await screen.findByText('Alice');
  fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  await waitFor(() => expect(finishProfile).toBeTypeOf('function'));
  view.unmount();
  await act(async () => { finishProfile(); });
  await waitFor(() => expect(fake.profileResult).toBe(null));
});
