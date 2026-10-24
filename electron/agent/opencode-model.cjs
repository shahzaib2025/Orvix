const { refreshOpenCodeCatalog, openCodeModel, markOpenCodeModelUnavailable } = require('./opencode-catalog.cjs');
const { abortable } = require('./opencode-headless.cjs');
const { createHash, randomBytes } = require('node:crypto');
const { transientFailure, providerRetryDelay, abortableDelay } = require('./model-failure-policy.cjs');
const { providerError, recoveryMetadata, details } = require('./provider-failure.cjs');
const { createRequestDeadline } = require('./request-deadline.cjs');
const { compactionCheckpoint } = require('./native-compaction-recovery.cjs');
// Metadata only: never persist prompt text, embedded images or credentials here.
function promptTrace(taskId, sessionID, body, kind, buildTemperature = null, supportsTemperature = null) {
  const digest = value => createHash('sha256').update(value).digest('hex');
  return { taskId, sessionID, kind, model: body.model, agent: body.agent, variant: body.variant ?? null,
    sampling: { configuredTemperature: buildTemperature, supportsTemperature,
      requestedTemperature: supportsTemperature === true ? buildTemperature : null,
      policy: 'OpenCode applies the agent temperature only when the model advertises support; provider acceptance is not confirmed by this trace', seedOverride: false },
    system: { characters: (body.system ?? '').length, sha256: digest(body.system ?? '') },
    parts: body.parts.map(part => ({ type: part.type, ...(part.type === 'text'
      ? { characters: (part.text ?? '').length, sha256: digest(part.text ?? '') } : { mime: part.mime ?? null }) })) };
}
let runtime;
let messageTimestamp = 0, messageCounter = 0;
// Match the bundled OpenCode identifier encoding. The same message ID is used
// to reconcile an ambiguous POST; it is never submitted a second time.
function newMessageID() {
  const now = Date.now(); messageCounter = now === messageTimestamp ? messageCounter + 1 : 1; messageTimestamp = now;
  const time = ((BigInt(now) * 4096n + BigInt(messageCounter)) & 0xffffffffffffn).toString(16).padStart(12, '0');
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  return 'msg_' + time + [...randomBytes(14)].map(byte => alphabet[byte % alphabet.length]).join('');
}
function configureOpenCodeModel(service) { runtime = service; }
function decodeReply(data, model) {
  if (data?.info?.error) {
    const failure = data.info.error, detail = failure.data ?? failure;
    const message = String(detail.message ?? failure.name ?? 'OpenCode model request failed');
    const network = !detail.statusCode && /cannot connect|fetch failed|socket|connection|econnreset|econnrefused|enotfound|eai_again/i.test(message);
    const error = providerError(`${model.name}: ${message}${detail.statusCode ? ` (HTTP ${detail.statusCode})` : ''}.${network ? ' The OpenCode provider connection failed. Completed actions were retained; review them before retrying. A reachable model catalog does not verify model generation.' : ''}`, {
      statusCode: detail.statusCode, code: detail.code ?? failure.name, headers: detail.responseHeaders, responseBody: detail.responseBody,
    });
    error.providerFailure = true; throw error;
  }
  const text = (data?.parts ?? []).filter(part => part.type === 'text' && !part.ignored && !part.synthetic).map(part => part.text ?? '').join('');
  const tokens = data?.info?.tokens;
  const usage = tokens ? { input_tokens: (tokens.input ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0), output_tokens: tokens.output ?? 0,
    reasoning_tokens: tokens.reasoning ?? 0, total_tokens: tokens.total ?? ((tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.reasoning ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0)) } : null;
  return { text, usage, finish: data?.info?.finish, parts: data?.parts ?? [] };
}
async function consumeEvents(response, sessionID, handle, signal) {
  const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = '';
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read(); if (done) break;
      pending = (pending + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      if (pending.length > 4 * 1024 * 1024) throw new Error('OpenCode event exceeded the supported size.');
      let split;
      while ((split = pending.indexOf('\n\n')) >= 0) {
        const frame = pending.slice(0, split); pending = pending.slice(split + 2);
        const source = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        let event; try { event = JSON.parse(source); } catch { continue; }
        const props = event.properties ?? {};
        if ((props.sessionID ?? props.info?.sessionID ?? props.part?.sessionID) === sessionID) await handle(event);
      }
    }
    if (!signal.aborted) throw new Error('OpenCode event connection closed during the task. Review its actions before retrying.');
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
}
async function runOpenCodeAttempt({ taskId, modelId, variant, parts, systemPrompt, signal, directory, timeoutMs = null, idleTimeoutMs = null, preparationTimeoutMs = 90000, onPermission, onQuestion, onEvent, onTextDelta, onSession, onRequest, onFailure, visualTools, readOnly = false, analysis = false, conversation = false, resumeSession, onCheckpoint, onRecovery, permissionRecovery, onCompactionContext, continuity, carriedUsage }) {
  if (systemPrompt !== undefined && (typeof systemPrompt !== 'string' || systemPrompt.length > 8000)) throw new Error('Supply a bounded system instruction string.');
  if (!runtime) throw new Error('OpenCode headless service is not initialized.');
  if (readOnly && visualTools) throw new Error('Independent reviewer cannot attach execution tools.');
  const requestStarted = performance.now();
  const timed = new Set();
  const timing = stage => {
    if (timed.has(stage)) return;
    timed.add(stage);
    console.info('[OpenCode timing]', JSON.stringify({ taskId, modelId, stage, elapsedMs: Math.round(performance.now() - requestStarted) }));
  };
  // A cold worker/catalog must not consume a greeting's model-response budget.
  // Setup remains bounded independently and cancellation covers both phases.
  const preparation = conversation ? createRequestDeadline({ timeoutMs: Number.isFinite(preparationTimeoutMs) && preparationTimeoutMs > 0 ? Math.min(preparationTimeoutMs, 90000) : 90000 }) : null;
  const deadline = createRequestDeadline({timeoutMs,idleTimeoutMs,deferred:conversation});
  const timeout = deadline.signal;
  const requestSignal = AbortSignal.any([signal ?? new AbortController().signal, timeout, ...(preparation ? [preparation.signal] : [])]);
  try {
  const catalog = await abortable(refreshOpenCodeCatalog(false, requestSignal), requestSignal);
  timing('catalog_ready');
  if (catalog.error || catalog.stale) throw new Error(`OpenCode free-model catalog could not be verified. ${catalog.error || 'Refresh its model list.'}`);
  const model = openCodeModel(modelId);
  if (!model) throw new Error('This model is no longer in the verified OpenCode free catalog. Refresh the model list and choose an available model.');
  if (variant && !model.variants.includes(variant)) throw new Error(`${model.name} does not advertise this thinking level. Choose Default or refresh the model list.`);
  if (parts.some(part => part.type === 'file' && part.mime?.startsWith('image/')) && !model.input.includes('image')) throw new Error(`${model.name} does not advertise image input. Choose a model that supports images.`);
  // A design comparison can run while the builder awaits its MCP result.
  // Use the existing isolated catalog lane: queuing on the builder's lease deadlocks.
  // A greeting must not queue behind another task's independent review.
  // Its own worker is already warmed by the active-task keep-alive control.
  const worker = (!readOnly || conversation) && runtime.forTask ? runtime.forTask(taskId, modelId) : runtime;
  let entered = false;
  const execute = () => worker.exclusive(requestSignal, async ({ api: rawApi, events, workdir, supportsAsyncPrompts = false, prepareLocation, markPrepared, verifyModel }) => {
    entered = true;
    timing('worker_ready');
    if (resumeSession && (readOnly || resumeSession.modelId !== modelId || resumeSession.variant !== (variant ?? null))) throw new Error('Retained native session does not match the selected model/reasoning.');
    const location = resumeSession?.directory || directory || workdir;
    const api = (endpoint, options = {}) => rawApi(endpoint, { ...options, directory: location });
    let sessionID, eventTask, eventFailure, visualBridge, failed = false, declinedPermissions = 0, pollTimer;
    const usageByMessage = new Map(resumeSession?.usageByMessage ?? []), repliedPermissions = new Set(), repliedQuestions = new Set();
    const finalizedTools = new Set(resumeSession?.finalizedTools ?? []), recoveredDenials = new Set(), questionAnswers = new Map();
    let usageWatermark = resumeSession?.usageWatermark ?? -Infinity, completedTools = resumeSession?.completedTools ?? 0, lastDenialAt = -1;
    const usageCreated = new Map(resumeSession?.usageCreated ?? []);
    const usageTotal = { input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, total_tokens: 0, ...carriedUsage, ...resumeSession?.usageTotal };
    const boundedAdd = (set, value) => { set.add(value); if (set.size > 512) set.delete(set.values().next().value); };
    function recordUsage(info) {
      const created = info?.time?.created ?? 0;
      if (!info?.tokens || !info.id || created <= usageWatermark && !usageByMessage.has(info.id)) return;
      const next = decodeReply({ info: { tokens: info.tokens } }, model).usage, prior = usageByMessage.get(info.id);
      for (const key of Object.keys(usageTotal)) usageTotal[key] += (next?.[key] ?? 0) - (prior?.[key] ?? 0);
      usageByMessage.set(info.id, next);
      usageCreated.set(info.id, created);
      if (usageByMessage.size > 256) {
        const oldest = [...usageCreated].sort((a, b) => a[1] - b[1])[0];
        usageWatermark = oldest[1]; usageByMessage.delete(oldest[0]); usageCreated.delete(oldest[0]);
      }
    }
    const eventController = new AbortController();
    const eventSignal = AbortSignal.any([eventController.signal, requestSignal]);
    let promptSent = false, promptObserved = false, completePrompt, reportStopped = false, reportStopPromise, roundError, pendingPrompt;
    const pendingTools = new Map(Object.entries(resumeSession?.pendingTools ?? {}));
    const checkpoint = (status, failure) => onCheckpoint?.({ version: 1, sessionID, directory: location, modelId, variant: variant ?? null,
      status, pendingPrompt, pendingTools: Object.fromEntries(pendingTools), completedTools, finalizedTools: [...finalizedTools], ...(continuity ? { continuity } : {}),
      usageByMessage: [...usageByMessage], usageCreated: [...usageCreated], usageTotal: { ...usageTotal }, usageWatermark: Number.isFinite(usageWatermark) ? usageWatermark : null,
      ...(failure ? { failure: recoveryMetadata(failure) } : {}), updatedAt: Date.now() });
    let latestAssistant = null, preparationRecorded = false;
    const recordPreparation = () => {
      if (preparationRecorded) return;
      preparationRecorded = true;
      markPrepared?.(location, modelId);
    };
    const assistantIds = new Set();
    const progressLengths = new Map();
    const textParts = new Map();
    let promptComplete = new Promise(resolve => { completePrompt = resolve; });
    const resetRound = () => { roundError = null; promptObserved = false; promptComplete = new Promise(resolve => { completePrompt = resolve; }); };
    try {
      await prepareLocation?.(location,requestSignal);
      await verifyModel?.(location, modelId, requestSignal, { refresh: !resumeSession });
      timing('location_ready');
      if (visualTools) {
        visualBridge = await visualTools({ acceptsImages: model.input.includes('image'), signal: requestSignal, workdir });
        const status = await api('/mcp', { method: 'POST', body: { name: 'orvix_visual', config: visualBridge.config }, signal: requestSignal });
        if (status?.orvix_visual?.status !== 'connected') throw new Error('OpenCode could not connect Orvix visual tools.');
      }
      timing('tools_ready');
      // Retain the official tool definitions for native free-model compatibility.
      // Every tool requires a permission event; the read-only handler always rejects it.
      const session = resumeSession
        ? await api(`/session/${resumeSession.sessionID}`, { signal: requestSignal })
        : await api('/session', { method: 'POST', body: { title: readOnly ? 'Orvix independent review' : 'Orvix agent task', permission: [{ permission: '*', pattern: '*', action: 'ask' }] }, signal: requestSignal });
      sessionID = session?.id;
      timing('session_ready');
      if (typeof sessionID !== 'string' || !/^[\w-]+$/.test(sessionID)) throw new Error('OpenCode did not create a valid session.');
      pendingPrompt = resumeSession?.pendingPrompt;
      checkpoint('connected');
      onSession?.({ sessionID, directory: location, workdir, signal: requestSignal, stopForReport: () => {
        // Stop the current generator instead of queuing another prompt behind it.
        // Retain the session and its recorded actions until the normal reply/cleanup path finishes.
        if (!reportStopPromise) {
          reportStopped = true;
          reportStopPromise = api(`/session/${sessionID}/abort`, { method: 'POST', timeoutMs: 5000, signal: requestSignal })
            .then(() => { completePrompt(); return { stopped: true }; })
            .catch(error => { eventFailure = error; eventController.abort(); onFailure?.(error); throw error; });
        }
        return reportStopPromise;
      }, steer: async text => {
        const body = { messageID: newMessageID(), model: { providerID: 'opencode', modelID: modelId.slice('opencode/'.length) }, agent: 'build', ...(variant ? { variant } : {}), ...(systemPrompt ? { system: systemPrompt } : {}), parts: [{ type: 'text', text }] };
        await onRequest?.(promptTrace(taskId, sessionID, body, 'steer', worker.status?.().buildTemperature ?? null, model.supportsTemperature ?? null));
        pendingPrompt = { messageID: body.messageID, kind: 'steer' }; checkpoint('submitting');
        try {
          const result = await api(`/session/${sessionID}/prompt_async`, { method: 'POST', signal: requestSignal, body });
          checkpoint('submitted'); return result;
        } catch (error) {
          try {
            if (transientFailure(error)) {
              const recorded = await reconcileUntilConnected();
              if (recorded.messages.some(message => message.info?.id === body.messageID)) { checkpoint('submitted'); return null; }
            }
          } catch (reconnectError) { error = reconnectError; }
          // Never continue editing under an undelivered human instruction.
          const failure = new Error(`Steering delivery could not be confirmed. The task was stopped and retained for recovery. ${error.message}`);
          eventFailure = failure; eventController.abort(); onFailure?.(failure); throw failure;
        }
      } });
      const stream = await events(eventSignal, location);
      const handleEvent = async event => {
        if (eventSignal.aborted) return;
        const props = event.properties ?? {};
        if (props.info?.role === 'assistant' && /^[\w-]+$/.test(props.info.id ?? '')) {
          boundedAdd(assistantIds,props.info.id);
          const createdAt = props.info.time?.created ?? 0;
          if (!latestAssistant || createdAt >= latestAssistant.createdAt) latestAssistant = { id: props.info.id, createdAt };
        }
        // Only new assistant content renews inactivity. Busy/heartbeat events,
        // replayed parts, user text and unrelated sessions are not progress.
        if (event.type === 'message.part.delta' && assistantIds.has(props.messageID)
          && typeof props.delta === 'string' && props.delta.length) deadline.progress();
        const progressPart = props.part;
        if (assistantIds.has(props.messageID ?? progressPart?.messageID)) {
          if ((event.type === 'message.part.delta' && props.delta?.length) || (['text', 'reasoning'].includes(progressPart?.type) && progressPart.text?.length)
            || progressPart?.type === 'tool' && progressPart.state?.status === 'running') {
            recordPreparation(); timing('first_model_content');
          }
          if (onTextDelta && progressPart?.type === 'text' && !progressPart.ignored && !progressPart.synthetic) {
            const previous = textParts.get(progressPart.id) ?? '';
            const next = typeof progressPart.text === 'string' ? progressPart.text : previous;
            if (next.startsWith(previous) && next.length > previous.length) { timing('first_visible_text'); onTextDelta(next.slice(previous.length)); }
            // Metadata-only and replayed older snapshots must not move the
            // streamed cursor backward and duplicate the next text delta.
            if (next.startsWith(previous)) textParts.set(progressPart.id, next);
          } else if (onTextDelta && event.type === 'message.part.delta' && props.field === 'text' && textParts.has(props.partID) && typeof props.delta === 'string') {
            textParts.set(props.partID, textParts.get(props.partID) + props.delta);
            timing('first_visible_text');
            onTextDelta(props.delta);
          }
        }
        if (progressPart && assistantIds.has(progressPart.messageID) && ['text','reasoning'].includes(progressPart.type)) {
          const length=String(progressPart.text??'').length;
          if(length>(progressLengths.get(progressPart.id)??0)) deadline.progress();
          progressLengths.set(progressPart.id,length);
          if(progressLengths.size>512)progressLengths.delete(progressLengths.keys().next().value);
        }
        if (promptSent && (event.type === 'message.updated' || event.type === 'session.status' && props.status?.type !== 'idle')) promptObserved = true;
        if (event.type === 'message.updated' && props.info?.role === 'assistant') recordUsage(props.info);
        if (event.type === 'permission.asked' || event.type === 'permission.updated') {
          if (typeof props.id !== 'string' || !/^[\w-]+$/.test(props.id)) throw new Error('Invalid OpenCode permission request.');
          if (!repliedPermissions.has(props.id)) {
            boundedAdd(repliedPermissions, props.id);
            const allowed = readOnly || reportStopped ? false : await abortable(Promise.resolve(onPermission?.(props, location)), requestSignal);
            if (allowed !== true) { declinedPermissions++; lastDenialAt = completedTools; }
            if (allowed === true && props.tool?.callID && !finalizedTools.has(props.tool.callID)) {
              pendingTools.set(props.tool.callID, { name: props.permission, status: 'authorized' }); checkpoint('running');
            }
            try {
              await api(`/permission/${props.id}/reply`, { method: 'POST', body: { reply: allowed === true ? 'once' : 'reject' }, signal: requestSignal });
            } catch (error) {
              if (!/HTTP 404/i.test(error.message) && !/not found/i.test(error.message)) { repliedPermissions.delete(props.id); throw error; }
            }
          }
        } else if (event.type === 'question.asked') {
          if (!/^[\w-]+$/.test(props.id)) throw new Error('Invalid OpenCode question request.');
          if (!repliedQuestions.has(props.id)) {
            boundedAdd(repliedQuestions, props.id);
            const answers = reportStopped ? null : questionAnswers.has(props.id) ? questionAnswers.get(props.id)
              : await abortable(Promise.resolve(onQuestion?.(props)), requestSignal);
            questionAnswers.set(props.id, answers); if (questionAnswers.size > 512) questionAnswers.delete(questionAnswers.keys().next().value);
            try {
              await api(`/question/${props.id}/${answers ? 'reply' : 'reject'}`, { method: 'POST', ...(answers ? { body: { answers } } : {}), signal: requestSignal });
            } catch (error) {
              if (!/HTTP 404/i.test(error.message) && !/not found/i.test(error.message)) { repliedQuestions.delete(props.id); throw error; }
            }
          }
        }
        await onEvent?.(event);
        if (event.type === 'session.compacted' && !readOnly && !reportStopped && !requestSignal.aborted && onCompactionContext) {
          // noReply stores context without starting another model generation.
          // Rehydrate exact current instructions, not a model's approximation.
          const text = onCompactionContext();
          await api(`/session/${sessionID}/message`, { method: 'POST', body: { messageID: newMessageID(), noReply: true,
            model: { providerID: 'opencode', modelID: modelId.slice('opencode/'.length) }, agent: 'build',
            parts: [{ type: 'text', text: 'Retained Orvix task context after compaction (honor latest human steering):\n' + text }] }, signal: requestSignal });
          checkpoint('running');
        }
        const part = props.part;
        if (part?.type === 'tool') {
          const id = part.callID || part.id;
          let changed = false;
          if (['completed', 'error'].includes(part.state?.status)) {
            if (!finalizedTools.has(id) && part.state.status === 'completed') completedTools++;
            changed = !finalizedTools.has(id) || pendingTools.has(id);
            finalizedTools.add(id); if (finalizedTools.size > 4096) finalizedTools.delete(finalizedTools.values().next().value); pendingTools.delete(id);
          } else if (!finalizedTools.has(id)) {
            const next = { name: part.tool, status: part.state?.status ?? 'pending' }, previous = pendingTools.get(id);
            changed = previous?.name !== next.name || previous?.status !== next.status;
            pendingTools.set(id, next);
          }
          if (changed) checkpoint('running');
        }
        // session.error is terminal in the official runtime; it need not be followed by idle.
        if (event.type === 'session.error') {
          if (!(reportStopped && /^(?:MessageAbortedError|AbortError)$/.test(props.error?.name ?? ''))) {
            try { decodeReply({ info: { error: props.error ?? { name: 'OpenCodeSessionError', data: { message: 'OpenCode session failed.' } } } }, model); }
            catch (error) {
              if (readOnly) throw error;
              roundError = error; promptObserved = true; completePrompt();
            }
          }
        }

        if (promptSent && promptObserved && (event.type === 'session.idle' || event.type === 'session.status' && props.status?.type === 'idle')) completePrompt();
      };
      async function reconcile() {
        const messages = await api(`/session/${sessionID}/message?limit=128`, { signal: eventSignal });
        if (!Array.isArray(messages)) return { messages: [], idle: false };
        for (const message of messages) {
          await handleEvent({ type: 'message.updated', properties: { info: message.info } });
          for (const part of message.parts ?? []) await handleEvent({ type: 'message.part.updated', properties: { part } });
        }
        for (const [endpoint, type] of [['/permission', 'permission.asked'], ['/question', 'question.asked']]) {
          let requests;
          try { requests = await api(endpoint, { signal: eventSignal }); }
          catch (error) { if (/HTTP 404/.test(error.message)) continue; throw error; }
          if (Array.isArray(requests)) for (const request of requests) if (request.sessionID === sessionID) await handleEvent({ type, properties: request });
        }
        const statuses = await api('/session/status', { signal: eventSignal });
        const idle = !statuses?.[sessionID] || statuses[sessionID].type === 'idle';
        const last = messages.findLast(message => message.info?.role === 'assistant');
        // Only a completed assistant message after the most recent user message
        // is completion evidence. Missing SSE alone must not finish a prompt.
        const user = pendingPrompt?.messageID
          ? messages.find(message => message.info?.id === pendingPrompt.messageID)
          : messages.findLast(message => message.info?.role === 'user');
        if (promptSent && idle && last?.info?.time?.completed && (!user || last.info.parentID === user.info.id)
          && (last.info.finish !== 'tool-calls' || last.info.error)) { promptObserved = true; completePrompt(); }
        return { messages, idle, last };
      }
      async function reconcileUntilConnected() {
        for (let attempt = 1; ; attempt++) {
          try { return await reconcile(); }
          catch (error) {
            if (readOnly || eventSignal.aborted || !transientFailure(error)) throw error;
            const delayMs = providerRetryDelay(error, attempt);
            onRecovery?.(`Rechecking the retained session after a connection failure in ${Math.round(delayMs / 1000)}s. No execution prompt is being replayed.`);
            await abortableDelay(delayMs, eventSignal);
          }
        }
      }
      const failEvents = error => { if (!eventSignal.aborted) { eventFailure = error; eventController.abort(); onFailure?.(error); } };
      eventTask = (async () => {
        let current = stream, attempt = 0;
        while (!eventSignal.aborted) {
          try { await consumeEvents(current, sessionID, handleEvent, eventSignal); }
          catch (error) {
            if (eventSignal.aborted) break;
            if (readOnly || !transientFailure(error)) throw error;
            const delayMs = providerRetryDelay(error, ++attempt);
            onRecovery?.(`OpenCode connection interrupted; reconnecting the retained session in ${Math.round(delayMs / 1000)}s. Completed actions will not be restarted.`);
            await abortableDelay(delayMs, eventSignal);
            // GET failures during reconciliation retry the connection, not a POST.
            for (;;) {
              try {
                // Subscribe before reading history: subscribing afterward leaves
                // a gap where a message's role event can be permanently missed.
                current = await events(eventSignal, location); await reconcile(); break;
              } catch (next) {
                await current?.body?.cancel().catch(() => {});
                if (eventSignal.aborted || !transientFailure(next)) throw next;
                await abortableDelay(providerRetryDelay(next, ++attempt), eventSignal);
              }
            }
          }
        }
      })().catch(failEvents);
      const poll = async () => {
        if (eventSignal.aborted) return;
        try {
          if (promptSent) {
            const statuses = await api('/session/status', { signal: eventSignal });
            if (!statuses?.[sessionID] || statuses[sessionID].type === 'idle') await reconcile();
          }
        }
        catch (error) { if (!eventSignal.aborted && !transientFailure(error)) failEvents(error); }
        if (!eventSignal.aborted) pollTimer = setTimeout(poll, 30000);
      };
      if (supportsAsyncPrompts && !readOnly) pollTimer = setTimeout(poll, 30000);
      // Keep the official built-in agent and its real tools. Orvix is the client and approval UI.
      const body = {
        messageID: newMessageID(),
        model: { providerID: 'opencode', modelID: modelId.slice('opencode/'.length) }, agent: conversation ? 'orvix_conversation' : readOnly&&analysis?'orvix_review':'build', ...(variant ? { variant } : {}),
        parts,
        ...(systemPrompt ? { system: systemPrompt } : {}),
      };
      if (continuity && onCompactionContext) body.parts = [...parts, { type: 'text', text: 'Latest authoritative task instructions and steering before continuation:\n' + onCompactionContext() }];
      await onRequest?.(promptTrace(taskId, sessionID, body, readOnly ? 'review' : 'builder', worker.status?.().buildTemperature ?? null, model.supportsTemperature ?? null));
      timing('prompt_submitting');
      preparation?.dispose(); deadline.start();
      const watchFailure = new Promise((_, reject) => {
        if (eventFailure) reject(eventFailure);
        else eventController.signal.addEventListener('abort', () => { if (eventFailure) reject(eventFailure); }, { once: true });
      });
      let data;
      if (supportsAsyncPrompts) {
        // A short acknowledged submission avoids a long HTTP response-header wait.
        // Completion is session-scoped SSE; retrieve the authoritative reply once idle.
        let submit = !resumeSession;
        if (resumeSession) {
          promptSent = true;
          const recorded = await reconcileUntilConnected();
          if (recorded.idle) {
            if (pendingTools.size) throw new Error('A retained native tool has an unknown outcome. Reconnection preserved its history; inspect the interrupted operation before authorizing more work.');
            if (recorded.last?.info?.error) {
              if (recorded.last.info.error.name === 'MessageAbortedError') submit = true;
              else try { decodeReply(recorded.last, model); } catch (error) {
                if (recorded.last.info.agent === 'compaction') throw error;
                // Only this explicit retained-task resume may retry a previously
                // terminal access/quota failure, after the user addresses it.
                // The automatic recovery loop below still never retries it.
                if (!transientFailure(error) && !['authentication','access','quota'].includes(details(error).kind)) throw error;
                submit = true;
              }
            } else submit = !recorded.last?.info?.time?.completed || recorded.last.info.finish === 'tool-calls';
          }
          if (submit) { resetRound(); body.parts = [{ type: 'text', text: 'Resume the authorized task from this retained session. Reconcile current files and recorded tool outcomes first. Do not repeat completed edits/commands or infer success for an interrupted operation. Continue only remaining work under the latest user instructions.\n\nCurrent Orvix context:\n' + parts.filter(part => part.type === 'text').map(part => part.text).join('\n') }]; }
        }
        let retry = 0;
        for (;;) {
          try {
            promptSent = true;
            if (submit && !reportStopped) {
              pendingPrompt = { messageID: body.messageID, kind: resumeSession || retry ? 'recovery' : 'builder' }; checkpoint('submitting');
              try { await Promise.race([api(`/session/${sessionID}/prompt_async`, { method: 'POST', timeoutMs: 15000, signal: requestSignal, body }), watchFailure]); }
              catch (error) {
                if (readOnly || !transientFailure(error)) throw error;
                // A timed-out POST may already have been accepted. Reconcile by
                // its durable message ID instead of blindly posting it again.
                await abortableDelay(providerRetryDelay(error, ++retry), requestSignal);
                const recorded = await reconcileUntilConnected();
                if (!recorded.messages.some(message => message.info?.id === body.messageID)) throw new Error('OpenCode prompt submission outcome is unknown. The retained session must be inspected before another prompt; no original task was replayed.');
              }
              checkpoint('submitted');
            }
            await abortable(Promise.race([promptComplete, watchFailure]), requestSignal);
            if (roundError) throw roundError;
            const messages = await api(`/session/${sessionID}/message${latestAssistant ? '/' + latestAssistant.id : '?limit=128'}`, { signal: requestSignal, timeoutMs: 30000 });
            data = Array.isArray(messages) ? messages.findLast(message => message.info?.role === 'assistant') : messages;
            if (!reportStopped) {
              const decoded = decodeReply(data, model);
              const feedback = !readOnly && declinedPermissions && completedTools === lastDenialAt ? permissionRecovery?.() : null;
              if ((!decoded.text?.trim() || feedback?.continue === true) && feedback?.recoverable && recoveredDenials.size < 2 && !recoveredDenials.has(feedback.reason)) {
                recoveredDenials.add(feedback.reason);
                onRecovery?.('A tool action was blocked; continuing with the permitted scoped tools. Completed actions are retained.');
                resetRound(); submit = true; body.messageID = newMessageID();
                body.parts = [{ type: 'text', text: `The previous action did not execute: ${feedback.reason}\n${feedback.guidance ?? 'Use an allowed alternative within the current request and permissions, such as native read/glob/grep for diagnosis or exact file edits for a scoped repair. Do not retry the rejected command or broaden workspace permissions. Retain completed actions and report only observed results.'}` }];
                continue;
              }
            }
            break;
          } catch (error) {
            if (readOnly || reportStopped || requestSignal.aborted || !transientFailure(error)) throw error;
            const delayMs = providerRetryDelay(error, ++retry);
            onRecovery?.(`Temporary provider failure; waiting ${Math.round(delayMs / 1000)}s before continuing the retained task (attempt ${retry}). Stop remains available.`);
            checkpoint('waiting'); await abortableDelay(delayMs, requestSignal);
            const recorded = await reconcileUntilConnected();
            if (recorded.idle && recorded.last?.info?.time?.completed && !recorded.last.info.error
              && recorded.last.info.finish !== 'tool-calls' && recorded.last.info.parentID === pendingPrompt?.messageID) {
              data = recorded.last; break;
            }
            // Do not inject another generation while a tool or model is active.
            resetRound(); submit = recorded.idle;
            if (submit && pendingTools.size) throw new Error('An interrupted native tool has an unknown outcome. Its session and checkpoint were retained; inspect its effects before authorizing further work.');
            body.messageID = newMessageID();
            body.parts = [{ type: 'text', text: 'Continue the same authorized task from recorded session history after a temporary provider failure. Reuse completed actions and evidence. Do not repeat mutations. Inspect current files for uncertain effects, preserve the latest steering and access restrictions, and finish only remaining work.' }];
          }
        }
        if (!data && !reportStopped) throw new Error('OpenCode ended without a recorded assistant response. Review its tool activity before retrying.');
      } else {
        // Compatibility for supplied runtime adapters implementing the synchronous API.
        data = await Promise.race([api(`/session/${sessionID}/message`, { method: 'POST', timeoutMs: timeoutMs ?? 900000, signal: requestSignal, body }), watchFailure]);
      }
      requestSignal.throwIfAborted();
      const stoppedData = reportStopped && /^(?:MessageAbortedError|AbortError)$/.test(data?.info?.error?.name ?? '')
        ? { ...data, info: { ...data.info, error: undefined } } : data;
      const reply = decodeReply(stoppedData, model);
      if (reply.text || reply.parts.some(part => part.type === 'tool')) recordPreparation();
      if (reportStopped) {
        reply.text = 'Stopped for a report of recorded actions.';
        reply.stoppedReason = 'report_only';
      }
      if (readOnly && (declinedPermissions || reply.parts.some(part => part.type === 'tool'))) throw new Error('Independent reviewer attempted an execution tool; its action was blocked.');
      recordUsage(data?.info);
      if (usageByMessage.size) reply.usage = { ...usageTotal };
      if (!reply.text?.trim() && declinedPermissions) {
        reply.text = 'The requested action was declined or blocked. OpenCode stopped without a final model reply. Review the recorded tool activity before continuing.';
        reply.stoppedReason = 'permission_declined';
      }
      if (!reply.text?.trim()) throw new Error(`${model.name} returned no final text. Review its tool activity before retrying.`);
      checkpoint(reportStopped ? 'stopped' : 'completed');
      return { ...reply, modelId, route: 'opencode-headless' };
    } catch (error) {
      failed = true;
      const failure = eventFailure || error;
      // Compaction can be denied by Zen even when the builder is accepted.
      // Confirm the failed agent from authoritative history, never from the
      // generic 403 text alone. Never roll over an uncertain tool operation.
      if (!readOnly && !reportStopped && !requestSignal.aborted && sessionID && details(failure).kind === 'access') {
        try {
          const messages = await api(`/session/${sessionID}/message?limit=128`, { signal: requestSignal, timeoutMs: 15000 });
          const text = Array.isArray(messages) ? compactionCheckpoint(messages, failure, Object.fromEntries(pendingTools)) : null;
          if (text) failure.nativeContinuation = { text, sourceSessionID: sessionID, directory: location,
            completedTools, usage: { ...usageTotal } };
        } catch { /* Unconfirmed history cannot authorize another execution. */ }
      }
      checkpoint(signal?.aborted ? 'stopped' : 'failed', eventFailure || error);
      if ((eventFailure || error).providerFailure || error.modelUnavailable) markOpenCodeModelUnavailable(modelId, eventFailure || error);
      if (sessionID) await api(`/session/${sessionID}/abort`, { method: 'POST', timeoutMs: 5000 }).catch(() => {});
      if (eventFailure) { if (!failure.nativeContinuation) onFailure?.(failure); throw eventFailure; }
      if (preparation?.signal.aborted) throw new Error('OpenCode preparation timed out before submitting a model prompt. No task actions were submitted.');
      if (timeout.aborted) throw new Error(deadline.reason()==='inactive'
        ? 'OpenCode response stalled: no new assistant content arrived before the inactivity deadline. Review its completed actions before retrying.'
        : 'OpenCode task timed out. Review its completed actions before retrying.');
      if (signal?.aborted) throw new Error('Task cancelled.');
      if (!failure.nativeContinuation) onFailure?.(failure);
      throw error;
    } finally {
      clearTimeout(pollTimer); eventController.abort(); if (eventTask) await eventTask;
      let cleanupError;
      // Builder history stays in its own task worker for safe reconnection. The
      // existing task-forget operation removes that worker's private records.
      if (sessionID && readOnly) await api(`/session/${sessionID}`, { method: 'DELETE', timeoutMs: 5000 }).catch(error => { cleanupError = error; });
      if (visualBridge) {
        await api('/mcp/orvix_visual/disconnect', { method: 'POST', timeoutMs: 5000 }).catch(() => {});
        await visualBridge.close();
      }
      if (cleanupError && !failed) throw new Error(`OpenCode completed its request but temporary session cleanup failed. Review recorded actions before retrying. ${cleanupError.message}`);
    }
  });
  for (let attempt = 0; ; attempt++) {
    try { return await execute(); }
    catch (error) {
      if (entered || readOnly || requestSignal.aborted || !transientFailure(error)) throw error;
      const delayMs = providerRetryDelay(error, attempt + 1);
      onRecovery?.(`OpenCode worker is temporarily unavailable; retrying its connection in ${Math.round(delayMs / 1000)}s. No task actions have been submitted.`);
      await abortableDelay(delayMs, requestSignal);
    }
  }
  } catch (error) {
    if (preparation?.signal.aborted && !signal?.aborted) throw new Error('OpenCode preparation timed out before submitting a model prompt. No task actions were submitted.');
    throw error;
  } finally { preparation?.dispose(); deadline.dispose(); }
}
async function runOpenCodeSession(options) {
  let current = options, recovered = false;
  const started = Date.now();
  for (;;) {
    try {
      return await runOpenCodeAttempt(current);
    } catch (error) {
      const next = error.nativeContinuation;
      if (!next || options.signal?.aborted) throw error;
      // Repeated rejection without new completed work is not progress.
      if (recovered && !next.completedTools) { options.onFailure?.(error); throw error; }
      const remaining = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs - (Date.now() - started) : options.timeoutMs;
      if (Number.isFinite(remaining) && remaining <= 0) { options.onFailure?.(error); throw error; }
      const continuity = { sourceSessionID: next.sourceSessionID, reason: 'native_compaction_access_rejected', kind: 'local_checkpoint' };
      await options.onEvent?.({ type: 'orvix.compaction.recovered', properties: continuity });
      options.onRecovery?.('OpenCode rejected its conversation summary. Continuing the same task from a local checkpoint in a fresh native session; completed files and recorded actions are retained.');
      current = { ...options, resumeSession: undefined, directory: next.directory, timeoutMs: remaining, continuity, carriedUsage: next.usage,
        parts: [...options.parts, { type: 'text', text: 'Continue only the remaining authorized work. Do not restart the task.\n'
          + 'Source native session: ' + next.sourceSessionID + '\n' + next.text
          + '\n\nCurrent authoritative Orvix context (takes precedence over historical records):\n' + (options.onCompactionContext?.() ?? '') }] };
      recovered = true;
    }
  }
}
async function requestOpenCode(options, instructions) {
  if (options.tools?.length) throw new Error('Zen Free requires the native OpenCode agent route; standalone Orvix model/tool requests are unavailable.');
  const imageParts = [];
  const history = options.history.map(item => !Array.isArray(item.content) ? item : { ...item, content: item.content.filter(part => {
    if (part.type !== 'orvix_image_ref') return true;
    if (!options.readImage) throw new Error('Review image reader is unavailable.');
    imageParts.push({ type: 'file', mime: part.mime, url: `data:${part.mime};base64,${options.readImage(part)}` }); return false;
  }) });
  let streamed = '';
  const reply = await runOpenCodeSession({ taskId: options.sessionId, modelId: options.modelId, variant: options.variant, signal: options.signal, timeoutMs: options.timeoutMs ?? 60000, readOnly: true, analysis:options.analysis===true, conversation: options.purpose === 'conversation',
    onTextDelta: options.analysis ? undefined : delta => { streamed += delta; options.onDelta?.(delta); },
    parts: [{ type: 'text', text: `${instructions}\nConversation:\n${JSON.stringify(history)}` }, ...imageParts], onPermission: async () => false });
  if (reply.text.startsWith(streamed) && reply.text.length > streamed.length) options.onDelta?.(reply.text.slice(streamed.length));
  return { ...reply, calls: [], raw: { content: reply.text }, route: 'chat' };
}
module.exports = { configureOpenCodeModel, requestOpenCode, runOpenCodeSession, decodeReply, consumeEvents };
