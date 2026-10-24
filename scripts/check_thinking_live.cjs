const path = require('node:path');
const assert = require('node:assert/strict');
const Module = require('node:module');
const esbuild = require('esbuild');
const { GoogleGenAI, Modality, ThinkingLevel, Behavior } = require('@google/genai');
const { loadLiveEnv } = require('../electron/live-env.cjs');
const { createLiveToken } = require('../electron/live-auth.cjs');

const project = path.join(__dirname, '..');
const built = esbuild.buildSync({
  entryPoints: [path.join(project, 'src/thinkingFlow.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent',
});
const loaded = new Module(path.join(__dirname, '.thinking-live-check.cjs'), module);
loaded.filename = path.join(__dirname, '.thinking-live-check.cjs');
loaded.paths = module.paths;
loaded._compile(built.outputFiles[0].text, loaded.filename);
const { buildThinkingSystemInstruction } = loaded.exports;

async function main() {
  loadLiveEnv(project);
  const { token, model } = await createLiveToken('Thinking', 'LOW');
  const client = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });
  let session;
  let utterance = '';
  const utterances = [];
  const statuses = [];
  const toolCalls = [];
  let settle;
  const result = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  const timeout = setTimeout(() => settle.reject(new Error('Live turn timed out after 90 seconds')), 90_000);
  try {
    session = await client.live.connect({
      model,
      config: {
        responseModalities: [Modality.AUDIO],
        outputAudioTranscription: {},
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        systemInstruction: buildThinkingSystemInstruction('2026-09-28', 'Speak English for this test.', ''),
        tools: [{ functionDeclarations: [{
          name: 'check_sample',
          description: 'Retrieve the test facts needed to answer the question.',
          behavior: Behavior.NON_BLOCKING,
          parameters: { type: 'OBJECT', properties: { topic: { type: 'STRING' } } },
        }] }],
      },
      callbacks: {
        onopen: () => {},
        onmessage: message => {
          if (message.toolCall?.functionCalls?.length) {
            toolCalls.push(...message.toolCall.functionCalls.map(call => ({ name: call.name, hasId: Boolean(call.id) })));
            session.sendToolResponse({ functionResponses: message.toolCall.functionCalls.map(call => ({
              id: call.id, name: call.name, response: { status: 'ok', fact: 'The sample item is blue.' },
            })) });
          }
          const content = message.serverContent;
          if (!content) return;
          if (content.outputTranscription?.text) utterance += content.outputTranscription.text;
          if (content.interactionStatus) statuses.push(content.interactionStatus);
          if (content.turnComplete || content.interactionStatus === 'IDLE') {
            if (utterance.trim()) utterances.push({ status: content.interactionStatus || 'unknown', text: utterance.trim() });
            utterance = '';
          }
          if (content.interactionStatus === 'IDLE') settle.resolve();
        },
        onerror: error => settle.reject(error),
        onclose: event => settle.reject(new Error(`Live connection closed (${event.code})`)),
      },
    });
    session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: 'Use check_sample to get the sample item’s color, then tell me the color.' }] }], turnComplete: true });
    await result;
    console.log(JSON.stringify({ statuses, toolCalls, utterances }, null, 2));
    assert.ok(utterances.some(item => item.status === 'IN_PROGRESS' && item.text), 'No spoken acknowledgement arrived before the final answer');
    assert.ok(toolCalls.some(item => item.name === 'check_sample' && item.hasId), 'Gemini did not call the sample tool');
    assert.ok(utterances.some(item => item.status === 'IDLE' && /blue/i.test(item.text)), 'No usable final answer arrived');
  } finally {
    clearTimeout(timeout);
    session?.close();
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
