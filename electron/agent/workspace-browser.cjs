const fs = require('node:fs');
const path = require('node:path');
const { isHiddenPath } = require('./file-policy.cjs');
const { listWorkspaceFiles } = require('./project-map.cjs');

const MAX_LISTED_FILES = 30000;
const MAX_READ_BYTES = 2 * 1024 * 1024;

function createWorkspaceBrowser(workspaces) {
  async function list(taskId, workspaceRoot) {
    const root = workspaces.assert(taskId, workspaceRoot);
    if (isHiddenPath(root)) throw new Error('System, generated and credential files are unavailable in the workspace browser.');
    const info = await fs.promises.stat(root);
    if (!info.isDirectory()) throw new Error('Choose an open workspace folder.');
    const discovered = await listWorkspaceFiles(root, new AbortController().signal);
    const files = discovered.filter(file => !isHiddenPath(file));
    return {
      root,
      files: files.slice(0, MAX_LISTED_FILES).map(file => ({
        path: file,
        relativePath: path.relative(root, file),
      })),
      total: files.length,
      truncated: files.length > MAX_LISTED_FILES,
    };
  }

  async function read(taskId, requestedFile) {
    const file = workspaces.assert(taskId, requestedFile);
    if (isHiddenPath(file)) throw new Error('System, generated and credential files are unavailable in the workspace browser.');
    const info = await fs.promises.stat(file);
    if (!info.isFile()) throw new Error('Choose a file inside an open workspace.');
    if (info.size > MAX_READ_BYTES) return { path: file, content: null, binary: false, tooLarge: true, size: info.size };
    const bytes = await fs.promises.readFile(file);
    if (bytes.includes(0)) return { path: file, content: null, binary: true, tooLarge: false, size: info.size };
    try {
      const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return { path: file, content, binary: false, tooLarge: false, size: info.size };
    } catch {
      return { path: file, content: null, binary: true, tooLarge: false, size: info.size };
    }
  }

  return { list, read };
}

module.exports = { createWorkspaceBrowser, MAX_LISTED_FILES, MAX_READ_BYTES };
