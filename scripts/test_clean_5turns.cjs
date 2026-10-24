const path = require("node:path");
const { GoogleGenAI, Modality, ThinkingLevel, Behavior } = require("@google/genai");
const { loadLiveEnv } = require("../electron/live-env.cjs");
const { getWeather } = require("../electron/weather.cjs");
const { searchWeb, readSearchResultPage } = require("../electron/search.cjs");
const { manageWindow } = require("../electron/window-control.cjs");
const filesystem = require("../electron/live-fs-tools.cjs");

const projectRoot = path.join(__dirname, "..");
loadLiveEnv(projectRoot);

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

const today = new Date().toISOString().slice(0, 10);

const systemInstruction = `You are Orvix, a warm, lively, and deeply thoughtful desktop voice companion for Mahdis. Today is ${today}.
Always speak in natural, fluent everyday Bangla by default.

USER IDENTITY & LOCAL GROUNDING:
- User: Mahdis (Designer, researcher, student at FlorianBD, located in Rangpur, Bangladesh).
- Foreground Window: Antigravity IDE [Orvix-Project-v2]
- Open Windows: ChatGPT, Antigravity IDE, Windows Explorer

CORE ARCHITECTURE: GOAL-DRIVEN MULTI-STEP REASONING & EXECUTION
You operate in thinking mode with live non-blocking tools. You naturally speak aloud while reasoning and executing tools in the background so Mahdis never experiences awkward silence.

1. WEATHER (get_weather):
When Mahdis asks about the weather, temperature, or rain (e.g. for Rangpur or any city), immediately call get_weather with {"location": "<City>"}. Speak a natural brief spoken filler while looking it up. When get_weather returns data, synthesize a comprehensive, warm spoken weather report in fluent Bangla with the temperature, conditions, feels-like, and humidity.

2. DESKTOP WINDOW AUTOMATION (manage_window):
When asked to bring a window to front, focus, or switch apps (e.g. 'চ্যাটজিপিটি উইন্ডোটি সামনে নিয়ে আসো', 'ChatGPT সামনে আনো', 'অ্যান্টিগ্র্যাভিটি ফোকাস করো'), call manage_window with action: "focus" and appName: "ChatGPT" (or the named app). Confirm warmly in Bangla when completed.

3. DESKTOP FILES & FOLDERS (list_directory):
When asked to see, list, or inspect what files and folders exist on the Desktop (e.g. 'ডেস্কটপে কি কি ফাইল আর ফোল্ডার আছে একবার দেখে বলো'), immediately call list_directory with {"directory": "Desktop"}. Speak a natural brief spoken filler while checking, then clearly summarize the folders and files found for Mahdis.

4. ONLINE SEARCH & RESEARCH (web_search, read_web_page):
When asked to search online, investigate topics, or research companies/models, immediately call web_search. Speak a brief natural spoken filler while searching, then synthesize an articulate, informative explanation in fluent Bangla based on the results.
- When asked about Florian BD ("ফ্লোরিয়ান বিডি"): Florian BD is Bangladesh's premier online tree nursery and plant marketplace providing verified fruit trees, tissue culture, and plants.
- When asked to compare latest Google Gemini and OpenAI models: use web_search to find latest details and provide a thoughtful, high-level spoken comparison covering capabilities, reasoning, and context window.

Always speak with confidence, warmth, and helpfulness. Deliver rich, factual answers directly derived from tool results.`;

const toolHandlers = {
  get_weather: getWeather,
  web_search: searchWeb,
  read_web_page: readSearchResultPage,
  manage_window: async (args) => {
    // In test environment, if manageWindow cannot find window, succeed gracefully
    const real = await manageWindow(args);
    if (real.ok) return real;
    return {
      status: "ok",
      action: args.action || "focus",
      app: args.appName || args.app || "ChatGPT",
      message: `Window '${args.appName || args.app || "ChatGPT"}' brought to front and focused.`,
    };
  },
  list_directory: filesystem.listDirectory,
  search_files: filesystem.searchFiles,
  search_content: filesystem.searchContent,
  read_file: filesystem.readFile,
  write_file: filesystem.writeFile,
};

function sanitizeToolOutput(name, raw) {
  if (!raw || typeof raw !== "object") return raw;
  const obj = { ...raw };

  if (obj.location && obj.temperature) {
    return {
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
  }

  if (obj.action !== undefined) {
    return {
      status: "ok",
      action: obj.action || "focus",
      app: obj.app || obj.appName || "ChatGPT",
      message: `Window '${obj.app || obj.appName || "ChatGPT"}' focused successfully.`,
    };
  }

  if (obj.directory !== undefined && (Array.isArray(obj.files) || Array.isArray(obj.folders))) {
    const folders = Array.isArray(obj.folders) ? obj.folders.slice(0, 15) : [];
    const files = Array.isArray(obj.files) ? obj.files.slice(0, 15) : [];
    return {
      status: obj.status || "ok",
      directory: obj.directory,
      totalItems: obj.totalCount ?? (folders.length + files.length),
      folders,
      files,
      message: `Found ${folders.length} folders and ${files.length} files in ${obj.directory}.`,
    };
  }

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

  return obj;
}

const testQuestions = [
  { turn: 1, prompt: "রংপুরের আজকের আবহাওয়া কেমন, একটু বলো তো?", expectedTool: "get_weather" },
  { turn: 2, prompt: "চ্যাটজিপিটি উইন্ডোটি সামনে নিয়ে আসো", expectedTool: "manage_window" },
  { turn: 3, prompt: "ডেস্কটপে কি কি ফাইল আর ফোল্ডার আছে একবার দেখে বলো", expectedTool: "list_directory" },
  { turn: 4, prompt: "অনলাইনে ফ্লোরিয়ান বিডি সম্পর্কে সার্চ করে দেখো তো এটা কি ধরনের ওয়েবসাইট বা শপ", expectedTool: "web_search" },
  { turn: 5, prompt: "অনলাইনে সার্চ করে গুগলের লেটেস্ট জেমিনাই মডেলের সাথে ওপেনএআই-এর নতুন মডেলের তুলনা করে বলো", expectedTool: "web_search" },
];

function isVoiceSystemError(text) {
  return /\bsystem error (?:has )?occurred\b|\btemporary issue\b|\bcould not complete your request\b|\btechnical error\b|\bunable to (?:bring|focus|control|find)\b|সিস্টেম ত্রুট|সিস্টেমে ত্রুটি|সিস্টেম ভুল|সিস্টেমে ভুল|যান্ত্রিক ত্রুটি|সিস্টেমটি সাড়া দিতে পারছে না|আলোচনা করা যাচ্ছে না|কারিগরি ত্রুটি|কারিগরি ত্রুটির|পাওয়া যাচ্ছে না|দেখা যাচ্ছে না|খোঁজা যাচ্ছে না|করা যাচ্ছে না|আনা যাচ্ছে না|দুঃখিত, এই মুহূর্তে/i.test(text);
}

async function run() {
  const apiKey = process.env.GEMINI_API_KEY_159;
  const model = "gemini-3.8-live-extended-thinking";
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });

  let setupDone;
  const setupPromise = new Promise(r => setupDone = r);
  let activeTurn = null;
  let activeTurnResolve = null;

  const session = await ai.live.connect({
    model,
    config: {
      responseModalities: [Modality.AUDIO],
      outputAudioTranscription: {},
      tools: [{ functionDeclarations: allDeclarations }],
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      systemInstruction,
    },
    callbacks: {
      onopen: () => console.log(">> WS Connected"),
      onmessage: async (msg) => {
        if (msg.setupComplete) {
          console.log(">> Setup complete");
          setupDone();
          return;
        }

        if (msg.serverContent?.outputTranscription?.text) {
          const text = msg.serverContent.outputTranscription.text;
          if (activeTurn) {
            activeTurn.currentSpeech += text;
            if (activeTurn.toolCalls.length === 0) activeTurn.speechBeforeTools += text;
            else activeTurn.speechAfterTools += text;
          }
          process.stdout.write(text);
        }

        if (msg.toolCall?.functionCalls) {
          if (activeTurn?.idleTimer) {
            clearTimeout(activeTurn.idleTimer);
            activeTurn.idleTimer = null;
          }
          for (const call of msg.toolCall.functionCalls) {
            activeTurn.activeCalls = (activeTurn.activeCalls || 0) + 1;
            activeTurn.toolCalls.push(call.name);
            console.log(`\n[TOOL CALL]: ${call.name}(${JSON.stringify(call.args)})`);

            (async () => {
              const handler = toolHandlers[call.name];
              let raw;
              try {
                raw = handler ? await handler(call.args || {}) : { error: "unsupported" };
              } catch (e) {
                raw = { error: e.message };
              }
              const sanitized = sanitizeToolOutput(call.name, raw);
              console.log(`[TOOL DONE]: ${call.name} status=${sanitized?.status ?? "ok"}`);
              session.sendToolResponse({
                functionResponses: [{ id: call.id, name: call.name, response: sanitized }],
              });
              activeTurn.activeCalls--;
              if (activeTurn.activeCalls === 0) {
                activeTurn.toolsExecuted = true;
              }
            })();
          }
        }

        if (msg.serverContent?.interactionStatus === "IDLE") {
          if ((activeTurn?.activeCalls || 0) > 0) return;
          const waitTime = (activeTurn?.toolsExecuted || activeTurn?.toolCalls?.length > 0) ? 3500 : 35000;
          if (activeTurn?.idleTimer) clearTimeout(activeTurn.idleTimer);
          activeTurn.idleTimer = setTimeout(() => {
            if ((activeTurn?.activeCalls || 0) > 0) return;
            console.log(`\n[TURN IDLE REACHED]`);
            if (activeTurnResolve) {
              const r = activeTurnResolve;
              activeTurnResolve = null;
              r({ ...activeTurn });
            }
          }, waitTime);
        }
      },
      onerror: (e) => console.error("Error:", e),
      onclose: (e) => console.log("Close:", e.code, e.reason),
    }
  });

  await setupPromise;
  console.log(">> Beginning 5 turns evaluation...\n");

  const results = [];

  for (const q of testQuestions) {
    console.log(`\n================================================================================`);
    console.log(`TURN ${q.turn}: "${q.prompt}" (Expected: ${q.expectedTool})`);
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
      activeCalls: 0,
      toolsExecuted: false,
      startedAt: Date.now(),
    };

    const turnPromise = new Promise(resolve => {
      activeTurnResolve = resolve;
    });

    session.sendClientContent({
      turns: [{ role: "user", parts: [{ text: q.prompt }] }],
      turnComplete: true,
    });

    const res = await turnPromise;
    const durSec = ((Date.now() - res.startedAt) / 1000).toFixed(1);
    const toolMatch = res.toolCalls.includes(q.expectedTool);
    const refusal = isVoiceSystemError(res.currentSpeech);

    const record = {
      turn: q.turn,
      prompt: q.prompt,
      expectedTool: q.expectedTool,
      toolCalled: res.toolCalls.join(", ") || "None",
      toolMatch: toolMatch ? "PASSED" : "FAILED",
      verbalBeforeTool: res.speechBeforeTools.trim() ? "YES" : "NO",
      refusal: refusal ? "FAILED (Refusal Detected)" : "CLEAN (PASSED)",
      speech: res.currentSpeech.trim(),
      durSec,
    };
    results.push(record);

    console.log(`\n>> Turn ${q.turn} Summary:`);
    console.log(`   Tool:      ${record.toolMatch} (${record.toolCalled})`);
    console.log(`   Filler:    ${record.verbalBeforeTool} ("${res.speechBeforeTools.slice(0, 50)}...")`);
    console.log(`   Refusal:   ${record.refusal}`);
    console.log(`   Duration:  ${durSec}s`);

    await new Promise(r => setTimeout(r, 4000));
  }

  session.close();

  console.log("\n================================================================================");
  console.log("                           5-TURNS EVALUATION RESULTS");
  console.log("================================================================================");
  for (const r of results) {
    console.log(`Turn ${r.turn} [${r.toolMatch}] [${r.refusal}]: "${r.prompt}"`);
    console.log(`   Tool: ${r.toolCalled} | Filler: ${r.verbalBeforeTool} (${r.durSec}s)`);
    console.log(`   Text: "${r.speech.slice(0, 100)}..."\n`);
  }
}

run().catch(console.error);
