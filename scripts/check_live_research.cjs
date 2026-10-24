// Opt-in live integration check. Uses the app's configured Gemini and search keys.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
require('../electron/live-env.cjs').loadLiveEnv(root);
const search = require('../electron/search.cjs');
const filename = path.join(root, 'src', 'liveVoice.probe.cjs');
const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'src', 'liveVoice.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true },
}).outputText;
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(path.dirname(filename));
loaded._compile(compiled, filename);
const { VoiceSession } = loaded.exports;
global.AudioContext = class { resume() { return Promise.resolve(); } close() { return Promise.resolve(); } };
global.window = { setTimeout, clearTimeout, orvixDesktop: {
  createLiveToken: process.env.ORVIX_PROBE_DIRECT === '1'
    ? async () => ({ token: process.env.GEMINI_API_KEY_159, model: 'gemini-3.8-live-extended-thinking' })
    : process.env.ORVIX_PROBE_UNLOCKED === '1'
    ? async () => {
      const { GoogleGenAI } = require('@google/genai');
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY_159, httpOptions: { apiVersion: 'v1beta' } });
      const issued = await ai.authTokens.create({ config: { uses: 1 } });
      return { token: issued.name, model: 'gemini-3.8-live-extended-thinking' };
    }
    : require('../electron/live-auth.cjs').createLiveToken,
  searchWeb: search.searchWeb,
  readSearchPage: search.readSearchResultPage,
  getWeather: require('../electron/weather.cjs').getWeather,
  ...require('../electron/live-fs-tools.cjs'),
  logLive: (level, message, data) => console.log(level, message, data || ''),
} };
VoiceSession.prototype.playAudio = () => {};
let spoke = false;
let finished = false;
let transcript = '';
const session = new VoiceSession('Thinking', 'MEDIUM', [], {
  onStatus(status, detail) {
    console.log(`[VoiceSession Status: ${status}]`, detail || '');
    if (status === 'error') finish(1, detail);
    if (status === 'listening' && spoke) finish(0, transcript);
  },
  onTranscript(entry) {
    if (entry.role === 'assistant') {
      spoke = true;
      transcript = entry.text;
      console.log(`[Assistant Spoke]: "${entry.text}"`);
    }
  },
});
const timeout = setTimeout(() => finish(1, 'Timed out. Last transcript: ' + transcript), 55_000);
function finish(code, message) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  session.stop();
  console.log('PROBE RESULT:', message);
  process.exitCode = code;
}
(async () => {
  await session.start(false);
  session.sendText(process.argv[2] || 'Search Google\'s official documentation for Gemini Live models. Read a result and tell me the model IDs it actually names, with the source URL.');
})().catch(error => finish(1, error.message));
