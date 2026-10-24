// Opt-in real Gemini + production ThinkingVoiceSession + real read-only backends.
// Typed requests only: no microphone, audible playback or changing desktop actions.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { createHash } = require('node:crypto');
const esbuild = require('esbuild');
const { loadLiveEnv } = require('../electron/live-env.cjs');
const { createLiveToken } = require('../electron/live-auth.cjs');
const search = require('../electron/search.cjs');
const files = require('../electron/live-fs-tools.cjs');
const { getWeather } = require('../electron/weather.cjs');
const project = path.resolve(__dirname, '..');
loadLiveEnv(project);
const built = esbuild.buildSync({ entryPoints: [path.join(project, 'src/thinkingVoice.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@google/genai'], logLevel: 'silent' });
const loaded = new Module(path.join(__dirname, '.thinking-research-live.cjs'), module);
loaded.filename = path.join(__dirname, '.thinking-research-live.cjs'); loaded.paths = module.paths;
loaded._compile(built.outputFiles[0].text, loaded.filename);
const { ThinkingVoiceSession } = loaded.exports;

const scenarios = [
  { name: 'website', prompt: 'accha florianbd.com search diye dekho to ki', required: ['read_web_page'], requiredRead: /^https:\/\/(?:www\.)?florianbd\.com(?:\/|$)/ },
  { name: 'desktop', prompt: 'accha desktop er files gula ki ki ase dekho to', required: ['list_directory'] },
  { name: 'latest-models', prompt: 'google er letest model gula ki ki?', required: ['read_web_page'], requiredRead: /^https:\/\/ai\.google\.dev\/gemini-api\/docs\/models(?:[/?#]|$)/ },
  { name: 'diagnosis', optional: true, prompt: 'function calling e problem naki onno somossa? kothay provider theke somossa dicce naki onno somossa? logs chara sure hoye bolo na.', required: [] },
];
const selected = process.argv.find(arg => arg.startsWith('--scenario='))?.split('=')[1];
const suiteArg = process.argv.find(arg => arg.startsWith('--suite='))?.split('=')[1];
const apiVersion = process.argv.find(arg => arg.startsWith('--api-version='))?.split('=')[1] || 'v1alpha';
if (!['v1alpha', 'v1beta'].includes(apiVersion)) throw new Error('Use --api-version=v1alpha or --api-version=v1beta');
const roundsArg = Number(process.argv.find(arg => arg.startsWith('--rounds='))?.split('=')[1] || 1);
const rounds = Number.isInteger(roundsArg) && roundsArg >= 1 && roundsArg <= 3 ? roundsArg : 1;
const suites = suiteArg ? [suiteArg] : ['full', 'minimal'];
if (suites.some(value => !['full', 'minimal'].includes(value))) throw new Error('Use --suite=full or --suite=minimal');
if (selected && !scenarios.some(value => value.name === selected)) throw new Error('Unknown scenario');
const reportFile = path.join(project, 'scratch', `thinking-research-live-${suiteArg || 'comparison'}${selected ? `-${selected}` : ''}-${apiVersion}.json`);

async function main() {
  const report = { at: new Date().toISOString(), apiVersion, sourceHash: createHash('sha256').update(built.outputFiles[0].text).digest('hex'), scope: 'Real Gemini Extended Thinking LOW and real search/page/directory/weather backends; typed input, no microphone or audible playback, no changing actions. Acceptance checks calls, submission, required source URLs and absence of a model failure; answer accuracy also needs manual review.', suites: [], status: 'running' };
  const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  for (const suite of suites) for (let round = 1; round <= rounds; round++) {
    const run = { suite, round, turns: [], setup: [] }; report.suites.push(run);
    let voice, current, finish, fail, timer;
    const invoke = (name, fn) => async args => {
      const owner = current;
      const started = Date.now();
      const result = await fn(args);
      if (owner) owner.backends.push({ name, durationMs: Date.now() - started, status: result?.status,
        ...(name === 'list_directory' ? { totalCount: result.totalCount, folderCount: result.folderCount, fileCount: result.fileCount, truncated: result.truncated } : {}),
        ...(name === 'read_web_page' ? { url: result.url, source: result.source, truncated: result.truncated } : {}) });
      return result;
    };
    global.window = { setTimeout, clearTimeout, orvixDesktop: {
      createLiveToken, getPcSnapshot: async () => null,
      getWeather: invoke('get_weather', getWeather),
      listDirectory: invoke('list_directory', files.listDirectory),
      searchWeb: invoke('web_search', search.searchWeb),
      readSearchPage: invoke('read_web_page', search.readSearchResultPage),
      logLive(type, message, details) {
        if (details?.event) (current ? current.trace : run.setup).push(details);
        if (current && ['error', 'warn'].includes(type)) current.issues.push({ type, message });
      },
    } };
    try {
      voice = new ThinkingVoiceSession('LOW', [], {
        onStatus(status, detail) {
          if (current) current.states.push({ status, detail });
          if (status === 'error') fail?.(new Error(detail || 'Thinking failed'));
        },
        onTranscript(value) {
          if (current && value.role === 'assistant') {
            if (value.phase === 'final') { current.final = value.text; finish?.(); }
          }
        },
      }, null, { apiVersion, ...(suite === 'minimal' ? { toolNames: ['list_directory', 'web_search', 'read_web_page'] } : {}) });
      voice.audioEngine.ensureContext = async () => {};
      voice.audioEngine.playAudio = () => {};
      await voice.start(false);
      for (const scenario of scenarios.filter(item => selected ? item.name === selected : !item.optional || process.argv.includes('--diagnosis'))) {
        current = { name: scenario.name, prompt: scenario.prompt, backends: [], trace: [], states: [], issues: [], status: 'running' };
        run.turns.push(current);
        const started = Date.now();
        const done = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
        timer = setTimeout(() => fail(new Error('No final answer within 95 seconds')), 95_000);
        try {
          voice.sendText(scenario.prompt);
          await done;
          current.durationMs = Date.now() - started;
          const idle = current.trace.findLast(item => item.event === 'turn_idle');
          const sent = current.trace.filter(item => item.event === 'response_submitted').flatMap(item => item.data.ids);
          current.summary = { callNames: current.trace.filter(item => item.event === 'tool_received').map(item => item.data.name), submittedIds: sent,
            modelReportedFailure: idle?.data.modelReportedFailure, submissionErrors: current.trace.filter(item => item.event === 'response_submission_failed').length,
            interruptions: current.trace.filter(item => item.event === 'speech_interrupted').length,
            transportErrors: current.trace.filter(item => ['socket_error', 'connection_close'].includes(item.event)).length };
          const missing = scenario.required.filter(name => !current.summary.callNames.includes(name));
          const backendFailures = current.backends.filter(item => !['ok', 'no_results'].includes(item.status));
          const requiredSourceRead = !scenario.requiredRead || current.backends.some(item => item.name === 'read_web_page' && item.status === 'ok' && scenario.requiredRead.test(item.url || ''));
          current.summary.requiredSourceRead = requiredSourceRead;
          current.status = !missing.length && !backendFailures.length && requiredSourceRead && !current.summary.modelReportedFailure && !current.summary.submissionErrors && current.final ? 'passed' : 'failed';
          if (missing.length) current.missingCalls = missing;
          if (backendFailures.length) current.backendFailures = backendFailures;
          if (!requiredSourceRead) current.sourceFailure = 'Required website or official model catalog was not read.';
        } catch (error) { current.status = 'failed'; current.failure = error.message; current.durationMs = Date.now() - started; }
        finally { clearTimeout(timer); finish = undefined; fail = undefined; }
        console.log(JSON.stringify({ suite, round, name: current.name, durationMs: current.durationMs, status: current.status, summary: current.summary, final: current.final, failure: current.failure }));
        save();
        if (current.failure) break; // Timed-out generation cannot contaminate the next turn.
        current = null;
      }
    } catch (error) { run.failure = error.message; }
    finally { clearTimeout(timer); voice?.stop(); save(); }
  }
  report.status = report.suites.every(run => !run.failure && run.turns.length && run.turns.every(turn => turn.status === 'passed')) ? 'passed' : 'failed';
  save();
  console.log(`Thinking research comparison: ${report.status}; report: ${reportFile}`);
  if (report.status !== 'passed') process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
