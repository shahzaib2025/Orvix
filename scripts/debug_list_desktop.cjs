const path = require('path');
const root = path.resolve(__dirname, '..');
require('../electron/live-env.cjs').loadLiveEnv(root);
const { GoogleGenAI } = require('@google/genai');

const weatherTool = require('../shared/weather-tool.json');
const searchTool = require('../shared/search-tool.json');
const pageTool = require('../shared/page-tool.json');
const filesystemTools = require('../shared/filesystem-tools.json');
const fsTools = require('../electron/live-fs-tools.cjs');
const { createLiveToken } = require('../electron/live-auth.cjs');

(async () => {
  const { token, model } = await createLiveToken('Thinking', 'MEDIUM');
  const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });
  const declarations = [
    ...weatherTool.functionDeclarations,
    ...searchTool.functionDeclarations,
    ...pageTool.functionDeclarations,
    ...filesystemTools.functionDeclarations,
  ];

  const session = await ai.live.connect({
    model,
    config: {
      responseModalities: ['AUDIO'],
      outputAudioTranscription: {},
      tools: [{ functionDeclarations: declarations }],
      thinkingConfig: { thinkingLevel: 'MEDIUM' },
      systemInstruction: 'You are Orvix Thinking, an authorized desktop assistant. You have full user permission to access local files, folders, and Desktop on this computer using list_directory, search_files, and search_content. Use get_weather for weather questions. Use web_search for live web queries. Always answer directly and helpfully based on tool results.',
    },
    callbacks: {
      onmessage: async (msg) => {
        console.log('[MSG KEYS]:', Object.keys(msg));
        if (msg.toolCall) {
          console.log('\n[TOOL CALL RECEIVED!]:', JSON.stringify(msg.toolCall, null, 2));
          for (const call of msg.toolCall.functionCalls || []) {
            let res;
            if (call.name === 'list_directory') {
              res = await fsTools.listDirectory(call.args || { directory: 'Desktop' });
            }
            console.log(`Sending response for ${call.name}, items count: ${res.count}`);
            session.sendToolResponse({
              functionResponses: [{ id: call.id, name: call.name, response: { output: res } }]
            });
          }
        }
        if (msg.serverContent?.outputTranscription?.text) {
          console.log('[MODEL SPOKE]:', msg.serverContent.outputTranscription.text);
        }
        if (msg.serverContent?.turnComplete) console.log('[TURN COMPLETE]');
        if (msg.serverContent?.interactionStatus) console.log('[INTERACTION STATUS]:', msg.serverContent.interactionStatus);
      },
      onerror: (e) => console.error('Error:', e),
      onclose: (e) => console.log('Closed:', e.code, e.reason),
    }
  });

  console.log('Sending: List the folders on my Desktop');
  session.sendClientContent({
    turns: [{ role: 'user', parts: [{ text: 'List the folders on my Desktop' }] }],
    turnComplete: true,
  });

  await new Promise(r => setTimeout(r, 20000));
  session.close();
  process.exit(0);
})();
