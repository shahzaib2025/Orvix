// Run only to restore an existing Orvix Construction Lock using its saved journal.
const path = require('node:path');
const { createConstructionLocks } = require('../electron/construction-lock.cjs');
const engine = createConstructionLocks({ getPath: () => path.join(process.env.APPDATA, 'Orvix'), getAppPath: () => path.join(__dirname, '..') });
(async () => {
  try { const before = engine.list(); console.log('Recovery status:', before.lock?.status || 'none'); const result = await engine.unlock(); console.log('Recovery result:', result.lock?.status || 'none'); }
  finally { engine.stop(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
