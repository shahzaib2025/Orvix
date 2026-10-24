const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { launchChrome, rememberPairedProfile } = require('./chrome-launch.cjs');
const browserProtocol = require('./browser-protocol.cjs');

const PORT = 49492;
const ACTIONS = new Set(['search_and_play', 'select_and_play', 'pause', 'resume']);
function log(stage, details = {}) {
  console.log(`[${new Date().toLocaleTimeString()}] [Orvix YouTube] ${stage}`, JSON.stringify(details));
}

function pairingToken() {
  try {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return fs.readFileSync(path.join(local, 'PCMonitorTest', 'pairing-token.txt'), 'utf8').trim();
  } catch { return ''; }
}

function createYoutubeControl({ startChrome = launchChrome, connectionTimeoutMs = 25_000, reconnectGraceMs = 1500, port = PORT, browserTimeouts = {} } = {}) {
  let chrome = null;
  let closed = false;
  let serverError = null;
  let authenticationFailed = false;
  let recovery = null;
  let browserHello = null;
  let inventory = null;
  const cancelledBrowser = new Set();
  const retiredBrowser = new Set();
  function retireBrowser(id) {
    retiredBrowser.add(id);
    while (retiredBrowser.size > 1000) retiredBrowser.delete(retiredBrowser.values().next().value);
  }
  const pending = new Map();
  function acceptInventory(observation) {
    if (!browserHello || observation?.sessionId !== browserHello.sessionId || !Array.isArray(observation.tabs)) return;
    if (inventory && Number(observation.revision) < Number(inventory.revision)) return;
    inventory = { ...observation, receivedAt: Date.now() };
  }
  const server = new WebSocketServer({
    host: '127.0.0.1', port, maxPayload: 1_048_576,
    verifyClient: ({ origin }) => /^chrome-extension:\/\/[a-p]{32}$/.test(origin || ''),
  });
  server.on('connection', (socket, request) => {
    log('extension socket connected; authenticating');
    let authenticated = false;
    const authTimer = setTimeout(() => { if (!authenticated) socket.close(1008, 'Pairing required'); }, 5000);
    socket.on('message', raw => {
      if (raw.length > 1_048_576) { socket.close(1009); return; }
      let message;
      try { message = JSON.parse(raw.toString()); } catch { socket.close(1003); return; }
      if (!authenticated) {
        const expected = pairingToken();
        if (message?.type !== 'hello' || message.browser !== 'Chrome' || !expected || message.token !== expected) {
          authenticationFailed = true;
          log('authentication rejected', { reason: !expected ? 'desktop token missing' : 'invalid hello or token mismatch' });
          socket.close(1008, 'Pairing failed'); return;
        }
        authenticated = true;
        clearTimeout(authTimer);
        if (chrome && chrome !== socket) chrome.close(1000, 'New Chrome connection');
        chrome = socket;
        rememberPairedProfile(request.headers.origin?.slice(19), expected);
        browserHello = message.protocolVersion === 2 && typeof message.sessionId === 'string'
          ? { protocolVersion: 2, sessionId: message.sessionId, extensionVersion: String(message.extensionVersion || ''), capabilities: message.capabilities || {} } : null;
        inventory = null;
        authenticationFailed = false;
        log('paired Chrome authenticated; command channel ready');
        socket.send(JSON.stringify({ type: 'ready', protocolVersion: 2 }));
        return;
      }
      if (message?.type === 'inventory' && browserHello && message.sessionId === browserHello.sessionId && message.observation && Array.isArray(message.observation.tabs)) {
        acceptInventory(message.observation);
        return;
      }
      if (message?.type === 'trace') {
        const details = {};
        for (const key of ['id', 'stage', 'tabId', 'status', 'type', 'count', 'playbackState', 'videoFound', 'elapsedMs']) {
          if (typeof message[key] === 'string') details[key] = message[key].slice(0, 1000);
          else if (typeof message[key] === 'number' || typeof message[key] === 'boolean') details[key] = message[key];
        }
        log('Chrome trace', details);
        return;
      }
      if (message?.type !== 'result' || typeof message.id !== 'string') return;
      const job = pending.get(message.id);
      if (!job || job.socket !== socket) return;
      clearTimeout(job.timer);
      pending.delete(message.id);
      if (job.browser) retireBrowser(message.id);
      // An action's observed postcondition is fresher than the pre-action cache.
      // Do not wait for a separate inventory publication before returning it.
      if (job.browser) acceptInventory(message.result?.observation);
      log('command result', { id: message.id, elapsedMs: Date.now() - job.started, result: browserProtocol.summary(message.result) });
      job.resolve(message.result && typeof message.result === 'object'
        ? message.result : { status: 'failed', message: 'Chrome returned an invalid result.' });
    });
    socket.on('close', (code, reason) => {
      log('extension socket closed', { code, reason: reason.toString(), authenticated });
      clearTimeout(authTimer);
      if (chrome === socket) { chrome = null; inventory = null; browserHello = null; }
      for (const [id, job] of pending) {
        if (job.socket !== socket) continue;
        clearTimeout(job.timer);
        pending.delete(id);
        if (job.browser) retireBrowser(id);
        job.resolve({ status: 'unavailable', requestId: id, completionUnknown: !!job.browser && job.kind === 'act', message: 'Chrome extension disconnected before the action finished. Inspect state before retrying.' });
      }
    });
    socket.on('error', error => log('extension socket error', { message: error.message }));
  });
  server.on('listening', () => log('command server listening', { host: '127.0.0.1', port: server.address().port, tokenAvailable: !!pairingToken() }));
  server.on('error', error => {
    serverError = error.message;
    console.warn(`[Orvix YouTube] Local command channel unavailable: ${error.message}`);
  });

  function connected() { return chrome?.readyState === WebSocket.OPEN; }
  async function waitForConnection(ms) {
    const deadline = Date.now() + ms;
    while (!connected() && !closed && !serverError && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now()))));
    }
    return connected();
  }

  function browserStatus() {
    return { connected: !!connected(), ...browserHello, inventoryFresh: !!inventory && Date.now() - inventory.receivedAt < 2000,
      capabilities: browserHello?.capabilities || {}, message: connected() && !browserHello ? 'Update the Chrome companion for browser control; legacy YouTube remains available.' : serverError || '' };
  }
  async function browserRequest(kind, rawInput) {
    const wasConnected = connected();
    let result = await performBrowserRequest(kind, rawInput);
    if (kind === 'observe' && wasConnected && result.status === 'unavailable' && await waitForConnection(3500)) result = await performBrowserRequest(kind, rawInput);
    const connection = browserStatus();
    if (result.connection?.actions) connection.capabilities = result.connection;
    return { resolvedTarget: null, observation: null,
      verification: { verified: kind === 'observe' && result.status === 'ok', evidence: kind === 'observe' && result.status === 'ok' ? 'Timestamped browser observation.' : 'No successful final outcome was observed.' }, ...result, connection };
  }
  async function performBrowserRequest(kind, rawInput) {
    let input;
    const requestId = rawInput?.requestId || randomUUID();
    if (retiredBrowser.has(requestId)) return { requestId, status: 'invalid_request', dispatched: false, message: 'A settled browser request ID cannot be reused. Inspect retained results or use a fresh ID for new work.' };
    try { input = browserProtocol.validate(kind, rawInput); }
    catch (error) { return { requestId, status: error.code || 'invalid_request', completionUnknown: false, error: { code: error.code || 'invalid_request', message: error.message } }; }
    log('browser request', { ...browserProtocol.summary(input), requestId });
    if (kind === 'act' && !connected()) {
      const failure = await ensureChrome();
      if (failure) return { ...failure, requestId, connection: browserStatus() };
    }
    if (cancelledBrowser.delete(requestId)) return { requestId, status: 'cancelled', message: 'Browser request cancelled before execution.' };
    if (!connected()) return { requestId, status: 'unavailable', connection: browserStatus(), message: 'Chrome companion is disconnected. Observation does not launch Chrome.' };
    if (!browserHello) {
      const legacy = { youtube_search: 'search_and_play', youtube_select: 'select_and_play', youtube_pause: 'pause', youtube_resume: 'resume' }[input.action];
      if (kind === 'act' && legacy) {
        const result = await execute({ action: legacy, ...input.args });
        return { ...result, requestId, legacyCompatibility: true, cancellationSupported: false,
          verification: { verified: result.status === 'ok' && ['playing', 'paused'].includes(result.playbackState), evidence: result.playbackState || result.message } };
      }
      return { requestId, status: 'update_required', connection: browserStatus(), message: 'Reload or update the Chrome companion for the new browser tools.' };
    }
    if (kind === 'observe' && input.scope === 'browser' && !input.query && !input.cursor && !input.target && !input.screenshot && browserStatus().inventoryFresh) {
      const { receivedAt, ...state } = inventory;
      const observation = { ...state, tabs: state.tabs.slice(0, 100), totalTabs: state.totalTabs ?? state.tabs.length, cursor: (state.totalTabs ?? state.tabs.length) > 100 ? '100' : null };
      return { requestId, status: 'ok', observation, connection: browserStatus(), verification: { verified: true, evidence: 'Fresh browser inventory' } };
    }
    const socket = chrome;
    if (pending.has(requestId)) return { requestId, status: 'invalid_request', message: 'Duplicate active request ID.' };
    const phase = kind === 'observe' ? (input.scope === 'browser' && !input.screenshot ? 'inventory' : 'observation') : 'action';
    // Slow navigation retains its full deadline; lightweight reads no longer
    // occupy the same 30-second failure window. Mutation timeouts are uncertain.
    const timeoutMs = browserTimeouts[phase] ?? ({ inventory: 3000, observation: 8000, action: 30000 })[phase];
    return new Promise(resolve => {
      const started = Date.now();
      const timer = setTimeout(() => {
        cancelBrowser([requestId]);
        pending.delete(requestId);
        retireBrowser(requestId);
        log('browser command timeout', { requestId, action: input.action, phase, timeoutMs });
        resolve({ requestId, status: 'timeout', phase, completionUnknown: kind === 'act', message: 'Browser deadline reached. Inspect state before retrying an action.' });
      }, timeoutMs);
      pending.set(requestId, { socket, timer, resolve, started, browser: true, kind });
      try { socket.send(JSON.stringify({ type: 'browser-command', id: requestId, kind, input, deadline: started + timeoutMs })); }
      catch { clearTimeout(timer); pending.delete(requestId); resolve({ requestId, status: 'unavailable', message: 'Could not send browser command.' }); }
    });
  }
  function cancelBrowser(ids) {
    for (const id of ids) {
      cancelledBrowser.add(id);
      while (cancelledBrowser.size > 1000) cancelledBrowser.delete(cancelledBrowser.values().next().value);
      const job = pending.get(id);
      if (!job?.browser) continue;
      if (job.socket.readyState === WebSocket.OPEN) job.socket.send(JSON.stringify({ type: 'browser-cancel', id }));
    }
  }
  async function ensureChrome() {
    if (connected()) return null;
    if (closed) return { status: 'unavailable', message: 'Orvix closed the YouTube command channel.' };
    if (!pairingToken()) return { status: 'unavailable', message: 'The desktop pairing token is missing. Complete initial companion setup.' };
    if (recovery) return recovery;
    recovery = (async () => {
      log('waiting for saved Chrome connection');
      if (await waitForConnection(reconnectGraceMs)) return null;
      if (serverError || closed) return { status: 'unavailable', message: serverError || 'Orvix closed the YouTube command channel.' };
      try {
        log('opening Chrome for YouTube');
        await startChrome({ token: pairingToken() });
      } catch (error) {
        log('Chrome startup failed', { message: error.message });
        return { status: 'unavailable', message: error.message || 'Chrome could not be started.' };
      }
      log('waiting for extension authentication', { timeoutMs: connectionTimeoutMs });
      if (await waitForConnection(connectionTimeoutMs)) return null;
      const message = closed ? 'Orvix closed the YouTube command channel.'
        : serverError ? `The local YouTube command server failed: ${serverError}`
        : authenticationFailed ? 'Chrome connected, but its saved pairing token was rejected. Repair pairing in the companion extension.'
        : 'Chrome was opened, but the YouTube companion did not connect. Check that the extension is enabled in the opened Chrome profile.';
      log('Chrome recovery failed', { message });
      return { status: 'unavailable', message };
    })();
    try { return await recovery; } finally { recovery = null; }
  }

  async function execute(input = {}, foregroundHandle = 0) {
    log('action requested', { action: input.action });
    const action = typeof input.action === 'string' ? input.action.trim() : '';
    if (!ACTIONS.has(action)) return { status: 'invalid_request', message: 'Choose a supported YouTube action.' };
    const query = typeof input.query === 'string' ? input.query.trim().slice(0, 200) : '';
    const candidateId = typeof input.candidateId === 'string' ? input.candidateId.trim().slice(0, 100) : '';
    const targetTitle = typeof input.targetTitle === 'string' ? input.targetTitle.trim().slice(0, 200) : '';
    if (action === 'search_and_play' && !query) return { status: 'invalid_request', message: 'A video title is required.' };
    if (action === 'select_and_play' && !candidateId) return { status: 'invalid_request', message: 'Choose a candidate ID from the previous search.' };
    if (action === 'search_and_play' && !connected()) {
      const failure = await ensureChrome();
      if (failure) return failure;
    }
    if (!chrome || chrome.readyState !== WebSocket.OPEN) {
      const tokenAvailable = !!pairingToken();
      log('action blocked: command channel disconnected', { tokenAvailable });
      return { status: 'unavailable', message: tokenAvailable
        ? 'The Chrome YouTube command channel is disconnected. Saved pairing may still be valid. Check that Chrome and the companion extension are running; do not assume re-pairing is needed.'
        : 'The desktop pairing token is missing. Start the PC Monitor companion and complete initial pairing.' };
    }
    const socket = chrome;
    const id = randomUUID();
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        log('command timed out', { id, action, elapsedMs: Date.now() - started });
        pending.delete(id);
        resolve({ status: 'timeout', message: 'Chrome did not finish the YouTube action in time.' });
      }, action === 'search_and_play' || action === 'select_and_play' ? 35_000 : 12_000);
      const started = Date.now();
      pending.set(id, { socket, timer, resolve, started });
      log('sending command to Chrome', { id, action });
      try { socket.send(JSON.stringify({ type: 'command', id, action, query, candidateId, targetTitle, foregroundHandle })); }
      catch {
        clearTimeout(timer);
        pending.delete(id);
        resolve({ status: 'unavailable', message: 'Could not send the YouTube action to Chrome.' });
      }
    });
  }

  function close() {
    closed = true;
    for (const job of pending.values()) {
      clearTimeout(job.timer);
      job.resolve({ status: 'unavailable', message: 'Orvix closed the YouTube command channel.' });
    }
    pending.clear();
    chrome?.close();
    server.close();
  }

  const browserContext = () => ({connected:!!connected(),sessionId:inventory?.sessionId,timestamp:inventory?.timestamp,ageMs:inventory?Date.now()-inventory.receivedAt:null,
    tabs:inventory?.tabs?.slice(0,100)||[],totalTabs:inventory?.totalTabs??inventory?.tabs?.length??0,windows:inventory?.windows||[],capabilities:browserHello?.capabilities||{}});
  return { execute, close, browserRequest, browserStatus, browserContext, cancelBrowser, get port() { return server.address()?.port; } };
}

module.exports = { createYoutubeControl };
