import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';

function ItemEditor({ item, scenarios, onSave, onCancel }) {
  const [scenarioId, setScenario] = useState(item?.scenarioId || scenarios[0]?.id || '');
  const [scheduledDate, setDate] = useState(item?.scheduledDate || '');
  const [status, setStatus] = useState(item?.status || 'scheduled');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <form className="plan-item-form" onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError('');
    try { await onSave({ scenarioId, scheduledDate, status }); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }}>
    <label>Scenario<select required value={scenarioId} onChange={e => setScenario(e.target.value)}>{scenarios.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
    <label>Date<input required type="date" value={scheduledDate} onChange={e => setDate(e.target.value)} /></label>
    <label>Status<select value={status} onChange={e => setStatus(e.target.value)}><option value="scheduled">Scheduled</option><option value="done">Done</option><option value="skipped">Skipped</option></select></label>
    <div className="plan-actions"><button disabled={busy} className="btn btn-primary btn-sm">Save session</button><button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button></div>
    {error && <p role="alert" className="form-error">{error}</p>}
  </form>;
}
function PlanCard({ plan, scenarios, refresh }) {
  const [title, setTitle] = useState(plan.title);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  async function mutate(fn) {
    setBusy(true); setError('');
    try { await fn(); await refresh(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <section className="plan-card">
    <form className="plan-actions" onSubmit={e => { e.preventDefault(); mutate(() => api.updatePlan(plan.id, { title })); }}>
      <input aria-label="Plan title" maxLength={120} required value={title} onChange={e => setTitle(e.target.value)} />
      <button disabled={busy} className="btn btn-secondary btn-sm">Rename</button>
      <button disabled={busy} type="button" className="btn btn-secondary btn-sm" onClick={() => setDeleting(true)}>Delete plan</button>
    </form>
    {deleting && <div className="action-card" role="alert"><p>Delete this plan and all its sessions?</p><button className="btn btn-primary btn-sm" disabled={busy} onClick={() => mutate(() => api.deletePlan(plan.id))}>Delete</button>{' '}<button className="btn btn-secondary btn-sm" onClick={() => setDeleting(false)}>Keep plan</button></div>}
    <ul className="plan-items">{[...plan.items].sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate)).map(item => <li key={item.id}>
      <div><strong>{scenarios.find(s => s.id === item.scenarioId)?.title || item.scenarioId}</strong><p>{item.scheduledDate} · {item.status}</p><details><summary>Item ID for coach updates</summary><code>{item.id}</code></details></div>
      <div className="plan-actions">
        <Link className="btn btn-primary btn-sm" to={`/interview/${item.scenarioId}`}>Start practice</Link>
        <button disabled={busy} className="btn btn-secondary btn-sm" onClick={() => mutate(() => api.updatePlanItem(item.id, { status: item.status === 'done' ? 'scheduled' : 'done' }))}>{item.status === 'done' ? 'Reopen' : 'Mark done'}</button>
        <button disabled={busy} className="btn btn-secondary btn-sm" onClick={() => setEditing(item)}>Edit</button>
        <button disabled={busy} className="btn btn-ghost" onClick={() => mutate(() => api.deletePlanItem(item.id))}>Remove</button>
      </div>
      {editing?.id === item.id && <ItemEditor key={item.id} item={item} scenarios={scenarios} onCancel={() => setEditing(null)} onSave={async data => { await api.updatePlanItem(item.id, data); setEditing(null); await refresh(); }} />}
    </li>)}</ul>
    {editing === 'new' ? <ItemEditor scenarios={scenarios} onCancel={() => setEditing(null)} onSave={async data => { await api.addPlanItem(plan.id, data); setEditing(null); await refresh(); }} />
      : <button className="btn btn-secondary btn-sm" onClick={() => setEditing('new')}>Add session</button>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
export default function PlanPage() {
  const [plans, setPlans] = useState([]);
  const [scenarios, setScenarios] = useState([]);
  const [title, setTitle] = useState('My practice plan');
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  async function refresh() { const { plans } = await api.listPlans(); setPlans(plans); }
  useEffect(() => {
    let active = true;
    Promise.all([api.listPlans(), api.listScenarios()]).then(([p, s]) => { if (active) { setPlans(p.plans); setScenarios(s.scenarios); } })
      .catch(err => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return <div className="page container plans-page">
    <span className="eyebrow">Interview practice</span><h1>Practice plans</h1><p>Manage your schedule here, or ask <Link to="/coach">Coach</Link> to propose one.</p>
    {error && <div className="form-error" role="alert">{error}</div>}
    {loading ? <p role="status">Loading plans...</p> : <>
      <button className="btn btn-primary" onClick={() => setCreating(true)}>New plan</button>
      {creating && <section className="plan-card"><label>Plan title<input maxLength={120} value={title} onChange={e => setTitle(e.target.value)} /></label>
        <ItemEditor scenarios={scenarios} onCancel={() => setCreating(false)} onSave={async item => { await api.createPlan({ title, items: [item] }); setCreating(false); await refresh(); }} /></section>}
      {!plans.length && !creating && <p className="empty-state">No plans yet. Create your first practice session.</p>}
      {plans.map(plan => <PlanCard key={plan.id} plan={plan} scenarios={scenarios} refresh={refresh} />)}
    </>}
  </div>;
}
