-- Metadata only: never store prompts, CV text, responses or API keys here.
CREATE TABLE IF NOT EXISTS public.interviewai_ai_request_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text,
  provider text NOT NULL,
  model text NOT NULL,
  operation text NOT NULL,
  prompt_version text,
  duration_ms integer NOT NULL,
  status text NOT NULL CHECK (status IN ('ok', 'error', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS interviewai_ai_request_logs_owner_time
  ON public.interviewai_ai_request_logs (user_id, created_at DESC);
ALTER TABLE public.interviewai_ai_request_logs ENABLE ROW LEVEL SECURITY;
