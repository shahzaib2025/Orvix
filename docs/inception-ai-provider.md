# Inception AI provider

Orvix connects to Inception AI through its OpenAI-compatible chat completions API. Add the key later in **Agent → Provider connections → Inception AI**. No key is bundled with Orvix.

## Listed model

| Model | API model ID | Context | Maximum output | Input / output price per 1M tokens | Input | Orvix features |
| --- | --- | ---: | ---: | --- | --- | --- |
| Mercury 3 | `mercury-3` | 1,000,000 tokens | 131,072 tokens | $0.10 / $0.35 launch price; standard $0.20 / $0.70 | Text | Streaming, tool calling, structured outputs, `instant`/`low`/`medium`/`high` reasoning |
| Mercury 2.5 | `mercury-2.5` | 260,000 tokens | 65,536 tokens | $0.20 / $0.75 | Text | Streaming, tool calling, structured outputs |
| Mercury 2 | `mercury-2` | 128,000 tokens | 50,000 tokens | $0.25 / $0.75 | Text | Streaming, tool calling, structured outputs |

The selector lists the three documented general chat models. Mercury 3 is the current flagship. Mercury Voice is enterprise-only; Mercury Decide uses a separate decision endpoint; Mercury Edit uses specialized completion/edit APIs. They are not exposed in Orvix's normal Agent selector. After a key is added, Orvix's API key check queries Inception's authenticated model-list endpoint and reports the Mercury chat model IDs returned for that account. This confirms access but does not dynamically rewrite the local model selector.

Orvix exposes Mercury 3's `instant`, `low`, `medium`, and `high` reasoning levels. The current Agent request path caps a completion at 8,192 tokens, below each model's provider maximum, to keep individual Agent turns bounded.

Inception currently advertises a 100-million-token grant for new API keys. This is an account/provider offer, not a promise of unlimited free use or a monthly quota; eligibility and remaining usage must be confirmed with Inception. Mercury 3's promotional price is time-sensitive; pricing above reflects the docs checked on 2026-10-22.

## API configuration

- Base URL: `https://api.inceptionlabs.ai/v1`
- Chat endpoint: `POST /chat/completions`
- Authentication: `Authorization: Bearer <API key>`
- Model discovery and key check: `GET /chat/completions/models`
- Orvix environment variable name: `ORVIX_INCEPTION_API_KEY`

Orvix's existing provider-key manager stores manually added API keys in the app's `.env` file. That file is plaintext; keep it private. The provider key is not written into this repository by this integration.

## Sources

- [Inception models](https://www.inceptionlabs.ai/models)
- [API models and limits](https://docs.inceptionlabs.ai/get-started/models)
- [List chat models](https://docs.inceptionlabs.ai/api-reference/models/list-chat-models)
- [Create a chat completion](https://docs.inceptionlabs.ai/api-reference/chat/create-a-chat-completion)
