const path = require("node:path");
const { GoogleGenAI, Modality, ThinkingLevel, Behavior } = require("@google/genai");
const { loadLiveEnv } = require("../electron/live-env.cjs");

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

const systemInstruction = `You are Orvix, a warm, intelligent, and proactive desktop voice assistant for Mahdis. Today's date is 2026-10-02.
LANGUAGE DIRECTIVE: Always speak in natural, fluent everyday Bangla by default. Only switch to English if the user explicitly asks.

USER IDENTITY & PROFILE:
- User's Name: Mahdis
- Occupation / Role: Designer, researcher, student
- Current Location: Rangpur
- Preferred Language: Bangla
DIRECTIVES FOR THIS USER:
Address Mahdis warmly. If he asks about weather, time, or local conditions (e.g. for Rangpur or without naming a place), call get_weather with location: "Rangpur".

REAL-TIME DESKTOP & LOCAL ENVIRONMENT GROUNDING:
- Foreground Window: Antigravity IDE [Orvix-Project-v2]
- Open Windows: ChatGPT, Antigravity IDE, Windows Explorer
- Location: Rangpur, Bangladesh

TOOL USAGE GUIDELINES:
1. WEATHER: Whenever asked about weather, temperature, or rain, immediately invoke get_weather. Speak a short 1-sentence Bangla acknowledgment aloud (e.g. "রংপুরের আজকের আবহাওয়া দেখছি..."). When the data arrives, provide a complete, clear weather report.
2. WINDOWS: When asked to bring an app or window to front, call manage_window (e.g. appName: "ChatGPT", action: "focus").
3. DESKTOP FILES: When asked to list or see files on Desktop, call list_directory with directory: "Desktop".
4. ONLINE RESEARCH: When asked to search online or check web info (e.g. Florian BD, AI models comparison), call web_search. Speak a short acknowledgment while searching, then summarize the findings accurately.
5. LOCAL FILES: When asked to read a specific file, call read_file.

TONE: Speak with confidence, warmth, and natural Bengali phrasing. Always answer directly from tool results.`;

async function testCleanPrompt() {
  const apiKey = process.env.GEMINI_API_KEY_159;
  const model = "gemini-3.8-live-extended-thinking";

  console.log(">> Connecting with clean prompt...");
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });

  let setupPromiseResolve;
  const setupPromise = new Promise(r => setupPromiseResolve = r);

  const session = await ai.live.connect({
    model,
    config: {
      responseModalities: [Modality.AUDIO],
      outputAudioTranscription: {},
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      tools: [{ functionDeclarations: allDeclarations }],
      systemInstruction,
    },
    callbacks: {
      onopen: () => console.log(">> WS Open"),
      onmessage: async (msg) => {
        if (msg.setupComplete) {
          console.log(">> setupComplete received");
          if (setupPromiseResolve) setupPromiseResolve();
          return;
        }
        if (msg.toolCall?.functionCalls?.length) {
          for (const call of msg.toolCall.functionCalls) {
            console.log(`\n[TOOL CALL]: ${call.name}(${JSON.stringify(call.args)})`);
            // Immediate response
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
                  todayHigh: "31.5 degrees C",
                  todayLow: "25.1 degrees C",
                }
              }]
            });
            console.log("[TOOL RESPONSE SENT]");
          }
        }
        if (msg.serverContent?.outputTranscription?.text) {
          process.stdout.write(msg.serverContent.outputTranscription.text);
        }
        if (msg.serverContent?.turnComplete) {
          console.log("\n[TURN COMPLETE]");
        }
        if (msg.serverContent?.interactionStatus === "IDLE") {
          console.log("\n[INTERACTION IDLE]");
        }
      },
      onerror: (e) => console.error("Error:", e),
      onclose: (e) => console.log("Close:", e.code, e.reason),
    }
  });

  await setupPromise;
  console.log(">> Sending User Prompt: 'রংপুরের আজকের আবহাওয়া কেমন, একটু বলো তো?'\n");
  session.sendClientContent({
    turns: [{ role: "user", parts: [{ text: "রংপুরের আজকের আবহাওয়া কেমন, একটু বলো তো?" }] }],
    turnComplete: true,
  });

  // Keep open for 30s
  await new Promise(r => setTimeout(r, 30000));
  session.close();
  process.exit(0);
}

testCleanPrompt().catch(console.error);
