const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
require('../electron/live-env.cjs').loadLiveEnv(root);
const { GoogleGenAI } = require('@google/genai');

const weatherTool = require('../shared/weather-tool.json');
const searchTool = require('../shared/search-tool.json');
const pageTool = require('../shared/page-tool.json');
const filesystemTools = require('../shared/filesystem-tools.json');
const weather = require('../electron/weather.cjs');
const { createLiveToken } = require('../electron/live-auth.cjs');

async function runTest(label, outputTransformer) {
  console.log(`\n=================== ${label} ===================`);
  const { token, model } = await createLiveToken('Thinking', 'MEDIUM');
  const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });
  const declarations = [
    ...weatherTool.functionDeclarations,
    ...searchTool.functionDeclarations,
    ...pageTool.functionDeclarations,
    ...filesystemTools.functionDeclarations,
  ];

  return new Promise((resolve) => {
    let toolFinished = false;
    let spoken = '';

    ai.live.connect({
      model,
      config: {
        responseModalities: ['AUDIO'],
        outputAudioTranscription: {},
        tools: [{ functionDeclarations: declarations }],
        thinkingConfig: { thinkingLevel: 'MEDIUM' },
        systemInstruction: 'You are Orvix Thinking. Answer weather questions based on get_weather results.',
      },
      callbacks: {
        onmessage: async (msg) => {
          if (msg.toolCall) {
            for (const call of msg.toolCall.functionCalls || []) {
              console.log(`Received toolCall: ${call.name} with:`, call.args);
              const raw = await weather.getWeather(call.args);
              const output = outputTransformer(raw);
              console.log('Sending tool response:', JSON.stringify(output).slice(0, 200));
              toolFinished = true;
              session.sendToolResponse({
                functionResponses: [{ id: call.id, name: call.name, response: { output } }]
              });
            }
          }
          if (msg.serverContent?.outputTranscription?.text) {
            spoken += msg.serverContent.outputTranscription.text;
          }
          if (msg.serverContent?.turnComplete && toolFinished) {
            console.log(`[RESULT: ${label}]: "${spoken.trim()}"`);
            session.close();
            resolve();
          }
        },
        onerror: (err) => console.error('Error:', err),
      }
    }).then(s => {
      session = s;
      session.sendClientContent({
        turns: [{ role: 'user', parts: [{ text: 'What is the weather in Tokyo?' }] }],
        turnComplete: true,
      });
    });
  });
}

(async () => {
  // Test A: Cleaned summary object
  await runTest('CLEANED SUMMARY (location, conditions, temperature, humidity)', (raw) => ({
    status: 'ok',
    location: raw.location,
    conditions: raw.current?.conditions,
    temperature: `${raw.current?.temperature} C`,
    feelsLike: `${raw.current?.feelsLike} C`,
    humidity: `${raw.current?.humidityPercent}%`,
    windSpeed: `${raw.current?.windSpeed} km/h`
  }));

  // Test B: Raw with forecast removed
  await runTest('RAW WITHOUT FORECAST ARRAY', (raw) => {
    const clone = { ...raw };
    delete clone.forecast;
    return clone;
  });

  // Test C: Raw without degree symbol
  await runTest('RAW WITHOUT DEGREE SYMBOL', (raw) => {
    const clone = { ...raw };
    clone.temperatureUnit = 'C';
    return clone;
  });
})();
