# Search API keys

Open Home → Search API Keys → Add / manage keys. Add your Serper key and the balance shown in its dashboard. A fresh key defaults to an estimated 2,500 credits. For multiple keys belonging to one Serper account, choose that account's existing credit pool instead of creating another balance.

Orvix uses the oldest enabled key with available credits. Confirmed invalid credentials or exhaustion allow another eligible key to be tried. Rate limits cause a provider cooldown; uncertain network outcomes retain the reserved credit. DuckDuckGo is the fallback. LangSearch is no longer used.

The Home counter records every invocation of the shared search tool. API attempts, successful Serper calls, credits, cache hits, failures, unknown outcomes and DuckDuckGo calls are separate counters. Remaining balances are estimates: Orvix cannot see usage made outside this app. Edit a key's account balance using the current dashboard balance to reconcile unknown outcomes. Historical unknown-outcome counters remain as an audit count after reconciliation.

Keys are encrypted by Electron safeStorage in the app's user-data directory. If encryption is unavailable, keys and counters are session-only. Saved keys are never returned by the listing interface. Deleting a key stops selection for new requests; it cannot cancel a request already sent to Serper.

Run `npm run check:search-keys`, `npm run build`, then `npm run check:search-keys:ui`. The UI check launches a hidden Electron instance with temporary isolated storage and removes its data afterward. It exercises the built Home page, account controls, pagination, responsive layout, conversation composer and persistence across an Electron restart. An optional `ORVIX_SEARCH_UI_KEY` environment variable enables one live Serper search; the test adds and then deletes that key through the UI. Do not commit that variable or print it in logs.
