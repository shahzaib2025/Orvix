const os = require("node:os");
const { createOpenCodeService, buildRequest, textFromResponse, MODEL_BY_ID } = require("../electron/opencode.cjs");

const fakeApp = { getPath: () => os.tmpdir() };
const noStorage = { isEncryptionAvailable: () => false };
const originalZenKey = process.env.ORVIX_OPENCODE_ZEN_KEY;
const originalGoKey = process.env.ORVIX_OPENCODE_GO_KEY;

function redact(message) {
  let output = String(message);
  for (const key of [originalZenKey, originalGoKey]) if (key) output = output.replaceAll(key, "[redacted]");
  return output;
}

async function checkRoutes() {
  let checked = 0;
  for (const model of MODEL_BY_ID.values()) {
    const request = buildRequest(model, [{ role: "user", content: "Say OK." }], "Full access");
    if (!request.url.endsWith(model.route === "chat" ? "/chat/completions" : model.route === "responses" ? "/responses" : "/messages")) throw new Error(`${model.id}: wrong endpoint`);
    if (!request.body.model) throw new Error(`${model.id}: missing model name`);
    const data = model.route === "responses" ? { output: [{ content: [{ type: "output_text", text: "OK" }] }] }
      : model.route === "messages" ? { content: [{ type: "text", text: "OK" }] }
        : { choices: [{ message: { content: "OK" } }] };
    if (textFromResponse(model.route, data) !== "OK") throw new Error(`${model.id}: no parsed reply`);
    checked++;
  }
  console.log(`Offline route and response checks: ${checked}/${MODEL_BY_ID.size} passed.`);
}

async function checkLive() {
  const service = createOpenCodeService(fakeApp, noStorage);
  let success = 0;
  let failed = 0;
  let skipped = 0;
  for (const model of MODEL_BY_ID.values()) {
    const tier = model.id.startsWith("opencode-go/") ? "go" : "zen";
    if (!(tier === "go" ? originalGoKey : originalZenKey)) {
      console.log(`SKIP ${model.id}: ${tier} key unavailable`);
      skipped++;
      continue;
    }
    try {
      const result = await service.run({ requestId: `live-${success + failed}`, sessionId: "orvix-model-check", modelId: model.id, accessMode: "Plan", messages: [{ role: "user", content: "Reply with the single word OK." }] });
      console.log(`PASS ${model.id}: ${result.route}, ${result.text.length} characters`);
      success++;
    } catch (error) {
      console.log(`FAIL ${model.id}: ${redact(error.message)}`);
      failed++;
    }
  }
  service.shutdown();
  console.log(`Live checks: ${success} passed, ${failed} failed, ${skipped} skipped.`);
}

(async () => { await checkRoutes(); await checkLive(); })().catch(error => { console.error(redact(error.message)); process.exitCode = 1; });
