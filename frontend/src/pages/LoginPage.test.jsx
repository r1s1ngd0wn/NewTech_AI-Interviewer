import React from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const fake = vi.hoisted(() => ({
  session: null,
  listener: null,
  initialize: vi.fn(),
  getSession: vi.fn(),
  signInWithOAuth: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('../lib/supabase.js', () => {
  const supabase = { auth: {
    initialize: fake.initialize,
    getSession: fake.getSession,
    signInWithOAuth: fake.signInWithOAuth,
    signOut: fake.signOut,
    onAuthStateChange: listener => {
      fake.listener = listener;
      return { data: { subscription: { unsubscribe() {} } } };
    },
  } };
  return { previewAuth: false, supabase, requireSupabase: () => supabase };
});

import { AuthProvider } from '../context/AuthContext.jsx';
import LoginPage from './LoginPage.jsx';

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/onboarding" element={<h1>Onboarding destination</h1>} />
          <Route path="/scenarios" element={<h1>Scenarios destination</h1>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  // jsdom has no media-query API; retain the real carousel with reduced motion.
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  fake.session = null;
  fake.listener = null;
  fake.initialize.mockReset().mockResolvedValue({ error: null });
  fake.getSession.mockReset().mockImplementation(async () => ({ data: { session: fake.session }, error: null }));
  fake.signInWithOAuth.mockReset().mockResolvedValue({ data: {}, error: null });
  fake.signOut.mockReset().mockResolvedValue({ error: null });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    user: { id: 'test-user', profile: { onboardingComplete: false } },
  }))));
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
});

test('Google sign-in requests the Google provider and current-origin login callback', async () => {
  renderLogin();
  fireEvent.click(screen.getByRole('button', { name: /Google/ }));
  await waitFor(() => expect(fake.signInWithOAuth).toHaveBeenCalledWith({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/login` },
  }));
});

test('Google sign-in initiation rejection is visible to the user', async () => {
  fake.signInWithOAuth.mockRejectedValueOnce(new Error('Unable to start Google sign-in'));
  renderLogin();
  fireEvent.click(screen.getByRole('button', { name: /Google/ }));
  expect((await screen.findByRole('alert')).textContent).toContain('Unable to start Google sign-in');
});

test('SIGNED_IN callback authenticates the account request and sends a new profile to onboarding', async () => {
  renderLogin();
  await waitFor(() => expect(fake.getSession).toHaveBeenCalled());
  await act(async () => {
    fake.session = { access_token: 'google-callback-test-token' };
    fake.listener('SIGNED_IN', fake.session);
  });
  await screen.findByRole('heading', { name: 'Onboarding destination' });
  expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/auth\/me$/), expect.objectContaining({
    headers: expect.objectContaining({ Authorization: 'Bearer google-callback-test-token' }),
  }));
});

test('a returning account restored on bootstrap navigates to scenarios', async () => {
  fake.session = { access_token: 'returning-account-test-token' };
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({
    user: { id: 'returning-user', profile: { onboardingComplete: true } },
  })));
  renderLogin();
  await screen.findByRole('heading', { name: 'Scenarios destination' });
});

test('a failed OAuth callback displays a generic message without the raw provider error', async () => {
  const providerError = 'Provider-internal callback diagnostics';
  fake.initialize.mockResolvedValueOnce({ error: new Error(providerError) });
  renderLogin();
  expect((await screen.findByRole('alert')).textContent).toContain('Google sign-in could not be completed. Please try again.');
  expect(screen.queryByText(providerError)).toBe(null);
  expect(screen.queryByRole('heading', { name: /destination/ })).toBe(null);
});

test('an authenticated account lookup failure offers a visible retry message', async () => {
  fake.session = { access_token: 'unavailable-account-test-token' };
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Temporary account service failure' }), { status: 503 }));
  renderLogin();
  expect((await screen.findByRole('alert')).textContent).toContain('Could not load your account. Please try signing in again.');
  expect(screen.queryByRole('heading', { name: /destination/ })).toBe(null);
});

test('a callback with no restored session explains the failure', async () => {
  window.history.replaceState({}, '', '/login?code=missing-verifier-code');
  renderLogin();
  expect((await screen.findByRole('alert')).textContent).toContain('Google sign-in could not be completed. Please try again.');
});

test('a fresh sign-in recovers after a callback failure', async () => {
  fake.initialize.mockResolvedValueOnce({ error: new Error('Expired callback') });
  renderLogin();
  await screen.findByRole('alert');
  await act(async () => { fake.listener('INITIAL_SESSION', null); });
  expect(screen.getByRole('alert').textContent).toContain('Google sign-in could not be completed');
  await act(async () => {
    fake.session = { access_token: 'recovered-session-token' };
    fake.listener('SIGNED_IN', fake.session);
  });
  await screen.findByRole('heading', { name: 'Onboarding destination' });
  expect(screen.queryByRole('alert')).toBe(null);
});
