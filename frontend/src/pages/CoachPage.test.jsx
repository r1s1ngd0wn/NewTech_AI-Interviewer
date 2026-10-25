import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const stream = vi.hoisted(() => ({ emit: null, finish: null }));
vi.mock('../lib/api.js', () => ({ api: {
  streamCoachMessage: vi.fn((text, emit) => {
    stream.emit = emit;
    return new Promise(resolve => { stream.finish = resolve; });
  }),
} }));
import CoachPage from './CoachPage.jsx';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test('coach keeps tool progress and confirmation alongside plain text replies and sources', async () => {
  const health = vi.fn();
  window.addEventListener('interviewai:ai-health', health);
  try {
    render(<MemoryRouter><CoachPage /></MemoryRouter>);
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask the coach' }), { target: { value: 'Prepare a plan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    act(() => {
      stream.emit({ type: 'status', status: 'searching' });
      stream.emit({ type: 'sources', sources: [{ id: 'cv', label: 'CV', excerpt: 'React experience' }] });
      stream.emit({ type: 'tool', name: 'create_practice_plan', status: 'completed' });
      stream.emit({ type: 'action', action: {
        id: 'proposal', status: 'pending', expires_at: '2099-01-01T00:00:00Z',
        tool: 'create_practice_plan', payload: { title: 'Practice week', items: [] },
      } });
    });
    expect(screen.getByText('Calling tool...')).toBeTruthy();
    expect(screen.getByText('create_practice_plan: completed')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Proposed plan change' })).toBeTruthy();
    expect(screen.getByText('1 sources found')).toBeTruthy();
    act(() => stream.emit({ type: 'token', text: '**Practice React**' }));
    expect(screen.getByRole('status').textContent).toContain('Practice React');
    expect(screen.getByRole('status').textContent).not.toContain('**');
    await act(async () => {
      stream.emit({ type: 'done', answer: {
        text: '**Practice React**', sources: [{ id: 'cv', label: 'CV', excerpt: 'React experience' }],
      } });
      stream.finish();
    });
    expect(screen.getByText('Practice React')).toBeTruthy();
    expect(screen.getByText('CV: React experience')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Proposed plan change' })).toBeTruthy();
    expect(health).toHaveBeenCalledOnce();
  } finally {
    window.removeEventListener('interviewai:ai-health', health);
  }
});
