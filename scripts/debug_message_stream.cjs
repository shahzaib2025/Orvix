const { GoogleGenAI } = require('@google/genai');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require('../electron/live-env.cjs').loadLiveEnv(root);
const { createLiveToken } = require('../electron/live-auth.cjs');
const weatherTool = require('../shared/weather-tool.json');
const searchTool = require('../shared/search-tool.json');
const pageTool = require('../shared/page-tool.json');
const filesystemTools = require('../shared/filesystem-tools.json');

(async () => {
  const { token, model } = await createLiveToken('Thinking', 'MEDIUM');
  const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });
  
  const declarations = [
    ...weatherTool.functionDeclarations.map(d => ({ ...d, behavior: 'NON_BLOCKING' })),
    ...searchTool.functionDeclarations.map(d => ({ ...d, behavior: 'NON_BLOCKING' })),
    ...pageTool.functionDeclarations.map(d => ({ ...d, behavior: 'NON_BLOCKING' })),
    ...filesystemTools.functionDeclarations.map(d => ({ ...d, behavior: 'NON_BLOCKING' })),
  ];

  const config = {
    responseModalities: ['AUDIO'],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    tools: [{ functionDeclarations: declarations }],
    systemInstruction: `You are Orvix Thinking, an accurate desktop voice assistant with access to local files and Desktop. Today's date is ${new Date().toISOString().slice(0, 10)}. For questions about files, folders, or Desktop items, call list_directory, search_files, or search_content. For current weather and forecasts, call get_weather. For recent facts, news, and official sources, call web_search and read_web_page. Provide clear, direct, and helpful spoken answers based on the tool results.`,
    thinkingConfig: { thinkingLevel: 'MEDIUM' },
  };

  const fsTools = require('../electron/live-fs-tools.cjs');

  let pendingCalls = [];
  let toolBatchTimer = null;

  const session = await ai.live.connect({
    model,
    config,
    callbacks: {
      onopen: () => console.log('CONNECTED!'),
      onmessage: msg => {
        const str = JSON.stringify(msg, (k, v) => (k === 'data' && typeof v === 'string' && v.length > 50 ? `[base64 ${v.length}b]` : v), 2);
        console.log('MSG:', str);
        if (msg.toolCall?.functionCalls?.length) {
          pendingCalls.push(...msg.toolCall.functionCalls);
          clearTimeout(toolBatchTimer);
          toolBatchTimer = setTimeout(async () => {
            const callsToRun = [...pendingCalls];
            pendingCalls = [];
            const functionResponses = [];
            for (const call of callsToRun) {
              console.log(`Executing tool: ${call.name} (id: ${call.id}) with args:`, call.args);
              let out;
              if (call.name === 'search_files') out = await fsTools.searchFiles(call.args);
              else if (call.name === 'search_content') out = await fsTools.searchContent(call.args);
              else if (call.name === 'list_directory') out = await fsTools.listDirectory(call.args);
              else out = { status: 'unknown_tool' };
              console.log(`Tool ${call.name} result:`, out);
              functionResponses.push({ id: call.id, name: call.name, response: { output: out } });
            }
            console.log(`Sending combined tool response with ${functionResponses.length} functionResponses...`);
            session.sendToolResponse({ functionResponses });
          }, 100);
        }
      },
      onerror: err => console.error('ERR:', err),
      onclose: ev => console.log('CLOSE:', ev),
    },
  });

  const query = process.argv[2] || "Find any files related to Florian on my computer.";
  console.log('Sending client content:', query);
  session.sendClientContent({
    turns: [{ role: 'user', parts: [{ text: query }] }],
    turnComplete: true,
  });

  setTimeout(() => {
    session.close();
    process.exit(0);
  }, 35000);
})();
