const path = require("node:path");
const Module = require("node:module");
const esbuild = require("esbuild");
const { GoogleGenAI, Modality, ThinkingLevel, Behavior } = require("@google/genai");
const { loadLiveEnv } = require("../electron/live-env.cjs");
const { getWeather } = require("../electron/weather.cjs");

const projectRoot = path.join(__dirname, "..");
loadLiveEnv(projectRoot);

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
const { buildThinkingSystemInstruction } = loaded.exports;

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

const today = new Date().toISOString().slice(0, 10);
const systemInstruction = buildThinkingSystemInstruction(
  today,
  languageDirective,
  userIdentityBlock,
  groundedContext
);

function sanitizeToolOutput(name, raw) {
  if (!raw || typeof raw !== "object") return raw;
  const obj = { ...raw };
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
  return obj;
}

async function runTest() {
  const apiKey = process.env.GEMINI_API_KEY_159;
  const model = "gemini-3.8-live-extended-thinking";
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });

  let setupDone;
  const setupPromise = new Promise(r => setupDone = r);

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
      onopen: () => console.log(">> WS Connected"),
      onmessage: async (msg) => {
        if (msg.setupComplete) {
          console.log(">> Setup complete");
          setupDone();
          return;
        }

        if (msg.serverContent?.outputTranscription?.text) {
          console.log(`[AUDIO TRANSCRIPT]: "${msg.serverContent.outputTranscription.text}"`);
        }

        if (msg.serverContent?.modelTurn?.parts) {
          for (const p of msg.serverContent.modelTurn.parts) {
            if (p.text) console.log(`[MODEL TEXT PART]: "${p.text}"`);
            if (p.thought) console.log(`[MODEL THOUGHT]: "${p.thought.slice(0, 80)}..."`);
          }
        }

        if (msg.toolCall?.functionCalls) {
          for (const call of msg.toolCall.functionCalls) {
            console.log(`\n>>> [TOOL CALL RECEIVED]: ${call.name}`, call.args);
            const raw = await getWeather(call.args);
            const sanitized = sanitizeToolOutput(call.name, raw);
            console.log(`>>> Sending Tool Response:`, JSON.stringify(sanitized, null, 2));
            session.sendToolResponse({
              functionResponses: [{
                id: call.id,
                name: call.name,
                response: sanitized,
              }]
            });
            console.log(`>>> Tool Response sent!`);
          }
        }

        if (msg.serverContent?.turnComplete) {
          console.log("\n>>> [TURN COMPLETE received]");
        }
        if (msg.serverContent?.interrupted) {
          console.log("\n>>> [INTERRUPTED received]");
        }
        if (msg.serverContent?.interactionStatus) {
          console.log(`\n>>> [INTERACTION STATUS]: ${msg.serverContent.interactionStatus}`);
        }
      },
      onerror: (e) => console.error("Error:", e),
      onclose: (e) => console.log("Close:", e),
    }
  });

  await setupPromise;
  console.log(">> Sending User Turn 1...");
  session.sendClientContent({
    turns: [{ role: "user", parts: [{ text: "রংপুরের আজকের আবহাওয়া কেমন, একটু বলো তো?" }] }],
    turnComplete: true,
  });

  // Keep alive for 40 seconds to observe full turn
  await new Promise(r => setTimeout(r, 40000));
  session.close();
  console.log(">> Test completed.");
}

runTest().catch(console.error);
