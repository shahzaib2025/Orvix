const path = require("node:path");
const { GoogleGenAI, Modality, ThinkingLevel, Behavior } = require("@google/genai");
const { loadLiveEnv } = require("../electron/live-env.cjs");
const { getWeather } = require("../electron/weather.cjs");

const projectRoot = path.join(__dirname, "..");
loadLiveEnv(projectRoot);

const weatherTool = require("../shared/weather-tool.json");
const declarations = weatherTool.functionDeclarations.map(d => ({ ...d, behavior: Behavior.NON_BLOCKING }));

const systemInstruction = `You are Orvix, a helpful desktop voice companion for Mahdis. Today is 2026-10-02.
Always speak in natural everyday Bangla.
When Mahdis asks about the weather, immediately call get_weather with the location.
When get_weather returns data, synthesize a complete, warm, and accurate weather report in fluent Bangla stating the temperature, conditions, and humidity.`;

async function test() {
  const apiKey = process.env.GEMINI_API_KEY_159;
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });

  const session = await ai.live.connect({
    model: "gemini-3.8-live-extended-thinking",
    config: {
      responseModalities: [Modality.AUDIO],
      outputAudioTranscription: {},
      tools: [{ functionDeclarations: declarations }],
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      systemInstruction,
    },
    callbacks: {
      onopen: () => console.log(">> WS Open"),
      onmessage: async (msg) => {
        if (msg.setupComplete) console.log(">> Setup complete");
        if (msg.serverContent?.outputTranscription?.text) {
          process.stdout.write(msg.serverContent.outputTranscription.text);
        }
        if (msg.toolCall?.functionCalls) {
          for (const call of msg.toolCall.functionCalls) {
            console.log(`\n[TOOL CALL]: ${call.name}(${JSON.stringify(call.args)})`);
            const raw = await getWeather(call.args);
            console.log(`[TOOL RESULT]:`, JSON.stringify(raw));
            session.sendToolResponse({
              functionResponses: [{
                id: call.id,
                name: call.name,
                response: {
                  status: "ok",
                  location: "Rangpur, Bangladesh",
                  temperature: raw.temperature || "27 degrees C",
                  conditions: raw.conditions || "clear sky",
                  humidity: raw.humidity || "82%",
                  feelsLike: raw.feelsLike || "32 degrees C",
                  windSpeed: raw.windSpeed || "5 km/h",
                }
              }]
            });
            console.log(`[TOOL RESPONSE SENT]`);
          }
        }
        if (msg.serverContent?.turnComplete) console.log("\n[TURN COMPLETE]");
        if (msg.serverContent?.interactionStatus) console.log(`[STATUS: ${msg.serverContent.interactionStatus}]`);
      },
      onerror: (e) => console.error("Error:", e),
      onclose: (e) => console.log("Close:", e.code, e.reason),
    }
  });

  setTimeout(() => {
    console.log(">> Sending User Turn...");
    session.sendClientContent({
      turns: [{ role: "user", parts: [{ text: "রংপুরের আজকের আবহাওয়া কেমন, একটু বলো তো?" }] }],
      turnComplete: true,
    });
  }, 2000);

  await new Promise(r => setTimeout(r, 45000));
  session.close();
  console.log("\n>> Done.");
  process.exit(0);
}

test().catch(console.error);
