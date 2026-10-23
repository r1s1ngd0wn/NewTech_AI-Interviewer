-- Run in Supabase SQL Editor before starting the backend. Only the trusted backend
-- connects to these tables; never expose a privileged database URL in the frontend.
CREATE TABLE IF NOT EXISTS public.interviewai_users (id text PRIMARY KEY, value jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS public.interviewai_users_by_email (email text PRIMARY KEY, value jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS public.interviewai_tokens (token text PRIMARY KEY, value jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS public.interviewai_sessions (id text PRIMARY KEY, value jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS public.interviewai_feedbacks (
  session_id text PRIMARY KEY REFERENCES public.interviewai_sessions(id) ON DELETE CASCADE,
  value jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS public.interviewai_session_chats (
  session_id text PRIMARY KEY REFERENCES public.interviewai_sessions(id) ON DELETE CASCADE,
  value jsonb NOT NULL
);

ALTER TABLE public.interviewai_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interviewai_users_by_email ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interviewai_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interviewai_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interviewai_feedbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interviewai_session_chats ENABLE ROW LEVEL SECURITY;
