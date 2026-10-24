// Read-only provider smoke checks. No credentials or generated content are saved.
const fs = require('node:fs');
const path = require('node:path');
const { createCredentials } = require('../electron/agent/credentials.cjs');
const { apiModels } = require('../electron/agent/api-models.cjs');
const { providerFor } = require('../electron/agent/provider-registry.cjs');
const { request, info, appendResult } = require('../electron/agent/model-client.cjs');
const { requestWithKeyPool } = require('../electron/agent/api-key-store.cjs');
if (!process.argv.includes('--live')) throw new Error('Pass --live for bounded requests to configured API providers.');
const credentials = createCredentials({ getPath: () => path.resolve('scratch/api-audit-no-profile'), getAppPath: () => process.cwd() }, { isEncryptionAvailable: () => false }, { envFilePath: path.resolve('.env') });
const selected = process.argv.find(value => value.startsWith('--provider='))?.slice(11);
const selectedModel = process.argv.find(value => value.startsWith('--model='))?.slice(8);
const variant = process.argv.find(value => value.startsWith('--variant='))?.slice(10) || null;
const generate = process.argv.includes('--generate');
const toolCheck = process.argv.includes('--tools');
const pinnedKey = Number(process.argv.find(value => value.startsWith('--key='))?.slice(6) ?? 0);
const report = { at: new Date().toISOString(), scope: 'Configured .env/process keys; encrypted desktop-only keys require a desktop check.', providers: [] };
const secrets = Object.keys(require('../electron/agent/api-key-store.cjs').providerEnvKeys).flatMap(tier => credentials.apiKeys.entries(tier).map(entry => entry.key));
function clean(value) { let text = String(value ?? ''); for (const key of secrets) text = text.replaceAll(key, '[redacted]'); return text.slice(0, 400); }
async function inspect(tier) {
  const models = apiModels.filter(model => model.credentialTier === tier);
  const entries = credentials.apiKeys.entries(tier).filter(entry => entry.enabled);
  const row = { provider: tier, configuredKeys: entries.length, catalog: [], missingModels: [], generation: [] };
  report.providers.push(row);
  if (!entries.length || !models.length) return;
  const adapter = providerFor(models[0]);
  const send = options => pinnedKey ? request({ ...options, key: entries[pinnedKey - 1]?.key ?? '' }) : requestWithKeyPool(options, tier, credentials.apiKeys, request);
  if (pinnedKey && !entries[pinnedKey - 1]) throw new Error('Requested key number is unavailable.');
  if (pinnedKey) row.keyNumber = pinnedKey;
  let available = null;
  let accepted;
  for (const [index, entry] of entries.entries()) {
    const url = tier === 'google' ? 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000' : adapter.baseUrl + '/models';
    const headers = tier === 'google' ? { 'x-goog-api-key': entry.key } : adapter.headers('chat', entry.key, 'api-smoke');
    try {
      const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(20000) });
      const body = await response.json().catch(() => null);
      row.catalog.push({ key: index + 1, status: response.status, ...(response.ok ? {} : { error: clean(body?.error?.message ?? body?.message ?? response.statusText) }) });
      if (response.ok) {
        available = (body?.models ?? body?.data ?? []).map(model => String(model.id ?? model.name ?? '').replace(/^models\//, ''));
        accepted = entry;
        break;
      }
    } catch (error) { row.catalog.push({ key: index + 1, error: clean(error.message) }); break; }
  }
  if (available) {
    row.availableModels = available;
    row.missingModels = models.filter(model => !available.includes(model.apiModelId)).map(model => model.id);
  }
  if (!generate || !accepted) return;
  const model = selectedModel ? models.find(item => item.id === selectedModel) : models.find(item => available?.includes(item.apiModelId));
  if (!model) return;
  try {
    const answer = await send({ modelId: model.id, history: [{ role: 'user', content: 'Reply only OK.' }], tools: [], purpose: 'conversation', variant, sessionId: 'api-smoke', signal: new AbortController().signal, timeoutMs: 60000 });
    row.generation.push({ model: model.id, textReceived: Boolean(answer.text?.trim()), toolCalls: answer.calls.length });
  } catch (error) { row.generation.push({ model: model.id, status: error.status ?? error.statusCode ?? null, error: clean(error.message) }); }
  if (toolCheck && row.generation[0]?.textReceived) {
    const tools = [{ name: 'healthcheck_echo', description: 'Read-only transport check. Returns the supplied value without accessing any files.', parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } }];
    const history = [{ role: 'user', content: 'This is a read-only API transport test. Call the only provided tool healthcheck_echo with value "orvix-api-check". After its result reply only with the returned value. Do not plan project work.' }];
    const options = { modelId: model.id, tools, variant, designProfile: 'none', accessMode: 'Plan', sessionId: 'api-tool-smoke', signal: new AbortController().signal, timeoutMs: 60000 };
    const originalFetch = global.fetch;
    row.toolTransport = [];
    // Isolate transport from the large coding prompt and its provider token limits.
    global.fetch = async (url, options) => {
      if (String(url) === adapter.baseUrl + '/chat/completions' && options?.body) {
        const body = JSON.parse(options.body);
        if (body.messages?.[0]?.role === 'system') body.messages[0].content = 'This is a read-only tool transport test. Use the provided healthcheck_echo tool exactly as requested, then report its returned value. No files or commands are involved.';
        const response = await originalFetch(url, { ...options, body: JSON.stringify(body) });
        const trace = { status: response.status, bytes: 0, doneEvent: false, finishEvent: false };
        row.toolTransport.push(trace);
        if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) return response;
        const decoder = new TextDecoder(); let tail = '';
        const stream = response.body.pipeThrough(new TransformStream({ transform(chunk, controller) {
          trace.bytes += chunk.byteLength; tail = (tail + decoder.decode(chunk, {stream:true})).slice(-5000);
          trace.doneEvent ||= tail.includes('[DONE]'); trace.finishEvent ||= /"finish_reason"\s*:\s*"/.test(tail);
          controller.enqueue(chunk);
        } }));
        return new Response(stream, {status:response.status,headers:response.headers});
      }
      return originalFetch(url, options);
    };
    try {
      const answer = await send({ ...options, history });
      if (answer.calls.length !== 1 || answer.calls[0].name !== 'healthcheck_echo') throw new Error('Model did not return the requested tool call.');
      const value = typeof answer.calls[0].args === 'string' ? JSON.parse(answer.calls[0].args) : answer.calls[0].args;
      if (value?.value !== 'orvix-api-check') throw new Error('Tool arguments did not match the read-only test.');
      appendResult(info(model.id).route, history, answer, [{ id: answer.calls[0].id, text: value.value }]);
      const final = await send({ ...options, history });
      row.toolRoundTrip = { passed: final.text.includes(value.value) && final.calls.length === 0 };
    } catch (error) { row.toolRoundTrip = { passed: false, error: clean(error.message) }; }
    finally { global.fetch = originalFetch; }
  }
}
(async () => {
  const tiers = ['google', 'groq', 'cerebras', 'nara', 'routeway'].filter(tier => !selected || tier === selected);
  if (toolCheck) { for (const tier of tiers) await inspect(tier); }
  else await Promise.all(tiers.map(inspect));
  const suffix = `${selected ?? 'all'}${selectedModel ? '-' + selectedModel.replace(/[^a-z0-9.-]/gi, '_') : ''}${variant ? '-' + variant.replace(/[^a-z0-9.-]/gi, '_') : ''}${toolCheck ? '-tools' : ''}${pinnedKey ? '-key' + pinnedKey : ''}`;
  const target = path.resolve(`scratch/api-connections-${suffix}-live.json`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, providers: report.providers.map(({ availableModels, ...row }) => ({ ...row, availableModelCount: availableModels?.length })), report: target }, null, 2));
  if (generate && report.providers.some(row => row.configuredKeys > 0 && (!row.generation.some(result => result.textReceived) || toolCheck && row.toolRoundTrip?.passed !== true))) process.exitCode = 1;
})().catch(error => { console.error(clean(error.message)); process.exitCode = 1; });
