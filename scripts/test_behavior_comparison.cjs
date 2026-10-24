const path = require("node:path");
const { GoogleGenAI, Modality, ThinkingLevel, Behavior } = require("@google/genai");
const { loadLiveEnv } = require("../electron/live-env.cjs");

const projectRoot = path.join(__dirname, "..");
loadLiveEnv(projectRoot);

const weatherTool = require("../shared/weather-tool.json");

async function runTest(label, nonBlocking) {
  console.log(`\n==================================================`);
  console.log(`TEST: ${label} (nonBlocking = ${nonBlocking})`);
  console.log(`==================================================`);

  const apiKey = process.env.GEMINI_API_KEY_159;
  const model = "gemini-3.8-live-extended-thinking";
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });

  const decls = weatherTool.functionDeclarations.map(d => {
    const copy = { ...d };
    if (!nonBlocking) {
      delete copy.behavior;
    } else {
      copy.behavior = Behavior.NON_BLOCKING;
    }
    return copy;
  });

  const systemInstruction = `You are Orvix, a helpful desktop voice assistant.
Always speak in natural, fluent Bangla.
When the user asks about the weather, ALWAYS invoke get_weather with the location.`;

  return new Promise(async (resolve) => {
    let toolEmitted = false;
    let spokenText = "";

    let setupResolve;
    const setupPromise = new Promise(r => setupResolve = r);

    const session = await ai.live.connect({
      model,
      config: {
        responseModalities: [Modality.AUDIO],
        outputAudioTranscription: {},
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        tools: [{ functionDeclarations: decls }],
        systemInstruction,
      },
      callbacks: {
        onopen: () => console.log(">> WS Open"),
        onmessage: async (msg) => {
          if (msg.setupComplete) {
            console.log(">> Setup complete.");
            if (setupResolve) setupResolve();
            return;
          }
          if (msg.toolCall?.functionCalls?.length) {
            toolEmitted = true;
            for (const call of msg.toolCall.functionCalls) {
              console.log(`\n>>> TOOL CALL: ${call.name}(${JSON.stringify(call.args)})`);
              session.sendToolResponse({
                functionResponses: [{
                  id: call.id,
                  name: call.name,
                  response: {
                    status: "ok",
                    location: "Rangpur, Bangladesh",
                    conditions: "clear sky",
                    temperature: "27.4 degrees C",
                  }
                }]
              });
            }
          }
          if (msg.serverContent?.outputTranscription?.text) {
            const t = msg.serverContent.outputTranscription.text;
            spokenText += t;
            process.stdout.write(t);
          }
          if (msg.serverContent?.interactionStatus === "IDLE") {
            console.log(`\n[IDLE]: toolEmitted = ${toolEmitted}`);
            session.close();
            resolve({ label, toolEmitted, spokenText });
          }
        },
      }
    });

    await setupPromise;
    console.log(">> Setup confirmed. Sending prompt...");
    session.sendClientContent({
      turns: [{ role: "user", parts: [{ text: "রংপুরের আজকের আবহাওয়া কেমন, একটু বলো তো?" }] }],
      turnComplete: true,
    });
  });
}

(async () => {
  // Test A: Blocking tools (default)
  await runTest("Blocking tools", false);
  // Test B: Non-blocking tools
  await runTest("Non-blocking tools", true);
  process.exit(0);
})();
