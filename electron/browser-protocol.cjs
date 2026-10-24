const fs = require('node:fs');
const tools = require('../shared/browser-tools.json').functionDeclarations;
const actions = new Set(tools[1].parameters.properties.action.enum);
const scopes = new Set(tools[0].parameters.properties.scope.enum);
function validate(kind, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('A browser request object is required.');
  const schema = tools[kind === 'observe' ? 0 : 1].parameters;
  if (Object.keys(input).some(key => !Object.hasOwn(schema.properties, key) && key !== 'requestId')) throw new Error('Unknown browser request field.');
  if (kind === 'observe' ? !scopes.has(input.scope) : !actions.has(input.action)) throw new Error('Unsupported browser scope or action.');
  if (input.target !== undefined && (typeof input.target !== 'string' || input.target.length > 500)) throw new Error('Invalid browser target.');
  if (input.requestId !== undefined && (typeof input.requestId !== 'string' || !/^[\w:-]{1,100}$/.test(input.requestId))) throw new Error('Invalid request ID.');
  if (JSON.stringify(input).length > 65_000) throw new Error('Browser request is too large.');
  if (kind === 'observe' && (input.query !== undefined && typeof input.query !== 'string' || input.cursor !== undefined && !/^\d{1,8}$/.test(input.cursor) || input.screenshot !== undefined && typeof input.screenshot !== 'boolean')) throw new Error('Invalid observation filter, cursor or screenshot flag.');
  const args = input.args ?? {};
  if (kind === 'act') {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid browser arguments.');
    const properties = schema.properties.args.properties;
    if(args.tabPolicy&&!['tab_open','navigate','search','youtube_search'].includes(input.action))throw new Error('tabPolicy is only valid for destination-opening or YouTube search.');
    for (const [key, value] of Object.entries(args)) {
      const property = properties[key];
      if (!property) throw new Error(`Unsupported argument: ${key}`);
      if (property.type === 'STRING' && typeof value !== 'string' || property.type === 'BOOLEAN' && typeof value !== 'boolean' ||
          ['NUMBER', 'INTEGER'].includes(property.type) && (!Number.isFinite(value) || property.type === 'INTEGER' && !Number.isInteger(value)) ||
          property.type === 'ARRAY' && (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== 'string'))) throw new Error(`Invalid argument: ${key}`);
      if (property.enum && !property.enum.includes(value)) throw new Error(`Invalid ${key}.`);
    }
    const needsElement = new Set(['click', 'type', 'key', 'select', 'check', 'drag', 'upload', 'media_play', 'media_pause', 'media_seek', 'media_mute', 'media_volume']);
    if (needsElement.has(input.action)) {
      const targetElement = input.target?.includes(':element:') ? input.target : undefined;
      const element = args.ref || targetElement;
      if (!element || !/^[^:]+:element:\d+:\d+:.+$/.test(element)) {
        throw Object.assign(new Error('This page action requires an observed element ref. Inspect the intended page and use its exact control ref; a tab ref is not a control.'), { code: 'invalid_target_type' });
      }
      if (args.ref && targetElement && args.ref !== targetElement) throw new Error('Two different element targets were supplied.');
    }
    if (input.action === 'type' && typeof args.text !== 'string') throw new Error('type requires text.');
    if (input.action === 'key' && !/^(?:(?:Ctrl|Shift|Alt)\+)*(?:Enter|Tab|Escape|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown|Backspace|Delete|Space|A)$/.test(args.key || '')) throw new Error('key requires a supported key.');
    if (input.action === 'upload') {
      if (!args.files?.length || args.files.length > 10) throw new Error('Supply 1–10 existing local files for upload.');
      input = { ...input, args: { ...args, files: args.files.map(file => {
        const full = fs.realpathSync(file);
        if (!fs.statSync(full).isFile()) throw new Error('Upload paths must be regular files.');
        return full;
      }) } };
    }
  }
  if (input.expect !== undefined && (!input.expect || typeof input.expect !== 'object' || Array.isArray(input.expect) || !['url', 'search_query', 'text', 'value', 'checked', 'visible', 'download', 'media_state'].includes(input.expect.kind) ||
      Object.keys(input.expect).some(key => !['kind', 'value', 'ref'].includes(key)) ||
      input.expect.ref !== undefined && typeof input.expect.ref !== 'string' ||
      input.expect.value !== undefined && typeof input.expect.value !== 'string' ||
      ['url', 'search_query', 'text', 'download', 'media_state', 'checked'].includes(input.expect.kind) && !input.expect.value)) throw new Error('Invalid browser expectation.');
  return input;
}
function summary(input) {
  if (!input || typeof input !== 'object') return input;
  const out = {};
  // Only operational metadata belongs in logs; never page text, form values, files or images.
  for (const key of ['requestId', 'id', 'action', 'scope', 'status', 'sessionId', 'extensionVersion', 'protocolVersion', 'verified', 'completionUnknown']) {
    if (input[key] !== undefined) out[key] = input[key];
  }
  if (input.error?.code) out.error = input.error.code;
  if (input.observation) out.observation = { revision: input.observation.revision, timestamp: input.observation.timestamp, tabCount: input.observation.tabs?.length, elementCount: input.observation.elements?.length };
  return out;
}
module.exports = { validate, summary, actions, scopes };
