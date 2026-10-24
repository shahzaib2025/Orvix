// Isolate parameterless tool schemas from production orchestration.
const fs = require('node:fs');
const path = require('node:path');
const { GoogleGenAI } = require('@google/genai');
const { createLiveToken } = require('../electron/live-auth.cjs');
const root = path.resolve(__dirname, '..');
require('../electron/live-env.cjs').loadLiveEnv(root);

async function probe(schema) {
  const report = { schema, calls: 0, submitted: 0, text: '', statuses: [] };
  let session, timer, resolve, reject;
  const done = new Promise((yes, no) => { resolve = yes; reject = no; });
  done.catch(() => {});
  try {
    const { token, model } = await createLiveToken('Thinking', 'LOW');
    const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });
    const declaration = { name: 'tiny_workflow_capabilities', description: 'Return the supported test trigger. Invoke when asked to inspect test workflow capabilities.', behavior: 'NON_BLOCKING',
      ...(schema === 'empty' ? { parameters: { type: 'OBJECT', properties: {} } } : schema === 'parameterized' ? { parameters: { type: 'OBJECT', properties: { topic: { type: 'STRING' } } } } : {}) };
    session = await ai.live.connect({ model, config: {
      responseModalities: ['AUDIO'], outputAudioTranscription: {}, thinkingConfig: { thinkingLevel: 'LOW' },
      systemInstruction: 'Speak English. When asked to inspect capabilities, call tiny_workflow_capabilities and answer using its returned data.',
      tools: [{ functionDeclarations: [declaration] }],
    }, callbacks: {
      onmessage(message) {
        for (const call of message.toolCall?.functionCalls || []) {
          report.calls++;
          try { session.sendToolResponse({ functionResponses: [{ id: call.id, name: call.name, response: { status: 'ok', trigger: 'daily' } }] }); report.submitted++; }
          catch (error) { reject(error); }
        }
        const content = message.serverContent;
        if (content?.outputTranscription?.text) report.text += content.outputTranscription.text;
        if (content?.interactionStatus) report.statuses.push(content.interactionStatus);
        if (content?.interactionStatus === 'IDLE') resolve();
      },
      onerror: error => reject(new Error(error.message || 'Socket error')),
      onclose: event => reject(new Error(`Connection closed (${event.code}): ${event.reason || ''}`)),
    } });
    timer = setTimeout(() => reject(new Error('No IDLE within 45 seconds')), 45000);
    session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: 'Inspect the test workflow capabilities using tiny_workflow_capabilities. Tell me the supported trigger returned by it.' }] }], turnComplete: true });
    await done;
    report.passed = report.calls > 0 && report.submitted > 0 && /daily/i.test(report.text) && !/system error/i.test(report.text);
  } catch (error) { report.passed = false; report.error = error.message; }
  finally { clearTimeout(timer); session?.close(); }
  console.log(JSON.stringify(report));
  return report;
}
(async () => {
  const results = [];
  for (const schema of ['empty', 'omitted', 'parameterized']) results.push(await probe(schema));
  fs.writeFileSync(path.join(root, 'scratch/thinking-schema-diagnostic-latest.json'), JSON.stringify({ at: new Date().toISOString(), scope: 'Real Extended Thinking LOW with one harmless synthetic tool, fresh connection per schema.', results }, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
