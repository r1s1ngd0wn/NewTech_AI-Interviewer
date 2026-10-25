import React from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
const fake = vi.hoisted(() => ({ session: null, listener: null }));
vi.mock('../lib/supabase.js', () => {
  const supabase = { auth: {
    initialize: async () => ({ error: null }),
    getSession: async () => ({ data: { session: fake.session } }),
    onAuthStateChange: listener => { fake.listener = listener; return { data: { subscription: { unsubscribe() {} } } }; },
    signOut: async () => { fake.session = null; fake.listener?.('SIGNED_OUT', null); return {}; },
  } };
  return { previewAuth: false, supabase, requireSupabase: () => supabase };
});
import { AuthProvider, useAuth } from './AuthContext.jsx';
import { api, getToken } from '../lib/api.js';
function Identity() { const { user, loading } = useAuth(); return <p>{loading ? 'Loading' : user?.name || 'Signed out'}</p>; }
beforeEach(() => { fake.session = { access_token: 'first-jwt' }; fake.listener = null; });
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
