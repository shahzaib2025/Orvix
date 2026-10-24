// Electron-only check of the encrypted credential and one live Zen request.
const { app, safeStorage } = require("electron");
const fs = require("node:fs");
const { createOpenCodeService } = require("../electron/opencode.cjs");

app.setName("Orvix");
app.whenReady().then(async () => {
  const service = createOpenCodeService(app, safeStorage);
  let result;
  try {
    const status = service.status();
    if (!status.zen.configured) throw new Error("No stored Zen key was found.");
    const modelId = process.env.ORVIX_CHECK_MODEL_ID || "opencode/space-bunny-free";
    const thinkingVariant = process.env.ORVIX_CHECK_THINKING_VARIANT || null;
    const content = process.env.ORVIX_CHECK_LONG_PROMPT ? `Reply with the single word OK. Ignore the padding: ${"a".repeat(17000)}` : "Reply with the single word OK.";
    const pending = service.run({ requestId: "stored-key-check", sessionId: "stored-key-check", modelId, thinkingVariant, accessMode: "Plan", messages: [{ role: "user", content }] });
    if (process.env.ORVIX_CHECK_CANCEL_AFTER_MS) setTimeout(() => service.cancel("stored-key-check"), Number(process.env.ORVIX_CHECK_CANCEL_AFTER_MS));
    const reply = await pending;
    result = { keyConfigured: true, model: reply.modelId, thinkingVariant, route: reply.route, responseLength: reply.text.length };
  } catch (error) { result = { error: error.message }; }
  service.shutdown();
  if (process.env.ORVIX_CHECK_RESULT_FILE) fs.writeFileSync(process.env.ORVIX_CHECK_RESULT_FILE, JSON.stringify(result));
  app.quit();
}).catch(error => { console.error(error.message); app.exit(1); });
