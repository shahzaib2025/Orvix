const path = require("node:path");
const { GoogleGenAI, Modality, ThinkingLevel } = require("@google/genai");
const { loadLiveEnv } = require("../electron/live-env.cjs");

const projectRoot = path.join(__dirname, "..");
loadLiveEnv(projectRoot);

const weatherTool = require("../shared/weather-tool.json");

async function testCity(cityQuery) {
  const apiKey = process.env.GEMINI_API_KEY_159;
  const model = "gemini-3.8-live-extended-thinking";
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });

  console.log(`\nTesting Query: "${cityQuery}"`);

  return new Promise(async (resolve) => {
    let setupResolve;
    const setupPromise = new Promise(r => setupResolve = r);
    let toolEmitted = null;
    let spoken = "";

    const session = await ai.live.connect({
      model,
      config: {
        responseModalities: [Modality.AUDIO],
        outputAudioTranscription: {},
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        tools: [{ functionDeclarations: weatherTool.functionDeclarations }],
        systemInstruction: "You are a helpful voice assistant. You have the get_weather tool. When asked about weather in any city, invoke get_weather immediately. Speak Bangla.",
      },
      callbacks: {
        onmessage: async (msg) => {
          if (msg.setupComplete) {
            if (setupResolve) setupResolve();
            return;
          }
          if (msg.toolCall?.functionCalls?.length) {
            for (const call of msg.toolCall.functionCalls) {
              toolEmitted = call.name + "(" + JSON.stringify(call.args) + ")";
              console.log(`>>> TOOL CALL:`, toolEmitted);
              session.sendToolResponse({
                functionResponses: [{
                  id: call.id,
                  name: call.name,
                  response: { status: "ok", location: call.args.location, temperature: "25C", conditions: "sunny" }
                }]
              });
            }
          }
          if (msg.serverContent?.outputTranscription?.text) {
            spoken += msg.serverContent.outputTranscription.text;
            process.stdout.write(msg.serverContent.outputTranscription.text);
          }
          if (msg.serverContent?.interactionStatus === "IDLE") {
            console.log(`\n[IDLE for "${cityQuery}"] -> tool: ${toolEmitted}`);
            session.close();
            resolve({ query: cityQuery, toolEmitted, spoken });
          }
        },
        onerror: (e) => console.error("Error:", e),
      }
    });

    await setupPromise;
    session.sendClientContent({
      turns: [{ role: "user", parts: [{ text: cityQuery }] }],
      turnComplete: true,
    });
  });
}

(async () => {
  await testCity("ঢাকার আবহাওয়া কেমন একটু বলো তো");
  await testCity("রংপুরের আজকের আবহাওয়া কেমন, একটু বলো তো?");
  await testCity("লন্ডনের আবহাওয়া কেমন?");
  process.exit(0);
})();
