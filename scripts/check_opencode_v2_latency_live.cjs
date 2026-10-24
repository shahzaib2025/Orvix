// Compare the installed V2 CLI in an isolated service. No production profile,
// credentials, model preference or runtime dependency is modified.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { isolatedEnvironment, unusedPort } = require('../electron/agent/opencode-headless.cjs');
const { instructionsFor } = require('../electron/agent/model-client.cjs');

async function main() {
  if (!process.argv.includes('--live')) throw new Error('Pass --live for the isolated V2 comparison.');
  const binary = path.join(process.env.LOCALAPPDATA, 'Programs/@opencodedesktop/resources/opencode-cli.exe');
  const clientRoot = path.resolve(__dirname, '../scratch/opencode-v2-compare-sdk/node_modules/@opencode/client/dist/promise');
  if (!fs.existsSync(binary) || !fs.existsSync(clientRoot)) throw new Error('The installed comparison CLI and staged V2 client are required.');
  const parent = path.resolve(__dirname, '../scratch');
  const root = fs.mkdtempSync(path.join(parent, 'opencode-v2-latency-'));
  const file = path.join(root, 'state/opencode/service.json');
  const env = isolatedEnvironment(root, require('node:crypto').randomBytes(32).toString('hex'));
  env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ update: 'disable', share: 'disabled', snapshots: false, plugins: [],
    permissions: [{ action: '*', resource: '*', effect: 'deny' }], agents: { title: { disabled: true }, summary: { disabled: true } } });
  const { Service } = await import(pathToFileURL(path.join(clientRoot, 'service.js')).href);
  const { OpenCode } = await import(pathToFileURL(path.join(clientRoot, 'index.js')).href);
  const events = new AbortController();
  let eventTask, active, client;
  const started = performance.now();
  try {
    const previousDirectory = process.cwd();
    let endpoint;
    try {
      process.chdir(root);
      endpoint = await Service.ensure({ file, version: '2.0.28', command: [binary, 'serve', '--service', '--hostname', '127.0.0.1', '--port', String(await unusedPort())], env });
    } finally { process.chdir(previousDirectory); }
    client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
    const info = await client.server.info();
    const models = await client.model.list({ location: { directory: root } });
    const model = models.data.find(item => item.providerID === 'opencode' && (item.id === 'space-bunny-free' || item.modelID === 'space-bunny-free'));
    if (!model?.enabled || !model.cost?.length || !model.cost.every(cost => cost.input === 0 && cost.output === 0 && cost.cache.read === 0 && cost.cache.write === 0)) throw new Error('V2 did not advertise Space Bunny as an enabled, zero-priced model. No generation was submitted.');
    const preparedMs = Math.round(performance.now() - started);
    eventTask = (async () => {
      for await (const event of client.event.subscribe({ signal: events.signal })) {
        if (event.type === 'session.execution.failed' && active?.sessionID === event.data?.sessionID) {
          active.failure = event.data;
        }
        if (event.type === 'session.text.delta' && active?.sessionID === event.data?.sessionID && event.data.delta) {
          active.firstTextMs ??= Math.round(performance.now() - active.started);
          active.characters += event.data.delta.length;
        }
      }
    })().catch(error => { if (!events.signal.aborted) console.error('Comparison event transport:', error.message); });
    for (let round = 1; round <= 3; round++) {
      const signal = AbortSignal.timeout(60000);
      const session = await client.session.create({ location: { directory: root }, agent: 'build', model: { providerID: 'opencode', id: model.id }, permissions: [{ action: '*', resource: '*', effect: 'deny' }] }, { signal });
      active = { sessionID: session.id, started: performance.now(), firstTextMs: null, characters: 0 };
      // Match Orvix's explicit conversational instructions and JSON history.
      await client.session.prompt({ sessionID: session.id, text: instructionsFor(null, 'Plan', 'conversation') + '\nConversation:\n' + JSON.stringify([{ role: 'user', content: 'Hi' }]) }, { signal });
      await client.session.wait({ sessionID: session.id }, { signal });
      const completed = await client.session.get({ sessionID: session.id }, { signal });
      console.log(JSON.stringify({ runtimeVersion: info.version, modelId: 'opencode/space-bunny-free', round, preparedMs, firstTextMs: active.firstTextMs, responseMs: Math.round(performance.now() - active.started), characters: active.characters, outcome: completed.outcome }));
      if (completed.outcome !== 'succeeded') {
        console.error('Isolated comparison failure:', JSON.stringify(active.failure ?? { outcome: completed.outcome }));
        throw new Error('The V2 greeting did not complete successfully.');
      }
      await client.session.remove({ sessionID: session.id }, { signal });
    }
  } finally {
    events.abort();
    if (eventTask) await eventTask;
    await Service.stop({ file });
    if (path.dirname(root) !== parent) throw new Error('Invalid comparison cleanup target.');
    try { await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    catch { console.log('The isolated V2 comparison folder is retained until its service exits.'); }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
