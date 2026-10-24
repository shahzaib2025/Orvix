const path = require('path');
const root = path.resolve(__dirname, '..');
require('../electron/live-env.cjs').loadLiveEnv(root);
const { GoogleGenAI } = require('@google/genai');

const weatherTool = require('../shared/weather-tool.json');
const searchTool = require('../shared/search-tool.json');
const pageTool = require('../shared/page-tool.json');
const filesystemTools = require('../shared/filesystem-tools.json');
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

  let session;
  session = await ai.live.connect({
    model,
    config: {
      responseModalities: ['AUDIO'],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      tools: [{ functionDeclarations: declarations }],
      thinkingConfig: { thinkingLevel: 'MEDIUM' },
      systemInstruction: 'You are Orvix Thinking. Always call the matching tool to look up information. For weather, call get_weather. For web questions, call web_search. For files or folders, call list_directory or search_files. Never say a system error occurred.',
    },
    callbacks: {
      onopen: () => {},
      onmessage: async (msg) => {
        if (msg.toolCall) {
          console.log('\n[DEBUG RAW TOOLCALL RECEIVED!]:', JSON.stringify(msg.toolCall));
          for (const call of msg.toolCall.functionCalls || []) {
            console.log(`Executing ${call.name} with:`, call.args);
            const weather = await require('../electron/weather.cjs').getWeather(call.args);
            console.log('Got weather result:', weather.location, weather.current?.temperature);
            console.log('Sending tool response back to Gemini...');
            session.sendToolResponse({
              functionResponses: [{
                id: call.id,
                name: call.name,
                response: { output: weather }
              }]
            });
            console.log('Tool response sent!');
          }
        }
        if (msg.serverContent?.outputTranscription?.text) {
          process.stdout.write(msg.serverContent.outputTranscription.text);
        }
        if (msg.serverContent?.interrupted) console.log('\n[INTERRUPTED]');
        if (msg.serverContent?.turnComplete) console.log('\n[TURN COMPLETE]');
      },
      onclose: (e) => console.log('\nClosed:', e.code, e.reason),
      onerror: (err) => console.error('\nError:', err),
    }
  });

  console.log('Connected! Sending: "What is the weather in Tokyo?"');
  session.sendClientContent({
    turns: [{ role: 'user', parts: [{ text: 'What is the weather in Tokyo?' }] }],
    turnComplete: true,
  });

  setTimeout(() => { session.close(); process.exit(0); }, 20000);
})();
