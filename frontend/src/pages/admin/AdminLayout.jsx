import { NavLink, Outlet } from 'react-router-dom';
import { usePageMeta } from '../../hooks/usePageMeta.js';
import './admin.css';

export default function AdminLayout() {
  usePageMeta({ title: 'AI usage admin', description: 'Monitor AI request volume, cost, latency and outcomes.' });
  return (
    <div className="page container admin-page">
      <header className="admin-heading">
        <span className="eyebrow">Operations</span>
        <h1>AI usage</h1>
        <p>Usage metrics and request history for the AI services in InterviewAI.</p>
      </header>
      <nav className="admin-tabs" aria-label="AI usage pages">
        <NavLink end to="/admin" className={({ isActive }) => `admin-tab${isActive ? ' active' : ''}`}>Overview</NavLink>
        <NavLink to="/admin/ai-logs" className={({ isActive }) => `admin-tab${isActive ? ' active' : ''}`}>AI Logs</NavLink>
        <NavLink to="/admin/ai-usage" className={({ isActive }) => `admin-tab${isActive ? ' active' : ''}`}>AI Usage</NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
