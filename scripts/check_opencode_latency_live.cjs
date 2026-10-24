// One free-model greeting in an isolated runtime; never reads an Orvix profile.
const fs = require('node:fs');
const path = require('node:path');
const { createOpenCodeWorkers } = require('../electron/agent/opencode-workers.cjs');
const { configureOpenCodeCatalog, refreshOpenCodeCatalog } = require('../electron/agent/opencode-catalog.cjs');
const { configureOpenCodeModel, requestOpenCode } = require('../electron/agent/opencode-model.cjs');
const { instructionsFor } = require('../electron/agent/model-client.cjs');

async function main() {
  if (!process.argv.includes('--live')) throw new Error('Pass --live to send one greeting to the verified free Space Bunny model.');
  const parent = path.resolve(__dirname, '../scratch');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'opencode-latency-'));
  const runtime = createOpenCodeWorkers(root, { getProviderKey: () => '' });
  const rounds = process.argv.includes('--repeat') ? 3 : 1;
  const signal = AbortSignal.timeout(rounds * 90000);
  const started = performance.now();
  try {
    configureOpenCodeCatalog(root, runtime);
    configureOpenCodeModel(runtime);
    await runtime.setKeepAlive(true, 'latency-probe');
    await refreshOpenCodeCatalog(false, signal);
    const preparedMs = Math.round(performance.now() - started);
    for (let round = 1; round <= rounds; round++) {
      let firstTextMs = null, characters = 0;
      const submitted = performance.now();
      const result = await requestOpenCode({ sessionId: 'latency-probe', purpose: 'conversation', modelId: 'opencode/space-bunny-free',
        history: [{ role: 'user', content: 'Hi' }], signal, timeoutMs: 60000,
        onDelta: delta => { firstTextMs ??= Math.round(performance.now() - submitted); characters += delta.length; },
      }, instructionsFor(null, 'Plan', 'conversation'));
      if (!result.text.trim() || !characters) throw new Error('No greeting text was received.');
      console.log(JSON.stringify({ modelId: 'opencode/space-bunny-free', round, preparedMs, firstTextMs, responseMs: Math.round(performance.now() - submitted), characters, usage: result.usage }));
    }
  } finally {
    runtime.shutdown();
    // Runtime termination can outlast shutdown() on Windows. Keep this isolated
    // scratch folder if the process still has a file open; never delete profiles.
    if (path.dirname(root) !== parent) throw new Error('Invalid scratch cleanup target.');
    try { await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    catch { console.log('The isolated latency scratch folder is retained until its worker exits.'); }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
