import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
export default function ConfirmActionCard({ action }) {
  const [state, setState] = useState(action.status || 'pending');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const expired = now >= Date.parse(action.expires_at);
  const payload = action.payload;
  async function decide(confirm) {
    setBusy(true); setError('');
    try {
      const result = await (confirm ? api.confirmAction(action.id) : api.cancelAction(action.id));
      setState(result.status);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <section className="action-card" aria-label="Proposed plan change">
    <strong>{action.tool === 'create_practice_plan' ? 'Create practice plan' : 'Update practice session'}</strong>
    {payload.title && <p>{payload.title}</p>}
    {payload.items ? <ul>{payload.items.map((item, i) => <li key={i}>{item.scheduledDate} · {item.scenarioId} · {item.status || 'scheduled'}</li>)}</ul>
      : <><p>Item: {payload.id}</p><ul>{Object.entries(payload.change || {}).map(([field, value]) => <li key={field}>{field}: {value}</li>)}</ul></>}
    <p className="chat-msg-note">{state === 'confirmed' ? 'Saved. View it on the Plans page.' : state === 'cancelled' ? 'Cancelled. No plan changes were saved.' : expired ? 'Expired. Ask the coach for a new proposal.' : `Not saved yet. Expires at ${new Date(action.expires_at).toLocaleTimeString()}.`}</p>
    {state === 'pending' && !expired && <div className="plan-actions">
      <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => decide(true)}>Xác nhận</button>
      <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => decide(false)}>Huỷ</button>
    </div>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
