-- Keep Long_RAG names and JSON shapes, enforce ownership in PostgreSQL too.
grant usage on schema extensions to authenticated;
alter table public.interviewai_documents add constraint document_storage_owner
  check(split_part(storage_path,'/',1)=user_id);
alter table public.interviewai_user_documents add constraint library_storage_owner
  check(split_part(storage_path,'/',1)=user_id);
grant select,insert,update,delete on public.interviewai_sessions,public.interviewai_feedbacks,
  public.interviewai_session_chats,public.interviewai_documents,public.interviewai_rag_chunks,
  public.interviewai_user_documents,public.interviewai_knowledge_chunks to authenticated;
revoke all on public.interviewai_users,public.interviewai_users_by_email,public.interviewai_tokens from anon,authenticated;

create policy session_owner on public.interviewai_sessions to authenticated
  using(value->>'userId' = (select auth.uid())::text and (select public.is_session_active()))
  with check(value->>'userId' = (select auth.uid())::text and (select public.is_session_active()));
create policy feedback_owner on public.interviewai_feedbacks to authenticated
  using(exists(select 1 from public.interviewai_sessions s where s.id=session_id))
  with check(exists(select 1 from public.interviewai_sessions s where s.id=session_id));
create policy session_chat_owner on public.interviewai_session_chats to authenticated
  using(exists(select 1 from public.interviewai_sessions s where s.id=session_id))
  with check(exists(select 1 from public.interviewai_sessions s where s.id=session_id));
create policy session_document_owner on public.interviewai_documents to authenticated
  using(user_id=(select auth.uid())::text and (select public.is_session_active()))
  with check(user_id=(select auth.uid())::text and exists(select 1 from public.interviewai_sessions s where s.id=session_id));
create policy rag_owner on public.interviewai_rag_chunks to authenticated
  using(user_id=(select auth.uid())::text and (select public.is_session_active()))
  with check(user_id=(select auth.uid())::text and exists(select 1 from public.interviewai_sessions s where s.id=session_id));
create policy library_owner on public.interviewai_user_documents to authenticated
  using(user_id=(select auth.uid())::text and (select public.is_session_active()))
  with check(user_id=(select auth.uid())::text and (select public.is_session_active()));
create policy knowledge_read on public.interviewai_knowledge_chunks for select to authenticated
  using((user_id=(select auth.uid())::text or (user_id is null and source_type='question')) and (select public.is_session_active()));
create policy knowledge_write on public.interviewai_knowledge_chunks to authenticated
  using(user_id=(select auth.uid())::text and (select public.is_session_active()))
  with check(user_id=(select auth.uid())::text and exists(select 1 from public.interviewai_user_documents d where d.id=document_id));

-- Private Storage uses the same owner prefix as Long_RAG. The backend still
-- removes files via its trusted service key after checking document ownership.
create policy document_file_owner on storage.objects to authenticated
  using(bucket_id='interviewai-private' and (storage.foldername(name))[1]=(select auth.uid())::text and (select public.is_session_active()))
  with check(bucket_id='interviewai-private' and (storage.foldername(name))[1]=(select auth.uid())::text and (select public.is_session_active()));
