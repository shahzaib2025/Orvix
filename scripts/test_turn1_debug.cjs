const path = require("node:path");
const Module = require("node:module");
const esbuild = require("esbuild");
const { GoogleGenAI, Modality, ThinkingLevel, Behavior } = require("@google/genai");
const { loadLiveEnv } = require("../electron/live-env.cjs");

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

async function testTurn1() {
  const apiKey = process.env.GEMINI_API_KEY_159;
  const model = "gemini-3.8-live-extended-thinking";

  console.log("Connecting to Gemini Live...");
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });

  let setupPromiseResolve;
  const setupPromise = new Promise(r => setupPromiseResolve = r);

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
      onopen: () => console.log(">> WS Open"),
      onmessage: async (msg) => {
        const keys = Object.keys(msg);
        if (keys.length === 0) {
          console.log(`[EMPTY KEYS MSG]:`, msg);
        } else {
          console.log(`[MSG KEYS]: ${keys.join(", ")}`);
        }
        if (msg.setupComplete) {
          console.log(">> setupComplete received");
          if (setupPromiseResolve) setupPromiseResolve();
          return;
        }
        if (msg.toolCall) {
          console.log("[TOOL CALL RECEIVED]:", JSON.stringify(msg.toolCall, null, 2));
          // Respond with weather
          for (const call of msg.toolCall.functionCalls || []) {
            session.sendToolResponse({
              functionResponses: [{
                id: call.id,
                name: call.name,
                response: {
                  status: "ok",
                  location: "Rangpur, Bangladesh",
                  conditions: "clear sky",
                  temperature: "27.4 degrees C",
                  humidity: "81%",
                }
              }]
            });
          }
        }
        if (msg.serverContent?.outputTranscription?.text) {
          process.stdout.write(`\n[TRANSCRIPT]: ${msg.serverContent.outputTranscription.text}`);
        }
        if (msg.serverContent?.modelTurn?.parts) {
          for (const p of msg.serverContent.modelTurn.parts) {
            if (p.text) console.log(`\n[MODEL TEXT PART]: ${p.text}`);
          }
        }
        if (msg.serverContent?.turnComplete) {
          console.log("\n[SERVER TURN COMPLETE]");
        }
        if (msg.serverContent?.interrupted) {
          console.log("\n[SERVER INTERRUPTED]");
        }
        if (msg.serverContent?.interactionStatus) {
          console.log(`\n[INTERACTION STATUS]: ${msg.serverContent.interactionStatus}`);
        }
      },
      onerror: (e) => console.error("Error:", e),
      onclose: (e) => console.log("Close:", e.code, e.reason),
    }
  });

  await setupPromise;
  console.log(">> Server setup confirmed. Sending User Turn 1...");
  session.sendClientContent({
    turns: [{ role: "user", parts: [{ text: "রংপুরের আজকের আবহাওয়া কেমন, একটু বলো তো?" }] }],
    turnComplete: true,
  });
}

testTurn1().catch(console.error);
