const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { GoogleGenAI, Modality, ThinkingLevel, Behavior } = require('@google/genai');
const { loadLiveEnv } = require('../electron/live-env.cjs');
const { createLiveToken } = require('../electron/live-auth.cjs');
const weatherDeclarations = require('../shared/weather-tool.json').functionDeclarations;
const { getWeather } = require('../electron/weather.cjs');

const project = path.join(__dirname, '..');
const built = esbuild.buildSync({
  entryPoints: [path.join(project, 'src/thinkingFlow.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent',
});
const loaded = new Module(path.join(__dirname, '.thinking-audit.cjs'), module);
loaded.filename = path.join(__dirname, '.thinking-audit.cjs');
loaded.paths = module.paths;
loaded._compile(built.outputFiles[0].text, loaded.filename);
const { buildThinkingSystemInstruction } = loaded.exports;

const colorTool = {
  name: 'check_sample',
  description: 'Looks up the color and shape of a sample item. Use this whenever the user asks for facts about the sample item.',
  behavior: Behavior.NON_BLOCKING,
  parameters: { type: 'OBJECT', properties: { item: { type: 'STRING' } }, required: ['item'] },
};

async function auditSession(depth, scenarios, toolKind = 'color', profile = 'Thinking') {
  const { token, model } = await createLiveToken(profile, depth);
  const client = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });
  let session;
  let current = null;
  let utterance = '';
  const log = [];
  try {
    session = await client.live.connect({
      model,
      config: {
        responseModalities: [Modality.AUDIO],
        outputAudioTranscription: {},
        ...(profile === 'Thinking' ? { thinkingConfig: { thinkingLevel: ThinkingLevel[depth] } } : {}),
        systemInstruction: process.argv.includes('--minimal-prompt')
          ? 'Speak English. Use get_weather when asked for current weather. Use check_sample when asked about the sample item.'
          : buildThinkingSystemInstruction('2026-09-28', 'Speak English for this test.', ''),
        tools: [{ functionDeclarations: toolKind === 'weather'
          ? weatherDeclarations.map(item => profile === 'Thinking' ? ({ ...item, behavior: Behavior.NON_BLOCKING }) : item)
          : [profile === 'Thinking' ? colorTool : { ...colorTool, behavior: undefined }] }],
      },
      callbacks: {
        onopen: () => {},
        onmessage: message => {
          if (!current) return;
          for (const call of message.toolCall?.functionCalls ?? []) {
            current.calls.push({ name: call.name, args: call.args });
            current.toolsPending = (current.toolsPending || 0) + 1;
            setTimeout(() => {
              Promise.resolve(toolKind === 'weather' ? getWeather(call.args || {}) : current.toolError
                ? { status: 'unavailable', message: 'The sample lookup is unavailable.' }
                : { status: 'ok', color: 'blue', shape: 'round' })
                .then(response => {
                  session.sendToolResponse({ functionResponses: [{ id: call.id, name: call.name, response }] });
                  if (current) current.toolsPending = Math.max(0, (current.toolsPending || 0) - 1);
                })
                .catch(error => current?.reject(error));
            }, current.toolDelayMs || 0);
          }
          const content = message.serverContent;
          if (!content) return;
          if (content.outputTranscription?.text) utterance += content.outputTranscription.text;
          if (content.turnComplete || content.interactionStatus === 'IDLE') {
            if (utterance.trim()) current.utterances.push({ status: content.interactionStatus || (profile === 'Fast' ? 'IDLE' : 'unknown'), text: utterance.trim() });
            utterance = '';
          }
          if (content.interactionStatus === 'IDLE' || (profile === 'Fast' && content.turnComplete && !current.toolsPending && current.utterances.some(u => u.text))) current.resolve();
        },
        onerror: error => current?.reject(error),
        onclose: event => current?.reject(new Error(`Live connection closed (${event.code})`)),
      },
    });
    for (const scenario of scenarios) {
      const item = { name: scenario.name, depth, prompt: scenario.prompt, toolError: scenario.toolError, toolDelayMs: scenario.toolDelayMs, calls: [], utterances: [] };
      log.push(item);
      utterance = '';
      let timer;
      const completed = new Promise((resolve, reject) => {
        item.resolve = resolve;
        item.reject = reject;
        timer = setTimeout(() => reject(new Error('Turn timed out after 100 seconds')), 100_000);
      });
      current = item;
      try {
        session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: scenario.prompt }] }], turnComplete: true });
        await completed;
      } catch (error) {
        item.error = error instanceof Error ? error.message : String(error);
      } finally {
        clearTimeout(timer);
        delete item.resolve;
        delete item.reject;
        delete item.toolError;
        delete item.toolDelayMs;
        console.log(JSON.stringify(item));
        current = null;
      }
    }
  } finally {
    session?.close();
  }
  return log;
}

async function main() {
  loadLiveEnv(project);
  const results = [];
  if (process.argv.includes('--simple-depths')) {
    for (const depth of ['LOW', 'MEDIUM', 'HIGH']) {
      results.push(...await auditSession(depth, [{ name: 'simple', prompt: 'What is seven plus five? Answer in one short sentence.' }]));
    }
  } else if (process.argv.includes('--fast-weather')) {
    results.push(...await auditSession('LOW', [{ name: 'fast_weather', prompt: 'Please check the current weather in Rangpur, Bangladesh, and tell me the temperature in Celsius.' }], 'weather', 'Fast'));
  } else if (process.argv.includes('--weather-depths')) {
    for (const depth of ['LOW', 'MEDIUM', 'HIGH']) {
      results.push(...await auditSession(depth, [{ name: 'weather', prompt: 'Please check the current weather in Rangpur, Bangladesh, and tell me the temperature in Celsius.' }], 'weather'));
    }
  } else {
  results.push(...await auditSession('LOW', [
    { name: 'simple', prompt: 'What is seven plus five? Answer in one short sentence.' },
    { name: 'tool', prompt: 'Use check_sample to find the sample item’s color and shape, then tell me both.' },
    { name: 'followup', prompt: 'What color was the sample item you just checked?' },
    { name: 'tool_failure', prompt: 'Check the sample item again and tell me its color only if the lookup succeeds.', toolError: true },
  ]));
  results.push(...await auditSession('MEDIUM', [
    { name: 'medium_tool', prompt: 'Use check_sample to find the sample item’s color and shape, then tell me both.' },
  ]));
  results.push(...await auditSession('HIGH', [
    { name: 'high_tool', prompt: 'Use check_sample to find the sample item’s color and shape, then tell me both.' },
  ]));
  }
  const summary = results.map(item => ({
    name: item.name,
    depth: item.depth,
    interimUtterance: item.utterances.some(u => u.status === 'IN_PROGRESS' && u.text),
    toolCalled: item.calls.length > 0,
    final: item.utterances.findLast(u => u.status === 'IDLE')?.text || '',
    error: item.error || null,
  }));
  console.log('SUMMARY ' + JSON.stringify(summary));
  if (summary.some(item => item.error || !item.final || /system error occurred/i.test(item.final))) process.exitCode = 1;
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
