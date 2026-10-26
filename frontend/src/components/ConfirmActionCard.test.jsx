import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
vi.mock('../lib/supabase.js', () => ({ previewAuth: true, supabase: null }));
import ConfirmActionCard from './ConfirmActionCard.jsx';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const proposal = { id: 'action-1', status: 'pending', expires_at: '2099-01-01T00:00:00Z', tool: 'create_practice_plan', payload: { title: 'Week', items: [{ scenarioId: 'scenario', scheduledDate: '2026-11-01' }] } };
test('confirmation remains disabled in flight and displays saved only after server success', async () => {
  let resolve;
  vi.stubGlobal('fetch', () => new Promise(done => { resolve = done; }));
  render(<ConfirmActionCard action={proposal} />);
  const button = screen.getByRole('button', { name: 'Confirm' });
  fireEvent.click(button);
  expect(button.disabled).toBe(true);
  expect(screen.queryByText(/Saved\. View/)).toBe(null);
  // The API waits for getToken before calling fetch.
  await vi.waitFor(() => expect(typeof resolve).toBe('function'));
  resolve(new Response(JSON.stringify({ status: 'confirmed' })));
  await screen.findByText('Saved. View it on the Plans page.');
  expect(screen.queryByRole('button', { name: 'Confirm' })).toBe(null);
});
test('expired proposals expose no confirm button', () => {
  render(<ConfirmActionCard action={{ ...proposal, expires_at: '2000-01-01T00:00:00Z' }} />);
  expect(screen.queryByRole('button', { name: 'Confirm' })).toBe(null);
  expect(screen.getByText(/Expired/)).toBeTruthy();
});
