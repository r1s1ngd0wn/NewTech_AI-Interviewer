import { useNavigate } from "react-router-dom";
import { usePageMeta } from "../hooks/usePageMeta.js";

export default function NotFoundPage() {
  const navigate = useNavigate();
  usePageMeta({
    title: "Page not found",
    description: "The page you're looking for doesn't exist.",
  });

  return (
    <div className="page container">
      <div className="empty-state card card-pad">
        <span className="eyebrow">404</span>
        <h1>Page not found</h1>
        <p>The page you're looking for doesn't exist or may have moved.</p>
        <button className="btn btn-primary" onClick={() => navigate("/scenarios")}>
          Back to scenarios
        </button>
      </div>
    </div>
  );
}
