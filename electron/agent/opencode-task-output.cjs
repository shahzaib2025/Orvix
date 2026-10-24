const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_CHARACTERS = 8000;
const key = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const same = (a, b) => key(a) === key(b);

const taskOutputDefinition = {
  name: 'read_tool_output',
  description: 'Read a long tool result saved by this OpenCode session. Without filePath, list this session’s available outputs. Use character offset/limit to read chunks, or a literal search to jump within minified HTML. This reads only registered results, never project files or private chat records. Use this instead of shell commands or searching the tool-output folder.',
  parameters: { type: 'object', additionalProperties: false, properties: {
    filePath: { type: 'string', description: 'Exact outputPath returned by a completed tool in this session.' },
    offset: { type: 'integer', minimum: 0, description: 'Character offset, starting at zero.' },
    limit: { type: 'integer', minimum: 1, maximum: MAX_CHARACTERS },
    search: { type: 'string', maxLength: 200, description: 'Optional literal, case-insensitive search, starting at offset.' },
  } },
};

const taskOutputGuidance = 'The OpenCode runtime working directory is an isolated staging directory, not a user project. If no project is open, use webfetch/websearch for web research; ask one focused question for the real project folder before local file work. Do not search or write in the runtime directory. Large tool results may be saved internally: use orvix_visual_read_tool_output with their exact outputPath, character offset/limit, or literal search. Call it without filePath to list only this session’s saved results. Never use shell commands, directory grep/glob, or a new workspace permission to open tool-output or other Orvix private records.';

// The transport supplies the worker directory and current session. A model-
// supplied path alone can never authorize a runtime file.
function createTaskOutputAccess() {
  let workdir = null, workerRoot = null, outputRoot = null, sessionID = null;
  const outputs = new Map(), calls = new Map();
  function runtime(directory) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) return;
    const next = path.resolve(directory);
    if (workdir && !same(workdir, next)) { outputs.clear(); calls.clear(); sessionID = null; }
    workdir = next; workerRoot = path.dirname(workdir);
    outputRoot = path.join(workerRoot, 'data', 'opencode', 'tool-output');
  }
  function begin(id, directory) {
    runtime(directory);
    if (id !== sessionID) { outputs.clear(); calls.clear(); }
    sessionID = id;
  }
  function outputDirectory() {
    if (!outputRoot || !workerRoot) return false;
    try {
      // Reject redirected data directories, including junctions into another
      // worker. Resolve only the trusted worker root, never a model path.
      const expected = path.join(fs.realpathSync.native(workerRoot), 'data', 'opencode', 'tool-output');
      return same(fs.realpathSync.native(outputRoot), expected) && fs.lstatSync(outputRoot).isDirectory();
    } catch { return false; }
  }
  function inspect(file) {
    if (typeof file !== 'string' || !path.isAbsolute(file) || !outputRoot
      || !same(path.dirname(file), outputRoot) || !/^tool_[\w-]+$/.test(path.basename(file)) || !outputDirectory()) return null;
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_BYTES
        || !same(fs.realpathSync.native(file), path.join(fs.realpathSync.native(outputRoot), path.basename(file)))) return null;
      return stat;
    } catch { return null; }
  }
  function observe(event) {
    const part = event.properties?.part;
    if (!sessionID || part?.type !== 'tool' || part.sessionID !== sessionID) return;
    const callId = part.callID || part.id;
    if (callId && part.state?.input && typeof part.state.input === 'object') {
      calls.set(callId, part.state.input);
      if (calls.size > 256) calls.delete(calls.keys().next().value);
    }
    if (part.state?.status !== 'completed') return;
    const file = part.state.metadata?.outputPath, stat = inspect(file);
    if (!stat) return;
    if (outputs.has(key(file))) return;
    outputs.set(key(file), { filePath: path.resolve(file), dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs });
    if (outputs.size > 256) outputs.delete(outputs.keys().next().value);
  }
  function registered(file) {
    if (typeof file !== 'string' || !path.isAbsolute(file)) return null;
    const record = outputs.get(key(file)), stat = record && inspect(file);
    return stat && ['dev', 'ino', 'size', 'mtimeMs'].every(field => stat[field] === record[field]) ? record : null;
  }
  function canListRuntime(file) {
    if (!sessionID || !workdir || !same(file, workdir)) return false;
    try { return fs.lstatSync(workdir).isDirectory() && same(fs.realpathSync.native(workdir), path.join(fs.realpathSync.native(workerRoot), path.basename(workdir))); }
    catch { return false; }
  }
  function canTraverse(file) {
    return Boolean(registered(file) || outputRoot && same(file, outputRoot) && outputDirectory()
      && [...outputs.values()].some(record => registered(record.filePath)));
  }
  function read({ filePath, offset = 0, limit = MAX_CHARACTERS, search } = {}) {
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > MAX_CHARACTERS
      || search !== undefined && (typeof search !== 'string' || !search || search.length > 200)) throw new Error('Use a nonnegative character offset, a limit from 1 to 8000, and a short literal search.');
    if (filePath === undefined) return { outputs: [...outputs.values()].filter(record => registered(record.filePath)).map(({ filePath, size }) => ({ filePath, bytes: size })) };
    const record = registered(filePath);
    if (!record) throw new Error('Only unchanged output files registered by the current task session are available. Use read_tool_output without filePath to list them.');
    const handle = fs.openSync(record.filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    let text;
    try {
      const stat = fs.fstatSync(handle);
      if (!registered(record.filePath) || !['dev', 'ino', 'size', 'mtimeMs'].every(field => stat[field] === record[field])) throw new Error('The saved output changed. Fetch the source again before continuing.');
      text = fs.readFileSync(handle, 'utf8');
    } finally { fs.closeSync(handle); }
    if (offset > text.length) throw new Error(`The output contains ${text.length} characters. Use an offset within that range.`);
    let start = offset, searchFound;
    if (search) {
      const index = text.toLowerCase().indexOf(search.toLowerCase(), offset);
      searchFound = index >= 0;
      if (index >= 0) start = Math.max(offset, index - 200);
      else return { filePath: record.filePath, totalCharacters: text.length, offset, searchFound: false, text: '', nextOffset: null };
    }
    const end = Math.min(text.length, start + limit);
    return { filePath: record.filePath, totalCharacters: text.length, offset: start, text: text.slice(start, end),
      nextOffset: end < text.length ? end : null, ...(search ? { searchFound } : {}) };
  }
  function recovery(request, directory, resolveTarget = (value, base) => path.resolve(base, value)) {
    if (!outputRoot || !['bash', 'shell', 'read', 'glob', 'grep', 'external_directory'].includes(request.permission ?? request.type)) return null;
    const metadata = request.metadata ?? {};
    const input = calls.get(request.tool?.callID ?? request.tool?.callId) ?? {};
    const targets = [request.pattern, metadata.pattern, metadata.path, metadata.directory, metadata.filePath, metadata.filepath,
      input.pattern, input.path, input.directory, input.filePath, input.filepath,
      ...(Array.isArray(request.patterns) ? request.patterns : [])].filter(value => typeof value === 'string');
    const raw = [metadata.command, input.command, ...targets].filter(value => typeof value === 'string').join('\n');
    const normalized = raw.replace(/\\/g, '/').toLowerCase();
    const referencesOutput = normalized.includes(outputRoot.replace(/\\/g, '/').toLowerCase())
      || targets.some(value => {
        try { return same(resolveTarget(value, directory).replace(/[\\/]\*$/, ''), outputRoot); } catch { return false; }
      });
    if (!referencesOutput) return null;
    return { recoverable: true, continue: true,
      guidance: 'Read the already captured result with orvix_visual_read_tool_output. Call it without filePath to list current-session outputs, then read the returned exact filePath using character offset/limit or literal search. Do not repeat the rejected shell/search or open the runtime folder as a workspace. If the result is no longer registered, refetch the original public URL with webfetch, then read its newly saved result. Do not replay edits or commands.' };
  }
  return { runtime, begin, observe, registered, canListRuntime, canTraverse, read, recovery };
}

module.exports = { createTaskOutputAccess, taskOutputDefinition, taskOutputGuidance };
