const fs = require('node:fs');
const path = require('node:path');

// A bounded local trace, separate from audio. Snapshots are redacted in ThinkingVoice.
function appendThinkingTrace(filePath, record, maxBytes = 5 * 1024 * 1024) {
  if (!record || typeof record.event !== 'string' || typeof record.sessionId !== 'string') return;
  const line = JSON.stringify(record);
  if (Buffer.byteLength(line) > 64 * 1024) throw new Error('Thinking trace record exceeds the size limit.');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath) && fs.statSync(filePath).size + Buffer.byteLength(line) + 1 > maxBytes) {
    fs.rmSync(`${filePath}.previous`, { force: true });
    fs.renameSync(filePath, `${filePath}.previous`);
  }
  fs.appendFileSync(filePath, `${line}\n`, { encoding: 'utf8', mode: 0o600 });
}

module.exports = { appendThinkingTrace };
