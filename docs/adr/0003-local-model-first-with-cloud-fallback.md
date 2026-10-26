# ADR 0003: Run the AI features on a local model first, with Gemini as the fallback

Status: accepted. Owner: Khoa (with Đức, whose agent code this touches).

## Context

The free Gemini tier gave too little quota for development and demos (HTTP 429 ended three of the
live agent runs), and the group decided to run on a local Gemma model. Before this change the local
provider only worked in the in-memory preview (`STORE_BACKEND=memory`, no uploads, no persistence),
and the Coach agent could not use it at all: tool calling was written against Gemini's function-calling
format and the Gemini client refused to run when `LLM_PROVIDER=local`. With Supabase, Gemma was off.

## Options

1. **Gemini only.** Works today; quota and cost limit demos and evaluation, and every prompt leaves the
   machine.
2. **Local only.** Nothing leaves the machine except embeddings, but a stopped LM Studio means no AI at
   all, and a hosted deploy cannot reach a laptop.
3. **Ordered providers (`LLM_PROVIDER=local,gemini`).** Gemma answers; Gemini is tried only when the
   local call fails; the existing scripted replies remain the last resort.

## Decision

Option 3. `LLM_PROVIDER` is a comma-separated list read by `services/llmProviders.js`; `llmService`
tries each provider in turn for plain generation, streaming, structured JSON and tool calling.
Rules that keep it safe:

- A cancelled request is never retried on another provider.
- A reply that has already shown text to the user is not restarted elsewhere.
- The scripted fallback of structured calls (the basic review) is used only after every provider failed.
- The agent keeps its Gemini-shaped conversation; `localToolClient.js` translates it to OpenAI
  `tools`/`tool_calls`, so `agent.js`, the tools, the evidence policy and the confirm flow are unchanged.
- The memory-only restriction on the local provider is removed. Local calls to an unreachable
  `localhost` fail fast, so a hosted deploy with `local,gemini` falls through to Gemini.
- Embeddings stay on Gemini: the stored vectors are 768-d Gemini vectors and switching model means
  re-indexing every document and question.

## Consequences

- Local calls cost nothing per token (`pricing.json` lists `gemma-4` at 0); electricity and hardware
  are not counted, and the admin dashboard shows the provider per request.
- A demo on Gemma needs LM Studio running on the demo machine.
- Gemma is a small model. On the 6 live agent cases it passed 6/6 and on the 8 critique cases 24/24
  runs, but it answers some general questions without calling `search_knowledge` (the evidence policy
  then refuses them rather than showing an unverified answer).
- Request logs and the health banner understand the local provider, but the health state of the local
  server is only learned from requests (an observation made under one provider setup is not reused
  under another).
