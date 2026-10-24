const root = require('path').resolve(__dirname, '..');
require('../electron/live-env.cjs').loadLiveEnv(root);
const { GoogleGenAI } = require('@google/genai');
const weatherTool = require('../shared/weather-tool.json');
const weather = require('../electron/weather.cjs');
const { createLiveToken } = require('../electron/live-auth.cjs');

async function test(name, transformOutput) {
  console.log(`\n=================== ${name} ===================`);
  const { token, model } = await createLiveToken('Thinking', 'MEDIUM');
  const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });
  
  return new Promise((resolve) => {
    let rawOutput;
    let toolResponseSubmitted = false;
    let spokenAfterTool = '';

    ai.live.connect({
      model,
      config: {
        responseModalities: ['AUDIO'],
        outputAudioTranscription: {},
        tools: [{ functionDeclarations: weatherTool.functionDeclarations }],
        thinkingConfig: { thinkingLevel: 'MEDIUM' },
        systemInstruction: 'You are Orvix. Today is 2026-09-27. Use get_weather for weather questions, then provide a helpful spoken answer.',
      },
      callbacks: {
        onmessage: async (msg) => {
          if (msg.toolCall) {
            for (const call of msg.toolCall.functionCalls || []) {
              rawOutput = await weather.getWeather(call.args);
              const output = transformOutput ? transformOutput(rawOutput) : rawOutput;
              console.log(`[${name}] Sending output:`, JSON.stringify(output).slice(0, 200));
              toolResponseSubmitted = true;
              session.sendToolResponse({
                functionResponses: [{ id: call.id, name: call.name, response: { output } }]
              });
            }
          }
          if (msg.serverContent?.outputTranscription?.text) {
            const text = msg.serverContent.outputTranscription.text;
            if (toolResponseSubmitted) {
              spokenAfterTool += text;
            } else {
              process.stdout.write(`(filler: ${text.trim()}) `);
            }
          }
          if (msg.serverContent?.turnComplete && toolResponseSubmitted) {
            console.log(`\n[${name}] FINAL ANSWER: "${spokenAfterTool.trim()}"`);
            session.close();
            resolve();
          }
        },
        onerror: (e) => console.error('Error:', e),
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
  // Test 1: Full raw output from weather.cjs
  await test('RAW FULL OUTPUT', (out) => out);

  // Test 2: Cleaned summary payload
  await test('CLEANED SUMMARY PAYLOAD', (out) => ({
    status: out.status,
    location: out.location,
    temperature: `${out.current?.temperature} ${out.temperatureUnit || '°C'}`,
    feelsLike: `${out.current?.feelsLike} ${out.temperatureUnit || '°C'}`,
    conditions: out.current?.conditions,
    humidity: `${out.current?.humidityPercent}%`,
    windSpeed: `${out.current?.windSpeed} ${out.windSpeedUnit || 'km/h'}`
  }));
})();
