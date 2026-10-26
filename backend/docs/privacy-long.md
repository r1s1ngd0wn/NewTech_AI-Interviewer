# Privacy note for document-grounded interview coaching

Uploaded CVs and job descriptions are stored in a private Supabase Storage bucket. Extracted text and 768-dimensional embeddings are stored in Supabase Postgres. Session answers, feedback and chat are also persisted there. The browser receives only documents belonging to the authenticated account, and retrieval queries filter private chunks by user ID. No Supabase secret or Gemini API key belongs in frontend code.

Uploads are limited to 5 MB, 100,000 extracted characters and 40 searchable chunks. A user may keep up to 10 reusable documents, with up to 3 additional documents per interview. DOCX archives are checked for excessive expanded size before text extraction.

When `GROQ_API_KEY` is set, a spoken answer is recorded in the browser and the audio is sent through the backend to Groq for transcription; it is not stored by the app, and the request log records only the model, time and status. Without the key the browser's own speech recognition is used, which sends audio to the browser vendor.

When Gemini embeddings are enabled, extracted text chunks and search queries are sent to Google's embedding API. When Gemini chat is enabled, relevant retrieved excerpts and the user's question may be sent to the Gemini generation API. With a local embedding/chat provider those model calls remain local, but Supabase still stores application data. Users should avoid uploading sensitive third-party information without consent.

Deleting a library file removes its original, extracted text and indexed chunks. Chat histories are cleared only for sessions that used the file as prepared question context or cited it in a reply; unrelated chats remain. Deleting an account also deletes its library files. Answers the user themselves typed or spoke remain part of their interview history until that session or account is deleted. Exporting account data includes the uploaded originals and extracted text.

AI request logs store user ID, provider, model, operation, prompt version, duration, status and time. They do not store prompts, document text, model replies or API keys. Account export includes these metadata rows, and account deletion removes them. Once migration 006 is applied, a database foreign key also cascades late-arriving logs when an account is deleted; existing orphan rows are not changed by that migration.

Input guardrails reject obvious prompt-override requests and strip matching instruction lines from retrieved source text before sending it to the model. This is defense in depth, not a guarantee against every prompt-injection technique. Uploaded text is treated as data, not trusted instructions.
