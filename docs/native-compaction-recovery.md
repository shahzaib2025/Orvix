# Native OpenCode compaction recovery

The KERN-Type-Foundry task reached 166,530 input tokens before OpenCode's
`compaction` agent received HTTP 403 / `FreeTierError`. Its builder requests
had succeeded. This is distinct from an Orvix filesystem permission denial.
The same symptom is reported in the upstream tracker:
https://github.com/anomalyco/opencode/issues/55575

Orvix now confirms the failed agent using the native session's stored
messages. For this specific rejection, it extracts a bounded local continuity
record and starts a fresh native session for the same task, model and project.
The record includes completed tool outcomes and paths; current task settings,
steering, selected skills, changes and verification state are supplied again.
The original native session and Orvix evidence are retained. Older results
may be omitted from the bounded prompt, so the agent must inspect current
files when more detail is needed. No model call generates this checkpoint.

No rollover is allowed for ordinary builder access errors, reviewer requests,
user cancellation, or an unfinished/unknown tool outcome. Repeated summary
rejection without newly completed work stops instead of looping. Recovery
keeps the existing request deadline, permissions and provider selection.
It does not grant filesystem access, switch to a paid model, spoof client
identity, or guarantee availability from the external provider.

Restart Orvix to load the Electron main-process change. A saved failed task
can then use its existing Continue action. A separately packaged executable
needs a new package to include the change.

## Checks

- `node --test scripts/check_native_compaction_recovery.cjs scripts/check_opencode_recovery.cjs`
- `node --test scripts/check_agent_long_running.cjs scripts/check_opencode_headless.cjs`
- `node scripts/check_native_compaction_runtime.cjs`
- `npm run build`

The native runtime check uses the real bundled OpenCode executable and a
loopback inference fixture that rejects a summary request. It consumes no
provider quota and is not a live Zen availability check.
