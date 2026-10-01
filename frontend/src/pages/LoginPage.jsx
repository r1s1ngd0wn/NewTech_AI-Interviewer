import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { AlertIcon } from "../components/icons.jsx";
import HeroCarousel from "../components/HeroCarousel.jsx";
import { usePageMeta } from "../hooks/usePageMeta.js";

export default function LoginPage() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { login, register, user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      navigate(user.profile?.onboardingComplete ? "/scenarios" : "/onboarding", { replace: true });
    }
  }, [user, navigate]);

  usePageMeta({
    title: mode === "login" ? "Log in" : "Create account",
    description: "Practice English job interviews with an AI simulator and get rubric-based feedback after each session.",
  });

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(email, password, name);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="hero-split">
      <div className="hero-photo">
        <HeroCarousel />
        <div className="hero-scrim" aria-hidden="true" />
        <div className="hero-copy">
          <h1>Practice until the interview feels routine.</h1>
          <p>
            Speak your answers to an AI interviewer bounded to a fixed scenario, then get
            rubric-based feedback, not a free-form AI opinion.
          </p>
        </div>
      </div>

      <div className="hero-form-panel">
        <div className="form-card" style={{ width: "100%" }}>
          <span className="eyebrow">InterviewAI</span>
          <h2>{mode === "login" ? "Welcome back" : "Create your account"}</h2>
          <p>
            Practice English job interviews with an AI simulator and get rubric-based feedback
            after each session.
          </p>

          {error && (
            <div className="form-error" role="alert">
              <AlertIcon width={16} height={16} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            {mode === "register" && (
              <div className="field">
                <label htmlFor="name">Full name</label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </div>
            )}
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </div>

            <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
              {submitting && <span className="spinner" aria-hidden="true" />}
              {mode === "login" ? "Log in" : "Create account"}
            </button>
          </form>

          <p className="text-center" style={{ marginTop: "1.25rem", marginBottom: 0 }}>
            {mode === "login" ? "New here?" : "Already have an account?"}{" "}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setError("");
                setMode(mode === "login" ? "register" : "login");
              }}
            >
              {mode === "login" ? "Create an account" : "Log in instead"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
