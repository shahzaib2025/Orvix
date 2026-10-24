// Electron-only live check of restricted Zen free models through Orvix's
// official OpenCode CLI route. Reads the existing encrypted key without
// printing or copying it into this script.
const { app, safeStorage } = require("electron");
const fs = require("node:fs");
const { createOpenCodeService } = require("../electron/opencode.cjs");

const modelIds = [
  "opencode/big-pickle", "opencode/mimo-v2.6-flash-free", "opencode/mimo-v2.5-free",
  "opencode/ling-3.0-flash-fin-free", "opencode/nemotron-3-ultra-free",
  "opencode/nemotron-3.5-lightning-free", "opencode/muse-spark-1.3-contributor-free",
];

app.setName("Orvix");
app.whenReady().then(async () => {
  const service = createOpenCodeService(app, safeStorage);
  const results = [];
  if (!service.status().zen.configured) throw new Error("No stored Zen key was found.");
  for (let index = 0; index < modelIds.length; index++) {
    const modelId = modelIds[index];
    try {
      const reply = await service.run({
        requestId: `cli-check-${index}`, sessionId: `cli-check-${index}`, modelId,
        accessMode: "Plan", messages: [{ role: "user", content: "Reply with the single word OK." }],
      });
      results.push({ modelId, ok: Boolean(reply.text), route: reply.route, responseLength: reply.text.length });
    } catch (error) {
      results.push({ modelId, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    if (process.env.ORVIX_CLI_CHECK_RESULT_FILE) fs.writeFileSync(process.env.ORVIX_CLI_CHECK_RESULT_FILE, JSON.stringify(results));
  }
  service.shutdown();
  console.log(JSON.stringify(results));
  app.quit();
}).catch(error => { console.error(error.message); app.exit(1); });
