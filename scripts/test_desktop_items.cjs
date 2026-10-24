const { GoogleGenAI } = require('@google/genai');
const path = require('path');
const root = path.resolve(__dirname, '..');
require('../electron/live-env.cjs').loadLiveEnv(root);
const fsTools = require('../electron/live-fs-tools.cjs');

async function testFolders(label, outputPayload) {
  console.log(`\n--- Testing ${label} ---`);
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY_159, httpOptions: { apiVersion: 'v1alpha' } });
  return new Promise((resolve) => {
    let session;
    let spoken = '';
    ai.live.connect({
      model: 'gemini-3.8-live-extended-thinking',
      config: {
        responseModalities: ['AUDIO'],
        outputAudioTranscription: {},
        tools: [{ functionDeclarations: [require('../shared/filesystem-tools.json').functionDeclarations[0]] }],
        systemInstruction: 'You are Orvix. When asked about folders or desktop items, call list_directory and speak the folder names clearly.',
      },
      callbacks: {
        onmessage: (msg) => {
          if (msg.toolCall) {
            console.log(`Tool call received: ${msg.toolCall.functionCalls[0].name}`);
            session.sendToolResponse({
              functionResponses: [{
                id: msg.toolCall.functionCalls[0].id,
                name: 'list_directory',
                response: { output: outputPayload }
              }]
            });
          }
          if (msg.serverContent?.outputTranscription?.text) {
            spoken += msg.serverContent.outputTranscription.text;
            process.stdout.write(msg.serverContent.outputTranscription.text);
          }
          if (msg.serverContent?.turnComplete && spoken.trim()) {
            console.log(`\nResult for ${label}: "${spoken.trim()}"`);
            session.close();
            resolve();
          }
        },
        onerror: (e) => console.error(e),
      }
    }).then(s => {
      session = s;
      session.sendClientContent({
        turns: [{ role: 'user', parts: [{ text: 'What folders are on my Desktop?' }] }],
        turnComplete: true,
      });
    });
  });
}

(async () => {
  // Test 1: Simple folders
  await testFolders('Simple Mock', {
    status: 'ok',
    directory: 'Desktop',
    count: 4,
    folders: ['Projects', 'Photos', 'Music', 'Documents']
  });

  // Test 2: Real desktop output
  const realOutput = await fsTools.listDirectory({ directory: 'Desktop' });
  await testFolders('Real Desktop Output', realOutput);

  process.exit(0);
})();
