-- Apply after 001_app_store.sql. Speeds up user-scoped session history.
CREATE INDEX IF NOT EXISTS interviewai_sessions_owner_started
  ON public.interviewai_sessions ((value->>'userId'), (value->>'startedAt') DESC);
