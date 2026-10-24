# OpenCode model checks — 2026-09-26

Historical report: these results describe earlier integrations. Since 2026-10-09, Zen Free uses an on-demand official OpenCode headless server and native agent; Go and Kilo retain their direct provider routes. See [the current integration and validation notes](docs/OPENCODE_HEADLESS.md). The old direct Zen and CLI results below do not establish current availability.

Orvix uses the model IDs and endpoint types from the [OpenCode Zen](https://opencode.ai/docs/zen) and [OpenCode Go](https://opencode.ai/docs/go/) documentation. `node scripts/check_opencode_models.cjs` checked construction and response parsing for every listed model with a local response stub: **39/39 passed**.

Live checks sent one short prompt per model with the supplied Zen key. The key was not written to source or build files. An encrypted key was also read by a fresh Electron process, which successfully completed a Space Bunny Free request.

| Model | Route | Live result |
| --- | --- | --- |
| Big Pickle | OpenCode CLI | Passed |
| Space Bunny Free | Chat Completions | Passed |
| MiMo-V2.6-Flash Free | OpenCode CLI | Passed |
| MiMo-V2.5 Free | OpenCode CLI | OpenCode server error (twice) |
| Ling 3.0 Flash Fin Free | OpenCode CLI | Passed |
| Nemotron 3 Ultra Free | OpenCode CLI | Passed |
| Nemotron 3.5 Lightning Free | OpenCode CLI | Passed |
| Muse Spark 1.3 Contributor Free | OpenCode CLI | Passed |
| Grok 4.7 | Responses | Awaiting Go key |
| Grok 4.6 | Responses | Awaiting Go key |
| GLM-5.3-Flash | Chat Completions | Awaiting Go key |
| GLM-5.3 | Chat Completions | Awaiting Go key |
| GLM-5.2 | Chat Completions | Awaiting Go key |
| GLM-5.1 | Chat Completions | Awaiting Go key |
| GPT 6 Luna | Responses | Awaiting Go key |
| GPT 5.6 Luna | Responses | Awaiting Go key |
| Kimi K3 | Chat Completions | Awaiting Go key |
| Kimi K2.7 Code | Chat Completions | Awaiting Go key |
| Kimi K2.6 | Chat Completions | Awaiting Go key |
| LongCat-2.0 | Chat Completions | Awaiting Go key |
| MiMo-V2.6-Flash | Chat Completions | Awaiting Go key |
| MiMo-V2.6-Pro | Chat Completions | Awaiting Go key |
| MiMo-V2.5 | Chat Completions | Awaiting Go key |
| MiMo-V2.5-Pro | Chat Completions | Awaiting Go key |
| MiniMax M3 | Messages | Awaiting Go key |
| MiniMax M2.7 | Messages | Awaiting Go key |
| Muse Spark 1.3 Contributor | Responses | Awaiting Go key |
| Muse Spark 1.2 Contributor | Responses | Awaiting Go key |
| Qwen3.8 Max | Messages | Awaiting Go key |
| Qwen3.8 Flash | Messages | Awaiting Go key |
| Qwen3.7 Max | Messages | Awaiting Go key |
| Qwen3.7 Plus | Messages | Awaiting Go key |
| Qwen3.6 Plus | Messages | Awaiting Go key |
| DeepSeek V4.1 Flash | Chat Completions | Awaiting Go key |
| DeepSeek V4 Pro | Chat Completions | Awaiting Go key |
| DeepSeek V4 Flash | Chat Completions | Awaiting Go key |
| DeepSeek V4 Flash Vision Exp | Chat Completions | Awaiting Go key |
| Hy4 preview | Chat Completions | Awaiting Go key |
| Hy3 | Chat Completions | Awaiting Go key |

The direct Zen API rejected seven free models because Orvix is an external client. Orvix now uses the official `opencode-ai` CLI for those models. A second live check through Orvix on 2026-09-26 passed for Big Pickle, MiMo-V2.6-Flash Free, Ling 3.0 Flash Fin Free, Nemotron 3 Ultra Free, Nemotron 3.5 Lightning Free, and Muse Spark 1.3 Contributor Free. MiMo-V2.5 Free failed twice through the official CLI with OpenCode's “Unexpected server error”; this is shown in the Agent conversation. Space Bunny Free still works through the direct API. The Go models were checked for request shape locally and have not been sent live requests because no Go subscription key is configured yet. Model availability and routes can change; refresh this report when OpenCode updates its catalog.

Thinking levels were compared against `opencode models <provider> --verbose` from the installed OpenCode CLI: **39/39 catalog entries matched**. A live request passed with Space Bunny Free at `low`, and another passed with Ling 3.0 Flash Fin Free at `high`. Go variants have not had live requests because no Go key is configured.
