const { spawnSync } = require('node:child_process');

let electronClipboard = null;
try {
  const electron = require('electron');
  if (electron && electron.clipboard) {
    electronClipboard = electron.clipboard;
  }
} catch {
  electronClipboard = null;
}

function readClipboard() {
  if (electronClipboard) {
    return electronClipboard.readText();
  }
  // Windows fallback for testing/node CLI
  try {
    const res = spawnSync('powershell.exe', ['-NoProfile', '-Command', '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard'], { encoding: 'utf8', timeout: 3000 });
    return (res.stdout || '').replace(/\r?\n$/, '');
  } catch {
    return '';
  }
}

function writeClipboard(text) {
  const safeText = String(text ?? '');
  if (electronClipboard) {
    electronClipboard.writeText(safeText);
    return true;
  }
  // Windows fallback using native clip.exe for testing/node CLI
  try {
    spawnSync('clip', [], { input: safeText, encoding: 'utf8', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function manageClipboard(input = {}) {
  const rawAction = String(input.action || input.mode || input.type || 'read').toLowerCase().trim();
  const isWrite = rawAction === 'write' || rawAction === 'copy' || rawAction === 'set';
  console.log(`[Orvix Live Tool: manage_clipboard] Action: ${isWrite ? 'write' : 'read'}`);

  if (isWrite) {
    const content = String(input.text ?? input.content ?? input.code ?? input.data ?? '');
    writeClipboard(content);
    console.log(`[Orvix Live Tool: manage_clipboard] Copied ${content.length} chars to clipboard.`);
    return {
      status: 'ok',
      action: 'write',
      length: content.length,
      preview: content.slice(0, 100),
      message: `Successfully copied ${content.length} characters to clipboard.`
    };
  } else {
    const content = readClipboard();
    console.log(`[Orvix Live Tool: manage_clipboard] Read ${content.length} chars from clipboard.`);
    return {
      status: 'ok',
      action: 'read',
      length: content.length,
      text: content.slice(0, 3000),
      message: content ? `Clipboard contains ${content.length} characters.` : 'Clipboard is currently empty.'
    };
  }
}

module.exports = {
  readClipboard,
  writeClipboard,
  manageClipboard
};
