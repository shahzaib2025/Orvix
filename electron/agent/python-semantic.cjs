const path = require('node:path');
const { spawn } = require('node:child_process');

function queryPython({ root, file, action, line, column, signal }) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('Task cancelled.'));
    const env = { ...process.env, PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1' };
    for (const name of Object.keys(env)) if (/^(?:ORVIX_OPENCODE_(?:ZEN|GO)_KEY|ORVIX_KILO_KEY|KILO_API_KEY|ORVIX_INCEPTION_API_KEY)$/i.test(name)) delete env[name];
    const child = spawn('python', ['-I', '-B', path.join(__dirname, 'python-semantic.py')],
      { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let errorOutput = '';
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => { child.kill(); finish(new Error('Task cancelled.')); };
    const timer = setTimeout(() => { child.kill(); finish(new Error('Python semantic navigation timed out after 30 seconds.')); }, 30000);
    signal.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => {
      output += chunk.toString('utf8');
      if (output.length > 2_000_000) { child.kill(); finish(new Error('Python semantic result exceeded its limit.')); }
    });
    child.stderr.on('data', chunk => { errorOutput = (errorOutput + chunk.toString('utf8')).slice(-2000); });
    child.on('error', error => finish(new Error(`Python semantic navigation is unavailable: ${error.message}`)));
    child.on('close', code => {
      if (settled) return;
      if (code !== 0) return finish(new Error(`Python semantic navigation failed: ${errorOutput.trim() || `exit ${code}`}`));
      try {
        const result = JSON.parse(output);
        if (result.error) return finish(new Error(result.error));
        finish(null, result);
      } catch { finish(new Error('Python semantic navigation returned invalid data.')); }
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify({ root, file, action, line, column }));
    if (signal.aborted) abort();
  });
}

module.exports = { queryPython };
