const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { GoogleGenAI, Modality, ThinkingLevel, Behavior } = require('@google/genai');
const { loadLiveEnv } = require('../electron/live-env.cjs');
const { createLiveToken } = require('../electron/live-auth.cjs');
const { getWeather } = require('../electron/weather.cjs');
const { searchWeb, readSearchResultPage } = require('../electron/search.cjs');
const filesystem = require('../electron/live-fs-tools.cjs');

const project = path.join(__dirname, '..');
const built = esbuild.buildSync({
  entryPoints: [path.join(project, 'src/thinkingFlow.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent',
});
const loaded = new Module(path.join(__dirname, '.thinking-conversation.cjs'), module);
loaded.filename = path.join(__dirname, '.thinking-conversation.cjs');
loaded.paths = module.paths;
loaded._compile(built.outputFiles[0].text, loaded.filename);
const { buildThinkingSystemInstruction } = loaded.exports;

const languageDirective = `LANGUAGE DIRECTIVE (CRITICAL):
Your default speaking and responding voice is ALWAYS BANGLA (বাংলা).
You must ALWAYS respond in natural, fluent Bangla by default for all questions, queries, chit-chat, and tool responses, regardless of whether the user speaks or writes in English or any other language.
EXCEPTION: Only switch to and speak in another language (such as English) if the user explicitly commands or asks you to speak in that other language (e.g., "speak in English", "reply in English", "can we switch to English?"). Otherwise, always speak in Bangla.`;

const declarations = [
  ...require('../shared/weather-tool.json').functionDeclarations,
  ...require('../shared/search-tool.json').functionDeclarations,
  ...require('../shared/page-tool.json').functionDeclarations,
  ...require('../shared/filesystem-tools.json').functionDeclarations,
].map(item => ({ ...item, behavior: Behavior.NON_BLOCKING }));
const toolHandlers = {
  get_weather: getWeather,
  web_search: searchWeb,
  read_web_page: readSearchResultPage,
  read_file: filesystem.readFile,
  list_directory: filesystem.listDirectory,
  search_files: filesystem.searchFiles,
  search_content: filesystem.searchContent,
};

const prompts = [
  'Please speak English from now on. Hi, Orvix.',
  'Could you check the current weather in Rangpur, Bangladesh?',
  'Based on that, would it be comfortable to go outside right now?',
  'What did you find, and what are you still unsure about?',
];
if (process.argv.includes('--weather-only')) prompts.splice(2);
if (process.argv.includes('--five-tools')) prompts.splice(0, prompts.length,
  'Please speak English from now on. Check the current weather in Rangpur, Bangladesh, and tell me the temperature and humidity.',
  'Check the current weather in Dhaka, Bangladesh, and compare its temperature with Rangpur.',
  'Search the web for Google’s official Gemini Live Extended Thinking documentation and tell me which thinking levels it supports.',
  'Read the official Google page you found and check what it says about asynchronous function calling.',
  'Read this project’s package.json at C:\\Users\\HP\\Desktop\\Orvix-Project-v2\\package.json and tell me the app name and version.',
);

async function main() {
  loadLiveEnv(project);
  const { token, model } = await createLiveToken('Thinking', 'MEDIUM');
  const client = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });
  let session;
  let turn = null;
  let utterance = '';
  try {
    session = await client.live.connect({
      model,
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        tools: [{ functionDeclarations: declarations }],
        systemInstruction: buildThinkingSystemInstruction('2026-09-28', languageDirective, ''),
      },
      callbacks: {
        onopen: () => {},
        onmessage: message => {
          if (!turn) return;
          if (message.toolCallCancellation?.ids?.length) turn.timeline.push({ ms: Date.now() - turn.startedAt, event: 'tool_cancel', ids: message.toolCallCancellation.ids });
          if (message.goAway) turn.timeline.push({ ms: Date.now() - turn.startedAt, event: 'go_away', timeLeft: message.goAway.timeLeft });
          for (const call of message.toolCall?.functionCalls ?? []) {
            turn.toolCalls.push({ name: call.name, args: call.args });
            turn.timeline.push({ ms: Date.now() - turn.startedAt, event: 'tool_call', name: call.name });
            const handler = toolHandlers[call.name];
            Promise.resolve().then(() => handler ? handler(call.args || {}) : ({ error: 'Unknown tool' }))
              .then(response => {
                turn.toolResults.push({ name: call.name, status: response?.status ?? (response?.error ? 'error' : 'ok') });
                turn.timeline.push({ ms: Date.now() - turn.startedAt, event: 'tool_result', name: call.name, status: response?.status ?? (response?.error ? 'error' : 'ok') });
                session.sendToolResponse({ functionResponses: [{ id: call.id, name: call.name, response }] });
              })
              .catch(error => turn?.reject(error));
          }
          const content = message.serverContent;
          if (!content) return;
          if (content.turnCompleteReason) turn.timeline.push({ ms: Date.now() - turn.startedAt, event: 'turn_reason', reason: content.turnCompleteReason });
          if (content.interactionStatus) turn.timeline.push({ ms: Date.now() - turn.startedAt, event: 'interaction_status', status: content.interactionStatus });
          if (content.outputTranscription?.text) utterance += content.outputTranscription.text;
          for (const part of content.modelTurn?.parts ?? []) {
            if (part.inlineData?.mimeType?.startsWith('audio/')) turn.audioChunks++;
          }
          if (content.turnComplete || content.interactionStatus === 'IDLE') {
            if (utterance) {
              turn.responses.push({ status: content.interactionStatus || 'unknown', text: utterance });
              turn.timeline.push({ ms: Date.now() - turn.startedAt, event: 'speech', status: content.interactionStatus || 'unknown', text: utterance });
            }
            utterance = '';
          }
          if (content.interactionStatus === 'IDLE') turn.resolve();
        },
        onerror: error => {
          turn?.timeline.push({ ms: Date.now() - turn.startedAt, event: 'socket_error', message: String(error?.message || error?.type || error) });
          turn?.reject(error);
        },
        onclose: event => {
          turn?.timeline.push({ ms: Date.now() - turn.startedAt, event: 'socket_close', code: event.code, reason: event.reason });
          turn?.reject(new Error(`Live connection closed (${event.code})`));
        },
      },
    });

    for (const prompt of prompts) {
      let timeout;
      const finished = new Promise((resolve, reject) => {
        turn = { user: prompt, responses: [], toolCalls: [], toolResults: [], audioChunks: 0, startedAt: Date.now(), timeline: [], resolve, reject };
        timeout = setTimeout(() => reject(new Error('Turn timed out after 90 seconds')), 90_000);
      });
      utterance = '';
      try {
        session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: prompt }] }], turnComplete: true });
        await finished;
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (error) {
        turn.error = error instanceof Error ? error.message : String(error);
      } finally {
        clearTimeout(timeout);
        const { resolve, reject, ...report } = turn;
        console.log(JSON.stringify(report));
        turn = null;
      }
    }
  } finally {
    session?.close();
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
