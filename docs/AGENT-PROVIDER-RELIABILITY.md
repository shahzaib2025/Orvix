# Provider reliability and long-running agent recovery

Implementation and evidence from 17 October 2026. These changes improve recovery;
they cannot grant provider access or guarantee that only quota will stop a run.

## Production behavior

- Native OpenCode workers borrow the configured **Zen** API key through the
  official authenticated local runtime API. Empty configuration retains the
  existing anonymous free-model behavior. Go credentials are not substituted.
- The key is not placed in prompts, tool-child environment variables, checkpoints
  or retained worker logs. The host credential store remains unchanged.
- OpenCode's own API stores a temporary credential in that task's private runtime
  store while it is in use. Cleanup runs after success, failure and cancellation;
  a dead-runtime fallback removes only the matching owned entry. An abrupt OS or
  process crash can leave temporary native files; this is not a claim that every
  possible crash securely erases storage.
- The host rereads the selected key at each worker lease. Changed credentials
  invalidate location-scoped provider SDKs without deleting saved task history.
- Structured status and provider codes distinguish temporary rate limits/network
  failures from quota exhaustion, invalid authentication and denied access.
  `Retry-After` seconds and HTTP dates are respected, including waits above the
  ordinary exponential-backoff cap. Stop interrupts these waits.
- Executor retries remain unbounded for temporary failures. Independent reviews
  and explicitly bounded requests keep their limits. No new whole-task timer or
  step cap was added; the two-minute worker idle timer does not run during a lease.
- Authentication, access and quota failures stop automatic retry and retain a
  checkpoint explaining the blocker. After resolving it, explicitly resume the
  retained task. Orvix reconciles recorded operations; it does not replay the
  original request. An interrupted mutation with an unknown outcome still blocks
  further execution until its effects have been inspected.
- A credential-cleanup failure stops the worker and preserves the original
  provider error classification rather than turning it into a transient retry.

## What the access comparison established

Four small tests were run using `opencode/deepseek-v4.1-flash-free`, high effort:
stock CLI and Orvix native, each anonymously and with the configured Zen key. All
four returned `OK` before integration and again after integration. The second
Orvix run used the actual new credential hook; neither native case left an
OpenCode credential entry on disk afterward.

This rules out a constant inability to access this model from Orvix at that time.
It **does not establish the cause** of the earlier 18m30s website-generation 403,
prove that the key eliminates that restriction, or verify long-run availability.

Evidence: `scratch/opencode-access-1792213217549/report.json`.

## Checks completed

- 124 focused checks passed across native runtime/recovery, long-running sessions,
  provider routing, key handling and cancellation. One further direct-transport
  assertion was then added; the affected provider suites passed 23/23 checks.
- A real Orvix engine run with DeepSeek high completed in 31.39 seconds despite an
  injected client event-stream disconnection. Native source reads and one shell
  observation succeeded, source files stayed unchanged, encrypted ownership
  reconnected, and the completed reply was retrieved without another generation.
  Its owned processes stopped afterward. This was a recovery smoke test, not an
  hours-long test. Evidence: `scratch/long-running-live-1792213640790/result.json`.
- `npm run build` passed. Vite reported its existing large-chunk warning.
- The idle desktop app was restarted and reached `Desktop shell ready` and
  `Local workspace loaded` with the new main-process code.

## Sustained test

The two-hour paced provider/tool test is recorded separately at
`scratch/provider-soak-1792213590044/report.json` and `activity.log`. It uses one
retained DeepSeek high session and two narrowly scoped MCP tools. Every case
writes one verified row to its own scratch ledger; duplicate calls cannot repeat
that mutation. A client event-stream disconnect is injected after case three.

**Status at initial report creation: running; no sustained pass claimed yet.**
The final JSON records actual duration, commits, recovery, failures, checkpoint
status and native credential cleanup. This synthetic workload measures paced
transport/tool continuity, not website quality, arbitrary shell workloads or all
possible long-running jobs.

## V2 evaluation, isolated from production

The official `@opencode/client` and Windows CLI 2.0.32 were installed only in
`scratch/opencode-v2-evaluation`. A fresh isolated service successfully started,
accepted the existing configured Zen key through `integration.connect.key`, and
completed a DeepSeek high session. Credentials were removed and that service was
stopped. Evidence: `scratch/opencode-v2-compat-1792213640806/report.json`.

Production remains pinned to its existing V1 runtime. V2 uses different session,
message, event, permission and integration contracts; an executable-only swap
would bypass important assumptions. The prototype is **not** proof of parity for
Orvix's permissions, privacy guards, previews, design profiles, steering or
checkpoint recovery. Those adapters and their checks are required before a
production migration. V2's live-only event subscriptions also require explicit
reconciliation/reconnect handling.

## Reproducing the focused checks

```powershell
node --test scripts/check_provider_reliability.cjs scripts/check_agent_long_running.cjs scripts/check_opencode_headless.cjs scripts/check_opencode_recovery.cjs scripts/check_api_model_providers.cjs scripts/check_api_key_pool.cjs scripts/check_kilo_provider.cjs
npm run build
node scripts/check_opencode_access_live.cjs --live
node scripts/check_agent_long_running_live.cjs --model=opencode/deepseek-v4.1-flash-free --variant=high
node scripts/check_provider_soak_live.cjs --live --minutes=120
```

Live commands consume provider requests. They do not silently choose another
model, purchase access, change accounts or bypass an access restriction.

## Supported access and remaining limits

For production availability, use an authorized API product that permits your
client and workload. A free-model catalog entry is not a promise of permanent
free access. Account eligibility, regional restrictions, model retirement,
outages, credential revocation and quota can still stop requests. A new 403 must
be diagnosed from its actual provider response; repeating it or disguising the
client is not a repair. Orvix does not silently switch to a billable provider.

Official references used for the evaluation:

- [V1 migration and breaking changes](https://opencode.ai/v2/docs/migrate-v1/)
- [Official network client and live-only subscriptions](https://opencode.ai/v2/docs/build/client/)
- [Console API authentication](https://opencode.ai/v2/docs/console/api/)
- [Go access and client requirements](https://opencode.ai/v2/docs/console/go/)
- [Console model availability](https://opencode.ai/v2/docs/console/models/)

OAuth refresh was not introduced here: this path uses the already configured API
key. If OAuth is added later, its refresh must be serialized; the official
Console documentation says refresh tokens are single-use.
