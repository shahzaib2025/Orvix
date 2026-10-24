const path = require("node:path");
const { GoogleGenAI, Modality, ThinkingLevel, Behavior } = require("@google/genai");
const { loadLiveEnv } = require("../electron/live-env.cjs");
const filesystem = require("../electron/live-fs-tools.cjs");

const projectRoot = path.join(__dirname, "..");
loadLiveEnv(projectRoot);

const filesystemTools = require("../shared/filesystem-tools.json");
const decl = filesystemTools.functionDeclarations.find(d => d.name === "list_directory");
const declarations = [{ ...decl, behavior: Behavior.NON_BLOCKING }];

const systemInstruction = `You are Orvix, a desktop voice companion for Mahdis.
Always speak in natural everyday Bangla.
When Mahdis asks about files or folders on Desktop, you MUST call list_directory with {"directory": "Desktop"}. Speak a brief filler while checking (e.g. "আপনার ডেস্কটপের ফাইল ও ফোল্ডারগুলো দেখছি...").
When list_directory returns, present the folders and files found to Mahdis in fluent, natural Bangla.`;

async function main() {
  const apiKey = process.env.GEMINI_API_KEY_159;
  const model = "gemini-3.8-live-extended-thinking";
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });

  let setupDone;
  const setupPromise = new Promise(r => setupDone = r);
  let finishTurn;
  const turnPromise = new Promise(r => finishTurn = r);

  const session = await ai.live.connect({
    model,
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
        if (msg.setupComplete) {
          console.log(">> Setup complete");
          setupDone();
          return;
        }

        if (msg.serverContent?.outputTranscription?.text) {
          process.stdout.write(msg.serverContent.outputTranscription.text);
        }

        if (msg.toolCall?.functionCalls) {
          for (const call of msg.toolCall.functionCalls) {
            console.log(`\n[TOOL CALL]: ${call.name}(${JSON.stringify(call.args)})`);
            const raw = await filesystem.listDirectory(call.args);
            const folders = Array.isArray(raw.folders) ? raw.folders.slice(0, 10) : [];
            const files = Array.isArray(raw.files) ? raw.files.slice(0, 10) : [];
            const response = {
              status: "ok",
              directory: "Desktop",
              folderCount: folders.length,
              fileCount: files.length,
              folders: folders.join(", "),
              files: files.join(", "),
              summary: `Found ${folders.length} folders (${folders.join(", ")}) and ${files.length} files (${files.join(", ")}).`
            };
            console.log("[TOOL RESPONSE]:", JSON.stringify(response));
            session.sendToolResponse({
              functionResponses: [{ id: call.id, name: call.name, response }],
            });
            console.log("[TOOL RESPONSE SENT]");
          }
        }

        if (msg.serverContent?.turnComplete) {
          console.log("\n[TURN COMPLETE]");
        }
        if (msg.serverContent?.interactionStatus === "IDLE") {
          console.log("\n[IDLE]");
          setTimeout(finishTurn, 3000);
        }
      },
      onerror: (e) => console.error("Error:", e),
      onclose: (e) => console.log("Close:", e.code, e.reason),
    }
  });

  await setupPromise;
  console.log(">> Sending Turn 3 prompt...");
  session.sendClientContent({
    turns: [{ role: "user", parts: [{ text: "ডেস্কটপে কি কি ফাইল আর ফোল্ডার আছে একবার দেখে বলো" }] }],
    turnComplete: true,
  });

  await turnPromise;
  session.close();
  console.log(">> Done.");
}

main().catch(console.error);
