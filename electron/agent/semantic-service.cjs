const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { ignoredDirectories, isSensitiveFile } = require('./file-policy.cjs');
const { queryPython } = require('./python-semantic.cjs');

const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']);
const actions = new Set(['definition', 'references', 'diagnostics', 'impact', 'rename']);
const timeoutMs = 30000;
const idleMs = 120000;

function contains(root, file) {
  const a = process.platform === 'win32' ? root.toLowerCase() : root;
  const b = process.platform === 'win32' ? file.toLowerCase() : file;
  const relative = path.relative(a, b);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function createSemanticService() {
  let worker = null;
  let nextId = 0;
  let idleTimer = null;
  const pending = new Map();

  function clearIdle() { if (idleTimer) clearTimeout(idleTimer); idleTimer = null; }
  function stop(error) {
    clearIdle();
    const current = worker;
    worker = null;
    if (current) void current.terminate();
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.signal.removeEventListener('abort', item.abort);
      item.reject(error);
    }
    pending.clear();
  }
  function scheduleIdle() {
    if (pending.size || !worker) return;
    clearIdle();
    idleTimer = setTimeout(() => stop(new Error('Semantic worker stopped after inactivity.')), idleMs);
    idleTimer.unref();
  }
  function getWorker() {
    if (worker) return worker;
    const env = { ...process.env };
    for (const name of Object.keys(env)) if (/^(?:ORVIX_OPENCODE_(?:ZEN|GO)_KEY|ORVIX_KILO_KEY|KILO_API_KEY|ORVIX_INCEPTION_API_KEY)$/i.test(name)) delete env[name];
    const instance = new Worker(path.join(__dirname, 'typescript-semantic-worker.cjs'), { env });
    instance.unref();
    worker = instance;
    instance.on('message', message => {
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      clearTimeout(item.timer);
      item.signal.removeEventListener('abort', item.abort);
      if (message.error) item.reject(new Error(message.error));
      else item.resolve(message.result);
      scheduleIdle();
    });
    instance.on('error', error => { if (worker === instance) stop(error); });
    instance.on('exit', code => {
      if (worker === instance) stop(new Error(`Semantic worker exited (${code}).`));
    });
    return instance;
  }

  function query({ taskId, file, action, line, column, newName, workspaces, signal }) {
    if (!actions.has(action)) throw new Error('Choose definition, references, impact, diagnostics, or rename.');
    if (action !== 'diagnostics' && (!Number.isInteger(line) || line < 1 || !Number.isInteger(column) || column < 1)) {
      throw new Error('Definition, references, impact, and rename need positive 1-based line and column.');
    }
    const requested = workspaces.assert(taskId, file);
    const extension = path.extname(requested).toLowerCase();
    if (!extensions.has(extension) && extension !== '.py') throw new Error('Semantic navigation supports JavaScript, TypeScript, and Python. Use find_symbol for other languages.');
    if (extension === '.py' && action === 'rename') throw new Error('Python rename is unavailable; use a reviewed patch after inspecting references.');
    const root = workspaces.list(taskId).filter(item => contains(item, requested)).sort((a, b) => b.length - a.length)[0];
    if (!root) throw new Error('Open this project before semantic navigation.');
    if (path.relative(root, requested).split(path.sep).some(part =>
      ignoredDirectories.has(part.toLowerCase()) || isSensitiveFile(part))) {
      throw new Error('Semantic navigation cannot inspect generated or credential paths.');
    }
    if (signal.aborted) throw new Error('Task cancelled.');
    if (extension === '.py') return queryPython({ root, file: requested, action, line, column, signal });
    clearIdle();
    const instance = getWorker();
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const abort = () => stop(new Error('Task cancelled.'));
      const timer = setTimeout(() => stop(new Error('Semantic analysis timed out after 30 seconds.')), timeoutMs);
      pending.set(id, { resolve, reject, timer, signal, abort });
      signal.addEventListener('abort', abort, { once: true });
      instance.postMessage({ id, input: { root, file: requested, action, line, column, newName } });
      if (signal.aborted) abort();
    });
  }

  function shutdown() { stop(new Error('Desktop app closed.')); }
  return { query, shutdown };
}

module.exports = { createSemanticService };
