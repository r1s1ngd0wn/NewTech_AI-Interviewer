-- Protect new rows without deleting historical metadata or requiring a full-table scan.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'interviewai_ai_request_logs_user_id_fkey'
      AND conrelid = 'public.interviewai_ai_request_logs'::regclass
  ) THEN
    ALTER TABLE public.interviewai_ai_request_logs
      ADD CONSTRAINT interviewai_ai_request_logs_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.interviewai_users(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
