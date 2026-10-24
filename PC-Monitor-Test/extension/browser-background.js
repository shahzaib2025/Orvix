// Shared browser engine. Only the two structured tools are exposed to Fast.
const OrvixBrowser = (() => {
  const sessionId = crypto.randomUUID();
  const pageRefs = new Map(), debuggers = new Map(), jobs = new Map();
  const commits = new Map();
  let traceRequestId = '';
  let runningJob = null;
  let revision = 0, queue = Promise.resolve();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const ref = (kind, id) => `${sessionId}:${kind}:${id}`;
  const fail = (status, message, extra = {}) => ({ status, message, ...extra });
  const trace = (stage, details = {}) => typeof youtubeTrace === 'function' && youtubeTrace(stage, { id: traceRequestId, ...details });
  const clearPageRefs = tabId => { for (const [key, value] of pageRefs) if (value.tabId === tabId) pageRefs.delete(key); };
  chrome.webNavigation.onCommitted.addListener(event => {
    if (event.frameId !== 0) return;
    clearPageRefs(event.tabId);
    commits.set(event.tabId, (commits.get(event.tabId) || 0) + 1);
    const url = new URL(event.url); url.search = ''; url.hash = '';
    trace('browser navigation committed', { tabId: event.tabId, url: url.href });
  });
  for (const name of ['onHistoryStateUpdated', 'onReferenceFragmentUpdated']) chrome.webNavigation[name].addListener(event => {
    if (event.frameId === 0) { clearPageRefs(event.tabId); commits.set(event.tabId, (commits.get(event.tabId) || 0) + 1); trace('browser page URL changed', { tabId: event.tabId }); }
  });
  chrome.tabs.onRemoved.addListener(tabId => commits.delete(tabId));
  const pageActions = new Set(['click', 'type', 'key', 'scroll', 'select', 'check', 'drag', 'wait', 'upload', 'media_play', 'media_pause', 'media_seek', 'media_mute', 'media_volume']);
  const permissions = ['tabs', 'scripting', 'debugger', 'webNavigation', 'tabGroups', 'sessions', 'bookmarks', 'history', 'downloads'];
  function guard(job) {
    if (job?.cancelled || job && Date.now() > job.deadline) throw Object.assign(new Error('Browser request cancelled or deadline reached.'), { status: 'cancelled' });
  }
  async function step(job, operation, mutation = false, label) {
    guard(job);
    if (mutation) job.effects = true;
    const result = await operation();
    if (mutation) job.completedEffects.push({ operation: label || job.action });
    guard(job);
    return result;
  }
  async function withObservationDeadline(job, operation, limit = 8000) {
    guard(job);
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
        job.cancelObservation = () => reject(Object.assign(new Error('Browser observation cancelled.'), { status: 'cancelled' }));
        timer = setTimeout(() => {
          job.cancelled = true;
          reject(Object.assign(new Error('Browser observation channel did not respond within its deadline.'), { status: 'timeout' }));
        }, Math.max(1, Math.min(limit, job.deadline - Date.now())));
      })]);
    } finally { clearTimeout(timer); delete job.cancelObservation; }
  }
  async function capabilities() {
    const granted = await chrome.permissions.getAll();
    return { actions: ['tabs', 'navigation', 'windows', 'groups', 'page', 'media', 'youtube', 'bookmarks', 'history', 'downloads', 'uploads'],
      missingPermissions: permissions.filter(p => !granted.permissions.includes(p)),
      websiteAccess: granted.origins?.includes('http://*/*') && granted.origins?.includes('https://*/*'),
      screenshot: granted.permissions.includes('debugger') };
  }
  async function inventory() {
    const windows = (await chrome.windows.getAll({ populate: true, windowTypes: ['normal', 'popup'] })).filter(w => !w.incognito);
    let groups = [];
    try { groups = await chrome.tabGroups.query({}); } catch { /* Capability status identifies missing permissions. */ }
    const tabs = windows.flatMap(w => (w.tabs || []).filter(t => !t.incognito).map(t => ({ ref: ref('tab', t.id), id: t.id, windowId: w.id,
      windowRef: ref('window', w.id), title: t.title || '', url: t.url || '', index: t.index, active: !!t.active, audible: !!t.audible,
      muted: !!t.mutedInfo?.muted, pinned: !!t.pinned, discarded: !!t.discarded, frozen: !!t.frozen, pendingUrl: t.pendingUrl || '', lastAccessed: t.lastAccessed || 0, status: t.status, groupRef: t.groupId >= 0 ? ref('group', t.groupId) : null })));
    return { sessionId, revision: ++revision, timestamp: Date.now(), windows: windows.map(w => ({ ref: ref('window', w.id), id: w.id, focused: !!w.focused, state: w.state, width: w.width, height: w.height, left: w.left, top: w.top })), tabs,
      groups: groups.filter(g => windows.some(w => w.id === g.windowId)).map(g => ({ ...g, ref: ref('group', g.id) })) };
  }
  async function publish() {
    if (typeof youtubeReady === 'undefined' || !youtubeReady || !youtubeSocket) return;
    try { youtubeSocket.send(JSON.stringify({ type: 'inventory', sessionId, observation: boundedObservation(await inventory(), 100) })); } catch { /* Reconnect refreshes inventory. */ }
  }
  let publishTimer;
  const scheduleInventory = () => { clearTimeout(publishTimer); publishTimer=setTimeout(()=>void publish(),100); };
  for(const name of ['onCreated','onRemoved','onActivated','onUpdated','onReplaced','onMoved'])chrome.tabs[name]?.addListener(scheduleInventory);
  for(const name of ['onCreated','onRemoved','onFocusChanged','onBoundsChanged'])chrome.windows[name]?.addListener(scheduleInventory);
  for(const name of ['onCommitted','onHistoryStateUpdated','onReferenceFragmentUpdated'])chrome.webNavigation[name]?.addListener(scheduleInventory);
  function boundedObservation(observation, tabLimit = 100) {
    if (!observation) return observation;
    if (observation.tabs) {
      observation.totalTabs ??= observation.tabs.length;
      if (observation.tabs.length > tabLimit) { observation.tabs = observation.tabs.slice(0, tabLimit); observation.cursor ??= String(tabLimit); observation.truncated = true; }
      observation.tabs = observation.tabs.map(tab => ({ ...tab, title: tab.title?.slice(0, 512), url: tab.url?.slice(0, 2048), ...(tab.title?.length > 512 || tab.url?.length > 2048 ? { textTruncated: true } : {}) }));
    }
    return observation;
  }
  function boundedResult(result) {
    boundedObservation(result.observation);
    let bytes = () => new TextEncoder().encode(JSON.stringify(result)).byteLength;
    for (const field of ['elements', 'items', 'options']) {
      const owner = field === 'options' ? result : result.observation;
      while (bytes() > 950000 && owner?.[field]?.length > 1) { owner[field] = owner[field].slice(0, Math.ceil(owner[field].length / 2)); if (result.observation) result.observation.truncated = true; }
    }
    if (bytes() > 950000) return { requestId: result.requestId, status: 'partial', completedEffects: result.completedEffects, completionUnknown: !!result.verification?.verified,
      error: { code: 'observation_too_large', message: 'Observation exceeds the bounded response size. Inspect a narrower target or filter before continuing.' } };
    return result;
  }
  function parse(value, kind) {
    if (typeof value !== 'string' || !value.includes(':')) return null;
    const parts = value.split(':');
    if (!['tab', 'window', 'group', 'bookmark', 'download', 'history', 'session', 'element'].includes(parts[1])) return null;
    if (parts[0] !== sessionId || parts[1] !== kind) throw Object.assign(new Error('The target belongs to another browser session or target type.'), { status: 'stale_target' });
    return parts.slice(2).join(':');
  }
  async function resolve(target = 'current', kind = 'tab', job) {
    const relativeNames = { active: 'current', 'active tab': 'current', 'current tab': 'current', 'current window': 'current', 'next tab': 'next', 'previous tab': 'previous' };
    if (Object.hasOwn(relativeNames, target)) target = relativeNames[target];
    const state = await step(job, inventory);
    const collection = kind === 'tab' ? state.tabs : kind === 'window' ? state.windows : state.groups;
    const id = parse(target, kind);
    if (id !== null) {
      const found = collection.find(item => String(item.id) === id);
      if (!found) throw Object.assign(new Error('The browser target was closed or changed.'), { status: 'stale_target', observation: state });
      trace('browser target resolved', { tabId: found.id, message: kind });
      return found;
    }
    const lastWindow = state.windows.find(w => w.focused) || state.windows.find(w => w.id === (chrome.windows.WINDOW_ID_CURRENT));
    let currentWindow = lastWindow;
    if (!currentWindow) { const last = await chrome.windows.getLastFocused(); currentWindow = state.windows.find(w => w.id === last.id); }
    if (['current', 'next', 'previous'].includes(target)) {
      if (kind === 'window' && currentWindow) return currentWindow;
      const tabs = state.tabs.filter(t => t.windowId === currentWindow?.id).sort((a, b) => a.index - b.index);
      const active = tabs.findIndex(t => t.active);
      if (kind === 'tab' && active >= 0) return tabs[(active + (target === 'next' ? 1 : target === 'previous' ? -1 : 0) + tabs.length) % tabs.length];
    }
    const numbered = /^(?:tab\s*)?(\d+)$/i.exec(target);
    if (kind === 'tab' && numbered) {
      const found = state.tabs.find(t => t.windowId === currentWindow?.id && t.index === Number(numbered[1]) - 1);
      if (found) return found;
    }
    const text = target.toLowerCase().trim();
    const exact = collection.filter(item => item.title?.toLowerCase() === text || item.url?.toLowerCase() === text);
    const candidates = exact.length ? exact : collection.filter(item => item.title?.toLowerCase().includes(text) || item.url?.toLowerCase().includes(text));
    if (candidates.length === 1) { trace('browser target resolved', { tabId: candidates[0].id, message: kind }); return candidates[0]; }
    throw Object.assign(new Error(candidates.length ? 'More than one browser target matches. Choose an exact ref.' : 'No browser target matches.'),
      { status: candidates.length ? 'needs_selection' : 'not_found', options: candidates.map((item, i) => ({ number: i + 1, ...item })) });
  }
  function webUrl(value) {
    let url;
    try { url = new URL(value); } catch { throw new Error('Provide a complete http:// or https:// URL.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only normal HTTP/HTTPS URLs without embedded credentials are supported.');
    return url.href;
  }
  function normalPage(tab) { if (!/^https?:\/\//.test(tab.url)) throw Object.assign(new Error('Page interaction is limited to normal HTTP/HTTPS websites.'), { status: 'unsupported' }); }
  function paginate(items, cursor, query = '') {
    const offset = cursor ? Number(cursor) : 0;
    if (!Number.isInteger(offset) || offset < 0) throw new Error('Invalid pagination cursor.');
    const filtered = items.filter(item => !query || `${item.title || ''} ${item.url || ''} ${item.filename || ''}`.toLowerCase().includes(query.toLowerCase()));
    return { items: filtered.slice(offset, offset + 100), total: filtered.length, cursor: offset + 100 < filtered.length ? String(offset + 100) : null };
  }
  async function pageCall(tabId, operation, args, frame, job) {
    const target = frame?.documentId ? { tabId, documentIds: [frame.documentId] } : frame ? { tabId, frameIds: [frame.frameId] } : { tabId, allFrames: true };
    await step(job, () => chrome.scripting.executeScript({ target, files: ['browser-page.js'] }));
    return step(job, () => chrome.scripting.executeScript({ target, func: (operation, args) => globalThis.__orvixBrowserPage[operation](args), args: [operation, args] }));
  }
  async function observePage(tab, input, job) {
    normalPage(tab);
    let frames;
    try { frames = await pageCall(tab.id, 'observe', { query: input.query || '', offset: Number(input.cursor || 0) }, null, job); }
    catch (error) { throw Object.assign(error, { status: /permission|access/i.test(error.message) ? 'permission_denied' : 'unavailable' }); }
    const observation = { sessionId, timestamp: Date.now(), revision: ++revision, tabRef: tab.ref, url: tab.url, frames: [], elements: [], text: '' };
    for (const frame of frames) {
      if (!frame.result) continue;
      const page = frame.result;
      observation.frames.push({ frameId: frame.frameId, documentId: frame.documentId, documentKey: page.documentKey, url: page.url, title: page.title, readyState: page.readyState, nextOffset: page.nextOffset });
      observation.text += `\n[Frame ${frame.frameId}] ${page.text}`;
      for (const el of page.elements) {
        const external = ref('element', `${tab.id}:${frame.frameId}:${el.ref}`);
        pageRefs.set(external, { tabId: tab.id, frameId: frame.frameId, documentId: frame.documentId, localRef: el.ref });
        observation.elements.push({ ...el, ref: external, frameId: frame.frameId });
      }
    }
    observation.text = observation.text.slice(0, 24000);
    observation.elements = observation.elements.slice(0, 200);
    observation.cursor = frames.some(f => f.result?.nextOffset !== null && f.result?.nextOffset !== undefined) ? String(Number(input.cursor || 0) + 100) : null;
    while (pageRefs.size > 5000) pageRefs.delete(pageRefs.keys().next().value);
    if (input.screenshot) observation.screenshot = await screenshot(tab.id, job);
    return observation;
  }
  async function observe(input, job) {
    guard(job);
    if (input.screenshot && !['browser', 'page'].includes(input.scope)) throw Object.assign(new Error('Screenshots require a browser or page scope and a normal website target.'), { status: 'unsupported' });
    if (input.scope === 'browser') {
      const state = await inventory();
      const target = input.target ? await resolve(input.target, input.target.includes(':window:') ? 'window' : 'tab', job) : null;
      const tabs = target ? state.tabs.filter(t => target.ref.includes(':window:') ? t.windowId === target.id : t.id === target.id) : state.tabs;
      const paged = paginate(tabs, input.cursor, input.query);
      const observation = { ...state, tabs: paged.items, totalTabs: paged.total, cursor: paged.cursor };
      if (input.screenshot) { const tab = target?.ref.includes(':tab:') ? target : await resolve(tabs.find(t => t.active)?.ref || 'current', 'tab', job); normalPage(tab); observation.screenshot = await screenshot(tab.id, job); }
      return { status: 'ok', resolvedTarget: target, observation, connection: await capabilities() };
    }
    if (input.scope === 'page') {
      const tab = await resolve(input.target, 'tab', job);
      return { status: 'ok', resolvedTarget: tab, observation: await observePage(tab, input, job) };
    }
    let items;
    if (input.scope === 'bookmarks') {
      const all = await chrome.bookmarks.getTree();
      items = []; const visit = nodes => nodes.forEach(node => { items.push({ id: node.id, ref: ref('bookmark', node.id), title: node.title, url: node.url, parentRef: node.parentId ? ref('bookmark', node.parentId) : null }); if (node.children) visit(node.children); }); visit(all);
    } else if (input.scope === 'history') items = (await chrome.history.search({ text: input.query || '', maxResults: 1000, startTime: 0 })).map(item => ({ ...item, ref: ref('history', item.id) }));
    else if (input.scope === 'downloads') items = (await chrome.downloads.search({ limit: 1000, orderBy: ['-startTime'] })).map(item => ({ id: item.id, ref: ref('download', item.id), url: item.url, filename: item.filename, state: item.state, startTime: item.startTime, paused: item.paused, canResume: item.canResume, bytesReceived: item.bytesReceived, totalBytes: item.totalBytes }));
    else if (input.scope === 'sessions') items = (await chrome.sessions.getRecentlyClosed({ maxResults: 25 })).map(item => ({ ref: ref('session', item.tab?.sessionId || item.window?.sessionId), title: item.tab?.title, url: item.tab?.url, window: !!item.window, lastModified: item.lastModified }));
    else throw new Error('Unsupported observation scope.');
    return { status: 'ok', observation: { scope: input.scope, timestamp: Date.now(), sessionId, ...paginate(items, input.cursor, input.query) } };
  }
  chrome.debugger.onEvent.addListener((source, method, params) => {
    const state = debuggers.get(source.tabId);
    if (!state) return;
    const target = source.sessionId ? { tabId: source.tabId, sessionId: source.sessionId } : { tabId: source.tabId };
    if (method === 'Input.dragIntercepted') state.dragData = params.data;
    if (method === 'Runtime.executionContextCreated' && params.context.auxData?.isDefault) state.contexts.set(`${source.sessionId || ''}:${params.context.id}`, { target, contextId: params.context.id });
    if (method === 'Runtime.executionContextsCleared') for (const [key, context] of state.contexts) if (context.target.sessionId === source.sessionId) state.contexts.delete(key);
    if (method === 'Runtime.executionContextDestroyed') state.contexts.delete(`${source.sessionId || ''}:${params.executionContextId}`);
    if (method === 'Target.attachedToTarget' && params.targetInfo.type === 'iframe') {
      const child = { tabId: source.tabId, sessionId: params.sessionId };
      state.children.set(params.sessionId, { frameId: params.targetInfo.targetId, parent: target });
      chrome.debugger.sendCommand(child, 'Runtime.enable').catch(() => {});
      chrome.debugger.sendCommand(child, 'Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true, filter: [{ type: 'iframe', exclude: false }] }).catch(() => {});
    }
  });
  chrome.debugger.onDetach.addListener(source => { clearTimeout(debuggers.get(source.tabId)?.timer); debuggers.delete(source.tabId); });
  async function attach(tabId, job) {
    let state = debuggers.get(tabId);
    if (state) {
      const targets = await step(job, () => chrome.debugger.getTargets());
      if (!targets.some(target => target.tabId === tabId && target.attached)) { clearTimeout(state.timer); debuggers.delete(tabId); state = null; }
    }
    if (!state) {
      state = { contexts: new Map(), children: new Map(), timer: null }; debuggers.set(tabId, state);
      try {
        await step(job, () => chrome.debugger.attach({ tabId }, '1.3'));
        await step(job, () => chrome.debugger.sendCommand({ tabId }, 'Runtime.enable'));
        await step(job, () => chrome.debugger.sendCommand({ tabId }, 'Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true, filter: [{ type: 'iframe', exclude: false }] }));
      } catch (error) { debuggers.delete(tabId); throw Object.assign(error, { status: 'debugger_unavailable' }); }
    }
    clearTimeout(state.timer);
    state.timer = setTimeout(() => { chrome.debugger.detach({ tabId }).catch(() => {}); debuggers.delete(tabId); }, 30_000);
    state.timer.unref?.();
    return state;
  }
  async function cdp(tabId, method, args, job, mutation = false) {
    await attach(tabId, job);
    try { return await step(job, () => chrome.debugger.sendCommand({ tabId }, method, args), mutation, method); }
    catch (error) {
      if (mutation || !/not attached/i.test(error.message)) throw error;
      clearTimeout(debuggers.get(tabId)?.timer); debuggers.delete(tabId);
      await attach(tabId, job);
      return step(job, () => chrome.debugger.sendCommand({ tabId }, method, args));
    }
  }
  async function markedObject(tabId, marker, job) {
    const state = await attach(tabId, job);
    // Marker is generated by our page script; no model code is evaluated.
    const expression = `(() => { const find = root => { for (const e of root.querySelectorAll('*')) { if (e.getAttribute('data-orvix-target') === ${JSON.stringify(marker)}) return e; if(e.shadowRoot) {const match=find(e.shadowRoot); if(match) return match;} } return null; }; return find(document); })()`;
    for (let attempt = 0; attempt < 10; attempt++) {
      for (const context of [{ target: { tabId } }, ...state.contexts.values()]) {
        try {
          const result = await step(job, () => chrome.debugger.sendCommand(context.target, 'Runtime.evaluate', { expression, ...(context.contextId ? { contextId: context.contextId } : {}), objectGroup: 'orvix' }));
          if (result.result?.objectId) return { ...context, objectId: result.result.objectId };
        } catch (error) { guard(job); /* Frame contexts can disappear during navigation. */ }
      }
      await sleep(50); guard(job);
    }
    throw Object.assign(new Error('The target frame or element changed before input.'), { status: 'stale_target' });
  }
  async function screenshot(tabId, job) {
    const metrics = await cdp(tabId, 'Page.getLayoutMetrics', {}, job);
    const view = metrics.cssVisualViewport || metrics.visualViewport;
    const width = view.clientWidth, height = view.clientHeight;
    for (const [maxWidth, quality] of [[1280, 55], [768, 30]]) {
      const result = await cdp(tabId, 'Page.captureScreenshot', { format: 'jpeg', quality, captureBeyondViewport: false,
        clip: { x: view.pageX, y: view.pageY, width, height, scale: Math.min(1, maxWidth / width, 960 / height) } }, job);
      if (result.data?.length <= 524288) return { mimeType: 'image/jpeg', data: result.data, timestamp: Date.now(), viewport: { width, height, x: view.pageX, y: view.pageY }, scale: Math.min(1, maxWidth / width, 960 / height) };
    }
    throw Object.assign(new Error('Screenshot exceeds the bounded image size.'), { status: 'unsupported' });
  }
  function elementRef(value) {
    parse(value, 'element');
    const found = pageRefs.get(value);
    if (!found) throw Object.assign(new Error('Observe the page to obtain a current element ref.'), { status: 'stale_target' });
    return found;
  }
  async function elementOperation(frame, operation, args, job) {
    let results;
    try { results = await pageCall(frame.tabId, operation, { ...args, ref: frame.localRef }, frame, job); }
    catch (error) { if (/no (document|frame)|removed|not found|does not exist|cannot find/i.test(error.message)) error.status = 'stale_target'; throw error; }
    const result = results[0]?.result;
    if (!result) throw Object.assign(new Error('The target document no longer exists.'), { status: 'stale_target' });
    return result;
  }
  async function prepareElement(frame, action, job, args = {}) {
    const prepared = await elementOperation(frame, 'prepare', { action, scroll: args.scroll !== false }, job);
    if (prepared.status !== 'ok') throw Object.assign(new Error(prepared.message), { status: prepared.status });
    const object = await markedObject(frame.tabId, prepared.marker, job);
    if (action === 'upload') return { ...prepared, object };
    const geometry = await step(job, () => chrome.debugger.sendCommand(object.target, 'DOM.getBoxModel', { objectId: object.objectId }));
    const quad = geometry.model.content;
    if (args.x !== undefined || args.y !== undefined) {
      if (!(Number.isFinite(args.x) && Number.isFinite(args.y) && args.x >= 0 && args.y >= 0 && args.x < prepared.rect.width && args.y < prepared.rect.height)) throw new Error('Visual click offsets must be inside the observed control.');
    }
    let x = quad.reduce((sum, value, i) => sum + (i % 2 === 0 ? value : 0), 0) / 4;
    let y = quad.reduce((sum, value, i) => sum + (i % 2 === 1 ? value : 0), 0) / 4;
    if (args.x !== undefined) { const px = args.x / prepared.rect.width, py = args.y / prepared.rect.height; x = quad[0] + (quad[2] - quad[0]) * px + (quad[6] - quad[0]) * py; y = quad[1] + (quad[3] - quad[1]) * px + (quad[7] - quad[1]) * py; }
    // OOPIF geometry is relative to its debugger session's viewport. Convert it
    // through the embedding frames before dispatching input to the root tab.
    let session = object.target.sessionId;
    while (session) {
      const child = debuggers.get(frame.tabId)?.children.get(session);
      if (!child) throw Object.assign(new Error('The embedding frame changed.'), { status: 'stale_target' });
      const owner = await step(job, () => chrome.debugger.sendCommand(child.parent, 'DOM.getFrameOwner', { frameId: child.frameId }));
      const box = await step(job, () => chrome.debugger.sendCommand(child.parent, 'DOM.getBoxModel', { backendNodeId: owner.backendNodeId }));
      const q = box.model.content;
      const metrics = await step(job, () => chrome.debugger.sendCommand({ tabId: frame.tabId, sessionId: session }, 'Page.getLayoutMetrics'));
      const viewport = metrics.cssLayoutViewport || metrics.layoutViewport;
      const px = x / viewport.clientWidth, py = y / viewport.clientHeight;
      x = q[0] + (q[2] - q[0]) * px + (q[6] - q[0]) * py;
      y = q[1] + (q[3] - q[1]) * px + (q[7] - q[1]) * py;
      session = child.parent.sessionId;
    }
    return { ...prepared, object, x, y };
  }
  async function mouse(tabId, type, point, job) {
    return cdp(tabId, 'Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 }, job, true);
  }
  async function clickElement(frame, action, job, args = {}) {
    const point = await prepareElement(frame, action, job, args);
    // Verify that the intended node receives the hit; do not click through an overlay.
    const check = await step(job, () => chrome.debugger.sendCommand(point.object.target, 'Runtime.callFunctionOn', { objectId: point.object.objectId,
      functionDeclaration: "function(x,y){const r=this.getBoundingClientRect();const root=this.getRootNode();const hit=root.elementFromPoint?.(r.x+(x??r.width/2),r.y+(y??r.height/2))||document.elementFromPoint(r.x+(x??r.width/2),r.y+(y??r.height/2));return hit===this||this.contains(hit);}", arguments: [{ value: args.x ?? null }, { value: args.y ?? null }], returnByValue: true }));
    if (!check.result?.value) throw new Error('The target is covered by another element.');
    await mouse(frame.tabId, 'mousePressed', point, job);
    try { await mouse(frame.tabId, 'mouseReleased', point, job); }
    catch (error) { await chrome.debugger.sendCommand({ tabId: frame.tabId }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left' }).catch(() => {}); throw error; }
    return point;
  }
  async function key(tabId, value, job) {
    const pieces = String(value || '').split('+');
    const name = pieces.pop(); let modifiers = 0;
    for (const mod of pieces) { if (mod === 'Ctrl') modifiers |= 2; else if (mod === 'Shift') modifiers |= 8; else if (mod === 'Alt') modifiers |= 1; else throw new Error('Unsupported key modifier.'); }
    const codes = { Enter: 13, Tab: 9, Escape: 27, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, PageUp: 33, PageDown: 34, Backspace: 8, Delete: 46, Space: 32, A: 65 };
    if (!Object.hasOwn(codes, name)) throw new Error('Unsupported key.');
    await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: name === 'Space' ? ' ' : name, modifiers, windowsVirtualKeyCode: codes[name], ...(name === 'Enter' ? { text: '\r' } : {}) }, job, true);
    try { await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: name === 'Space' ? ' ' : name, modifiers, windowsVirtualKeyCode: codes[name] }, job, true); }
    catch (error) { await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', key: name, modifiers: 0 }).catch(() => {}); throw error; }
  }
  async function expectation(expect, tab, args, job) {
    if (!expect) return false;
    if (expect.kind === 'search_query') {
      const url = new URL((await chrome.tabs.get(tab.id)).url);
      return url.protocol === 'https:' && /(^|\.)google\.[a-z.]+$/.test(url.hostname) && url.pathname === '/search' && url.searchParams.get('q') === expect.value;
    }
    if (expect.kind === 'url') return (await chrome.tabs.get(tab.id)).url === webUrl(expect.value);
    if (expect.kind === 'text') return (await observePage(tab, {}, job)).text.includes(expect.value || '');
    if (expect.kind === 'download') return (await chrome.downloads.search({ url: webUrl(expect.value) })).some(d => d.url === webUrl(expect.value) && d.state === 'complete');
    const frame = elementRef(expect.ref || args.ref);
    const state = await elementOperation(frame, 'operate', { action: 'state' }, job);
    if (state.status !== 'ok') return expect.kind === 'visible' && expect.value === 'false' && state.status === 'stale_target';
    if (expect.kind === 'value') return state.value === expect.value;
    if (expect.kind === 'checked') return String(state.checked) === expect.value;
    if (expect.kind === 'visible') return state.element.visible === (expect.value !== 'false');
    if (expect.kind === 'media_state') return (state.element.media?.paused ? 'paused' : 'playing') === expect.value;
    return false;
  }
  async function pageAction(input, job) {
    const args = input.args || {};
    const frame = args.ref ? elementRef(args.ref) : null;
    const tab = frame ? await resolve(ref('tab', frame.tabId), 'tab', job) : await resolve(input.target, 'tab', job);
    if (input.target && frame && (await resolve(input.target, 'tab', job)).id !== frame.tabId) throw new Error('The element does not belong to the requested tab.');
    normalPage(tab);
    let verified = false, result = {};
    if (input.action === 'wait') {
      if (!input.expect) throw new Error('wait requires an expected condition.');
      const end = Date.now() + Math.min(25000, Math.max(100, args.timeoutMs || 10000));
      while (Date.now() < end) { guard(job); if (await expectation(input.expect, tab, args, job)) { verified = true; break; } await sleep(150); }
    } else if (input.action === 'scroll' && !frame) {
      const values = await pageCall(tab.id, 'operate', { action: 'scroll', x: args.x, y: args.y }, { frameId: 0 }, job);
      verified = values[0]?.result?.verified;
      job.effects = true;
    } else {
      if (!frame) throw Object.assign(new Error('An observed element ref is required for this page action.'), { status: 'stale_target' });
      if (['click', 'type', 'key', 'check', 'drag', 'upload'].includes(input.action)) {
        if (input.action === 'upload') {
          const point = await prepareElement(frame, 'upload', job);
          if (point.type !== 'file') throw new Error('Target an observed file input.');
          await step(job, () => chrome.debugger.sendCommand(point.object.target, 'DOM.setFileInputFiles', { objectId: point.object.objectId, files: args.files }), true);
          const state = await elementOperation(frame, 'operate', { action: 'state' }, job);
          verified = state.fileCount === args.files.length && state.fileNames.every((name, i) => name === args.files[i].split(/[\\/]/).pop());
        } else if (input.action === 'check') {
          if (typeof args.enabled !== 'boolean') throw new Error('check requires enabled true or false.');
          const before = await elementOperation(frame, 'operate', { action: 'state' }, job);
          if (typeof before.checked !== 'boolean') throw new Error('Target an observed checkbox or radio input.');
          if (before.checked !== args.enabled) await clickElement(frame, 'check', job);
          verified = (await elementOperation(frame, 'operate', { action: 'state' }, job)).checked === args.enabled;
        } else if (input.action === 'drag') {
          const destination = elementRef(args.destinationRef);
          if (destination.tabId !== frame.tabId) throw new Error('Drag endpoints must belong to the same tab.');
          await prepareElement(frame, 'drag', job); await prepareElement(destination, 'drag', job);
          const from = await prepareElement(frame, 'drag', job, { scroll: false }), to = await prepareElement(destination, 'drag', job, { scroll: false });
          const metrics = await cdp(tab.id, 'Page.getLayoutMetrics', {}, job), viewport = metrics.cssVisualViewport || metrics.visualViewport;
          if ([from, to].some(point => point.x < 0 || point.y < 0 || point.x >= viewport.clientWidth || point.y >= viewport.clientHeight)) throw Object.assign(new Error('Both drag endpoints must fit in the current viewport.'), { status: 'unsupported' });
          const debuggerState = await attach(tab.id, job); debuggerState.dragData = null;
          await cdp(tab.id, 'Input.setInterceptDrags', { enabled: true }, job);
          try {
            await mouse(tab.id, 'mousePressed', from, job);
            for (let i = 1; i <= 8; i++) await mouse(tab.id, 'mouseMoved', { x: from.x + (to.x - from.x) * i / 8, y: from.y + (to.y - from.y) * i / 8 }, job);
            if (debuggerState.dragData) for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp(tab.id, 'Input.dispatchDragEvent', { type, x: to.x, y: to.y, data: debuggerState.dragData }, job, true);
          } finally {
            await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1 }).catch(() => {});
            await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.setInterceptDrags', { enabled: false }).catch(() => {});
            debuggerState.dragData = null;
          }
        } else {
          if (input.action === 'type') {
            const point = await elementOperation(frame, 'prepare', { action: 'type' }, job);
            if (point.status !== 'ok') throw Object.assign(new Error(point.message), { status: point.status });
            if (typeof args.text !== 'string' || !point.editable) throw new Error('type requires text and an editable target.');
            if (point.type === 'password') throw Object.assign(new Error('Password entry stays with the user; password values are not exposed to the voice model.'), { status: 'unsupported' });
          }
          if (input.action === 'key') {
            const state = await elementOperation(frame, 'operate', { action: 'focus' }, job);
            if (state.status !== 'ok') throw Object.assign(new Error(state.message), { status: state.status });
          } else await clickElement(frame, input.action, job, input.action === 'click' ? args : {});
          if (input.action === 'type') {
            if (args.replace !== false) await key(tab.id, 'Ctrl+A', job);
            await cdp(tab.id, 'Input.insertText', { text: args.text }, job, true);
            const state = await elementOperation(frame, 'operate', { action: 'state' }, job);
            verified = args.replace !== false && state.value === args.text;
          }
          if (input.action === 'key') await key(tab.id, args.key, job);
        }
      } else {
        if (input.action === 'media_volume' && !(args.volume >= 0 && args.volume <= 1)) throw new Error('Media volume must be between 0 and 1.');
        if (input.action === 'media_seek' && !(args.seconds >= 0 && Number.isFinite(args.seconds))) throw new Error('Provide nonnegative media seconds.');
        if (input.action === 'media_mute' && typeof args.enabled !== 'boolean') throw new Error('Supply enabled true or false.');
        result = await step(job, () => elementOperation(frame, 'operate', { ...args, action: input.action }, job), true);
        verified = result.verified === true;
        if (result.status !== 'ok') return { ...result, resolvedTarget: tab };
      }
    }
    if (input.expect && input.action !== 'wait') {
      const until = Date.now() + Math.min(10000, args.timeoutMs || 5000);
      verified = false;
      do { guard(job); if (await expectation(input.expect, tab, args, job)) { verified = true; break; } await sleep(150); } while (Date.now() < until);
    }
    let observation;
    try { observation = await observePage(await resolve(tab.ref, 'tab', job), {}, job); } catch { observation = await inventory(); }
    return { status: verified ? 'ok' : input.action === 'wait' ? 'timeout' : 'dispatched', resolvedTarget: tab, observation,
      verification: { verified: !!verified, evidence: verified ? 'Observed the requested page condition or control state.' : 'Input was dispatched; the intended outcome is not verified.' } };
  }
  async function waitTab(tabId, expectedUrl, job, previousCommit) {
    const until = Math.min(job.deadline, Date.now() + 15000);
    let tab;
    do { tab = await step(job, () => chrome.tabs.get(tabId)); if (tab.status === 'complete' && (previousCommit === undefined || (commits.get(tabId) || 0) > previousCommit) && (!expectedUrl || tab.url === expectedUrl)) return tab; await sleep(100); } while (Date.now() < until);
    return tab;
  }
  async function trustedYoutubePlay(tabId) {
    const job = runningJob;
    guard(job);
    const result = (await pageCall(tabId, 'youtubePlayControl', {}, { frameId: 0 }, job))[0]?.result;
    if (!result || !['ok', 'already_playing'].includes(result.status)) return null;
    if (result.status === 'ok') {
      trace('YouTube autoplay recovery: trusted play click', { tabId });
      const tab = await chrome.tabs.get(tabId);
      if (new URL(tab.url).searchParams.get('v') !== result.videoId) throw Object.assign(new Error('The YouTube video changed before playback.'), { status: 'stale_target' });
      await clickElement({ tabId, frameId: 0, localRef: result.ref }, 'click', job);
    }
    await sleep(500); guard(job);
    const state = await chrome.tabs.sendMessage(tabId, { type: 'youtube-state' });
    return state?.videoFound && state.playbackState === 'playing' ? { ...state, status: 'ok', message: 'Playback verified after a trusted play click.' } : null;
  }
  async function verifyEventually(predicate, job) {
    const end = Math.min(job.deadline, Date.now() + 2000);
    do { guard(job); if (await predicate()) return true; await sleep(50); } while (Date.now() < end);
    return false;
  }
  async function destinationTab(input,url,job) {
    const args=input.args||{},policy=args.tabPolicy||'reuse';
    const windowTarget=args.windowRef||(input.target?.includes(':window:')?input.target:null);
    const windowId=windowTarget?(await resolve(windowTarget,'window',job)).id:undefined;
    const explicit=input.target&&!input.target.includes(':window:');
    if(policy==='new'&&explicit)throw Object.assign(new Error('A new-tab request cannot also target an existing tab.'),{status:'invalid_request'});
    if(explicit)return {tab:await resolve(input.target,'tab',job),tabDisposition:'reused',selectionReason:'explicit_target'};
    const chosen=policy==='reuse'?OrvixTabRouting.choose(await step(job,inventory),url,windowId):null;
    if(chosen)return {tab:chosen.tab,tabDisposition:'reused',selectionReason:chosen.reason};
    const created=await step(job,()=>chrome.tabs.create({url,active:true,...(windowId?{windowId}:{})}),true);
    const loaded=await waitTab(created.id,url,job);
    return {tab:{...loaded,ref:ref('tab',created.id)},tabDisposition:'created',selectionReason:policy==='new'?'explicit_new_tab':'no_matching_tab'};
  }
  async function openDestination(input,job) {
    const args=input.args||{},url=input.action==='search'?`https://www.google.com/search?q=${encodeURIComponent(args.query||'')}`:webUrl(args.url);
    const selected=await destinationTab(input,url,job),tab=selected.tab;
    const win=await chrome.windows.get(tab.windowId);
    await step(job,()=>chrome.windows.update(tab.windowId,{focused:true,...(win.state==='minimized'?{state:'normal'}:{})}),true);
    await step(job,()=>chrome.tabs.update(tab.id,{active:true}),true);
    let previousCommit;
    if(tab.url!==url){previousCommit=commits.get(tab.id)||0;await step(job,()=>chrome.tabs.update(tab.id,{url}),true);}
    const current=await waitTab(tab.id,url,job,previousCommit);
    let verified=current.status==='complete'&&current.url===url;
    if(input.expect)verified=verified&&await verifyEventually(()=>expectation(input.expect,{...current,ref:tab.ref},args,job),job);
    let page;
    if(verified)try{page=await observePage({...current,ref:tab.ref},{},job);}catch(error){page={status:error.status||'unavailable',message:'Page contents are unavailable; tab metadata remains available.'};}
    const observation=await inventory();
    if(page)observation.page=page;
    return {status:verified?'ok':'partial',resolvedTarget:observation.tabs.find(t=>t.id===tab.id),tabDisposition:selected.tabDisposition,selectionReason:selected.selectionReason,observation,verification:{verified,evidence:verified?'Requested destination is ready in the selected tab.':'Destination readiness remains unconfirmed.'}};
  }
  async function act(input, job) {
    const action = input.action, args = input.args || {};
    trace('browser action started', { message: action });
    if (pageActions.has(action)) {
      if (input.target?.includes(':element:')) {
        if (args.ref && args.ref !== input.target) throw Object.assign(new Error('Two different element targets were supplied.'), { status: 'invalid_request' });
        input = { ...input, target: undefined, args: { ...args, ref: input.target } };
      }
      return pageAction(input, job);
    }
    if (action.startsWith('youtube_')) {
      const legacy = { youtube_search: 'search_and_play', youtube_select: 'select_and_play', youtube_pause: 'pause', youtube_resume: 'resume' }[action];
      const chosen=action==='youtube_search'?await destinationTab(input,'https://www.youtube.com/',job):input.target?{tab:await resolve(input.target,'tab',job),tabDisposition:'reused',selectionReason:'explicit_target'}:null;
      if(chosen&&OrvixTabRouting.site(chosen.tab.url)!=='youtube.com')throw Object.assign(new Error('The selected YouTube tab changed site.'),{status:'stale_target'});
      const result = await step(job, () => runYoutubeCommand({ action: legacy, ...args, ...(chosen?{tabId:chosen.tab.id}:{}) }), true);
      const used=result.tabId?(await inventory()).tabs.find(t=>t.id===result.tabId):chosen?.tab;
      return { ...result, ...(chosen?{tabDisposition:chosen.tabDisposition,selectionReason:chosen.selectionReason}:{}), resolvedTarget:used, verification: { verified: result.status === 'ok' && ['playing', 'paused'].includes(result.playbackState), evidence: result.playbackState || result.message }, observation: await inventory() };
    }
    if(['tab_open','navigate','search'].includes(action)&&args.tabPolicy) return openDestination(input,job);
    let target, verified = false, result = {};
    if (action.startsWith('window_')) {
      if (action === 'window_create') {
        const bounds = Object.fromEntries(['width', 'height', 'left', 'top'].filter(key => args[key] !== undefined).map(key => [key, args[key]]));
        if (args.width !== undefined && args.width < 200 || args.height !== undefined && args.height < 100) throw new Error('Supply valid window dimensions.');
        const created = await step(job, () => chrome.windows.create({ ...bounds, ...(args.url ? { url: webUrl(args.url) } : {}), focused: true }), true);
        target = { id: created.id, ref: ref('window', created.id) };
        const current = await chrome.windows.get(created.id); verified = current.focused && Object.entries(bounds).every(([key, value]) => current[key] === value);
      } else {
        target = await resolve(input.target, 'window', job);
        if (action === 'window_close') { await step(job, () => chrome.windows.remove(target.id), true); verified = await verifyEventually(async () => !(await inventory()).windows.some(w => w.id === target.id), job); }
        else {
          const states = { window_minimize: 'minimized', window_maximize: 'maximized', window_restore: 'normal' };
          let update = action === 'window_focus' ? { focused: true, ...(target.state === 'minimized' ? { state: 'normal' } : {}) } : states[action] ? { state: states[action] } : {};
          if (action === 'window_resize') {
            for (const field of ['width', 'height', 'left', 'top']) if (args[field] !== undefined) update[field] = args[field];
            if (!Object.keys(update).length || args.width !== undefined && args.width < 200 || args.height !== undefined && args.height < 100) throw new Error('Supply valid window dimensions or position.');
            update.state = 'normal';
          }
          if (!Object.keys(update).length) throw new Error('Unsupported window action.');
          await step(job, () => chrome.windows.update(target.id, update), true);
          const current = await chrome.windows.get(target.id); verified = Object.entries(update).every(([key, value]) => current[key] === value);
        }
      }
    } else if (action.startsWith('group_')) {
      if (['group_create', 'group_add', 'group_remove'].includes(action)) {
        const tabs = await Promise.all((args.tabRefs?.length ? args.tabRefs : [input.target || 'current']).map(t => resolve(t, 'tab', job)));
        if (tabs.some(t => t.windowId !== tabs[0].windowId)) throw new Error('Group tabs within one window.');
        if (action === 'group_remove') { await step(job, () => chrome.tabs.ungroup(tabs.map(t => t.id)), true); verified = (await inventory()).tabs.filter(t => tabs.some(old => old.id === t.id)).every(t => !t.groupRef); }
        else {
          const group = action === 'group_add' ? await resolve(args.groupRef, 'group', job) : null;
          const id = await step(job, () => chrome.tabs.group({ tabIds: tabs.map(t => t.id), ...(group ? { groupId: group.id } : {}) }), true);
          target = { id, ref: ref('group', id) };
          if (args.title || args.color || args.collapsed !== undefined) await step(job, () => chrome.tabGroups.update(id, { ...(args.title ? { title: args.title } : {}), ...(args.color ? { color: args.color } : {}), ...(args.collapsed !== undefined ? { collapsed: args.collapsed } : {}) }), true);
          const state = await inventory(), current = await chrome.tabGroups.get(id);
          verified = state.tabs.filter(t => tabs.some(old => old.id === t.id)).length === tabs.length && state.tabs.filter(t => tabs.some(old => old.id === t.id)).every(t => t.groupRef === target.ref) &&
            ['title', 'color', 'collapsed'].filter(key => args[key] !== undefined).every(key => current[key] === args[key]);
        }
      } else {
        target = await resolve(input.target, 'group', job);
        if (action === 'group_move') {
          const window = args.windowRef ? await resolve(args.windowRef, 'window', job) : null;
          await step(job, () => chrome.tabGroups.move(target.id, { index: args.index ?? -1, ...(window ? { windowId: window.id } : {}) }), true);
          const current = await chrome.tabGroups.get(target.id), state = await inventory();
          const groupTabs = state.tabs.filter(t => t.groupRef === target.ref), windowTabs = state.tabs.filter(t => t.windowId === current.windowId);
          const expectedIndex = args.index === undefined || args.index === -1 ? windowTabs.length - groupTabs.length : Math.min(args.index, windowTabs.length - groupTabs.length);
          verified = groupTabs.length > 0 && Math.min(...groupTabs.map(t => t.index)) === expectedIndex && (!window || current.windowId === window.id);
        } else if (action === 'group_update') {
          const changes = Object.fromEntries(['title', 'color', 'collapsed'].filter(key => args[key] !== undefined).map(key => [key, args[key]]));
          await step(job, () => chrome.tabGroups.update(target.id, changes), true);
          const current = await chrome.tabGroups.get(target.id); verified = Object.entries(changes).every(([key, value]) => current[key] === value);
        } else throw new Error('Unsupported group action.');
      }
    } else if (action.startsWith('bookmark_')) {
      if (action === 'bookmark_create') {
        const bookmark = await step(job, () => chrome.bookmarks.create({ title: args.title || '', ...(args.url ? { url: webUrl(args.url) } : {}), ...(args.parentRef ? { parentId: parse(args.parentRef, 'bookmark') } : {}) }), true);
        target = { ref: ref('bookmark', bookmark.id), id: bookmark.id }; verified = !!(await chrome.bookmarks.get(bookmark.id))[0];
      } else {
        const id = parse(input.target, 'bookmark'); if (!id) throw new Error('Supply an observed bookmark ref.');
        target = { id, ref: input.target };
        if (action === 'bookmark_delete') { await step(job, () => chrome.bookmarks.remove(id), true); verified = !(await chrome.bookmarks.get(id).catch(() => [])).length; }
        else {
          const changes = { ...(args.title !== undefined ? { title: args.title } : {}), ...(args.url ? { url: webUrl(args.url) } : {}) };
          await step(job, () => chrome.bookmarks.update(id, changes), true);
          const current = (await chrome.bookmarks.get(id))[0]; verified = Object.entries(changes).every(([key, value]) => current[key] === value);
        }
      }
    } else if (action === 'history_delete') {
      const id = parse(input.target, 'history'); if (!id) throw new Error('Supply an observed history ref.');
      const item = (await chrome.history.search({ text: '', startTime: 0, maxResults: 1000 })).find(entry => entry.id === id);
      if (!item) throw Object.assign(new Error('The history entry changed.'), { status: 'stale_target' });
      await step(job, () => chrome.history.deleteUrl({ url: item.url }), true);
      verified = !(await chrome.history.getVisits({ url: item.url })).length;
      target = { ref: input.target, url: item.url };
    } else if (action.startsWith('download_')) {
      let id;
      if (action === 'download_start') id = await step(job, () => chrome.downloads.download({ url: webUrl(args.url), saveAs: false }), true);
      else { const parsed = parse(input.target, 'download'); if (!parsed) throw new Error('Supply an observed download ref.'); id = Number(parsed); }
      if (action === 'download_pause') await step(job, () => chrome.downloads.pause(id), true);
      if (action === 'download_resume') await step(job, () => chrome.downloads.resume(id), true);
      if (action === 'download_cancel') await step(job, () => chrome.downloads.cancel(id), true);
      const item = (await chrome.downloads.search({ id }))[0];
      target = { id, ref: ref('download', id) }; result.download = { state: item?.state, paused: item?.paused };
      verified = action === 'download_pause' ? item?.paused : action === 'download_resume' ? item?.state === 'in_progress' && !item.paused : action === 'download_cancel' ? item?.state === 'interrupted' : ['in_progress', 'complete'].includes(item?.state);
    } else if (action === 'tab_restore') {
      const id = input.target ? parse(input.target, 'session') : null;
      const restored = await step(job, () => chrome.sessions.restore(id || undefined), true);
        target = restored.tab ? { id: restored.tab.id, ref: ref('tab', restored.tab.id) } : { id: restored.window?.id, ref: ref('window', restored.window?.id) };
        verified = await verifyEventually(async () => restored.tab ? !!(await chrome.tabs.get(restored.tab.id).catch(() => null)) : !!(await chrome.windows.get(restored.window.id).catch(() => null)), job);
    } else {
      if (action === 'tab_open') {
        const window = args.windowRef || input.target ? await resolve(args.windowRef || input.target, 'window', job) : null;
        const created = await step(job, () => chrome.tabs.create({ active: true, ...(args.url ? { url: webUrl(args.url) } : {}), ...(window ? { windowId: window.id } : {}) }), true);
        target = { id: created.id, ref: ref('tab', created.id), windowId: created.windowId };
        await step(job, () => chrome.windows.update(created.windowId, { focused: true }), true);
        const tab = await waitTab(created.id, args.url ? webUrl(args.url) : null, job); verified = tab.active && (await chrome.windows.get(tab.windowId)).focused && (!args.url || tab.url === webUrl(args.url));
      } else {
        target = await resolve(input.target, 'tab', job);
        if (action === 'tab_close') { await step(job, () => chrome.tabs.remove(target.id), true); verified = !(await inventory()).tabs.some(t => t.id === target.id); }
        else if (action === 'tab_activate') {
          const window = await chrome.windows.get(target.windowId);
          await step(job, () => chrome.windows.update(target.windowId, { focused: true, ...(window.state === 'minimized' ? { state: 'normal' } : {}) }), true);
          await step(job, () => chrome.tabs.update(target.id, { active: true }), true);
          verified = (await chrome.tabs.get(target.id)).active && (await chrome.windows.get(target.windowId)).focused;
        } else if (action === 'tab_duplicate') { const copied = await step(job, () => chrome.tabs.duplicate(target.id), true); verified = copied.url === target.url; target = { id: copied.id, ref: ref('tab', copied.id) }; }
        else if (action === 'tab_move') {
          const window = args.windowRef ? await resolve(args.windowRef, 'window', job) : null;
          if (!Number.isInteger(args.index) || args.index < -1) throw new Error('Supply tab index (zero-based, or -1 for last).');
          await step(job, () => chrome.tabs.move(target.id, { index: args.index, ...(window ? { windowId: window.id } : {}) }), true);
          const current = await chrome.tabs.get(target.id); const tabs = (await inventory()).tabs.filter(t => t.windowId === current.windowId);
          verified = current.index === (args.index === -1 ? tabs.length - 1 : Math.min(args.index, tabs.length - 1)) && (!window || current.windowId === window.id);
        } else if (action === 'tab_pin' || action === 'tab_mute') {
          if (typeof args.enabled !== 'boolean') throw new Error('Supply enabled true or false.');
          await step(job, () => chrome.tabs.update(target.id, { [action === 'tab_pin' ? 'pinned' : 'muted']: args.enabled }), true);
          const current = await chrome.tabs.get(target.id); verified = (action === 'tab_pin' ? current.pinned : current.mutedInfo?.muted) === args.enabled;
        } else if (['navigate', 'search', 'back', 'forward', 'reload'].includes(action)) {
          let url;
          const previousCommit = commits.get(target.id) || 0;
          const window = await chrome.windows.get(target.windowId);
          await step(job, () => chrome.windows.update(target.windowId, { focused: true, ...(window.state === 'minimized' ? { state: 'normal' } : {}) }), true);
          await step(job, () => chrome.tabs.update(target.id, { active: true }), true);
          if (action === 'navigate' || action === 'search') {
            url = action === 'search' ? `https://www.google.com/search?q=${encodeURIComponent(args.query || '')}` : webUrl(args.url);
            await step(job, () => chrome.tabs.update(target.id, { url }), true);
          } else await step(job, () => chrome.tabs[action === 'back' ? 'goBack' : action === 'forward' ? 'goForward' : 'reload'](target.id), true);
          const current = await waitTab(target.id, url, job, previousCommit); verified = current.status === 'complete' && (commits.get(target.id) || 0) > previousCommit && (!url || current.url === url);
        } else if (action === 'zoom') {
          if (!(args.factor >= .25 && args.factor <= 5)) throw new Error('Zoom factor must be 0.25–5.');
          await step(job, () => chrome.tabs.setZoom(target.id, args.factor), true); verified = Math.abs((await chrome.tabs.getZoom(target.id)) - args.factor) < .01;
        } else throw new Error('Unsupported browser action.');
      }
    }
    if (input.expect) {
      const tab = target?.ref?.includes(':tab:') ? await resolve(target.ref, 'tab', job) : await resolve('current', 'tab', job);
      const expected = await verifyEventually(() => expectation(input.expect, tab, args, job), job);
      verified = verified && expected;
    }
    trace('browser action verified', { message: action, status: verified ? 'ok' : 'partial', tabId: target?.id });
    return { ...result, status: verified ? 'ok' : 'partial', resolvedTarget: target, observation: await inventory(), verification: { verified: !!verified, evidence: verified ? `Observed ${action} result.` : 'The requested final state could not be fully verified.' } };
  }
  function cancel(id) { const job = jobs.get(id); if (job) { job.cancelled = true; job.cancelObservation?.(); } }
  function run(message) {
    const job = { cancelled: false, effects: false, completedEffects: [], action: message.input?.action, started: Date.now(), deadline: Math.min(message.deadline || Date.now() + 30000, Date.now() + 30000) };
    jobs.set(message.id, job);
    const execute = async () => {
      traceRequestId = message.id;
      runningJob = job;
      try { guard(job); return boundedResult({ ...await (message.kind === 'observe' ? withObservationDeadline(job, () => observe(message.input, job)) : message.kind === 'legacy' ? step(job, () => runYoutubeCommand(message.input), true) : act(message.input, job)), requestId: message.id }); }
      catch (error) {
        if (job.cancelled && job.effects) { try { error.observation = await withObservationDeadline({ ...job, cancelled: false, deadline: Date.now() + 1500 }, inventory, 1500); } catch {} }
        if (error.status === 'stale_target' && !error.observation && !job.cancelled) {
          try {
            const frame = pageRefs.get(message.input.args?.ref || message.input.target);
            error.observation = await withObservationDeadline(job, async () => frame ? observePage(await resolve(ref('tab', frame.tabId), 'tab', job), {}, job) : inventory(), 2000);
          } catch { /* The stale tab itself may have closed. */ }
        }
        trace('browser action failed', { status: error.status || 'failed', elapsedMs: Date.now() - job.started });
        return boundedResult({ requestId: message.id, status: error.status || 'failed', error: { code: error.status || 'browser_error', message: error.message },
        ...(error.options ? { options: error.options } : {}), ...(error.observation ? { observation: error.observation } : {}), completedEffects: job.completedEffects, completionUnknown: job.effects }); }
      finally { jobs.delete(message.id); traceRequestId = ''; runningJob = null; void publish().catch(() => {}); }
    };
    const result = queue.catch(() => {}).then(execute); queue = result.catch(() => {}); return result;
  }
  function cancelAll() { for (const job of jobs.values()) { job.cancelled = true; job.cancelObservation?.(); } }
  return { sessionId, capabilities, inventory, publish, run, cancel, cancelAll, trustedYoutubePlay, checkpoint: () => guard(runningJob), currentRequestId: () => traceRequestId };
})();
