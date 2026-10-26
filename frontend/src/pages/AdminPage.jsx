import { Link } from "react-router-dom";
import { usePageMeta } from "../hooks/usePageMeta.js";

export default function AdminPage() {
  usePageMeta({ title: "Admin", description: "Administrator tools." });
  return (
    <div className="page container">
      <span className="eyebrow">Admin</span>
      <h1>Administration</h1>
      <p>Tools for administrators.</p>
      <div className="grid grid-2">
        <div className="card card-pad stack">
          <h3 className="mt-0 mb-0">AI usage</h3>
          <p className="muted mb-0">Requests, failures, response time, tokens and estimated cost for every AI call.</p>
          <div><Link className="btn btn-primary btn-sm" to="/admin/usage">Open usage dashboard</Link></div>
        </div>
      </div>
    </div>
  );
}
