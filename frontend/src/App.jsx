import { Routes, Route, Navigate } from "react-router-dom";
import Header from "./components/Header.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import OnboardingPage from "./pages/OnboardingPage.jsx";
import ScenariosPage from "./pages/ScenariosPage.jsx";
import InterviewPage from "./pages/InterviewPage.jsx";
import FeedbackPage from "./pages/FeedbackPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import DocumentsPage from "./pages/DocumentsPage.jsx";
import CoachPage from "./pages/CoachPage.jsx";
import NotFoundPage from "./pages/NotFoundPage.jsx";
import PlanPage from './pages/PlanPage.jsx';

export default function App() {
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <Header />
      <main id="main-content">
        <Routes>
          <Route path="/" element={<Navigate to="/scenarios" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/plans" element={<ProtectedRoute><PlanPage /></ProtectedRoute>} />
          <Route path="/admin/*" element={<ProtectedRoute role="admin"><div className="page container"><h1>Admin</h1><p>Administrator access is enabled.</p></div></ProtectedRoute>} />
          <Route
            path="/onboarding"
            element={
              <ProtectedRoute>
                <OnboardingPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/scenarios"
            element={
              <ProtectedRoute>
                <ScenariosPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/interview/:scenarioId"
            element={
              <ProtectedRoute>
                <InterviewPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/feedback/:sessionId"
            element={
              <ProtectedRoute>
                <FeedbackPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/coach"
            element={
              <ProtectedRoute>
                <CoachPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/documents"
            element={
              <ProtectedRoute>
                <DocumentsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </div>
  );
}
