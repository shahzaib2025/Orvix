const path = require("node:path");
const { GoogleGenAI, Modality, ThinkingLevel, Behavior } = require("@google/genai");
const { loadLiveEnv } = require("../electron/live-env.cjs");
const filesystem = require("../electron/live-fs-tools.cjs");

const projectRoot = path.join(__dirname, "..");
loadLiveEnv(projectRoot);

const filesystemTools = require("../shared/filesystem-tools.json");
const declarations = filesystemTools.functionDeclarations.map(d => ({ ...d, behavior: Behavior.NON_BLOCKING }));

const systemInstruction = `You are Orvix, a warm, lively desktop voice companion for Mahdis. Today is 2026-10-02.
Always speak in natural everyday Bangla.

DESKTOP FILES & DIRECTORIES (list_directory):
When asked to see, list, or inspect desktop files or folders (e.g. 'ডেস্কটপে কি কি ফাইল আর ফোল্ডার আছে একবার দেখে বলো', 'ডেস্কটপে কি কি ফাইল আছে'), you MUST call list_directory with {"directory": "Desktop"}.
Speak a brief natural spoken filler while looking (e.g. "আপনার ডেস্কটপের ফাইল ও ফোল্ডারগুলো দেখছি...").
When list_directory returns the items, immediately summarize the folders and files found clearly for Mahdis in fluent Bangla. Never say system error; report the items directly.`;

function sanitizeToolOutput(name, raw) {
  if (!raw || typeof raw !== "object") return raw;
  const obj = { ...raw };
  if (obj.directory !== undefined && (Array.isArray(obj.files) || Array.isArray(obj.folders))) {
    const folders = Array.isArray(obj.folders) ? obj.folders.slice(0, 15) : [];
    const files = Array.isArray(obj.files) ? obj.files.slice(0, 15) : [];
    return {
      status: "ok",
      directory: "Desktop",
      totalItems: obj.totalCount ?? (folders.length + files.length),
      folders,
      files,
      message: `Found ${folders.length} folders and ${files.length} files in Desktop.`,
    };
  }
  return obj;
}

async function testTurn3() {
  const apiKey = process.env.GEMINI_API_KEY_159;
  const model = "gemini-3.8-live-extended-thinking";
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });

  let setupDone;
  const setupPromise = new Promise(r => setupDone = r);
  let spoken = "";

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

        if (msg.serverContent?.modelTurn?.parts) {
          for (const p of msg.serverContent.modelTurn.parts) {
            if (p.thought && p.text) {
              process.stdout.write(`\x1b[33m[THOUGHT]: ${p.text}\x1b[0m\n`);
            }
          }
        }

        if (msg.serverContent?.outputTranscription?.text) {
          const t = msg.serverContent.outputTranscription.text;
          spoken += t;
          process.stdout.write(t);
        }

        if (msg.toolCall?.functionCalls) {
          for (const call of msg.toolCall.functionCalls) {
            console.log(`\n[TOOL CALL]: ${call.name}(${JSON.stringify(call.args)})`);
            const raw = await filesystem.listDirectory(call.args);
            const sanitized = sanitizeToolOutput(call.name, raw);
            console.log(`[TOOL RESULT]: status=${sanitized.status}, folders=${sanitized.folders.length}, files=${sanitized.files.length}`);
            session.sendToolResponse({
              functionResponses: [{ id: call.id, name: call.name, response: sanitized }],
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

  await setupPromise;
  console.log(">> Sending Turn 3 prompt...");
  session.sendClientContent({
    turns: [{ role: "user", parts: [{ text: "ডেস্কটপে কি কি ফাইল আর ফোল্ডার আছে একবার দেখে বলো" }] }],
    turnComplete: true,
  });

  await new Promise(r => setTimeout(r, 45000));
  session.close();
  console.log("\n>> Spoken length:", spoken.length);
  process.exit(0);
}

testTurn3().catch(console.error);
