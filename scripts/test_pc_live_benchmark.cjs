const { GoogleGenAI } = require('@google/genai');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require('../electron/live-env.cjs').loadLiveEnv(root);
const { createLiveToken } = require('../electron/live-auth.cjs');
const Module = require('node:module');
const ts = require('typescript');
const fs = require('node:fs');

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

const { formatFastPcContext, formatThinkingPcContext } = requireTs('src/pcContext.ts');
const { buildFastSystemInstruction, buildThinkingSystemInstruction } = requireTs('src/thinkingFlow.ts');

async function runLiveVoiceTurn(profile, systemInstruction, userText) {
  const depth = profile === 'Thinking' ? 'LOW' : undefined;
  const { token, model } = await createLiveToken(profile, depth);
  const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });

  const declarations = [
    { name: 'get_weather', description: 'Get weather', parameters: { type: 'OBJECT', properties: { location: { type: 'STRING' } } } },
    { name: 'read_file', description: 'Read local file', parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' } } } },
    { name: 'list_directory', description: 'List folder', parameters: { type: 'OBJECT', properties: { directory: { type: 'STRING' } } } },
  ];

  const config = {
    responseModalities: ['AUDIO'],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    tools: [{ functionDeclarations: declarations }],
    systemInstruction,
    ...(profile === 'Thinking' ? { thinkingConfig: { thinkingLevel: 'LOW' } } : {}),
  };

  return new Promise(async (resolve, reject) => {
    let session;
    let fullSpokenTranscript = '';
    let toolCallsAttempted = [];
    const timer = setTimeout(() => {
      if (session) session.close();
      resolve({
        transcript: fullSpokenTranscript || '(timed out)',
        tools: toolCallsAttempted,
        timedOut: true
      });
    }, 20_000);

    try {
      session = await ai.live.connect({
        model,
        config,
        callbacks: {
          onopen: () => {},
          onmessage: msg => {
            if (msg.toolCall?.functionCalls?.length) {
              for (const call of msg.toolCall.functionCalls) {
                toolCallsAttempted.push(call.name);
              }
              // Respond so it doesn't hang
              session.sendToolResponse({
                functionResponses: msg.toolCall.functionCalls.map(c => ({
                  id: c.id,
                  name: c.name,
                  response: { status: 'mock_reply' }
                }))
              });
            }
            const content = msg.serverContent;
            if (content?.outputTranscription?.text) {
              fullSpokenTranscript += content.outputTranscription.text;
            }
            if (content?.turnComplete) {
              clearTimeout(timer);
              session.close();
              resolve({
                transcript: fullSpokenTranscript.trim(),
                tools: toolCallsAttempted,
                timedOut: false
              });
            }
          },
          onerror: err => {
            clearTimeout(timer);
            reject(err);
          },
          onclose: () => {}
        }
      });
      session.sendClientContent({
        turns: [{ role: 'user', parts: [{ text: userText }] }],
        turnComplete: true,
      });
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

async function main() {
  console.log('================================================================');
  console.log('LIVE GEMINI WEBSOCKET CONVERSATION BENCHMARK (ORVIX BRAIN)');
  console.log('================================================================\n');

  const today = '2026-09-29';
  const langClause = 'LANGUAGE DIRECTIVE: Always speak in natural, fluent everyday Bangla by default for all conversation and answers. Only switch to English if the user explicitly asks to speak in English.';
  const identity = 'User: Mahdis. Location: Rangpur, Bangladesh.';

  const activeSnapshot = {
    Windows: [
      { Handle: 101, Pid: 1204, App: 'Code', Title: 'HistoryStore.cs - Orvix-Project-v2 - Visual Studio Code', State: 'maximized', Document: 'HistoryStore.cs', Active: true },
      { Handle: 102, Pid: 3412, App: 'chrome', Title: 'Google Gemini Documentation - Google Chrome', State: 'normal', Document: 'Google Gemini Documentation', Active: false },
    ],
    Browsers: [
      { Name: 'Chrome', SeenUtc: new Date().toISOString(), Tabs: [{ id: 1, windowId: 1, title: 'Google Gemini Documentation', url: 'https://ai.google.dev', active: true, audible: false, muted: false }], Videos: [] }
    ],
    Media: [
      { Source: 'Spotify', Title: 'Starboy', Artist: 'The Weeknd' }
    ],
    Volume: 65,
    Muted: false,
    Brightness: 90,
    Activity: {
      IdleSeconds: 15,
      IsIdle: false,
      NotificationState: 'Normal',
      IsPresentationOrFullscreen: false,
      TotalActiveSeconds: 4200,
      TotalIdleSeconds: 300,
      DwellTimes: [
        { App: 'Code', ActiveSeconds: 2700, Percent: 64, FormattedTime: '45m', IsCurrent: true },
        { App: 'chrome', ActiveSeconds: 1200, Percent: 28, FormattedTime: '20m', IsCurrent: false },
        { App: 'Spotify', ActiveSeconds: 300, Percent: 8, FormattedTime: '5m', IsCurrent: false }
      ]
    }
  };

  // --- CONVERSATION TEST 1: FAST PROFILE ---
  console.log('--- TEST 1: Fast Profile (Active App + Open File + Current Music) ---');
  const fastContext = formatFastPcContext(activeSnapshot);
  console.log('[Injected Context]:\n' + fastContext.trim() + '\n');
  const fastInstruction = buildFastSystemInstruction(today, langClause, identity, fastContext);

  const q1 = 'আমি এখন পিসিতে কী কাজ করছি আর কী শুনছি বলো তো?';
  console.log(`User: "${q1}"`);
  const t0 = Date.now();
  const res1 = await runLiveVoiceTurn('Fast', fastInstruction, q1);
  const dur1 = Date.now() - t0;
  console.log(`Orvix Fast (${dur1}ms, ${res1.tools.length} tool calls):`);
  console.log(`"${res1.transcript}"`);
  console.log(`Tools Called: ${res1.tools.length === 0 ? 'None (Instant Zero-Tool Grounding SUCCESS)' : res1.tools.join(', ')}\n`);

  // --- CONVERSATION TEST 2: THINKING PROFILE ---
  console.log('--- TEST 2: Thinking Profile (Focus Distribution, Dwell Time & Care Advice) ---');
  const thinkingContext = formatThinkingPcContext(activeSnapshot);
  console.log('[Injected Context]:\n' + thinkingContext.trim() + '\n');
  const thinkingInstruction = buildThinkingSystemInstruction(today, langClause, identity, thinkingContext);

  const q2 = 'আজকে আমার কাজের অবস্থা কেমন? কোনটায় কত সময় দিলাম আর আমার কি কোনো বিরতি নেওয়া উচিত?';
  console.log(`User: "${q2}"`);
  const t1 = Date.now();
  const res2 = await runLiveVoiceTurn('Thinking', thinkingInstruction, q2);
  const dur2 = Date.now() - t1;
  console.log(`Orvix Thinking (${dur2}ms, ${res2.tools.length} tool calls):`);
  console.log(`"${res2.transcript}"`);
  console.log(`Tools Called: ${res2.tools.length === 0 ? 'None (Instant Grounding SUCCESS)' : res2.tools.join(', ')}\n`);

  // --- CONVERSATION TEST 3: AFK / IDLE DETECTION ---
  console.log('--- TEST 3: User Presence & AFK State (Returned after 25 mins away) ---');
  const afkSnapshot = {
    ...activeSnapshot,
    Activity: {
      ...activeSnapshot.Activity,
      IdleSeconds: 1500, // 25 min idle
      IsIdle: true,
      NotificationState: 'Normal',
      IsPresentationOrFullscreen: false,
    }
  };
  const afkContext = formatFastPcContext(afkSnapshot);
  const afkInstruction = buildFastSystemInstruction(today, langClause, identity, afkContext);
  const q3 = 'আমি কি এতক্ষণ ডেস্কে ছিলাম নাকি বাইরে ছিলাম?';
  console.log(`User: "${q3}"`);
  const res3 = await runLiveVoiceTurn('Fast', afkInstruction, q3);
  console.log(`Orvix AFK Reply:`);
  console.log(`"${res3.transcript}"\n`);

  // --- CONVERSATION TEST 4: EDGE CASE - DISCONNECTED MONITOR ---
  console.log('--- TEST 4: Edge Case: Monitor Starting Up / No Telemetry ---');
  const emptyContext = formatFastPcContext(null);
  const emptyInstruction = buildFastSystemInstruction(today, langClause, identity, emptyContext);
  const q4 = 'আমার পিসিতে এখন কোন উইন্ডো খোলা?';
  console.log(`User: "${q4}"`);
  const res4 = await runLiveVoiceTurn('Fast', emptyInstruction, q4);
  console.log(`Orvix Degraded State Reply:`);
  console.log(`"${res4.transcript}"\n`);
}

main().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
