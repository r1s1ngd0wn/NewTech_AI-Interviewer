# Privacy note for document-grounded interview coaching

Uploaded CVs and job descriptions are stored in a private Supabase Storage bucket. Extracted text and 768-dimensional embeddings are stored in Supabase Postgres. Session answers, feedback and chat are also persisted there. The browser receives only documents belonging to the authenticated account, and retrieval queries filter private chunks by user ID. No Supabase secret or Gemini API key belongs in frontend code.

When Gemini embeddings are enabled, extracted text chunks and search queries are sent to Google's embedding API. When Gemini chat is enabled, relevant retrieved excerpts and the user's question may be sent to the Gemini generation API. With a local embedding/chat provider those model calls remain local, but Supabase still stores application data. Users should avoid uploading sensitive third-party information without consent.

Deleting a library file removes its original, extracted text and indexed chunks; previously generated chat histories are cleared, and prepared question context derived from it is removed. Deleting an account also deletes its library files. Answers the user themselves typed or spoke remain part of their interview history until that session or account is deleted. Exporting account data includes the uploaded originals and extracted text.

Input guardrails reject obvious prompt-override requests and strip matching instruction lines from retrieved source text before sending it to the model. This is defense in depth, not a guarantee against every prompt-injection technique. Uploaded text is treated as data, not trusted instructions.
