CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.interviewai_documents (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  session_id text NOT NULL REFERENCES public.interviewai_sessions(id) ON DELETE CASCADE,
  filename text NOT NULL,
  content_type text NOT NULL,
  storage_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS interviewai_documents_scope
  ON public.interviewai_documents (user_id, session_id);

CREATE TABLE IF NOT EXISTS public.interviewai_rag_chunks (
  id text NOT NULL,
  user_id text NOT NULL,
  session_id text NOT NULL REFERENCES public.interviewai_sessions(id) ON DELETE CASCADE,
  document_id text REFERENCES public.interviewai_documents(id) ON DELETE CASCADE,
  source_label text NOT NULL,
  content text NOT NULL,
  content_hash text NOT NULL,
  model_key text NOT NULL,
  embedding extensions.vector(768) NOT NULL,
  PRIMARY KEY (user_id, session_id, id)
);
CREATE INDEX IF NOT EXISTS interviewai_rag_scope
  ON public.interviewai_rag_chunks (user_id, session_id, model_key);
CREATE INDEX IF NOT EXISTS interviewai_rag_embedding
  ON public.interviewai_rag_chunks USING hnsw (embedding extensions.vector_cosine_ops);

ALTER TABLE public.interviewai_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interviewai_rag_chunks ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public)
VALUES ('interviewai-private', 'interviewai-private', false)
ON CONFLICT (id) DO NOTHING;
