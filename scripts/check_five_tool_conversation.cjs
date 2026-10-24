const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { loadLiveEnv } = require('../electron/live-env.cjs');
const { createLiveToken } = require('../electron/live-auth.cjs');
const { getWeather } = require('../electron/weather.cjs');
const { searchWeb, readSearchResultPage } = require('../electron/search.cjs');
const filesystem = require('../electron/live-fs-tools.cjs');

const project = path.join(__dirname, '..');
const built = esbuild.buildSync({
  entryPoints: [path.join(project, 'src/liveVoice.ts')], bundle: true, platform: 'node', format: 'cjs',
  write: false, external: ['@google/genai'], logLevel: 'silent',
});
const loaded = new Module(path.join(__dirname, '.five-tools-check.cjs'), module);
loaded.filename = path.join(__dirname, '.five-tools-check.cjs');
loaded.paths = module.paths;
loaded._compile(built.outputFiles[0].text, loaded.filename);
const { VoiceSession } = loaded.exports;

const questions = [
  'Please speak English from now on. Check the current weather in Rangpur, Bangladesh, and tell me the temperature and humidity.',
  'Check the current weather in Dhaka, Bangladesh, and compare its temperature with Rangpur.',
  'Search the web for Google’s official Gemini Live Extended Thinking documentation and tell me which thinking levels it supports.',
  'Search for the official Google Live API tools page, read that page, and tell me what it says about asynchronous function calling.',
  'Read this project’s package.json at C:\\Users\\HP\\Desktop\\Orvix-Project-v2\\package.json and tell me the app name and version.',
];

async function main() {
  loadLiveEnv(project);
  let active = null;
  const wrap = (name, handler) => async args => {
    active?.tools.push({ name, args, phase: 'called' });
    const result = await handler(args);
    active?.tools.push({ name, phase: 'result', status: result?.status ?? (result?.error ? 'error' : 'ok') });
    return result;
  };
  global.window = {
    setTimeout, clearTimeout,
    orvixDesktop: {
      createLiveToken,
      getWeather: wrap('get_weather', getWeather),
      searchWeb: wrap('web_search', searchWeb),
      readSearchPage: wrap('read_web_page', readSearchResultPage),
      readFile: wrap('read_file', filesystem.readFile),
      listDirectory: wrap('list_directory', filesystem.listDirectory),
      searchFiles: wrap('search_files', filesystem.searchFiles),
      searchContent: wrap('search_content', filesystem.searchContent),
      logLive: (_kind, message) => { if (active && /Tool .*FAILED|Gemini spoke a system error|turn completion reason/i.test(message)) active.diagnostics.push(message); },
    },
  };
  const history = [];
  const session = new VoiceSession('Thinking', 'MEDIUM', history, {
    onStatus: (status, detail) => {
      if (!active) return;
      active.statuses.push(status);
      if (detail) active.diagnostics.push(detail);
      if (status === 'listening' && active.waitingForReply) active.resolve();
      if (status === 'error' && active.waitingForReply) active.reject(new Error(detail || 'Voice session error'));
    },
    onTranscript: entry => {
      if (!active || entry.role !== 'assistant') return;
      const index = active.responses.findIndex(item => item.id === entry.id);
      const value = { id: entry.id, phase: entry.phase || 'final', text: entry.text };
      if (index < 0) active.responses.push(value);
      else active.responses[index] = value;
    },
    onProgress: entry => { if (active) active.progress.push({ phase: entry.phase, text: entry.text }); },
  });
  session.stopped = false;
  session.generation = 1;
  try {
    await session.connect(1);
    for (const question of questions) {
      let timer;
      const finished = new Promise((resolve, reject) => {
        active = { user: question, responses: [], progress: [], tools: [], statuses: [], diagnostics: [], waitingForReply: true, resolve, reject };
        timer = setTimeout(() => reject(new Error('Turn timed out after 100 seconds')), 100_000);
      });
      try {
        session.sendText(question);
        await finished;
      } catch (error) {
        active.error = error instanceof Error ? error.message : String(error);
      } finally {
        clearTimeout(timer);
        const { resolve, reject, waitingForReply, ...report } = active;
        report.responses = report.responses.map(({ phase, text }) => ({ phase, text }));
        console.log(JSON.stringify(report));
        active = null;
      }
    }
  } finally {
    session.stop();
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
