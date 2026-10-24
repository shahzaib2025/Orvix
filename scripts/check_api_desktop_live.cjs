// Electron-only diagnostic: read existing encrypted credentials, isolate runtime files.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createCredentials } = require('../electron/agent/credentials.cjs');
if (!process.argv.includes('--live')) throw new Error('Pass --live for bounded desktop provider checks.');
const scratch = path.resolve('scratch/api-desktop-live');
fs.mkdirSync(scratch, { recursive: true });
app.setPath('userData', path.join(scratch, 'profile'));
const report = { at: new Date().toISOString(), providers: [] };
let workers;
app.whenReady().then(async () => {
  const credentials = createCredentials({ getPath: () => path.join(process.env.APPDATA, 'Orvix'), getAppPath: () => process.cwd() }, safeStorage);
  const secrets = ['kilo','zen','go'].map(tier => credentials.getKey(tier)).filter(Boolean);
  const clean = value => { let text = String(value ?? ''); for (const key of secrets) text = text.replaceAll(key, '[redacted]'); return text.slice(0, 400); };
  const kilo = { provider: 'kilo', configured: Boolean(credentials.getKey('kilo')) };
  report.providers.push(kilo);
  if (kilo.configured) {
    const catalog = require('../electron/agent/kilo-catalog.cjs');
    catalog.configureKiloCatalog(scratch, () => credentials.getKey('kilo'));
    const listing = await catalog.refreshKiloCatalog(true);
    kilo.models = listing.models.map(model => model.id);
    if (listing.error) kilo.error = clean(listing.error);
    const model = listing.models.find(model => model.access !== 'byok');
    if (model) try {
      const answer = await require('../electron/agent/model-client.cjs').request({ modelId: model.id, key: credentials.getKey('kilo'), tools: [], history: [{ role: 'user', content: 'Reply only OK.' }], purpose: 'conversation', sessionId: 'api-desktop-check', signal: new AbortController().signal, timeoutMs: 45000 });
      kilo.generation = { model: model.id, textReceived: Boolean(answer.text?.trim()) };
    } catch (error) { kilo.error = clean(error.message); }
  }
  const zen = { provider: 'opencode-zen', configured: Boolean(credentials.getKey('zen')) };
  report.providers.push(zen);
  try {
    workers = require('../electron/agent/opencode-workers.cjs').createOpenCodeWorkers(scratch, { getProviderKey: () => credentials.getKey('zen') });
    const catalog = require('../electron/agent/opencode-catalog.cjs');
    const modelApi = require('../electron/agent/opencode-model.cjs');
    catalog.configureOpenCodeCatalog(scratch, workers); modelApi.configureOpenCodeModel(workers);
    const listing = await catalog.refreshOpenCodeCatalog(true, AbortSignal.timeout(30000));
    zen.models = listing.models.map(model => model.id);
    if (listing.error) zen.catalogError = clean(listing.error);
    const model = listing.models.find(model => model.id === 'opencode/space-bunny-free') ?? listing.models[0];
    if (model) {
      const reply = await modelApi.runOpenCodeSession({ taskId: 'api-healthcheck', modelId: model.id, directory: scratch, parts: [{ type: 'text', text: 'Reply only OK. Do not use any tools, read files or change anything.' }], signal: AbortSignal.timeout(45000), timeoutMs: 45000, onPermission: async () => false });
      zen.generation = { model: model.id, textReceived: Boolean(reply.text?.trim()) };
    }
  } catch (error) { zen.error = clean(error.message); }
  report.providers.push({ provider: 'opencode-go', configured: Boolean(credentials.getKey('go')), status: 'Not generated: paid plan access is model-specific.' });
}).catch(() => { report.error = 'Desktop credential diagnostic failed.'; process.exitCode = 1; }).finally(() => {
  workers?.shutdown();
  fs.writeFileSync(path.join(scratch, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  app.exit(process.exitCode || 0);
});
