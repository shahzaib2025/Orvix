// Task-scoped, authenticated Streamable HTTP MCP. No credentials in prompts or project config.
const http = require('node:http');
const crypto = require('node:crypto');
const { validateTool } = require('./tool-validation.cjs');
const { abortable } = require('./opencode-headless.cjs');
const { visualImages } = require('./visual-images.cjs');
const { listenBrowserLoopback } = require('./browser-loopback.cjs');

async function createVisualMcp({ definitions, call, imageStore, acceptsImages, signal, operationTimeoutMs = 170000 }) {
  const token = crypto.randomBytes(32).toString('hex');
  const requests = new Map();
  let active = false;
  const server = http.createServer(async (request, response) => {
    const send = (status, value) => { if (!response.destroyed) { response.writeHead(status, { 'content-type': 'application/json' }); response.end(value === undefined ? '' : JSON.stringify(value)); } };
    if (request.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'Unauthorized' });
    if (request.headers.origin) return send(403, { error: 'Browser origins are not supported' });
    if (request.url !== '/mcp') return send(404, { error: 'Not found' });
    if (request.method !== 'POST') return send(405, { error: 'Only POST is supported' });
    let rpc, size = 0, chunks = [];
    try {
      for await (const chunk of request) { size += chunk.length; if (size > 128_000) { send(413, { error: 'Request too large' }); return; } chunks.push(chunk); }
      rpc = JSON.parse(Buffer.concat(chunks).toString());
      if (rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string' || (rpc.id !== undefined && typeof rpc.id !== 'string' && typeof rpc.id !== 'number')) throw new Error('Invalid RPC request');
    } catch { return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON-RPC request' } }); }
    if (rpc.method === 'notifications/cancelled') requests.get(rpc.params?.requestId)?.abort();
    if (rpc.id === undefined) return send(202);
    const controller = new AbortController();
    const callSignal = AbortSignal.any([signal, controller.signal]);
    requests.set(rpc.id, controller);
    const disconnect = () => { if (!response.writableEnded) controller.abort(); };
    response.once('close', disconnect);
    let operationTimer, timedOut = false;
    let result;
    try {
      if (rpc.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'orvix-visual', version: '1.0.0' } };
      else if (rpc.method === 'ping') result = {};
      else if (rpc.method === 'tools/list') result = { tools: definitions.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.parameters })) };
      else if (rpc.method === 'tools/call') {
        validateTool(definitions.find(tool => tool.name === rpc.params?.name), rpc.params?.arguments ?? {});
        if (active) throw new Error('A visual operation is already running.');
        if (callSignal.aborted) throw new Error('Task cancelled.');
        active = true;
        operationTimer = setTimeout(() => { timedOut = true; controller.abort(); }, operationTimeoutMs);
        try {
          const value = await abortable(Promise.resolve(call(rpc.params.name, rpc.params.arguments ?? {}, callSignal)), callSignal);
          const images = visualImages(value);
          result = { content: [{ type: 'text', text: JSON.stringify({ ...value, imageOrder: images.map(ref => ref.name), imageInputAvailable: acceptsImages,
            ...(!acceptsImages && images.length ? { visualInspectionLimit: 'Selected model cannot see images. Use a model advertising image input for visual judgments.' } : {}) }) },
          ...(acceptsImages ? images.map(ref => ({ type: 'image', mimeType: ref.mime, data: imageStore.read(ref) })) : [])] };
        } finally { active = false; }
      } else return send(200, { jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: 'Method not found' } });
      send(200, { jsonrpc: '2.0', id: rpc.id, result });
    } catch (error) {
      send(200, { jsonrpc: '2.0', id: rpc.id, result: { isError: true, content: [{ type: 'text', text: timedOut ? 'Visual operation timed out and was cancelled. Inspect the current preview state before retrying.' : String(error.message ?? error).slice(0, 1000) }] } });
    } finally { clearTimeout(operationTimer); response.removeListener('close', disconnect); requests.delete(rpc.id); }
  });
  server.requestTimeout = 180000; server.headersTimeout = 10000;
  const close = async () => { for (const controller of requests.values()) controller.abort(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  await listenBrowserLoopback(server);
  if (signal.aborted) { await close(); throw new Error('Task cancelled.'); }
  return { config: { type: 'remote', url: `http://127.0.0.1:${server.address().port}/mcp`, headers: { Authorization: `Bearer ${token}` }, oauth: false, timeout: 180000 }, close };
}
module.exports = { createVisualMcp };
