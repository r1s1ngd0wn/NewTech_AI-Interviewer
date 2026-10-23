CREATE TABLE IF NOT EXISTS public.interviewai_user_documents (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('cv', 'jd')),
  filename text NOT NULL,
  content_type text NOT NULL,
  storage_path text NOT NULL,
  extracted_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS interviewai_user_documents_owner
  ON public.interviewai_user_documents (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.interviewai_knowledge_chunks (
  id text PRIMARY KEY,
  user_id text,
  document_id text REFERENCES public.interviewai_user_documents(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('document', 'question')),
  source_label text NOT NULL,
  content text NOT NULL,
  content_hash text NOT NULL,
  model_key text NOT NULL,
  embedding extensions.vector(768) NOT NULL,
  CHECK ((source_type = 'question' AND user_id IS NULL AND document_id IS NULL)
    OR (source_type = 'document' AND user_id IS NOT NULL AND document_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS interviewai_knowledge_scope
  ON public.interviewai_knowledge_chunks (user_id, model_key);
CREATE INDEX IF NOT EXISTS interviewai_knowledge_embedding
  ON public.interviewai_knowledge_chunks USING hnsw (embedding extensions.vector_cosine_ops);

ALTER TABLE public.interviewai_user_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interviewai_knowledge_chunks ENABLE ROW LEVEL SECURITY;
