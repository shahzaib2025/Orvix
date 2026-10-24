const apiModels = [
  ...require('../../shared/inception-models.json').models.map(model => ({
    ...model, id: `inception/${model.id}`, credentialTier: 'inception', route: 'chat',
  })),
  ...require('../../shared/requesty-models.json').models.map(model => ({
    id: `requesty/${model.id}`, name: model.name, apiModelId: model.id, credentialTier: 'requesty', route: 'chat',
    input: model.vision ? ['text', 'image'] : ['text'], contextLength: model.contextLength,
  })),
  ...require('../../shared/routeway-models.json').models.map(model => ({
    id: `routeway/${model.id}`, name: model.name, apiModelId: model.id, credentialTier: 'routeway', route: 'chat',
    input: model.vision ? ['text', 'image'] : ['text'], contextLength: model.contextLength,
  })),
  ...[
    ['Gemini 3.8 Flash', 'gemini-3.8-flash'],
    ['Gemini 3.6 Flash', 'gemini-3.6-flash'],
    ['Gemini 3.5 Flash-Lite', 'gemini-3.5-flash-lite'],
    ['Gemini 3.1 Flash-Lite', 'gemini-3.1-flash-lite'],
    ['Gemini 2.5 Flash', 'gemini-2.5-flash'],
    ['Gemini 2.5 Flash-Lite', 'gemini-2.5-flash-lite'],
    ['Gemini 2.5 Pro', 'gemini-2.5-pro'],
  ].map(([name, apiModelId]) => ({ id: `google/${apiModelId}`, name, apiModelId, credentialTier: 'google', route: 'chat', input: ['text'],
    variants: apiModelId === 'gemini-3.8-flash' ? ['low', 'medium', 'high'] : apiModelId.startsWith('gemini-2.5-') ? (apiModelId.endsWith('-pro') ? ['minimal', 'low', 'medium', 'high'] : ['none', 'minimal', 'low', 'medium', 'high']) : ['minimal', 'low', 'medium', 'high'] })),
  ...[
    ['GPT OSS 120B', 'gpt-oss-120b'],
    ['Qwen 3.8 27B', 'qwen-3.8-27b'],
  ].map(([name, apiModelId]) => ({ id: `cerebras/${apiModelId}`, name, apiModelId, credentialTier: 'cerebras', route: 'chat', input: ['text'] })),
  ...[
    ['GPT OSS 120B', 'openai/gpt-oss-120b'],
    ['GPT OSS 20B', 'openai/gpt-oss-20b'],
    ['Qwen 3.8 27B', 'qwen/qwen3.8-27b'],
  ].map(([name, apiModelId]) => ({ id: `groq/${apiModelId}`, name, apiModelId, credentialTier: 'groq', route: 'chat', input: ['text'], variants: apiModelId.startsWith('openai/gpt-oss-') ? ['low', 'medium', 'high'] : ['none', 'low', 'medium', 'high'] })),
  ...[
    ['Agnes 2.5 Flash', 'agnes-2.5-flash'],
    ['JEV', 'jev'],
    ['Laguna S 2.1', 'laguna-s-2.1'],
    ['Nemotron 3.5 Lightning Free', 'nemotron-3.5-lightning-free'],
  ].map(([name, apiModelId]) => ({ id: `nara/${apiModelId}`, name, apiModelId, credentialTier: 'nara', route: 'chat', input: ['text'] })),
];

module.exports = { apiModels };
