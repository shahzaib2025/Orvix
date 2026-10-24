// Minimal single-turn test: Only weather tool + short system instruction
// Goal: Isolate whether the refusal is caused by instruction length or tool count

const path = require("node:path");
const { GoogleGenAI, Modality, ThinkingLevel, Behavior } = require("@google/genai");
const { loadLiveEnv } = require("../electron/live-env.cjs");
const { getWeather } = require("../electron/weather.cjs");

const projectRoot = path.join(__dirname, "..");
loadLiveEnv(projectRoot);

const weatherTool = require("../shared/weather-tool.json");

// MINIMAL: Only 1 tool
const decl = weatherTool.functionDeclarations.map(d => ({ ...d, behavior: Behavior.NON_BLOCKING }));

const apiKey = process.env.GEMINI_API_KEY_159;

// Very short system instruction
const shortInstruction = `You are Orvix, a warm and helpful voice companion for Mahdis. Today is ${new Date().toISOString().slice(0, 10)}.
Always speak in natural Bangla.
When asked about weather, ALWAYS call get_weather immediately. Speak a brief Bangla filler while the tool runs.
When get_weather returns data, describe the weather warmly in Bangla using the returned data.
NEVER say "সিস্টেম ত্রুটি" or "সিস্টেম সমস্যা" or any error. The tools always work.`;

async function run() {
  console.log("=== MINIMAL SINGLE-TURN TEST (1 tool, short instruction) ===\n");
  
  let spoken = '';
  let gotTool = false;
  let toolResult = null;

  const session = await new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } })
    .live.connect({
      model: "gemini-3.8-live-extended-thinking",
      config: {
        responseModalities: [Modality.AUDIO],
        outputAudioTranscription: {},
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        tools: [{ functionDeclarations: decl }],
        systemInstruction: shortInstruction,
      },
      callbacks: {
        onopen: () => console.log("Connected"),
        onmessage: async (m) => {
          if (m.setupComplete) { console.log("Setup OK\n"); return; }
          
          const sc = m.serverContent;
          if (sc?.outputTranscription?.text) {
            spoken += sc.outputTranscription.text;
            process.stdout.write(sc.outputTranscription.text);
          }
          if (sc?.interactionStatus) console.log(`\n[STATUS: ${sc.interactionStatus}]`);
          if (sc?.turnComplete) console.log(`[TURN_COMPLETE]`);
          
          if (m.toolCall?.functionCalls?.length) {
            gotTool = true;
            for (const c of m.toolCall.functionCalls) {
              console.log(`\n[TOOL]: ${c.name}(${JSON.stringify(c.args)})`);
              try {
                const res = await getWeather(c.args || {});
                toolResult = { status: "ok", location: res.location, temperature: res.temperature, conditions: res.conditions };
                console.log(`[TOOL OK]:`, JSON.stringify(toolResult));
                session.sendToolResponse({
                  functionResponses: [{ id: c.id, name: c.name, response: toolResult }],
                });
              } catch (err) {
                console.log(`[TOOL ERR]: ${err.message}`);
              }
            }
          }
        },
        onerror: (e) => console.log("ERR:", e.message),
        onclose: (e) => console.log("\nCLOSE:", e.code, e.reason),
      },
    });

  // Wait for setup
  await new Promise(r => setTimeout(r, 2000));
  
  console.log("Sending: রংপুরের আবহাওয়া কেমন?\n");
  session.sendClientContent({
    turns: [{ role: "user", parts: [{ text: "রংপুরের আবহাওয়া কেমন?" }] }],
    turnComplete: true,
  });

  // Wait for response
  await new Promise(r => setTimeout(r, 60000));
  
  console.log("\n\n=== RESULT ===");
  console.log("Tool called:", gotTool);
  console.log("Tool result:", JSON.stringify(toolResult));
  console.log("Spoken:", spoken);
  console.log("Has refusal:", /দুঃখিত|সিস্টেম ত্রুটি|সিস্টেম সমস্যা|সিস্টেম ভুল/.test(spoken) ? "YES" : "NO");
  
  try { session.close(); } catch {}
  process.exit(0);
}

run().catch(err => { console.error("Fatal:", err); process.exit(1); });
