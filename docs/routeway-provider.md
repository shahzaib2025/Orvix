# Routeway in Orvix Agent

Added on 2026-10-17 from Routeway's live `/v1/models` catalog.

- Agent → API → Routeway selects one of nine zero-priced model IDs.
- The default is `gemma-4-26b-a4b-it-luminous:free`.
- Agent → Provider keys → Routeway manages masked, labeled keys with the same add, replace, pause, resume, and remove controls as the other API providers.
- Credentials use the existing local `.env` provider-key store: `ORVIX_ROUTEWAY_API_KEY` for a single environment key, or the managed `ORVIX_ROUTEWAY_API_KEYS` list. Keep this file private when sharing the project.
- Shared model metadata lives in `shared/routeway-models.json`; the renderer and Electron backend use the same IDs, endpoint and image capabilities.
- Requests use `https://api.routeway.ai/v1/chat/completions`, including the Agent's streaming responses, tool-call parsing, tool-result continuation, approval checks and cancellation.
- All Routeway requests in this app share one cancelable queue, with at least 12.1 seconds between request starts. The provider documents 5 requests/minute, 200/day and one concurrent request. Provider 429 cooldowns apply across saved keys; adding keys does not create additional account quota.
- Rate limits, partial streams and failures do not trigger unlimited retries or paid-model fallback. Invalid credentials can advance to another enabled saved key.
- Routeway context budgets reserve room for instructions, tool schemas and output within the catalog's 42K, 62K or 131,072-token limits. History sizes remain estimates.

## Evidence and limits

Before integration, a direct Gemma Luminous text request completed successfully in 1.55 seconds. A DeepSeek stream repeated output and timed out at 45 seconds; a Gemma function-call request timed out at 25 seconds. Those checks do not establish reliable tool calling or latency for every model. The catalog's MiniMax entry additionally carries a subscription flag; account eligibility must be confirmed by the provider.

Provider references:

- https://docs.routeway.ai/getting-started/introduction
- https://docs.routeway.ai/getting-started/rate-limits
- https://api.routeway.ai/v1/models

Restart Electron after updating the provider backend. Use `start.bat` after the frontend build has finished.
