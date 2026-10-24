const path = require("node:path");
const { GoogleGenAI, Modality, ThinkingLevel } = require("@google/genai");
const { loadLiveEnv } = require("../electron/live-env.cjs");

const projectRoot = path.join(__dirname, "..");
loadLiveEnv(projectRoot);

const weatherTool = require("../shared/weather-tool.json");

async function testSingle() {
  const apiKey = process.env.GEMINI_API_KEY_159;
  const model = "gemini-3.8-live-extended-thinking";
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });

  console.log(`Starting testSingle...`);

  return new Promise(async (resolve) => {
    let setupResolve;
    const setupPromise = new Promise(r => setupResolve = r);

    const session = await ai.live.connect({
      model,
      config: {
        responseModalities: [Modality.AUDIO],
        outputAudioTranscription: {},
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        tools: [{ functionDeclarations: weatherTool.functionDeclarations }],
        systemInstruction: "You are Orvix, a helpful desktop voice assistant. When asked about weather, you MUST call the get_weather tool.",
      },
      callbacks: {
        onmessage: async (msg) => {
          console.log("[SERVER MSG]:", JSON.stringify(msg, (k, v) => (k === "data" && typeof v === "string" && v.length > 50 ? `[BYTES len=${v.length}]` : v)));
          if (msg.setupComplete) {
            if (setupResolve) setupResolve();
            return;
          }
          if (msg.serverContent?.interactionStatus === "IDLE") {
            session.close();
            resolve();
          }
        },
        onerror: (e) => console.error("[WS ERROR]:", e),
        onclose: (e) => console.log("[WS CLOSE]:", e),
      }
    });

    await setupPromise;
    console.log("Setup done. Sending user message...");
    session.sendClientContent({
      turns: [{ role: "user", parts: [{ text: "What is the weather in London right now?" }] }],
      turnComplete: true,
    });
  });
}

testSingle().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
