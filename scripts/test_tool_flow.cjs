const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
require('../electron/live-env.cjs').loadLiveEnv(root);
const { GoogleGenAI } = require('@google/genai');

const weatherTool = require('../shared/weather-tool.json');
const searchTool = require('../shared/search-tool.json');
const pageTool = require('../shared/page-tool.json');
const filesystemTools = require('../shared/filesystem-tools.json');
const search = require('../electron/search.cjs');
const { createLiveToken } = require('../electron/live-auth.cjs');

(async () => {
  console.log('Testing tool-calling flow...');
  const { token, model } = await createLiveToken('Thinking', 'MEDIUM');
  const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });
  const declarations = [
    ...weatherTool.functionDeclarations,
    ...searchTool.functionDeclarations,
    ...pageTool.functionDeclarations,
    ...filesystemTools.functionDeclarations,
  ];

  let session;
  session = await ai.live.connect({
    model,
    config: {
      responseModalities: ['AUDIO'],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      tools: [{ functionDeclarations: declarations }],
      thinkingConfig: { thinkingLevel: 'MEDIUM' },
      systemInstruction: 'You are Orvix Thinking, an accurate desktop voice assistant with access to local files and Desktop. For questions about files, folders, weather, or web information, call the appropriate tool first, then provide a direct, helpful spoken answer based on the tool results. Never say a system error occurred.',
    },
    callbacks: {
      onopen: () => {},
      onmessage: async (msg) => {
        if (msg.toolCall) {
          console.log('\n>>> RECEIVED TOOL CALL:', JSON.stringify(msg.toolCall, null, 2));
          for (const call of msg.toolCall.functionCalls || []) {
            console.log(`Executing ${call.name} with args:`, call.args);
            let out;
            if (call.name === 'web_search') {
              out = await search.searchWeb(call.args);
            } else if (call.name === 'get_weather') {
              out = await require('../electron/weather.cjs').getWeather(call.args);
            } else if (call.name === 'list_directory') {
              const fs = require('fs');
              const os = require('os');
              const targetDir = path.join(os.homedir(), 'Desktop');
              const entries = fs.readdirSync(targetDir, { withFileTypes: true });
              const items = entries
                .filter(e => !e.name.startsWith('~$') && !e.name.startsWith('.') && e.name !== 'desktop.ini' && !/api\s*keys/i.test(e.name))
                .slice(0, 50)
                .map(e => ({
                  name: e.name.replace(/[\u00a0\u200b-\u200d\ufeff]/g, ' ').trim(),
                  type: e.isDirectory() ? 'folder' : 'file',
                  path: path.join(targetDir, e.name.trim())
                }));
              out = {
                status: 'ok',
                directory: targetDir,
                count: items.length,
                items
              };
            }
            console.log(`Tool ${call.name} output:`, JSON.stringify(out).slice(0, 300));
            const toolResponsePayload = {
              functionResponses: [{
                id: call.id,
                name: call.name,
                response: { output: out },
              }]
            };
            console.log('Submitting tool response payload...');
            session.sendToolResponse(toolResponsePayload);
            console.log('Submitted tool response!');
          }
        }
        if (msg.serverContent?.outputTranscription?.text) {
          console.log('[MODEL SPOKE]:', msg.serverContent.outputTranscription.text);
        }
        if (msg.serverContent?.turnComplete) {
          console.log('[TURN COMPLETE]');
        }
      },
      onclose: (e) => console.log('Closed:', e.code, e.reason),
      onerror: (err) => console.error('Error:', err),
    }
  });

  console.log('Connected! Sending user turn: "Search for the latest news on OpenAI"');
  session.sendClientContent({
    turns: [{ role: 'user', parts: [{ text: 'Search for the latest news on OpenAI' }] }],
    turnComplete: true,
  });

  setTimeout(() => { session.close(); process.exit(0); }, 25000);
})();
