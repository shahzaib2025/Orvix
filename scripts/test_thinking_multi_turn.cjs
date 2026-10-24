const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const fs = require('node:fs');
const { GoogleGenAI, Modality, ThinkingLevel, Behavior } = require('@google/genai');
const { loadLiveEnv } = require('../electron/live-env.cjs');
const { createLiveToken } = require('../electron/live-auth.cjs');

const root = path.resolve(__dirname, '..');
loadLiveEnv(root);

function requireTs(relPath) {
  const fullPath = path.join(root, relPath);
  const code = fs.readFileSync(fullPath, 'utf8');
  const compiled = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = new Module(fullPath, module);
  mod.filename = fullPath;
  mod.paths = Module._nodeModulePaths(path.dirname(fullPath));
  mod._compile(compiled, fullPath);
  return mod.exports;
}

const { formatThinkingPcContext } = requireTs('src/pcContext.ts');
const { buildThinkingSystemInstruction } = requireTs('src/thinkingFlow.ts');

const pcSnapshot = {
  Windows: [
    { Handle: 101, Pid: 1204, App: 'Code', Title: 'HistoryStore.cs - Orvix-Project-v2 - Visual Studio Code', State: 'maximized', Document: 'HistoryStore.cs', Active: true },
    { Handle: 102, Pid: 3412, App: 'chrome', Title: 'Google Gemini Documentation - Google Chrome', State: 'normal', Document: 'Google Gemini Documentation', Active: false },
    { Handle: 103, Pid: 5520, App: 'cmd', Title: 'Command Prompt - build.bat', State: 'normal', Document: 'Unknown', Active: false }
  ],
  Browsers: [
    { Name: 'Chrome', SeenUtc: new Date().toISOString(), Tabs: [{ id: 1, windowId: 1, title: 'Google Gemini Documentation', url: 'https://ai.google.dev/gemini-api/docs/live', active: true, audible: false, muted: false }], Videos: [] }
  ],
  Media: [
    { Source: 'Spotify', Title: 'Starboy', Artist: 'The Weeknd' }
  ],
  Volume: 65,
  Muted: false,
  Brightness: 90,
  Activity: {
    IdleSeconds: 10,
    IsIdle: false,
    NotificationState: 'Normal',
    IsPresentationOrFullscreen: false,
    TotalActiveSeconds: 4560,
    TotalIdleSeconds: 240,
    DwellTimes: [
      { App: 'Code', ActiveSeconds: 3120, Percent: 68, FormattedTime: '52m', IsCurrent: true },
      { App: 'chrome', ActiveSeconds: 1080, Percent: 24, FormattedTime: '18m', IsCurrent: false },
      { App: 'Spotify', ActiveSeconds: 360, Percent: 8, FormattedTime: '6m', IsCurrent: false }
    ]
  }
};

const prompts = [
  'আমি এখন আসলে কী কোড করছি আর কোন প্রজেক্টে আছি? একটু বিস্তারিত বলো তো মাহদিসকে।',
  'আমার ব্রাউজারে যে ট্যাবগুলো খোলা আছে, ওগুলো কি আমার এই কোডিংয়ের সাথেই রিলেটেড?',
  'আমার কাজের ফোকাস আর আজকের রুটিন কেমন দেখছো? আমার এখন কী করা উচিত?',
];

async function main() {
  console.log('================================================================');
  console.log('ORVIX BRAIN: THINKING PROFILE MULTI-TURN CONVERSATION BENCHMARK');
  console.log('================================================================\n');

  const today = '2026-09-29';
  const langClause = 'LANGUAGE DIRECTIVE: Always speak in natural, fluent everyday Bangla by default for all conversation and answers. Only switch to English if the user explicitly asks to speak in English.';
  const identity = 'User: Mahdis. Location: Rangpur, Bangladesh.';

  const groundedContext = formatThinkingPcContext(pcSnapshot);
  console.log('[Injected Telemetry Block]:\n' + groundedContext.trim() + '\n');

  const systemInstruction = buildThinkingSystemInstruction(today, langClause, identity, groundedContext);

  const { token, model } = await createLiveToken('Thinking', 'MEDIUM');
  const client = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });

  let session;
  let currentTurn = null;
  let currentUtterance = '';

  try {
    session = await client.live.connect({
      model,
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        systemInstruction,
      },
      callbacks: {
        onopen: () => {},
        onmessage: message => {
          if (!currentTurn) return;
          if (message.toolCall?.functionCalls?.length) {
            for (const call of message.toolCall.functionCalls) {
              currentTurn.tools.push(call.name);
            }
            session.sendToolResponse({
              functionResponses: message.toolCall.functionCalls.map(c => ({
                id: c.id, name: c.name, response: { status: 'mock' }
              }))
            });
          }
          const content = message.serverContent;
          if (!content) return;
          if (content.outputTranscription?.text) {
            currentUtterance += content.outputTranscription.text;
          }
          if (content.turnComplete || content.interactionStatus === 'IDLE') {
            if (currentUtterance) {
              currentTurn.reply = currentUtterance;
            }
          }
          if (content.interactionStatus === 'IDLE' && currentTurn.reply) {
            currentTurn.resolve();
          }
        },
        onerror: err => {
          currentTurn?.reject(err);
        },
        onclose: event => {
          currentTurn?.reject(new Error(`Session closed (${event.code})`));
        },
      },
    });

    for (let i = 0; i < prompts.length; i++) {
      const prompt = prompts[i];
      console.log(`----------------------------------------------------------------`);
      console.log(`TURN ${i + 1}:`);
      console.log(`Mahdis: "${prompt}"`);

      currentUtterance = '';
      const turnStart = Date.now();

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (currentTurn?.reply) resolve();
          else reject(new Error('Turn timed out after 35s'));
        }, 35_000);

        currentTurn = {
          prompt,
          reply: '',
          tools: [],
          resolve: () => { clearTimeout(timeout); resolve(); },
          reject: err => { clearTimeout(timeout); reject(err); },
        };

        session.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: prompt }] }],
          turnComplete: true,
        });
      });

      const elapsed = Date.now() - turnStart;
      console.log(`\nOrvix Thinking (${elapsed}ms, ${currentTurn.tools.length} tool calls):`);
      console.log(`"${currentTurn.reply.trim()}"\n`);
      currentTurn = null;

      // Natural pause between conversational turns
      await new Promise(r => setTimeout(r, 1200));
    }

  } finally {
    session?.close();
  }

  console.log('================================================================');
  console.log('THINKING PROFILE MULTI-TURN CONVERSATION COMPLETE');
  console.log('================================================================');
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
