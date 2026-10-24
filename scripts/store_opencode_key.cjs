// Run with Electron and ORVIX_OPENCODE_ZEN_KEY or ORVIX_OPENCODE_GO_KEY in this process's environment.
// No key is written to this script or printed to the terminal.
const { app, safeStorage } = require("electron");
const fs = require("node:fs");
const { createOpenCodeService } = require("../electron/opencode.cjs");

app.setName("Orvix");
app.whenReady().then(() => {
  const service = createOpenCodeService(app, safeStorage);
  for (const [tier, name] of [["zen", "ORVIX_OPENCODE_ZEN_KEY"], ["go", "ORVIX_OPENCODE_GO_KEY"]]) {
    if (process.env[name]?.trim()) service.setKey(tier, process.env[name]);
  }
  const status = service.status();
  if (process.env.ORVIX_KEY_STATUS_FILE) fs.writeFileSync(process.env.ORVIX_KEY_STATUS_FILE, JSON.stringify({ zen: status.zen.configured, go: status.go.configured, encrypted: status.canPersist }));
  console.log(`OpenCode credentials: Zen ${status.zen.configured ? "configured" : "missing"}, Go ${status.go.configured ? "configured" : "missing"}, encrypted storage ${status.canPersist ? "available" : "unavailable"}.`);
  app.quit();
}).catch(error => { console.error(`Could not store OpenCode credentials: ${error.message}`); app.exit(1); });
