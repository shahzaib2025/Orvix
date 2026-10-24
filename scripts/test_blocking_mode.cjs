const path = require('path');
const root = path.resolve(__dirname, '..');
require('../electron/live-env.cjs').loadLiveEnv(root);
const { GoogleGenAI } = require('@google/genai');

const weatherTool = require('../shared/weather-tool.json');
const searchTool = require('../shared/search-tool.json');
const pageTool = require('../shared/page-tool.json');
const filesystemTools = require('../shared/filesystem-tools.json');

(async () => {
  const query = process.argv[2] || 'What is the weather in London?';
  console.log(`Testing query: "${query}"`);
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY_159, httpOptions: { apiVersion: 'v1alpha' } });
  
  // Set all tools to BLOCKING (remove behavior: NON_BLOCKING)
  const declarations = [
    ...weatherTool.functionDeclarations,
    ...searchTool.functionDeclarations,
    ...pageTool.functionDeclarations,
    ...filesystemTools.functionDeclarations,
  ].map(d => {
    const copy = { ...d };
    delete copy.behavior;
    return copy;
  });

  let session;
  session = await ai.live.connect({
    model: 'gemini-3.8-live-extended-thinking',
    config: {
      responseModalities: ['AUDIO'],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      tools: [{ functionDeclarations: declarations }],
      thinkingConfig: { thinkingLevel: 'MEDIUM' },
      systemInstruction: 'You are Orvix Thinking, a careful desktop assistant. Always call tools to answer user questions about weather, web search, reading web pages, or local files and folders. Never say a system error occurred.',
    },
    callbacks: {
      onopen: () => {},
      onmessage: async (msg) => {
        if (msg.toolCall) {
          console.log('\n>>> [TOOL CALL RECEIVED!]:', JSON.stringify(msg.toolCall));
          const functionResponses = [];
          for (const call of msg.toolCall.functionCalls || []) {
            console.log(`Executing ${call.name} with:`, call.args);
            let out;
            if (call.name === 'get_weather') {
              out = await require('../electron/weather.cjs').getWeather(call.args);
            } else if (call.name === 'list_directory') {
              out = await require('../electron/live-fs-tools.cjs').listDirectory(call.args);
            } else if (call.name === 'search_files') {
              out = await require('../electron/live-fs-tools.cjs').searchFiles(call.args);
            } else if (call.name === 'search_content') {
              out = await require('../electron/live-fs-tools.cjs').searchContent(call.args);
            } else if (call.name === 'web_search') {
              out = await require('../electron/search.cjs').searchWeb(call.args);
            } else if (call.name === 'read_web_page') {
              out = await require('../electron/search.cjs').readSearchResultPage(call.args);
            }
            functionResponses.push({
              id: call.id,
              name: call.name,
              response: { output: out }
            });
          }
          console.log(`Sending combined tool response with ${functionResponses.length} functionResponses...`);
          session.sendToolResponse({ functionResponses });
          console.log('Combined tool responses sent!');
        }
        if (msg.serverContent?.outputTranscription?.text) {
          process.stdout.write(msg.serverContent.outputTranscription.text);
        }
        if (msg.serverContent?.turnComplete) console.log('\n[TURN COMPLETE]');
      },
      onclose: (e) => console.log('\nClosed:', e.code, e.reason),
      onerror: (err) => console.error('\nError:', err),
    }
  });

  console.log(`Sending message: "${query}"`);
  session.sendClientContent({
    turns: [{ role: 'user', parts: [{ text: query }] }],
    turnComplete: true,
  });

  setTimeout(() => { session.close(); process.exit(0); }, 30000);
})();
