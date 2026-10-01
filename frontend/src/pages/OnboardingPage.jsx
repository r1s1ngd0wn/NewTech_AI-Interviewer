import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../lib/api.js";
import { AlertIcon, TrashIcon } from "../components/icons.jsx";
import { usePageMeta } from "../hooks/usePageMeta.js";

const EXPERIENCE_LEVELS = ["Junior", "Mid-level", "Senior"];

export default function OnboardingPage() {
  const { user, updateProfile, logout } = useAuth();
  const navigate = useNavigate();
  const [industries, setIndustries] = useState([]);
  const [form, setForm] = useState({
    name: user?.name || "",
    targetIndustry: user?.profile?.targetIndustry || "",
    targetRole: user?.profile?.targetRole || "",
    experienceLevel: user?.profile?.experienceLevel || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [dataError, setDataError] = useState("");

  usePageMeta({
    title: "Profile",
    description: "Set your target industry, role and experience level for better scenario recommendations.",
  });

  useEffect(() => {
    api.scenarioFilters().then((data) => setIndustries(data.industries)).catch(() => {});
  }, []);

  function handleChange(key, value) {
    setSaved(false);
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) {
      setError("Please enter your name.");
      return;
    }
    setSaving(true);
    try {
      await updateProfile({
        name: form.name,
        targetIndustry: form.targetIndustry || null,
        targetRole: form.targetRole.trim() || null,
        experienceLevel: form.experienceLevel || null,
      });
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    setDataError("");
    try {
      const data = await api.exportMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "interviewai-my-data.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setDataError(err.message);
    }
  }

  async function handleDeleteAccount() {
    if (
      !window.confirm(
        "Delete your account? Every session, transcript, score and chat will be permanently removed. This can't be undone."
      )
    ) {
      return;
    }
    setDataError("");
    try {
      await api.deleteMyAccount();
      await logout();
      navigate("/login");
    } catch (err) {
      setDataError(err.message);
    }
  }

  return (
    <div className="page container">
      <div className="card card-pad form-card">
        <span className="eyebrow">Profile</span>
        <h1>Tell us about your target role</h1>
        <p>
          We use this to recommend scenarios that match your industry and seniority. You can change
          it anytime.
        </p>

        {error && (
          <div className="form-error" role="alert">
            <AlertIcon width={16} height={16} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="name">Your name</label>
            <input
              id="name"
              type="text"
              value={form.name}
              maxLength={80}
              onChange={(e) => handleChange("name", e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="industry">Target industry</label>
            <select
              id="industry"
              value={form.targetIndustry}
              onChange={(e) => handleChange("targetIndustry", e.target.value)}
            >
              <option value="">Select an industry</option>
              {industries.map((industry) => (
                <option key={industry} value={industry}>
                  {industry}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="role">Target job title</label>
            <input
              id="role"
              type="text"
              value={form.targetRole}
              maxLength={80}
              placeholder="e.g. Frontend Developer"
              onChange={(e) => handleChange("targetRole", e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="level">Experience level</label>
            <select
              id="level"
              value={form.experienceLevel}
              onChange={(e) => handleChange("experienceLevel", e.target.value)}
            >
              <option value="">Select a level</option>
              {EXPERIENCE_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </div>

          <div className="row" style={{ marginTop: "1.5rem" }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving && <span className="spinner" aria-hidden="true" />}
              Save profile
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => navigate("/scenarios")}>
              {saved ? "Continue to scenarios" : "Skip for now"}
            </button>
          </div>
          {saved && (
            <p className="muted" role="status" style={{ marginBottom: 0, marginTop: "0.75rem" }}>
              Profile saved.
            </p>
          )}
        </form>
      </div>

      <div className="card card-pad form-card data-card">
        <h2 className="mt-0">Your data</h2>
        <p>
          Download everything InterviewAI holds about you, or delete your account along with every
          session, transcript and chat.
        </p>
        {dataError && (
          <div className="form-error" role="alert">
            <AlertIcon width={16} height={16} />
            <span>{dataError}</span>
          </div>
        )}
        <div className="row wrap">
          <button type="button" className="btn btn-secondary" onClick={handleExport}>
            Download my data
          </button>
          <button type="button" className="btn btn-ghost" onClick={handleDeleteAccount}>
            <TrashIcon width={16} height={16} />
            Delete my account
          </button>
        </div>
      </div>
    </div>
  );
}
