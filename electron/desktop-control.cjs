const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {annotateWindows}=require('./fast-windows.cjs');
function createDesktopControl() {
  const active = new Map(), cancelled = new Set();
  function request(kind, input, signal) {
    if (signal?.aborted || cancelled.delete(input.requestId)) return Promise.resolve({ status: 'cancelled' });
    let token;
    try { token = fs.readFileSync(path.join(process.env.LOCALAPPDATA, 'PCMonitorTest', 'pairing-token.txt'), 'utf8').trim(); }
    catch { return Promise.resolve({ status: 'unavailable', message: 'PC Monitor pairing is unavailable.' }); }
    return new Promise(resolve => {
      const data = JSON.stringify({ ...input, deadlineUtcMs: Date.now() + 14000 });
      let finished = false;
      const finish = value => { if (finished) return; finished = true; active.delete(input.requestId); signal?.removeEventListener('abort', abort); resolve(value); };
      const abort = () => {
        const body = JSON.stringify({ requestId: input.requestId });
        const cancel = http.request({ hostname: '127.0.0.1', port: 49491, path: '/desktop-cancel', method: 'POST', timeout: 1000,
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-PC-Monitor-Token': token } }, response => response.resume());
        cancel.on('error', () => {}); cancel.on('timeout', () => cancel.destroy()); cancel.end(body);
        req.destroy(); finish({ status: 'cancelled', completionUnknown: kind === 'act' });
      };
      const req = http.request({ hostname: '127.0.0.1', port: 49491, path: `/desktop-${kind}`, method: 'POST', timeout: 15000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'X-PC-Monitor-Token': token } }, response => {
        let body = '', size = 0;
        response.on('data', chunk => { size += chunk.length; if (size > 16 * 1024 * 1024) { req.destroy(); finish({ status: 'failed', message: 'Desktop observation exceeded its limit.' }); } else body += chunk; });
        response.on('end', () => { try { finish(annotateWindows(JSON.parse(body))); } catch { finish({ status: 'update_required', message: 'Restart the updated PC Monitor to enable desktop controls.' }); } });
      });
      req.on('error', () => finish({ status: 'unavailable', completionUnknown: kind === 'act', message: 'Desktop bridge unavailable. Inspect state before retrying.' }));
      req.on('timeout', () => { req.destroy(); finish({ status: 'timeout', completionUnknown: kind === 'act', message: 'Desktop deadline reached. Inspect state before retrying.' }); });
      active.set(input.requestId, abort); signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort(); else req.end(data);
    });
  }
  return { observe: (input, signal) => request('observe', input, signal), act: (input, signal) => request('act', input, signal),
    cancel: ids => { for (const id of ids) { if (active.has(id)) active.get(id)(); else cancelled.add(id); } while (cancelled.size > 500) cancelled.delete(cancelled.values().next().value); } };
}
module.exports = { createDesktopControl };
