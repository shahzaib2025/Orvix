---
name: project-specific-testing
description: Choose the smallest meaningful project check for a code change using the repository's own scripts, tests, and conventions; avoid routine full-suite runs.
---

# Project-specific testing

Use when a task changes code in a project and a check can provide evidence about the changed behavior. Follow the existing route's project and workspace boundaries. This skill selects checks; it does not require running tests for research-only work, prose-only edits, or changes with no meaningful executable behavior.

## Choose a check

Identify the changed behavior and the narrowest observable result that would establish it. Inspect the relevant project guidance, package scripts, nearby tests, and CI configuration only as needed to find the established command and fixture. Prefer an existing focused test for the affected unit or flow. If none exists, choose the most relevant available check, such as a typecheck, targeted browser assertion, or build. A build proves compilation and bundling only; it does not prove a user flow.

Run one focused check first. Add a broader check only when the change affects shared behavior, a public boundary, or multiple connected areas that the focused check cannot cover. Do not run every available check by habit, add a test that merely mirrors the implementation, or install tools just to satisfy this skill. For a real regression, prefer an assertion that would fail before the fix and pass after it when a safe reproducer is available.

Use the project's supported check tool and working directory. When Orvix's `verify_work` is available, link the check to the changed requirement and record its actual result. Respect report-only, no-test, and other explicit user constraints. Do not replace a failed check with a passing unrelated command.

Report the exact check and observed result. Separate a passing focused check from wider suites, live services, packaged builds, or production behavior that were not exercised. If a check is unavailable or fails for an environment reason, state that limitation and keep the requested work distinct from unverified behavior.
