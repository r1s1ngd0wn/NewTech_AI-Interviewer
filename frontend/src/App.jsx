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
import AdminLayout from './pages/admin/AdminLayout.jsx';
import AdminOverviewPage from './pages/admin/AdminOverviewPage.jsx';
import AdminAiLogsPage from './pages/admin/AdminAiLogsPage.jsx';
import AdminAiUsageLogPage from './pages/admin/AdminAiUsageLogPage.jsx';
import AdminUsersPage from './pages/admin/AdminUsersPage.jsx';
import AdminScenariosPage from './pages/admin/AdminScenariosPage.jsx';

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
          <Route path="/admin" element={<ProtectedRoute role="admin"><AdminLayout /></ProtectedRoute>}>
            <Route index element={<AdminOverviewPage />} />
            <Route path="ai-logs" element={<AdminAiLogsPage />} />
            <Route path="ai-usage" element={<AdminAiUsageLogPage />} />
            <Route path="users" element={<AdminUsersPage />} />
            <Route path="scenarios" element={<AdminScenariosPage />} />
          </Route>
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
