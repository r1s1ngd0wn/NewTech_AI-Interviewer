import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <header className="site-header">
      <div className="container">
        <NavLink to="/" className="brand" aria-label="InterviewAI home">
          InterviewAI
        </NavLink>

        {user && (
          <nav className="nav-links" aria-label="Main navigation">
            <NavLink to="/scenarios" className={({ isActive }) => `nav-pill ${isActive ? "active" : ""}`}>
              Scenarios
            </NavLink>
            <NavLink to="/dashboard" className={({ isActive }) => `nav-pill ${isActive ? "active" : ""}`}>
              Progress
            </NavLink>
            <NavLink to="/documents" className={({ isActive }) => `nav-pill ${isActive ? "active" : ""}`}>
              Documents
            </NavLink>
            <NavLink to="/coach" className={({ isActive }) => `nav-pill ${isActive ? "active" : ""}`}>
              Coach
            </NavLink>
            <NavLink to="/onboarding" className={({ isActive }) => `nav-pill ${isActive ? "active" : ""}`}>
              Profile
            </NavLink>
          </nav>
        )}

        <div className="nav-user">
          {user ? (
            <>
              <span className="nav-user-name">{user.name}</span>
              <button className="btn btn-secondary btn-sm" onClick={handleLogout}>
                Log out
              </button>
            </>
          ) : (
            <NavLink to="/login" className="btn btn-primary btn-sm">
              Log in
            </NavLink>
          )}
        </div>
      </div>
    </header>
  );
}
