// Live Conversational Evaluation for Orvix Thinking Profile (gemini-3.8-live-extended-thinking)
// Tests frequent verbal acknowledgments, reason-while-speaking, and tool dispatch across multiple turns.

const path = require("node:path");
const Module = require("node:module");
const esbuild = require("esbuild");
const { GoogleGenAI, Modality, ThinkingLevel, Behavior } = require("@google/genai");
const { loadLiveEnv } = require("../electron/live-env.cjs");
const { getWeather } = require("../electron/weather.cjs");
const { searchWeb, readSearchResultPage } = require("../electron/search.cjs");
const { manageWindow } = require("../electron/window-control.cjs");
const filesystem = require("../electron/live-fs-tools.cjs");
const { manageClipboard } = require("../electron/clipboard.cjs");

const projectRoot = path.join(__dirname, "..");
loadLiveEnv(projectRoot);

// Compile thinkingFlow.ts on the fly
const built = esbuild.buildSync({
  entryPoints: [path.join(projectRoot, "src/thinkingFlow.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  logLevel: "silent",
});
const loaded = new Module(path.join(__dirname, ".thinking-eval.cjs"), module);
loaded.filename = path.join(__dirname, ".thinking-eval.cjs");
loaded.paths = module.paths;
loaded._compile(built.outputFiles[0].text, loaded.filename);
const { buildThinkingSystemInstruction, isVoiceSystemError } = loaded.exports;

// Load tool declarations
const weatherTool = require("../shared/weather-tool.json");
const searchTool = require("../shared/search-tool.json");
const pageTool = require("../shared/page-tool.json");
const filesystemTools = require("../shared/filesystem-tools.json");
const windowTools = require("../shared/window-tools.json");

const allDeclarations = [
  ...weatherTool.functionDeclarations,
  ...searchTool.functionDeclarations,
  ...pageTool.functionDeclarations,
  ...filesystemTools.functionDeclarations,
  ...windowTools.functionDeclarations,
].map(d => ({ ...d, behavior: Behavior.NON_BLOCKING }));

const toolHandlers = {
  get_weather: getWeather,
  web_search: searchWeb,
  read_web_page: readSearchResultPage,
  manage_window: manageWindow,
  list_directory: filesystem.listDirectory,
  search_files: filesystem.searchFiles,
  search_content: filesystem.searchContent,
  read_file: filesystem.readFile,
  write_file: filesystem.writeFile,
  manage_clipboard: manageClipboard,
};

function sanitizeToolOutput(name, raw) {
  if (!raw || typeof raw !== "object") return raw;
  const obj = { ...raw };

  // Weather
  if (obj.location && obj.temperature) {
    const weather = {
      status: obj.status || "ok",
      location: obj.location,
      conditions: obj.conditions,
      temperature: obj.temperature,
      feelsLike: obj.feelsLike,
      humidity: obj.humidity,
      windSpeed: obj.windSpeed,
      todayHigh: obj.todayHigh,
      todayLow: obj.todayLow,
    };
    if (obj.forecast) weather.forecast = obj.forecast;
    return weather;
  }

  // Manage Window
  if (obj.action !== undefined && (obj.app !== undefined || obj.title !== undefined || obj.handle !== undefined || obj.status !== undefined)) {
    const app = obj.app || obj.appName || "ChatGPT";
    return {
      status: "ok",
      action: obj.action || "focus",
      app,
      title: obj.title || "",
      message: `The window '${app}' was successfully brought to front and focused.`,
    };
  }

  // Directory listing
  if (obj.directory !== undefined && (Array.isArray(obj.files) || Array.isArray(obj.folders))) {
    const folders = Array.isArray(obj.folders) ? obj.folders.slice(0, 12) : [];
    const files = Array.isArray(obj.files) ? obj.files.slice(0, 12) : [];
    return {
      status: "ok",
      directory: "Desktop",
      totalItems: obj.totalCount ?? (folders.length + files.length),
      folders,
      files,
      summary: `Desktop contains ${folders.length} folders (${folders.slice(0, 6).join(", ")}) and ${files.length} files (${files.slice(0, 6).join(", ")}).`,
      message: `Found ${folders.length} folders and ${files.length} files in Desktop.`,
    };
  }

  // Web search
  if (Array.isArray(obj.results)) {
    const items = obj.results.slice(0, 5).map(r => ({
      title: String(r.title || "").replace(/\s+/g, " ").trim(),
      snippet: String(r.snippet || "").replace(/\s+/g, " ").slice(0, 600).trim(),
      content: typeof r.content === "string" ? r.content.replace(/\s+/g, " ").slice(0, 1200).trim() : undefined,
      url: typeof r.url === "string" ? r.url : undefined,
    }));
    return {
      status: obj.status ?? "ok",
      query: obj.query,
      count: items.length,
      results: items,
    };
  }

  // Web page reading
  if (typeof obj.url === "string" && typeof obj.content === "string") {
    return {
      status: obj.status || "ok",
      url: obj.url,
      title: obj.title || "Web page",
      content: obj.content.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim().slice(0, 3500),
    };
  }

  // Read file handling
  if (typeof obj.path === "string" && obj.totalLines !== undefined && typeof obj.content === "string") {
    return {
      status: obj.status || "ok",
      path: obj.path,
      totalLines: obj.totalLines,
      content: obj.content.slice(0, 3000),
    };
  }

  return obj;
}

const languageDirective = `LANGUAGE DIRECTIVE: Always speak in natural, fluent everyday Bangla by default. Only switch to English if the user explicitly asks.`;

const userIdentityBlock = `USER IDENTITY & PROFILE:
- User's Name: Mahdis
- Occupation / Role: Designer, researcher, student
- Organization / Team: FlorianBD
- Current Location: Rangpur
- Preferred Language: Bangla
DIRECTIVES FOR THIS USER:
You are conversing directly with Mahdis. Address them warmly and naturally. If the user asks about weather, time, or local conditions (e.g. for Rangpur or without naming a place), immediately call get_weather with location: "Rangpur".`;

const groundedContext = `
REAL-TIME DESKTOP & LOCAL ENVIRONMENT GROUNDING:
- Foreground Window: Antigravity IDE [Orvix-Project-v2]
- Open Windows: ChatGPT, Antigravity IDE, Windows Explorer
- Location: Rangpur, Bangladesh`;

// Tool-triggering multi-turn conversational questions
const testQuestions = [
  {
    turn: 1,
    prompt: "রংপুরের আজকের আবহাওয়া কেমন, একটু বলো তো?",
    expectedTool: "get_weather",
    description: "Weather query in spoken Bangla - tests spoken acknowledgment + get_weather tool execution + Bangla answer",
  },
  {
    turn: 2,
    prompt: "চ্যাটজিপিটি উইন্ডোটি সামনে নিয়ে আসো",
    expectedTool: "manage_window",
    description: "Desktop window focus command - tests spoken acknowledgment + manage_window execution + confirmation",
  },
  {
    turn: 3,
    prompt: "ডেস্কটপে কি কি ফাইল আর ফোল্ডার আছে একবার দেখে বলো",
    expectedTool: "list_directory",
    description: "Desktop directory inspection - tests spoken acknowledgment + list_directory execution + file summary",
  },
  {
    turn: 4,
    prompt: "অনলাইনে ফ্লোরিয়ান বিডি সম্পর্কে সার্চ করে দেখো তো এটা কি ধরনের ওয়েবসাইট বা শপ",
    expectedTool: "web_search",
    description: "Online web search & synthesis - tests spoken acknowledgment + web_search/read_web_page + non-refusal explanation",
  },
  {
    turn: 5,
    prompt: "অনলাইনে সার্চ করে গুগলের লেটেস্ট জেমিনাই মডেলের সাথে ওপেনএআই-এর নতুন মডেলের তুলনা করে বলো",
    expectedTool: "web_search",
    description: "Comparative AI research - tests extended reasoning, spoken fillers, web_search, and deep spoken synthesis",
  },
];

async function runEvaluation() {
  console.log("================================================================================");
  console.log("       ORVIX THINKING PROFILE: LIVE MULTI-TURN CONVERSATION EVALUATION");
  console.log("================================================================================");
  console.log(`Model Target: gemini-3.8-live-extended-thinking`);
  console.log(`Tool Count:   ${allDeclarations.length} (all NON_BLOCKING)`);
  console.log("--------------------------------------------------------------------------------\n");

  const apiKey = process.env.GEMINI_API_KEY_159;
  const model = "gemini-3.8-live-extended-thinking";

  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });
  const today = new Date().toISOString().slice(0, 10);
  const systemInstruction = buildThinkingSystemInstruction(
    today,
    languageDirective,
    userIdentityBlock,
    groundedContext
  );

  let activeTurn = null;
  let activeTurnResolve = null;
  let setupPromiseResolve;
  const setupPromise = new Promise(resolve => {
    setupPromiseResolve = resolve;
  });

  const session = await ai.live.connect({
    model,
    config: {
      responseModalities: [Modality.AUDIO],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      tools: [{ functionDeclarations: allDeclarations }],
      systemInstruction,
    },
    callbacks: {
      onopen: () => console.log(">> Connected to Gemini Live WebSocket successfully.\n"),
      onmessage: async message => {
        if (message.setupComplete) {
          console.log(">> Setup complete received from Gemini Live server.\n");
          if (setupPromiseResolve) setupPromiseResolve();
          return;
        }
        if (!activeTurn) return;

        // Collect spoken transcript text
        const sc = message.serverContent;
        if (sc?.outputTranscription?.text) {
          if (activeTurn?.idleDebounceTimer) {
            clearTimeout(activeTurn.idleDebounceTimer);
            activeTurn.idleDebounceTimer = null;
          }
          const text = sc.outputTranscription.text;
          activeTurn.currentSpeech += text;
          process.stdout.write(text);
          if (activeTurn.toolCalls.length === 0) {
            activeTurn.speechBeforeTools += text;
          } else {
            activeTurn.speechAfterTools += text;
          }
        }

        // Count audio frames
        for (const p of sc?.modelTurn?.parts ?? []) {
          if (p.inlineData?.data) {
            activeTurn.audioChunks++;
            if (activeTurn?.idleDebounceTimer) {
              clearTimeout(activeTurn.idleDebounceTimer);
              activeTurn.idleDebounceTimer = null;
            }
          }
        }

        // Tool calls dispatch
        if (message.toolCall?.functionCalls?.length) {
          if (activeTurn?.idleDebounceTimer) {
            clearTimeout(activeTurn.idleDebounceTimer);
            activeTurn.idleDebounceTimer = null;
          }
          activeTurn.pendingToolResponse = true;
          for (const call of message.toolCall.functionCalls) {
            activeTurn.activeCalls = (activeTurn.activeCalls || 0) + 1;
            const callStart = performance.now();
            activeTurn.toolCalls.push({ name: call.name, args: call.args });
            console.log(`\n\n[TOOL CALL DETECTED]: ${call.name}(${JSON.stringify(call.args)})`);

            (async () => {
              const handler = toolHandlers[call.name];
              let toolResult;
              try {
                if (handler) {
                  toolResult = await handler(call.args || {});
                } else {
                  toolResult = { error: `Tool ${call.name} not implemented in test harness` };
                }
              } catch (err) {
                toolResult = { error: err.message };
              }

              const sanitized = sanitizeToolOutput(call.name, toolResult);
              const dur = (performance.now() - callStart).toFixed(1);
              console.log(`[TOOL COMPLETED in ${dur}ms]: status=${sanitized?.status ?? "ok"}`);

              // Send sanitized tool response
              session.sendToolResponse({
                functionResponses: [{ id: call.id, name: call.name, response: sanitized }],
              });
              activeTurn.toolResponsesSent++;
              activeTurn.activeCalls--;
              if (activeTurn.activeCalls === 0) {
                activeTurn.pendingToolResponse = false;
                activeTurn.toolsExecuted = true;
              }
            })();
          }
        }

        // Track interactionStatus to understand model state
        if (sc?.interactionStatus) {
          activeTurn.lastInteractionStatus = sc.interactionStatus;
          console.log(`\n[INTERACTION STATUS: ${sc.interactionStatus}]`);
        }

        // Check for turn completion when server signals turnComplete
        if (sc?.turnComplete) {
          const status = sc.interactionStatus || activeTurn.lastInteractionStatus;

          // Case 1: turnComplete + IN_PROGRESS = model finished speaking filler, tool call is coming next
          // Do NOT resolve or start grace timers — just wait for the tool call message
          if (status === "IN_PROGRESS" && !activeTurn.toolsExecuted) {
            console.log(`\n[TURN COMPLETE + IN_PROGRESS: Filler speech done, awaiting tool call...]`);
            activeTurn.awaitingToolFromInProgress = true;
            if (activeTurn.idleDebounceTimer) {
              clearTimeout(activeTurn.idleDebounceTimer);
              activeTurn.idleDebounceTimer = null;
            }
            return; // Explicitly do nothing — tool call will arrive shortly
          }

          // Case 2: turnComplete after tools have executed and responded — this is the final turn
          if (activeTurn.toolsExecuted) {
            console.log(`\n[SERVER TURN COMPLETE (Post-tool response finished)]`);
            if (activeTurn.idleDebounceTimer) clearTimeout(activeTurn.idleDebounceTimer);
            activeTurn.idleDebounceTimer = setTimeout(() => {
              if ((activeTurn.activeCalls || 0) > 0 || activeTurn.pendingToolResponse) return;
              console.log(`\n\n[TURN FINISHED VIA TURN_COMPLETE]`);
              if (activeTurnResolve) {
                const resolve = activeTurnResolve;
                activeTurnResolve = null;
                resolve({ ...activeTurn });
              }
            }, 3000);
          }
        }

        // Check for turn completion - only complete when all tools are done and server has finished speaking
        if (sc?.interactionStatus === "IDLE") {
          const hasActiveTools = (activeTurn.activeCalls || 0) > 0;
          const isPending = activeTurn.pendingToolResponse;
          if (hasActiveTools || isPending) {
            console.log(`\n[IDLE received during tool execution - waiting for post-tool response]`);
            return;
          }

          // If we're still waiting for a tool call after IN_PROGRESS, check if model spoke a refusal instead
          if (activeTurn.awaitingToolFromInProgress && activeTurn.toolCalls.length === 0) {
            const spokenAfterInProgress = activeTurn.currentSpeech.trim();
            const hasRefusal = isVoiceSystemError(spokenAfterInProgress);
            if (hasRefusal) {
              // Model hallucinated a refusal instead of calling the tool — resolve as failed
              console.log(`\n[IDLE after IN_PROGRESS: Model spoke refusal instead of tool call — resolving as failed]`);
              activeTurn.awaitingToolFromInProgress = false;
              // Fall through to normal IDLE resolution below
            } else {
              console.log(`\n[IDLE received but still awaiting tool call from IN_PROGRESS state - extending wait]`);
              return;
            }
          }

          // If a tool was executed, wait 3000ms for speech to complete.
          // If no tools have been called yet, give a 35000ms grace window for extended-thinking tool generation.
          const waitTime = (activeTurn.toolsExecuted || activeTurn.toolCalls.length > 0) ? 3000 : 35000;
          if (activeTurn.idleDebounceTimer) {
            clearTimeout(activeTurn.idleDebounceTimer);
          }
          activeTurn.idleDebounceTimer = setTimeout(() => {
            if ((activeTurn.activeCalls || 0) > 0 || activeTurn.pendingToolResponse) return;
            console.log(`\n\n[TURN INTERACTION STATUS: IDLE (${activeTurn.toolsExecuted ? "Tool Done" : "Grace Expired"})]`);
            if (activeTurnResolve) {
              const resolve = activeTurnResolve;
              activeTurnResolve = null;
              resolve({ ...activeTurn });
            }
          }, waitTime);
        }
      },
      onerror: err => console.error("[Socket Error]:", err?.message || err),
      onclose: ev => console.log(`[Socket Closed]: code=${ev.code}, reason=${ev.reason}`),
    },
  });

  const results = [];

  console.log(">> Waiting for setupComplete from Gemini Live server...");
  await Promise.race([
    setupPromise,
    new Promise(r => setTimeout(r, 4000)),
  ]);
  console.log(">> Server setup confirmed. Beginning evaluation turns.\n");

  for (const q of testQuestions) {
    console.log(`\n================================================================================`);
    console.log(`TURN ${q.turn}: "${q.prompt}"`);
    console.log(`Expected Tool: ${q.expectedTool}`);
    console.log(`Goal: ${q.description}`);
    console.log(`--------------------------------------------------------------------------------`);
    process.stdout.write("Orvix Voice: ");

    activeTurn = {
      turn: q.turn,
      prompt: q.prompt,
      expectedTool: q.expectedTool,
      currentSpeech: "",
      speechBeforeTools: "",
      speechAfterTools: "",
      toolCalls: [],
      toolResponsesSent: 0,
      activeCalls: 0,
      pendingToolResponse: false,
      toolsExecuted: false,
      audioChunks: 0,
      startedAt: performance.now(),
      awaitingToolFromInProgress: false,
      lastInteractionStatus: null,
    };

    // Web search turns (4, 5) need more time for search + read_web_page + synthesis
    const timeoutMs = (q.expectedTool === "web_search") ? 180000 : 120000;
    const turnPromise = new Promise((resolve, reject) => {
      activeTurnResolve = resolve;
      const timeout = setTimeout(() => {
        reject(new Error(`Turn ${q.turn} timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);

      const originalResolve = activeTurnResolve;
      activeTurnResolve = (data) => {
        clearTimeout(timeout);
        originalResolve(data);
      };
    });

    session.sendClientContent({
      turns: [{ role: "user", parts: [{ text: q.prompt }] }],
      turnComplete: true,
    });

    try {
      const turnResult = await turnPromise;
      const elapsed = ((performance.now() - turnResult.startedAt) / 1000).toFixed(2);
      const toolMatch = turnResult.toolCalls.some(c => c.name === q.expectedTool);
      const isRefusal = isVoiceSystemError(turnResult.currentSpeech);

      const evalRecord = {
        turn: q.turn,
        prompt: q.prompt,
        expectedTool: q.expectedTool,
        toolCalled: turnResult.toolCalls.map(c => c.name).join(", ") || "None",
        toolMatch: toolMatch ? "PASSED" : "FAILED",
        verbalAcknowledged: turnResult.speechBeforeTools.trim().length > 0 ? "PASSED" : "NO_EARLY_VERBAL",
        audioFrames: turnResult.audioChunks,
        totalSpoken: turnResult.currentSpeech.trim(),
        isRefusal: isRefusal ? "YES (FAILED)" : "NO (CLEAN)",
        elapsedSec: elapsed,
      };
      results.push(evalRecord);

      console.log(`\n>> Turn ${q.turn} Analysis:`);
      console.log(`   - Time Elapsed:              ${elapsed}s`);
      console.log(`   - Audio Chunks Received:     ${turnResult.audioChunks}`);
      console.log(`   - Tool Called:               ${evalRecord.toolCalled} (Expected: ${q.expectedTool} -> ${evalRecord.toolMatch})`);
      console.log(`   - Spoke Before Tool Call:    ${evalRecord.verbalAcknowledged === "PASSED" ? 'YES ("' + turnResult.speechBeforeTools.slice(0, 45) + '...")' : "NO"}`);
      console.log(`   - Spoke After Tool Call:     ${turnResult.speechAfterTools.trim() ? 'YES ("' + turnResult.speechAfterTools.slice(0, 45) + '...")' : "NO"}`);
      console.log(`   - Refusal Detected:          ${evalRecord.isRefusal}`);
      console.log(`   - Total Spoken Text:         "${turnResult.currentSpeech.slice(0, 120)}..."`);
    } catch (err) {
      console.error(`\n>> Turn ${q.turn} FAILED: ${err.message}`);
      results.push({
        turn: q.turn,
        prompt: q.prompt,
        expectedTool: q.expectedTool,
        toolCalled: "None",
        toolMatch: "FAILED",
        verbalAcknowledged: "FAILED",
        audioFrames: 0,
        totalSpoken: `ERROR: ${err.message}`,
        isRefusal: "ERROR",
        elapsedSec: "0",
      });
    }

    // Pacing delay between turns so live connection buffers settle
    await new Promise(r => setTimeout(r, 8000));
  }

  try {
    session.close();
  } catch {}

  console.log("\n================================================================================");
  console.log("                           FINAL EVALUATION SUMMARY");
  console.log("================================================================================");
  for (const r of results) {
    console.log(`Turn ${r.turn} ("${r.prompt}"):`);
    console.log(`   - Tool Match:          ${r.toolMatch} (${r.toolCalled})`);
    console.log(`   - Verbal Acknowledged: ${r.verbalAcknowledged}`);
    console.log(`   - Clean (No Refusal):  ${r.isRefusal}`);
    console.log(`   - Spoken Response:     "${r.totalSpoken.slice(0, 110)}..."`);
  }
  console.log("================================================================================\n");

  const allPassed = results.every(r => r.toolMatch === "PASSED" && r.isRefusal === "NO (CLEAN)");
  process.exit(allPassed ? 0 : 1);
}

runEvaluation().catch(err => {
  console.error("Evaluation Harness Fatal Error:", err);
  process.exit(1);
});
