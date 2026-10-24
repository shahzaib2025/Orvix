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
const filesystemTools = require("../shared/filesystem-tools.json");

const allDeclarations = [
  ...weatherTool.functionDeclarations,
  ...filesystemTools.functionDeclarations,
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

async function run() {
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
      onopen: () => console.log(">> WS Open"),
      onmessage: async (msg) => {
        if (msg.setupComplete) {
          console.log(">> Setup complete");
          setupDone();
          return;
        }

        if (msg.serverContent?.outputTranscription?.text) {
          process.stdout.write(`\n[SPOKEN]: ${msg.serverContent.outputTranscription.text}`);
        }

        if (msg.serverContent?.modelTurn?.parts) {
          for (const p of msg.serverContent.modelTurn.parts) {
            if (p.thought) {
              process.stdout.write(`\n[THOUGHT]: ${p.thought}`);
            }
          }
        }

        if (msg.toolCall?.functionCalls) {
          for (const call of msg.toolCall.functionCalls) {
            console.log(`\n[TOOL CALL]: ${call.name}(${JSON.stringify(call.args)}) id=${call.id}`);
            const raw = await getWeather(call.args);
            console.log(`[RAW WEATHER]:`, JSON.stringify(raw, null, 2));
            const resp = {
              status: "ok",
              location: "Rangpur, Bangladesh",
              conditions: raw.conditions || "clear sky",
              temperature: raw.temperature || "27 degrees C",
              feelsLike: raw.feelsLike || "32 degrees C",
              humidity: raw.humidity || "82%",
              windSpeed: raw.windSpeed || "5 km/h",
              todayHigh: raw.todayHigh || "31 degrees C",
              todayLow: raw.todayLow || "25 degrees C",
            };
            console.log(`[SENDING TOOL RESPONSE]:`, JSON.stringify(resp, null, 2));
            session.sendToolResponse({
              functionResponses: [{
                id: call.id,
                name: call.name,
                response: { output: resp },
              }]
            });
            console.log(`[TOOL RESPONSE SENT]`);
          }
        }

        if (msg.serverContent?.interrupted) {
          console.log("\n[INTERRUPTED]");
        }
        if (msg.serverContent?.turnComplete) {
          console.log("\n[TURN COMPLETE]");
        }
        if (msg.serverContent?.interactionStatus) {
          console.log(`\n[STATUS: ${msg.serverContent.interactionStatus}]`);
        }
      },
      onerror: (e) => console.error("Error:", e),
      onclose: (e) => console.log("Close:", e.code, e.reason),
    }
  });

  await setupPromise;
  console.log(">> Sending User Prompt...");
  session.sendClientContent({
    turns: [{ role: "user", parts: [{ text: "রংপুরের আজকের আবহাওয়া কেমন, একটু বলো তো?" }] }],
    turnComplete: true,
  });

  await new Promise(r => setTimeout(r, 60000));
  session.close();
  console.log("\n>> Done.");
  process.exit(0);
}

run().catch(console.error);
