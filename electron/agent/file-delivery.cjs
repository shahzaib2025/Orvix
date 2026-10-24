const fs = require('node:fs');
const path = require('node:path');
const { isSensitiveFile, credentialDirectories } = require('./file-policy.cjs');
const { canonicalTarget } = require('./workspace-manager.cjs');

const imageMime = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif', '.svg':'image/svg+xml' };
const textExtensions = new Set('.txt .md .markdown .csv .tsv .json .jsonc .yaml .yml .xml .html .htm .css .scss .js .jsx .ts .tsx .mjs .cjs .py .php .go .rs .java .c .cpp .h .sql .sh .bat .ps1 .toml .log'.split(' '));
const openExtensions = new Set('.pdf .docx .doc .xlsx .xls .pptx .ppt .odt .ods .odp .rtf .txt .md .markdown .csv .tsv .html .htm .png .jpg .jpeg .webp .gif .svg .mp3 .wav .mp4 .webm'.split(' '));
const maxBytes = 16 * 1024 * 1024;
function hidden(file) { return file.split(/[\\/]/).some(part => isSensitiveFile(part) || credentialDirectories.has(part.toLowerCase()) || ['.git','node_modules'].includes(part.toLowerCase())); }
function normalize(file) { return process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file); }
function createFileDelivery(workspaces, turnReports) {
  async function inspect(taskId, requested) {
    let candidate, file;
    try {
      candidate = workspaces.assert(taskId, requested);
      file = canonicalTarget(candidate);
      workspaces.assert(taskId, file);
    } catch { throw new Error('This file is outside this chat’s available folders or is protected.'); }
    if (hidden(candidate) || hidden(file)) throw new Error('This file is unavailable for delivery.');
    let stat;
    try { stat = await fs.promises.stat(file); }
    catch (error) {
      if (['ENOENT','ENOTDIR'].includes(error.code)) throw new Error('This file has moved or been removed.');
      throw new Error('Orvix cannot access this file. Check its permissions.');
    }
    if (!stat.isFile()) throw new Error('Choose an existing file.');
    const extension = path.extname(file).toLowerCase();
    return { path: candidate, name: path.basename(candidate), size: stat.size, modifiedAt: stat.mtimeMs,
      previewKind: imageMime[extension] ? 'image' : extension === '.pdf' ? 'pdf' : ['.html','.htm'].includes(extension) ? 'html' : textExtensions.has(extension) ? 'text' : 'unsupported',
      canOpen: openExtensions.has(extension), extension, canonical: file };
  }
  async function list(taskId, requestId) {
    const report = await turnReports.report(taskId, requestId);
    const result = [];
    const seen = new Set();
    for (const entry of report?.changes ?? []) {
      if (entry.directory || entry.kind === 'deleted' || seen.has(normalize(entry.path))) continue;
      seen.add(normalize(entry.path));
      try { const { canonical, extension, ...item } = await inspect(taskId, entry.path); result.push({ ...item, kind: entry.kind }); }
      catch { /* Historical outputs can disappear or leave the approved workspace. */ }
    }
    return result;
  }
  async function preview(taskId, requested) {
    const item = await inspect(taskId, requested);
    const { canonical, extension, ...metadata } = item;
    if (item.size > maxBytes) return { ...metadata, kind: 'unavailable', reason: 'This file is too large for an inline preview. Open it in its app or show its folder.' };
    if (item.previewKind === 'unsupported') return { ...metadata, kind: 'unavailable', reason: 'Inline preview is unavailable for this format. Open it in its app or show its folder.' };
    const bytes = await fs.promises.readFile(canonical);
    if (bytes.length > maxBytes) throw new Error('The file grew beyond the preview limit.');
    if (item.previewKind === 'image' || item.previewKind === 'pdf') return { ...metadata, kind: item.previewKind, data: bytes.toString('base64'), mime: imageMime[extension] ?? 'application/pdf' };
    try { return { ...metadata, kind: item.previewKind, content: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }; }
    catch { return { ...metadata, kind: 'unavailable', reason: 'This file is not readable UTF-8 text. Open it in its app.' }; }
  }
  async function act(taskId, requested, action, shell) {
    if (!['open','reveal'].includes(action)) throw new Error('Unknown file action.');
    const item = await inspect(taskId, requested);
    if (action === 'reveal') { shell.showItemInFolder(item.canonical); return { ok: true }; }
    if (!item.canOpen) throw new Error('Use Preview to inspect this file without executing it.');
    const error = await shell.openPath(item.canonical);
    if (error) throw new Error(error);
    return { ok: true };
  }
  return { list, preview, act };
}
function registerFileDeliveryIpc(ipcMain, { getMainWindow, delivery, shell }) {
  function sender(event) {
    const window = getMainWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Unavailable from this window or frame.');
  }
  ipcMain.handle('orvix:agent-deliverables', (event, taskId, requestId) => { sender(event); return delivery.list(taskId, requestId); });
  ipcMain.handle('orvix:agent-file-preview', (event, taskId, file) => { sender(event); return delivery.preview(taskId, file); });
  ipcMain.handle('orvix:agent-file-action', (event, taskId, file, action) => { sender(event); return delivery.act(taskId, file, action, shell); });
}
module.exports = { createFileDelivery, registerFileDeliveryIpc };
