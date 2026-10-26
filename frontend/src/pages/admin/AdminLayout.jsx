import { NavLink, Outlet } from 'react-router-dom';
import { usePageMeta } from '../../hooks/usePageMeta.js';
import './admin.css';

export default function AdminLayout() {
  usePageMeta({ title: 'Admin console', description: 'Manage users and scenarios, and review AI usage.' });
  return (
    <div className="page container admin-page">
      <header className="admin-heading">
        <span className="eyebrow">Operations</span>
        <h1>Admin console</h1>
        <p>Manage user access and scenario availability, and review AI service usage.</p>
      </header>
      <nav className="admin-tabs" aria-label="AI usage pages">
        <NavLink end to="/admin" className={({ isActive }) => `admin-tab${isActive ? ' active' : ''}`}>Overview</NavLink>
        <NavLink to="/admin/ai-logs" className={({ isActive }) => `admin-tab${isActive ? ' active' : ''}`}>AI Logs</NavLink>
        <NavLink to="/admin/ai-usage" className={({ isActive }) => `admin-tab${isActive ? ' active' : ''}`}>AI Usage</NavLink>
        <NavLink to="/admin/users" className={({ isActive }) => `admin-tab${isActive ? ' active' : ''}`}>Users</NavLink>
        <NavLink to="/admin/scenarios" className={({ isActive }) => `admin-tab${isActive ? ' active' : ''}`}>Scenarios</NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
