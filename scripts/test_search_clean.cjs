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
  console.log('Testing clean web_search payload with Thinking model...');
  const { token, model } = await createLiveToken('Thinking', 'MEDIUM');
  const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });
  const declarations = [
    ...weatherTool.functionDeclarations,
    {
      name: "web_search",
      description: "Searches the live web for current facts, news, documentation, and information. Call this tool whenever the user asks for news, online facts, or live web info.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: {
            type: "STRING",
            description: "The search query to look up on the live web."
          }
        },
        required: ["query"]
      }
    },
    ...pageTool.functionDeclarations,
    ...filesystemTools.functionDeclarations,
  ];

  let spoken = '';
  const session = await ai.live.connect({
    model,
    config: {
      responseModalities: ['AUDIO'],
      outputAudioTranscription: {},
      tools: [{ functionDeclarations: declarations }],
      thinkingConfig: { thinkingLevel: 'MEDIUM' },
      systemInstruction: 'You are Orvix Thinking, an accurate desktop voice assistant. Always call tools (web_search, get_weather, list_directory, search_files) to retrieve data before speaking answers. Provide a clear, natural spoken summary based on the tool results.',
    },
    callbacks: {
      onmessage: async (msg) => {
        if (msg.toolCall) {
          for (const call of msg.toolCall.functionCalls || []) {
            console.log(`Executing ${call.name} with:`, call.args);
            const raw = await search.searchWeb(call.args);
            // Format clean concise results
            const cleanOutput = {
              status: raw.status,
              count: raw.count,
              results: (raw.results || []).slice(0, 3).map(r => ({
                title: r.title,
                snippet: r.snippet ? r.snippet.slice(0, 250) : '',
                url: r.url
              }))
            };
            console.log('Sending cleanOutput:', JSON.stringify(cleanOutput).slice(0, 200));
            session.sendToolResponse({
              functionResponses: [{ id: call.id, name: call.name, response: { output: cleanOutput } }]
            });
          }
        }
        if (msg.serverContent?.outputTranscription?.text) {
          spoken += msg.serverContent.outputTranscription.text;
          process.stdout.write(msg.serverContent.outputTranscription.text);
        }
        if (msg.serverContent?.turnComplete) {
          console.log('\n[TURN COMPLETE]');
        }
      }
    }
  });

  console.log('Sending: Search for the latest news on OpenAI');
  session.sendClientContent({
    turns: [{ role: 'user', parts: [{ text: 'Search for the latest news on OpenAI' }] }],
    turnComplete: true,
  });

  await new Promise(r => setTimeout(r, 35000));
  session.close();
  process.exit(0);
})();
