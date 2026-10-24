// Live, opt-in integration conversation for the actual FastVoiceSession.
// Uses the configured provider and search routes; never prints credentials.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
require('../electron/live-env.cjs').loadLiveEnv(root);
const { createLiveToken } = require('../electron/live-auth.cjs');
const { searchWeb, readSearchResultPage } = require('../electron/search.cjs');
const filesystem = require('../electron/live-fs-tools.cjs');
const built = esbuild.buildSync({ entryPoints: [path.join(root, 'src/fastVoice.ts')], bundle: true,
  platform: 'node', format: 'cjs', write: false, external: ['@google/genai'], logLevel: 'silent' });
const loaded = new Module(path.join(__dirname, '.fast-research-check.cjs'), module);
loaded.filename = path.join(__dirname, '.fast-research-check.cjs');
loaded.paths = module.paths;
loaded._compile(built.outputFiles[0].text, loaded.filename);
const { FastVoiceSession } = loaded.exports;

const prompts = [
  'Please answer in English. If a web page cannot be read, what should you do before making a factual claim? Keep this answer brief; do not search yet.',
  'Now research deeply how OpenAI GPT and Google Gemini compare for live voice, tool calling, and coding. Use current official documentation. If a page fails, try a different source. Tell me what is verified and what remains unverified.',
  'Briefly tell me which source lookup failed in the previous answer and how you recovered. Do not use tools.',
];
const turns = [];
let active = null;
let failFirstPage = true;

global.window = { setTimeout, clearTimeout, orvixDesktop: {
  createLiveToken,
  searchWeb: async input => {
    active?.tools.push({ name: 'web_search', query: input.query });
    const result = await searchWeb(input);
    active?.tools.push({ name: 'web_search_result', status: result.status, count: result.count });
    return result;
  },
  readSearchPage: async input => {
    active?.tools.push({ name: 'read_web_page', url: input.url });
    if (failFirstPage && active?.index === 1) {
      failFirstPage = false;
      active.tools.push({ name: 'read_web_page_result', status: 'unavailable', injectedFailure: true });
      return { status: 'unavailable', url: input.url, message: 'Simulated page failure for recovery check.' };
    }
    const result = await readSearchResultPage(input);
    active?.tools.push({ name: 'read_web_page_result', status: result.status, source: result.source });
    return result;
  },
  getPcSnapshot: async () => null,
  ...filesystem,
  logLive: (kind, message, details) => {
    if (active && (kind === 'error' || kind === 'warn')) active.diagnostics.push({ kind, message,
      ...(details && typeof details === 'object' ? { details } : {}) });
  },
} };

const history = [];
const session = new FastVoiceSession(history, {
  onStatus(status, detail) {
    if (!active) return;
    active.statuses.push(status);
    if (detail) active.diagnostics.push({ status, detail });
    if (status === 'listening' && active.waiting) active.resolve();
    if (status === 'error' && active.waiting) active.reject(new Error(detail || 'Fast session error'));
  },
  onTranscript(entry) {
    if (!active || entry.role !== 'assistant') return;
    const existing = active.answers.findIndex(item => item.id === entry.id);
    const next = { id: entry.id, phase: entry.phase || 'stream', text: entry.text };
    if (existing < 0) active.answers.push(next);
    else active.answers[existing] = next;
  },
  onProgress(entry) {
    if (!active) return;
    if (active.progress.at(-1)?.text !== entry.text) active.progress.push({ phase: entry.phase, text: entry.text });
  },
});
session.audioEngine.playAudio = () => {};

async function main() {
  session.stopped = false;
  session.generation = 1;
  await session.connect(1);
  try {
    for (let index = 0; index < prompts.length; index++) {
      let timer;
      const done = new Promise((resolve, reject) => {
        active = { index, user: prompts[index], startedAt: new Date().toISOString(), answers: [], progress: [],
          tools: [], statuses: [], diagnostics: [], waiting: true, resolve, reject };
        timer = setTimeout(() => reject(new Error('Turn timed out')), index === 1 ? 480_000 : 90_000);
      });
      try {
        session.sendText(prompts[index]);
        await done;
      } catch (error) {
        active.error = error instanceof Error ? error.message : String(error);
      } finally {
        clearTimeout(timer);
        const { resolve, reject, waiting, ...report } = active;
        report.durationMs = Date.now() - Date.parse(report.startedAt);
        turns.push(report);
        console.log(JSON.stringify({ turn: index + 1, durationMs: report.durationMs,
          final: report.answers.filter(item => item.phase === 'final').map(item => item.text).join('\n\n').slice(0, 5000),
          progress: report.progress, tools: report.tools, diagnostics: report.diagnostics, error: report.error }));
        active = null;
      }
      if (turns[index].error) break;
    }
  } finally {
    session.stop();
    const reportPath = path.join(__dirname, 'check_fast_research_conversation.report.json');
    fs.writeFileSync(reportPath, JSON.stringify({ recordedAt: new Date().toISOString(), injectedFailure: true, turns }, null, 2));
    console.log(`Report saved: ${reportPath}`);
  }
  if (turns.length !== prompts.length || turns.some(turn => turn.error)) process.exitCode = 1;
}
main().catch(error => { session.stop(); console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
