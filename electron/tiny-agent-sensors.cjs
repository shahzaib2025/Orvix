const fs = require('node:fs/promises');
const { watch } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
function leaves(c) { return c.op === 'predicate' ? [c] : c.children.flatMap(leaves); }
function cpuTotals() { return os.cpus().reduce((a, c) => ({ idle: a.idle + c.times.idle, total: a.total + Object.values(c.times).reduce((x,y) => x+y, 0) }), { idle: 0, total: 0 }); }
function checkNetwork(signal) {
  return new Promise(resolve => {
    // Match Windows NCSI's fixed, non-sensitive probe; redirects/captive portals
    // are not evidence that this endpoint is reachable.
    const request = http.request('http://www.msftconnecttest.com/connecttest.txt', { timeout: 4000, signal }, response => {
      let body = ''; response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; if (body.length > 1024) { request.destroy(); resolve(false); } });
      response.on('end', () => resolve(response.statusCode === 200 && body.trim() === 'Microsoft Connect Test'));
      response.on('error', () => resolve(false));
    });
    request.on('error', () => resolve(false)); request.on('timeout', () => { request.destroy(); resolve(false); }); request.end();
  });
}
async function disks(targets) {
  const results = await Promise.all(targets.map(async target => {
    try {
      const value = await fs.statfs(target + '\\');
      return [target, value.blocks > 0 ? 100 * value.bavail / value.blocks : null];
    } catch { return [target, null]; }
  }));
  return Object.fromEntries(results);
}
function createTinyAgentSensors({ listRules, observeDownloads, onUpdate, networkProbe = checkNetwork, diskProbe = disks, cpuProbe = cpuTotals, memoryProbe = () => 100 * (1 - os.freemem() / os.totalmem()), watchFactory = watch }) {
  let timer = null, timerAt = 0, busy = false, stopped = true, resample = false, previousCpu = null, sequence = 0, lastHealth = 0, generation = 0, signature = '', probeController = null;
  let snapshot = { at: 0, System: {}, Files: {}, Downloads: null };
  const folders = new Map(), pendingFiles = new Map(), downloads = new Map();
  const watchers = new Map(), failedWatches = new Map(), dirty = new Set(), fileReadAt = new Map();
  const metrics = { samples: 0, cpu: 0, memory: 0, disk: 0, network: 0, folderScans: 0 };
  let downloadsReady = false, downloadsBaselineAt = 0;
  const predicatesFor = () => listRules().filter(r => r.enabled && !r.draft).flatMap(r => [...leaves(r.condition), ...(r.incident?.recoveryCondition ? leaves(r.incident.recoveryCondition) : []), ...(r.trigger?.watches || [])]);
  function schedule(milliseconds) {
    if (stopped) return;
    const at = Date.now() + milliseconds;
    if (timer && timerAt <= at) return;
    clearTimeout(timer);
    timerAt = at;
    timer = setTimeout(() => { timer = null; timerAt = 0; void sample(Date.now(), false).catch(() => {}); }, milliseconds);
    timer.unref?.();
  }
  function reconcileWatches(predicates) {
    const targets = new Map();
    const selected = new Set(predicates.filter(p=>['file_exists','folder_new_file'].includes(p.signal)).map(p=>p.target));
    for (const target of dirty) if (!selected.has(target)) dirty.delete(target);
    for (const p of predicates.filter(p => ['file_exists', 'folder_new_file'].includes(p.signal))) {
      for (const directory of [path.dirname(p.target), ...(p.signal === 'folder_new_file' ? [p.target] : [])]) {
        if (!targets.has(directory)) targets.set(directory, new Set());
        targets.get(directory).add(p.target);
      }
    }
    for (const [directory, entry] of watchers) if (!targets.has(directory)) { entry.handle.close(); watchers.delete(directory); }
    for (const [directory, paths] of targets) {
      if (watchers.has(directory)) { watchers.get(directory).paths = paths; continue; }
      if ((failedWatches.get(directory) || 0) > Date.now()) continue;
      try {
        const entry = { paths, handle: null };
        const invalidate = (event, filename) => {
          if (stopped || watchers.get(directory) !== entry) return;
          for (const target of entry.paths) {
            // Reading a directory can change its own metadata on Windows.
            // Parent watches only repair creation/removal/rename of the target.
            if (directory !== target && event === 'change') continue;
            if (filename != null && directory !== target && path.resolve(directory, filename.toString()).toLowerCase() !== path.resolve(target).toLowerCase()) continue;
            dirty.add(target);
            if (event === 'rename' && directory !== target) failedWatches.delete(target);
            if (event === 'rename' && directory !== target && watchers.has(target)) { watchers.get(target).handle.close(); watchers.delete(target); }
          }
          if (dirty.size && !busy) schedule(dirtyDelay());
        };
        entry.handle = watchFactory(directory, { persistent: false }, invalidate);
        entry.handle.on('error', () => { invalidate(); entry.handle.close(); if (watchers.get(directory) === entry) { watchers.delete(directory); failedWatches.set(directory,Date.now()+10000); } });
        watchers.set(directory, entry);
        failedWatches.delete(directory);
      } catch { failedWatches.set(directory,Date.now()+10000); /* Repair scans also cover missing folders and failed watches. */ }
    }
    for (const directory of failedWatches.keys()) if (!targets.has(directory)) failedWatches.delete(directory);
  }
  function dirtyDelay() {
    // Coalesce a busy copy without postponing CPU readings or scanning on every write.
    return Math.max(150, Math.min(1000, ...[...dirty].map(target => folders.has(target) ? 1000 - (Date.now() - (fileReadAt.get(target) || 0)) : 150)));
  }
  async function sample(now = Date.now(), forceFiles = true) {
    if (busy || stopped) return;
    busy = true; const epoch = generation, controller = new AbortController(); probeController = controller; metrics.samples++;
    try {
      const predicates = predicatesFor();
      reconcileWatches(predicates);
      const wants = new Set(predicates.map(p => p.signal));
      const system = { ...snapshot.System };
      const observations = { ...snapshot.Observations };
      const observed = (key, value, at = Date.now()) => { observations[key] = { at, status: value == null ? 'unavailable' : 'ready' }; };
      if (wants.has('cpu_percent')) {
        const cpu = cpuProbe(), delta = previousCpu ? cpu.total - previousCpu.total : 0; metrics.cpu++;
        system.cpu_percent = delta > 0 ? Math.max(0, Math.min(100, 100 * (1 - (cpu.idle - previousCpu.idle) / delta))) : null;
        previousCpu = cpu; observed('cpu_percent', system.cpu_percent, now);
      } else { previousCpu = null; delete system.cpu_percent; delete observations.cpu_percent; }
      if (wants.has('memory_percent')) { metrics.memory++; system.memory_percent = memoryProbe(); observed('memory_percent', system.memory_percent, now); }
      else { delete system.memory_percent; delete observations.memory_percent; }
      if (now - lastHealth >= 30000 || !lastHealth || (wants.has('network_online') && system.network_online == null) || (wants.has('disk_free_percent') && system.disks == null)) {
        const targets = [...new Set(predicates.filter(p => p.signal === 'disk_free_percent').map(p => p.target))];
        if (wants.has('network_online')) metrics.network++;
        if (targets.length) metrics.disk++;
        const results = await Promise.all([wants.has('network_online') ? networkProbe(controller.signal) : null, targets.length ? diskProbe(targets) : null]);
        system.network_online = results[0]; system.disks = results[1]; lastHealth = now;
        observed('network_online', results[0], now);
        for (const p of predicates.filter(p => p.signal === 'disk_free_percent')) observed('disk_free_percent:' + p.target, results[1]?.[p.target], now);
      }
      const files = {};
      const filePredicates = predicates.filter(p => ['file_exists', 'folder_new_file'].includes(p.signal));
      for (const p of filePredicates) {
        if (files[p.target]) continue;
        if (!forceFiles && !dirty.has(p.target) && !pendingFiles.get(p.target)?.size && snapshot.Files[p.target] && now - (fileReadAt.get(p.target) || 0) < 10000) {
          files[p.target] = snapshot.Files[p.target]; continue;
        }
        dirty.delete(p.target); fileReadAt.set(p.target, now);
        try {
          const stat = await fs.stat(p.target);
          if (p.signal === 'folder_new_file') {
            if (!stat.isDirectory()) throw new Error('Not a folder');
            metrics.folderScans++;
            const entries = (await fs.readdir(p.target, { withFileTypes: true })).filter(e => e.isFile()).slice(0, 10000).map(e => e.name);
            const old = folders.get(p.target), names = new Set(entries);
            const pending = pendingFiles.get(p.target) || new Map();
            for (const name of old ? entries.filter(name => !old.has(name)) : []) pending.set(name, null);
            const added = [];
            for (const [name, previous] of pending) {
              if (!names.has(name)) { pending.delete(name); continue; }
              try {
                const info = await fs.stat(path.join(p.target, name));
                const fingerprint = `${info.size}:${info.mtimeMs}`;
                if (previous === fingerprint) { added.push(name); pending.delete(name); } else pending.set(name, fingerprint);
              } catch { pending.delete(name); }
            }
            pendingFiles.set(p.target, pending);
            const prior = snapshot.Files[p.target];
            files[p.target] = { exists: false, names: added.length ? added : (prior?.eventAt && now - prior.eventAt < 15000 ? prior.names : []), sequence: added.length ? ++sequence : prior?.sequence || 0, eventAt: added.length ? now : prior?.eventAt || 0 };
            folders.set(p.target, names);
          } else files[p.target] = { exists: stat.isFile(), names: [] };
        } catch (error) { folders.delete(p.target); pendingFiles.delete(p.target); files[p.target] = error.code === 'ENOENT' && p.signal === 'file_exists' ? { exists: false, names: [] } : { error: error.message }; }
      }
      for (const p of filePredicates) observed(p.signal + ':' + p.target, files[p.target]?.error ? null : files[p.target], fileReadAt.get(p.target) || now);
      for (const key of folders.keys()) if (!filePredicates.some(p => p.target === key && p.signal === 'folder_new_file')) { folders.delete(key); pendingFiles.delete(key); }
      for (const key of fileReadAt.keys()) if (!filePredicates.some(p => p.target === key)) fileReadAt.delete(key);
      const observedKeys = new Set(predicates.map(p => p.signal + (p.target ? ':' + p.target : '')));
      for (const key of Object.keys(observations)) if (!observedKeys.has(key)) delete observations[key];
      let downloadEvents = null;
      if (wants.has('browser_download')) {
        try {
          const result = await observeDownloads();
          if (result?.status !== 'ok' || !Array.isArray(result.observation?.items)) throw new Error('Browser companion unavailable');
          const items = result.observation.items;
          downloadEvents = (snapshot.Downloads || []).filter(d => now - d.eventAt < 15000);
          for (const d of items) {
            if (downloadsReady && (downloads.has(d.id) || Date.parse(d.startTime) >= downloadsBaselineAt) && downloads.get(d.id) !== d.state && ['complete', 'interrupted'].includes(d.state)) downloadEvents.push({ ...d, sequence: ++sequence, eventAt: now });
            downloads.set(d.id, d.state);
          }
          const present = new Set(items.map(d => d.id));
          for (const id of downloads.keys()) if (!present.has(id)) downloads.delete(id);
          if (!downloadsReady) downloadsBaselineAt = now;
          downloadsReady = true;
        } catch { downloadsReady = false; downloads.clear(); }
      } else { downloadsReady = false; downloads.clear(); }
      if (stopped || generation !== epoch) return;
      observed('browser_download', downloadEvents, now);
      snapshot = { at: now, Observations: observations, System: system, Files: files, Downloads: downloadEvents };
      onUpdate(snapshot);
    } finally {
      busy = false;
      if (probeController === controller) probeController = null;
      if (generation !== epoch) { folders.clear(); pendingFiles.clear(); fileReadAt.clear(); previousCpu = null; lastHealth = 0; downloadsReady = false; downloads.clear(); }
      if (!stopped) {
        if (resample) { resample = false; lastHealth = 0; schedule(0); }
        const wants = new Set(predicatesFor().map(p => p.signal));
        const pending = [...pendingFiles.values()].some(value => value.size);
        schedule(dirty.size ? dirtyDelay() : pending ? 1000 : [...wants].some(signal => ['cpu_percent', 'memory_percent', 'browser_download'].includes(signal)) ? 3000 : [...wants].some(signal => ['file_exists','folder_new_file'].includes(signal)) ? 10000 : 30000);
      }
    }
  }
  function hasSensorRules() {
    const sensorSignals = new Set(['cpu_percent', 'memory_percent', 'network_online', 'disk_free_percent', 'file_exists', 'folder_new_file', 'browser_download']);
    return predicatesFor().some(predicate => sensorSignals.has(predicate.signal));
  }
  function start() { if (!stopped) return; stopped = false; generation++; return sample(); }
  function stop() {
    stopped = true; resample = false; generation++; clearTimeout(timer); timer = null; timerAt = 0;
    probeController?.abort();
    for (const entry of watchers.values()) entry.handle.close();
    watchers.clear(); failedWatches.clear(); dirty.clear(); folders.clear(); pendingFiles.clear(); fileReadAt.clear(); downloads.clear();
    previousCpu = null; downloadsReady = false; lastHealth = 0;
    snapshot = { at: 0, System: {}, Files: {}, Downloads: null };
  }
  function refresh() {
    if (!hasSensorRules()) { signature = ''; stop(); return; }
    const next = JSON.stringify(predicatesFor());
    if (stopped) { signature = next; return start(); }
    if (next !== signature) { signature = next; reconcileWatches(predicatesFor()); for (const p of predicatesFor()) if (['file_exists','folder_new_file'].includes(p.signal)) dirty.add(p.target); lastHealth = 0; if (busy) resample = true; else schedule(0); }
  }
  return { start, stop, refresh, sample, diagnostics: () => ({ ...metrics, watchers: watchers.size, scheduled: !!timer, stopped }) };
}
module.exports = { createTinyAgentSensors, cpuTotals };
