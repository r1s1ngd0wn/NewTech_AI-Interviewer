import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../lib/api.js";
import { AlertIcon } from "../components/icons.jsx";

const EXPERIENCE_LEVELS = ["Junior", "Mid-level", "Senior"];

export default function OnboardingPage() {
  const { user, updateProfile } = useAuth();
  const navigate = useNavigate();
  const [industries, setIndustries] = useState([]);
  const [form, setForm] = useState({
    name: user?.name || "",
    targetIndustry: user?.profile?.targetIndustry || "",
    experienceLevel: user?.profile?.experienceLevel || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

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
    setSaving(true);
    try {
      await updateProfile({
        name: form.name,
        targetIndustry: form.targetIndustry || null,
        experienceLevel: form.experienceLevel || null,
      });
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page container">
      <div className="card card-pad form-card">
        <span className="eyebrow">Step 1</span>
        <h1>Tell us about your target role</h1>
        <p>
          We use this to recommend scenarios that match your industry and seniority (FR-1.2 /
          FR-1.3). You can change this anytime from Profile.
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
        </form>
      </div>
    </div>
  );
}
