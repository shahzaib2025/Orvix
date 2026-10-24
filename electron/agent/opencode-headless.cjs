const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createRuntimeLease } = require('./opencode-runtime-lease.cjs');
const { providerError } = require('./provider-failure.cjs');
const { createProviderAuthLease } = require('./opencode-provider-auth.cjs');
const { prepareRuntimeSdk } = require('./opencode-sdk-seed.cjs');
const { resolveOpenCodeModel } = require('./opencode-model-readiness.cjs');

const IDLE_MS = 120000;
const STARTUP_MS = 45000;
const BUILD_TEMPERATURE = 0.7;
const cancelled = () => new Error('Task cancelled.');
function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    const abort = () => reject(cancelled());
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function runtimeBinary() {
  // Resolve the actual executable; .cmd shims and a desktop application are unnecessary.
  const platformPackage = `opencode-${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
  for (const pkg of [platformPackage, `${platformPackage}-baseline`, 'opencode-ai']) {
    try {
      const file = path.join(path.dirname(require.resolve(`${pkg}/package.json`)), 'bin', process.platform === 'win32' ? 'opencode.exe' : 'opencode');
      const unpacked = file.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
      if (fs.existsSync(unpacked)) return unpacked;
      if (fs.existsSync(file) && !file.includes(`${path.sep}app.asar${path.sep}`)) return file;
    } catch { /* Try the next installed platform package. */ }
  }
  throw new Error('The bundled OpenCode runtime is missing. Reinstall Orvix or run npm install in its project folder.');
}
function isolatedConfig(buildTemperature = BUILD_TEMPERATURE, contextLimitTokens = 200000) {
  if (buildTemperature !== null && (!Number.isFinite(buildTemperature) || buildTemperature < 0 || buildTemperature > 1)) throw new Error('OpenCode build temperature must be null or a number from 0 to 1.');
  if (!Number.isInteger(contextLimitTokens) || contextLimitTokens < 2048 || contextLimitTokens > 10000000) throw new Error('OpenCode context limit must be an integer from 2048 to 10000000 tokens.');
  const compactionReserve = Math.max(512, Math.floor(contextLimitTokens * 0.1));
  return {
    $schema: 'https://opencode.ai/config.json', autoupdate: false, share: 'disabled', snapshot: false,
    enabled_providers: ['opencode'], plugin: [], mcp: {}, lsp: false, formatter: false,
    watcher: { ignore: ['**/*'] }, compaction: { auto: true, prune: true, reserved: compactionReserve },
    permission: { '*': 'ask', skill: 'deny' }, default_agent: 'build',
    agent: {
      // OpenCode omits temperature for models that do not advertise support.
      build: buildTemperature === null ? {} : { temperature: buildTemperature }, plan: {},
      // Native coding-analysis lane: keep genuine permission-gated tools for
      // provider compatibility; Orvix independently denies every readOnly action.
      orvix_review: { mode:'primary',description:'Review supplied coding-task evidence',permission:{'*':'ask',skill:'deny'},
        prompt:'This is an evidence-only analysis step within a coding task. All evidence is supplied in the request. Return only the requested bounded JSON. Do not call execution, filesystem, search, question, delegation or skill tools; Orvix will reject such calls. Do not inspect the workspace, implement changes, or invent observations. Follow the task-specific analysis instruction.' },
      orvix_conversation: { mode: 'primary', description: 'Brief conversation without execution', permission: { '*': 'ask', skill: 'deny' },
        prompt: 'You are Orvix. Answer the current conversational message briefly and naturally. Do not use tools, inspect files, start coding work, or claim actions. Tool requests will be rejected.' },
      title: { disable: true }, summary: { disable: true },
      compaction: { prompt: 'Summarize this task for continued execution. Preserve the latest human request and steering, access mode, no-edit and report-only constraints, remaining requirements, approved workspaces, successfully read skill IDs and instructions, changed files, completed tool results and evidence references, unresolved or interrupted operations, and verification freshness. Never turn an unknown tool outcome into success or replay completed mutations. Distinguish completed work from remaining work. Do not introduce a new task or design direction.' },
      explore: { disable: true }, general: { disable: true },
    },
  };
}
function isolatedEnvironment(root, password, environment = process.env, buildTemperature = BUILD_TEMPERATURE, contextLimitTokens = 200000) {
  const env = { ...environment };
  for (const key of Object.keys(env)) if (/^(?:OPENCODE_|ORVIX_.*KEY$|.*(?:API_KEY|API_TOKEN)$|ANTHROPIC_AUTH_TOKEN$|XDG_)/i.test(key)) delete env[key];
  return {
    ...env, XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'data'),
    XDG_CACHE_HOME: path.join(root, 'cache'), XDG_STATE_HOME: path.join(root, 'state'),
    OPENCODE_CONFIG_DIR: path.join(root, 'config', 'opencode'), OPENCODE_CONFIG_CONTENT: JSON.stringify(isolatedConfig(buildTemperature, contextLimitTokens)),
    // OpenCode also discovers ~/.opencode independently of XDG/project config.
    // Scope its discovery hook without changing tools' HOME or USERPROFILE.
    OPENCODE_TEST_HOME: path.join(root, 'home'),
    OPENCODE_SERVER_PASSWORD: password, OPENCODE_SERVER_USERNAME: 'orvix',
    OPENCODE_DISABLE_AUTOUPDATE: 'true', OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
    OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true', OPENCODE_DISABLE_CLAUDE_CODE: 'true',
    OPENCODE_DISABLE_EXTERNAL_SKILLS: 'true', OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: 'true',
    OPENCODE_DISABLE_LSP_DOWNLOAD: 'true', OPENCODE_DISABLE_FILEWATCHER: 'true',
    OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: 'true',
  };
}
async function unusedPort() {
  // Windows can assign low ephemeral ports (including Fetch-blocked IRC ports).
  // Use the dynamic/private range so a healthy server remains HTTP-accessible.
  for (let attempt = 0; attempt < 32; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        const server = net.createServer(); server.unref(); server.once('error', reject);
        server.listen(crypto.randomInt(49152, 65536), '127.0.0.1', () => {
          const port = server.address().port;
          server.close(error => error ? reject(error) : resolve(port));
        });
      });
    } catch (error) { if (!['EADDRINUSE', 'EACCES'].includes(error.code) || attempt === 31) throw error; }
  }
}
function createOpenCodeHeadless(directory, dependencies = {}) {
  const buildTemperature = dependencies.buildTemperature === undefined ? BUILD_TEMPERATURE : dependencies.buildTemperature;
  const contextLimitTokens = dependencies.contextLimitTokens ?? 200000;
  const compactionReserve = isolatedConfig(buildTemperature, contextLimitTokens).compaction.reserved;
  const root = path.join(directory, 'opencode-headless');
  const workdir = path.join(root, 'workspace');
  const spawnProcess = dependencies.spawn ?? spawn;
  const fetchRequest = dependencies.fetch ?? fetch;
  const idleMs = dependencies.idleMs ?? IDLE_MS;
  let keepAlive = dependencies.keepAlive === true;
  let retireWhenIdle = false;
  const ownership = dependencies.spawn ? null : createRuntimeLease(root);
  let ownerRecord = null;
  let child = null, baseUrl = '', authorization = '', startedAt = 0, lastError = '';
  let pending = Promise.resolve(), startup = null, idleTimer = null, idleExpiresAt = 0, leases = 0, disposed = false, generation = 0;
  let preparation = null, preparedKey = '', preparedDirectory = '', preparedModelId = null, preparationError = '';
  const credentialIdentity = () => crypto.createHash('sha256').update(String(dependencies.getProviderKey?.() ?? '')).digest('hex');
  const preparationKey = (directory, identity = credentialIdentity(), modelId = null) => `${generation}:${path.resolve(directory)}:${identity}:${modelId ?? ''}`;
  const lifetime = new AbortController();
  const providerAuth = createProviderAuthLease(root,dependencies.getProviderKey);
  const clearIdle = () => { if (idleTimer) clearTimeout(idleTimer); idleTimer = null; idleExpiresAt = 0; };
  function stop() {
    clearIdle(); generation++;
    preparedKey = ''; preparationError = '';
    const owned = child; child = null; baseUrl = ''; authorization = ''; startedAt = 0;
    if (owned && owned.exitCode === null) {
      if (owned.reattached) {
        // Revalidate the authenticated server before acting on a persisted PID.
        // A reused PID or unrelated listener must never be terminated.
        void ownership.reconnect(fetchRequest, AbortSignal.timeout(1500)).then(record => {
          if (record?.owner !== owned.owner) return;
          if (process.platform === 'win32') {
            const killer = spawn('taskkill', ['/PID', String(owned.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
            killer.once('error', () => {}); killer.once('close', code => { if (!code) ownership.clear(owned.owner); });
          } else { process.kill(owned.pid); ownership.clear(owned.owner); }
        }).catch(() => {});
        return;
      }
      if (process.platform === 'win32' && owned.pid && !dependencies.spawn) {
        // This PID comes from our own spawn. Retire native tool children with their worker.
        const killer = spawn('taskkill', ['/PID', String(owned.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.once('error', () => owned.kill());
        killer.once('close', code => { if (code !== 0) owned.kill(); });
      } else owned.kill();
    }
  }
  function scheduleIdle() {
    clearIdle();
    if (retireWhenIdle && !disposed && !leases && child) { stop(); return; }
    if (!keepAlive && !disposed && !leases && child) {
      idleExpiresAt = Date.now() + idleMs;
      idleTimer = setTimeout(stop, idleMs); idleTimer.unref?.();
    }
  }
  function setKeepAlive(value) {
    if (typeof value !== 'boolean') throw new Error('OpenCode keep-alive must be a boolean.');
    keepAlive = value;
    retireWhenIdle = false;
    if (keepAlive) { clearIdle(); }
    else scheduleIdle();
    return keepAlive;
  }
  async function start(signal) {
    if (disposed || lifetime.signal.aborted || signal?.aborted) throw cancelled();
    if (child && baseUrl) return;
    if (startup) return abortable(startup, signal);
    startup = (async () => {
      const epoch = generation;
      fs.mkdirSync(workdir, { recursive: true });
      fs.mkdirSync(path.join(root, 'home'), { recursive: true });
      const retained = await ownership?.reconnect(fetchRequest, AbortSignal.any([lifetime.signal, signal ?? lifetime.signal, AbortSignal.timeout(1500)]));
      if (retained) {
        if (disposed || signal?.aborted || generation !== epoch) throw cancelled();
        // A crashed older app may have left its server alive with older config.
        // Never label a recovered worker as using settings it has not loaded.
        const response = await fetchRequest(`${retained.url}/agent?directory=${encodeURIComponent(workdir)}`, {
          headers: { Authorization: retained.authorization }, redirect: 'error',
          signal: AbortSignal.any([lifetime.signal, signal ?? lifetime.signal, AbortSignal.timeout(5000)]),
        });
        const agents = response.ok ? await response.json() : null;
        if (!Array.isArray(agents) || !agents.some(agent => agent.name === 'build' && (agent.temperature ?? null) === buildTemperature)
          || !agents.some(agent=>agent.name==='orvix_review'&&agent.prompt===isolatedConfig(buildTemperature).agent.orvix_review.prompt)
          || !agents.some(agent=>agent.name==='orvix_conversation'&&agent.prompt===isolatedConfig(buildTemperature).agent.orvix_conversation.prompt)) {
          throw new Error('The retained OpenCode worker has different sampling or analysis settings. Stop that owned worker and restart Orvix before continuing; its saved task is unchanged.');
        }
        child = { pid: retained.pid, exitCode: null, reattached: true, owner: retained.owner };
        ownerRecord = retained; baseUrl = retained.url; authorization = retained.authorization; startedAt = retained.createdAt;
        return;
      }
      const password = crypto.randomBytes(32).toString('hex');
      await (dependencies.prepareConfig ?? prepareRuntimeSdk)(root);
      const port = await (dependencies.port ?? unusedPort)();
      if (disposed || signal?.aborted || generation !== epoch) throw cancelled();
      const executable = dependencies.binary ?? runtimeBinary();
      const processChild = spawnProcess(executable, ['--pure', 'serve', '--hostname', '127.0.0.1', '--port', String(port)], {
        cwd: workdir, env: isolatedEnvironment(root, password, process.env, buildTemperature, contextLimitTokens), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      child = processChild;
      ownerRecord = Number.isInteger(processChild.pid) ? ownership?.save(processChild.pid, port, `Basic ${Buffer.from(`orvix:${password}`).toString('base64')}`, executable) ?? null : null;
      const spawnedOwner = ownerRecord;
      let output = '', processError = null;
      const retain = chunk => { output = (output + String(chunk)).slice(-6000).replaceAll(password, '[redacted]'); if(providerAuth)output=providerAuth.redact(output); };
      processChild.stdout?.on('data', retain); processChild.stderr?.on('data', retain);
      processChild.on('error', error => { processError = error; });
      processChild.once('exit', (code, reason) => {
        if (spawnedOwner) { try { ownership.clear(spawnedOwner.owner); } catch {} }
        if (child === processChild) { child = null; baseUrl = ''; authorization = ''; startedAt = 0; }
        processError = new Error(`OpenCode stopped${code === null ? ` (${reason})` : ` (exit ${code})`}. ${output.trim().slice(-1200)}`);
      });
      const url = `http://127.0.0.1:${port}`;
      const auth = `Basic ${Buffer.from(`orvix:${password}`).toString('base64')}`;
      const deadline = Date.now() + (dependencies.startupMs ?? STARTUP_MS);
      while (Date.now() < deadline) {
        if (disposed || signal?.aborted || generation !== epoch) { stop(); throw cancelled(); }
        if (processError) throw processError;
        try {
          const reply = await fetchRequest(`${url}/global/health`, { headers: { Authorization: auth }, signal: AbortSignal.any([lifetime.signal, signal ?? lifetime.signal, AbortSignal.timeout(1500)]), redirect: 'error' });
          if (reply.ok && (await reply.json()).healthy === true) {
            if (generation !== epoch || disposed) throw cancelled();
            baseUrl = url; authorization = auth; startedAt = Date.now(); lastError = ''; return;
          }
        } catch { /* Wait for this owned process to become ready. */ }
        await abortable(new Promise(resolve => setTimeout(resolve, 150)), AbortSignal.any([lifetime.signal, signal ?? lifetime.signal]));
      }
      throw new Error(`OpenCode startup timed out. ${output.trim().slice(-1200)}`);
    })().catch(error => { lastError = error.message; stop(); throw error; }).finally(() => { startup = null; });
    return startup;
  }
  async function api(endpoint, { method = 'GET', body, signal, timeoutMs = 15000, directory } = {}) {
    // A crashed owned worker can restart against its existing private database.
    // Callers reconcile the retained session before submitting further work.
    if (!baseUrl) await start(signal);
    const location = directory ? `${endpoint.includes('?') ? '&' : '?'}directory=${encodeURIComponent(directory)}` : '';
    let reply;
    try { reply = await fetchRequest(`${baseUrl}${endpoint}${location}`, {
      method, headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}), redirect: 'error',
      signal: AbortSignal.any([lifetime.signal, signal ?? lifetime.signal, AbortSignal.timeout(timeoutMs)]),
    }); } catch (error) {
      // A reattached process has no child-process exit event in this app.
      // Clear the connection so the next reconciliation GET rechecks ownership.
      if (child?.reattached) { child = null; baseUrl = ''; authorization = ''; }
      throw error;
    }
    const data = await reply.json().catch(() => null);
    const errorMessage = `OpenCode ${data?.data?.message ?? data?.error?.message ?? data?.message ?? reply.statusText} (HTTP ${reply.status}).`;
    if (!reply.ok) throw providerError(providerAuth?.redact(errorMessage) ?? errorMessage, {
      statusCode: reply.status, code: data?.error?.code ?? data?._tag, headers: reply.headers,
    });
    return data;
  }
  function exclusive(signal, callback) {
    if (disposed || signal?.aborted) return Promise.reject(cancelled());
    clearIdle(); leases++;
    let begun = false;
    const job = pending.catch(() => {}).then(async () => {
      if (disposed || signal?.aborted) throw cancelled();
      begun = true;
      await start(signal);
      let originalFailure;
      try {
        const identity = credentialIdentity();
        await providerAuth?.prepare(api, signal);
        return await callback({ api, workdir, supportsAsyncPrompts: true,
          verifyModel: (directory, id, requestSignal, options) => resolveOpenCodeModel(api, directory, id, requestSignal, options),
          markPrepared: (directory, modelId) => markPrepared(directory, identity, modelId),
          prepareLocation: providerAuth ? ((directory, requestSignal) => providerAuth.prepareLocation(api, directory, requestSignal)) : undefined,
          events: async (eventSignal, directory) => {
            if (!baseUrl) await start(eventSignal);
            const reply = await fetchRequest(`${baseUrl}/event${directory ? `?directory=${encodeURIComponent(directory)}` : ''}`, { headers: { Authorization: authorization }, redirect: 'error', signal: AbortSignal.any([eventSignal, lifetime.signal]) });
            if (!reply.ok || !reply.body) throw providerError(`OpenCode event stream failed (HTTP ${reply.status}).`, { statusCode: reply.status, headers: reply.headers });
            return reply;
          } });
      } catch (error) { originalFailure = error; throw error; }
      finally {
        try { await providerAuth?.clear(api); }
        catch (cleanupError) {
          // A cleanup failure must not turn a quota/access failure into an
          // apparently transient error and retry the original provider request.
          stop();
          if (!originalFailure) throw cleanupError;
          originalFailure.credentialCleanupFailed = true;
          originalFailure.message += ' Native provider credential cleanup also failed; the worker was stopped.';
        }
      }
    }).finally(() => { leases--; scheduleIdle(); });
    pending = job.catch(() => {});
    if (!signal) return job;
    return new Promise((resolve, reject) => {
      const abort = () => { if (!begun) reject(cancelled()); };
      signal.addEventListener('abort', abort, { once: true });
      job.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
      if (signal.aborted) abort();
    });
  }
  function markPrepared(directory = workdir, identity, modelId = null) {
    preparedDirectory = path.resolve(directory);
    preparedModelId = modelId;
    preparedKey = preparationKey(preparedDirectory, identity, modelId);
    preparationError = '';
  }
  async function prepare(directory = workdir, signal, modelId) {
    if (modelId !== undefined && (typeof modelId !== 'string' || !/^opencode\/[\w.-]{1,150}$/.test(modelId))) throw new Error('Invalid OpenCode preparation model.');
    const location = path.resolve(directory), key = preparationKey(location, undefined, modelId);
    if (child && baseUrl && preparedKey === key) return status();
    if (preparation?.key === key) return abortable(preparation.promise, signal);
    preparationError = '';
    const epoch = generation;
    const job = exclusive(signal, async ({ api, prepareLocation, markPrepared, verifyModel }) => {
      await prepareLocation?.(location, signal);
      // The health/catalog endpoints alone leave the native prompt location cold.
      // The file service materializes the same legacy location services used by
      // SystemPrompt.environment; tool metadata prepares the selected schemas.
      // These are metadata reads, without sessions, messages or model generation.
      if (modelId) await verifyModel(location, modelId, signal);
      else await api('/config/providers', { directory: location, signal });
      const files = await api('/file?path=.', { directory: location, signal });
      if (!Array.isArray(files)) throw new Error('OpenCode workspace preparation returned an invalid file listing.');
      const tools = await api(modelId ? `/experimental/tool?provider=opencode&model=${encodeURIComponent(modelId.slice('opencode/'.length))}`
        : '/experimental/tool/ids', { directory: location, signal });
      if (!Array.isArray(tools)) throw new Error('OpenCode tool preparation returned invalid metadata.');
      if (generation !== epoch) throw cancelled();
      if (preparationKey(location, undefined, modelId) !== key) throw new Error('OpenCode credentials changed during preparation. Prepare this task again.');
      markPrepared(location, modelId);
    });
    const record = { key, promise: null };
    record.promise = job.catch(error => { preparedKey = ''; preparationError = error.message; throw error; })
      .finally(() => { if (preparation === record) preparation = null; });
    preparation = record;
    await record.promise;
    return status();
  }
  const status = () => ({ running: Boolean(child && baseUrl), starting: Boolean(startup), preparing: Boolean(preparation), prepared: Boolean(child && baseUrl && preparedKey && preparedKey === preparationKey(preparedDirectory, undefined, preparedModelId)), preparedModelId, preparationError,
    queued: leases, pid: child?.pid ?? null, startedAt, idleMs, idleExpiresAt: idleExpiresAt || null, keepAlive, error: lastError, buildTemperature, contextLimitTokens, compactionReserve, runtimeVersion: require('opencode-ai/package.json').version });
  return {
    exclusive, prepare, connect: async signal => { await start(signal); scheduleIdle(); return status(); }, setKeepAlive, status,
    retireIdle: () => { keepAlive = false; retireWhenIdle = true; scheduleIdle(); },
    shutdown: () => { disposed = true; lifetime.abort(); stop(); },
  };
}
module.exports = { createOpenCodeHeadless, isolatedConfig, isolatedEnvironment, runtimeBinary, abortable, unusedPort };
