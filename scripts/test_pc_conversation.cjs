const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
require('../electron/live-env.cjs').loadLiveEnv(root);
const search = require('../electron/search.cjs');
const { createLiveToken } = require('../electron/live-auth.cjs');

// Transpile TypeScript modules
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
const { GoogleGenAI } = require('@google/genai');

async function testGeminiTurn(profile, systemInstruction, userPrompt) {
  const apiKey = process.env.GEMINI_API_KEY_159?.trim();
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } });
  
  const startTime = Date.now();
  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash',
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    config: {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      temperature: 0.7,
    },
  });
  const elapsed = Date.now() - startTime;
  return {
    text: response.text?.trim() || '',
    elapsedMs: elapsed,
  };
}

async function runConversationalEvaluation() {
  console.log('================================================================');
  console.log('ORVIX PC MONITOR BRAIN CONVERSATIONAL BENCHMARK & EVALUATION');
  console.log('================================================================\n');

  // Scenario 1: Active Work Session (VS Code + Spotify + Dwell Time)
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
      IdleSeconds: 12,
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

  const today = '2026-09-29';
  const langClause = 'LANGUAGE DIRECTIVE: Always speak in natural, fluent everyday Bangla by default for all conversation and answers. Only switch to English if the user explicitly asks to speak in English.';
  const identity = 'User: Mahdis. Location: Rangpur, Bangladesh.';

  // --- TURN 1: FAST PROFILE (Instant Awareness & Token Economy) ---
  console.log('>>> TEST 1: Fast Profile — "আমি এখন পিসিতে কী কাজ করছি আর কী শুনছি?"');
  const fastContext = formatFastPcContext(activeSnapshot);
  console.log('[Fast Injected Context]:\n' + fastContext.trim());
  const fastInstruction = buildFastSystemInstruction(today, langClause, identity, fastContext);
  
  const turn1 = await testGeminiTurn('Fast', fastInstruction, 'আমি এখন পিসিতে কী কাজ করছি আর কী শুনছি বলো তো?');
  console.log(`\n[Orvix Fast Reply] (${turn1.elapsedMs}ms):`);
  console.log(`"${turn1.text}"\n`);

  // --- TURN 2: THINKING PROFILE (Dwell Distribution & Care Break) ---
  console.log('>>> TEST 2: Thinking Profile — "আজকে আমার কাজের অবস্থা কেমন? কোনটায় কত সময় দিলাম আর আমার কি কোনো বিরতি নেওয়া উচিত?"');
  const thinkingContext = formatThinkingPcContext(activeSnapshot);
  console.log('[Thinking Injected Context]:\n' + thinkingContext.trim());
  const thinkingInstruction = buildThinkingSystemInstruction(today, langClause, identity, thinkingContext);

  const turn2 = await testGeminiTurn('Thinking', thinkingInstruction, 'আজকে আমার কাজের অবস্থা কেমন? কোনটায় কত সময় দিলাম আর আমার কি কোনো বিরতি নেওয়া উচিত?');
  console.log(`\n[Orvix Thinking Reply] (${turn2.elapsedMs}ms):`);
  console.log(`"${turn2.text}"\n`);

  // --- TURN 3: AFK / IDLE DETECTION SCENARIO ---
  console.log('>>> TEST 3: User Presence & AFK State — User asks after returning from being away');
  const afkSnapshot = {
    ...activeSnapshot,
    Activity: {
      ...activeSnapshot.Activity,
      IdleSeconds: 1380, // 23 minutes
      IsIdle: true,
      NotificationState: 'Normal',
      IsPresentationOrFullscreen: false,
    }
  };
  const afkContext = formatFastPcContext(afkSnapshot);
  const afkInstruction = buildFastSystemInstruction(today, langClause, identity, afkContext);
  const turn3 = await testGeminiTurn('Fast', afkInstruction, 'মাহদিস কথা বলছে, আমি কি এতক্ষণ ডেস্কে ছিলাম নাকি বাইরে ছিলাম?');
  console.log(`\n[Orvix AFK Reply] (${turn3.elapsedMs}ms):`);
  console.log(`"${turn3.text}"\n`);

  // --- TURN 4: FULL-SCREEN GAMING / PRESENTATION MODE ---
  console.log('>>> TEST 4: Exclusive Fullscreen / Presentation Mode');
  const gamingSnapshot = {
    ...activeSnapshot,
    Windows: [
      { Handle: 501, Pid: 991, App: 'Cyberpunk2077', Title: 'Cyberpunk 2077', State: 'maximized', Document: 'Unknown', Active: true }
    ],
    Activity: {
      ...activeSnapshot.Activity,
      IdleSeconds: 4,
      IsIdle: false,
      NotificationState: 'Busy (Exclusive Full-screen)',
      IsPresentationOrFullscreen: true,
    }
  };
  const gamingContext = formatFastPcContext(gamingSnapshot);
  const gamingInstruction = buildFastSystemInstruction(today, langClause, identity, gamingContext);
  const turn4 = await testGeminiTurn('Fast', gamingInstruction, 'আমি কি এখন কোনো প্রেজেন্টেশন বা ফুলস্ক্রিন গেমে আছি?');
  console.log(`\n[Orvix Gaming/Presentation Reply] (${turn4.elapsedMs}ms):`);
  console.log(`"${turn4.text}"\n`);

  // --- TURN 5: EMPTY / DEGRADED STATE (PC Monitor starting or no windows) ---
  console.log('>>> TEST 5: Degraded State (PC Monitor disconnected / null)');
  const emptyContext = formatFastPcContext(null);
  const emptyInstruction = buildFastSystemInstruction(today, langClause, identity, emptyContext);
  const turn5 = await testGeminiTurn('Fast', emptyInstruction, 'আমার পিসিতে এখন কোন গান বাজছে আর কী উইন্ডো খোলা আছে?');
  console.log(`\n[Orvix Degraded State Reply] (${turn5.elapsedMs}ms):`);
  console.log(`"${turn5.text}"\n`);

  console.log('================================================================');
  console.log('EVALUATION COMPLETE');
  console.log('================================================================');
}

runConversationalEvaluation().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
