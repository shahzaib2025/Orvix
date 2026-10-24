# Desktop top bar

Enable **Settings → Desktop top bar → Show desktop top bar**. New profiles default to off; the choice is saved in `desktop-bar-settings.json` in Orvix user data. This preference does not change Windows login startup or Orvix's close/tray behavior.

The bar and clock are sandboxed windows in Orvix's existing Electron application. Hover for one second to expand, leave to collapse, or use the drag handle to move it. The clock updates at minute boundaries and refreshes when shown. Volume and brightness use a lazy Windows helper that retires after 20 seconds without requests. Unsupported brightness controls report an error without changing another display.

Turning off hides and destroys both windows immediately, cancels feature timers and requests, removes feature handlers, and waits for its own helpers to exit. A failed cleanup remains visible in Settings and can be retried with **Stop top bar controls**. Full quit performs the same cleanup while preserving the saved enabled choice. Programs intentionally launched from shortcuts remain open.

The preload exposes only approved shortcuts and bar controls. The bar cannot call Orvix's Agent/provider bridge. Local assets are packaged under `electron/desktop-bar`; the two PowerShell scripts are unpacked beside the ASAR archive. No prototype process, preview server, global Chromium performance switches or runtime checksum is used by the production feature.

## Verification

- `npm run check:desktop-bar`: controller lifecycle, cancellation, helper ownership and packaging configuration.
- `node --test scripts/check_startup_settings.cjs`: existing Windows startup behavior.
- `npm run check:settings-page`: Settings toggle and responsive layout.
- `npm run check:desktop-bar:package`: native feature exercised from an ASAR fixture with unpacked control scripts.
- `npm run check:desktop-bar:native`: native behavior and resource sampling, including at least a minute each collapsed and expanded. Writes `scratch/desktop-bar-resources.json` and native screenshots. The development check verifies the original cached Electron runtime before measuring; this check is not shipped with the feature.
- `npm run build`: renderer production build.

Resource sampling uses a hidden Electron host baseline, then measures the entire test application process tree, including lazy helpers. It is a feature-isolation measurement, not a full Orvix workload benchmark. Actual installed NSIS/MSI behavior and performance require separate installed-app acceptance testing.

### Recorded validation (2026-10-22)

Production build, Settings UI, 20 lifecycle/startup tests, 52 ASAR-packaged native checks and 53 native checks with resource sampling passed. The samples included a clock update, at least 61 seconds each collapsed and expanded, and complete teardown after stress checks.

| State | Added private memory, average | Added private memory, peak | Sampled CPU |
| --- | --- | --- | --- |
| Collapsed idle | 117.2 MB | 130.0 MB | 0.000% at sampler precision |
| Expanded idle | 118.6 MB | 128.5 MB | 0.000% at sampler precision |

Startup peaked at 18.1% CPU. Control-helper warm-up peaked at 205.9 MB added private memory; transient startup/control peaks are separate from the idle targets. These observations are not a hard resource ceiling on other PCs or during other Orvix workloads. Raw samples are in `scratch/desktop-bar-resources.json`.

Installed NSIS/MSI testing and a full Orvix baseline remain unverified. The local development Electron executable repeatedly changed during testing; the native checks used an isolated runtime verified against its original cached archive and held read-only for the duration of validation. The feature does not change file permissions or runtime verification settings.
