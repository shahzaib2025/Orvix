// Real model and production session, with harmless synthetic tool outputs.
// Does not access the microphone, play audio, or change desktop/files.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { loadLiveEnv } = require('../electron/live-env.cjs');
const { createLiveToken } = require('../electron/live-auth.cjs');
const project = path.resolve(__dirname, '..');
loadLiveEnv(project);
const built = esbuild.buildSync({ entryPoints: [path.join(project, 'src/thinkingVoice.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@google/genai'], logLevel: 'silent' });
const loaded = new Module(path.join(__dirname, '.thinking-production-live.cjs'), module);
loaded.filename = path.join(__dirname, '.thinking-production-live.cjs'); loaded.paths = module.paths;
loaded._compile(built.outputFiles[0].text, loaded.filename);
const { ThinkingVoiceSession } = loaded.exports;

async function main() {
  const report = { at: new Date().toISOString(), model: 'gemini-3.8-live-extended-thinking', scope: 'Production ThinkingVoiceSession with real Gemini Live; typed input and synthetic read-only tool outputs. No microphone or audible playback.', turns: [], status: 'running' };
  let voice, current, resolveTurn, rejectTurn, timer;
  global.window = { setTimeout, clearTimeout, orvixDesktop: {
    createLiveToken,
    getPcSnapshot: async () => null,
    getWeather: async () => {
      if (!current) return { status: 'unavailable' };
      current.calls.push({ name: 'get_weather' });
      return { status: 'ok', location: 'Dhaka, Bangladesh', temperature: '23.7 degrees C', conditions: 'clear', humidity: '40%', todayHigh: '25 degrees C', todayLow: '20 degrees C' };
    },
    listDirectory: async () => {
      if (!current) return { status: 'ok', directory: 'Desktop', folders: [], files: [] };
      current.calls.push({ name: 'list_directory' });
      return { status: 'ok', directory: 'Desktop', folders: [], files: ['blue.txt'], totalCount: 1 };
    },
    tinyWorkflowCapabilities: async () => {
      current.calls.push({ name: 'tiny_workflow_capabilities' });
      return { status: 'ok', testTrigger: 'daily', message: 'The supported test trigger is daily.' };
    },
    logLive(type, message) { if (current && type === 'error') current.errors.push(message); },
  } };
  try {
    voice = new ThinkingVoiceSession('LOW', [], {
      onStatus(status, detail) { if (current) current.states.push({ status, detail }); if (status === 'error') rejectTurn?.(new Error(detail || 'Thinking failed')); },
      onTranscript(value) { if (current && value.role === 'assistant') { current.transcripts.push({ text: value.text, phase: value.phase }); if (value.phase === 'final') resolveTurn?.(); } },
    });
    voice.audioEngine.ensureContext = async () => {};
    voice.audioEngine.playAudio = () => {};
    await voice.start(false);
    const scenarios = [
      { tool: 'list_directory', prompt: 'Reply in English. Call list_directory with directory Desktop to freshly inspect it, even if initial context contains a listing. Tell me the exact returned file name.', expected: /blue/i },
      { tool: 'get_weather', prompt: 'Reply in English. Call get_weather for Dhaka and tell me the temperature returned by that function.', expected: /23[.,]7|twenty.?three/i },
      { tool: 'tiny_workflow_capabilities', prompt: 'Reply in English. Call tiny_workflow_capabilities and tell me the supported test trigger returned in its data. Do not draft, approve or execute a workflow.', expected: /daily/i },
      { tool: 'combined', requiredTools: ['list_directory', 'get_weather'], prompt: 'Reply in English. Do both parts: call list_directory with directory Desktop again and call get_weather for Dhaka again. Give a final answer containing the freshly returned file name and temperature.', expected: /blue/i, alsoExpected: /23[.,]7|twenty.?three/i },
    ];
    for (const scenario of scenarios) {
      current = { tool: scenario.tool, calls: [], transcripts: [], states: [], errors: [] };
      report.turns.push(current);
      const done = new Promise((resolve, reject) => { resolveTurn = resolve; rejectTurn = reject; });
      timer = setTimeout(() => rejectTurn(new Error('No final answer within 60 seconds')), 60_000);
      voice.sendText(scenario.prompt);
      try {
        await done;
        for (const name of scenario.requiredTools || [scenario.tool]) assert.ok(current.calls.some(c => c.name === name), `No ${name} call received`);
        const text = current.transcripts.at(-1)?.text || '';
        assert.match(text, scenario.expected, 'Final answer did not use the synthetic tool data');
        if (scenario.alsoExpected) assert.match(text, scenario.alsoExpected, 'Final answer missed the second requested outcome');
        assert.doesNotMatch(text, /system error|technical (?:error|issue|problem)|সিস্টেম\s*(?:ত্রুটি|সমস্যা)/i);
        current.status = 'passed';
      } catch (error) { current.status = 'failed'; current.failure = error.message; }
      finally { clearTimeout(timer); resolveTurn = undefined; rejectTurn = undefined; }
      console.log(JSON.stringify({ tool: current.tool, calls: current.calls, final: current.transcripts.at(-1), status: current.status, failure: current.failure }));
    }
    report.status = report.turns.length === scenarios.length && report.turns.every(t => t.status === 'passed') ? 'passed' : 'failed';
  } catch (error) { report.status = 'failed'; report.failure = error.message; }
  finally {
    clearTimeout(timer); voice?.stop();
    fs.writeFileSync(path.join(project, 'scratch', 'thinking-production-live-latest.json'), JSON.stringify(report, null, 2));
  }
  console.log(`Production Thinking live check: ${report.status}`);
  if (report.status !== 'passed') process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
