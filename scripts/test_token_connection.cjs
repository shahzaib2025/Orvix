const path = require("node:path");
const { GoogleGenAI, Modality, ThinkingLevel } = require("@google/genai");
const { loadLiveEnv } = require("../electron/live-env.cjs");
const { createLiveToken } = require("../electron/live-auth.cjs");

const projectRoot = path.join(__dirname, "..");
loadLiveEnv(projectRoot);

const weatherTool = require("../shared/weather-tool.json");

async function testWithAuthToken() {
  console.log(">> Creating live token via createLiveToken('Thinking', 'LOW')...");
  const { token, model } = await createLiveToken("Thinking", "LOW");
  console.log(">> Token created:", token.slice(0, 25) + "...", "Model:", model);

  const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1alpha" } });

  return new Promise(async (resolve) => {
    let setupResolve;
    const setupPromise = new Promise(r => setupResolve = r);
    let toolEmitted = null;

    const session = await ai.live.connect({
      model,
      config: {
        responseModalities: [Modality.AUDIO],
        outputAudioTranscription: {},
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        tools: [{ functionDeclarations: weatherTool.functionDeclarations }],
        systemInstruction: "You are Orvix, a helpful desktop voice assistant. When asked about weather, you MUST call get_weather. Speak Bangla.",
      },
      callbacks: {
        onopen: () => console.log(">> Connected to Live WS!"),
        onmessage: (msg) => {
          if (msg.setupComplete) {
            console.log(">> Setup complete.");
            if (setupResolve) setupResolve();
            return;
          }
          if (msg.toolCall) {
            toolEmitted = msg.toolCall;
            console.log("\n>>> [TOOL CALL DETECTED!]:", JSON.stringify(msg.toolCall));
            for (const call of msg.toolCall.functionCalls || []) {
              session.sendToolResponse({
                functionResponses: [{
                  id: call.id,
                  name: call.name,
                  response: { status: "ok", location: "Rangpur", temperature: "27C", conditions: "clear" }
                }]
              });
            }
          }
          if (msg.serverContent?.outputTranscription?.text) {
            process.stdout.write(msg.serverContent.outputTranscription.text);
          }
          if (msg.serverContent?.interactionStatus === "IDLE") {
            console.log("\n[IDLE]");
            session.close();
            resolve(toolEmitted);
          }
        },
        onerror: (e) => console.log("Err:", e),
      }
    });

    await setupPromise;
    console.log(">> Sending prompt: 'রংপুরের আজকের আবহাওয়া কেমন, একটু বলো তো?'");
    session.sendClientContent({
      turns: [{ role: "user", parts: [{ text: "রংপুরের আজকের আবহাওয়া কেমন, একটু বলো তো?" }] }],
      turnComplete: true,
    });
  });
}

testWithAuthToken().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
