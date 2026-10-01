import { useEffect } from "react";

const SITE_NAME = "InterviewAI";

function upsertMeta(name, content) {
  let el = document.querySelector(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertCanonical(href) {
  let el = document.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

// Sets the document title, meta description, and canonical link for the
// current route. No react-helmet dependency - direct DOM writes are enough
// for a handful of static per-page strings.
export function usePageMeta({ title, description }) {
  useEffect(() => {
    document.title = title ? `${title} - ${SITE_NAME}` : SITE_NAME;
    if (description) upsertMeta("description", description);
    upsertCanonical(window.location.origin + window.location.pathname);
  }, [title, description]);
}
