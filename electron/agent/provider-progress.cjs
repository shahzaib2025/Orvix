const { redactApiKeys } = require('./api-key-check.cjs');
const { providerFor } = require('./provider-registry.cjs');

function requestReasoning(model) {
  // A compatible Responses endpoint does not imply that every model supports summary requests.
  return Boolean(providerFor(model).reasoningSummary?.(model));
}

function cleanProgress(value) {
  return redactApiKeys(String(value ?? '')).slice(0, 16000);
}

function streamProgress(route, event) {
  if (route === 'responses') {
    if (event.type === 'response.reasoning_summary_text.delta' && typeof event.delta === 'string') {
      return { kind: 'reasoning_summary', id: `summary-${event.item_id ?? event.output_index}-${event.summary_index ?? 0}`, phase: 'delta', text: cleanProgress(event.delta) };
    }
    if (event.type === 'response.reasoning_summary_text.done' && typeof event.text === 'string') {
      return { kind: 'reasoning_summary', id: `summary-${event.item_id ?? event.output_index}-${event.summary_index ?? 0}`, phase: 'complete', text: cleanProgress(event.text) };
    }
  }
  if (route === 'messages' && event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta' && typeof event.delta.thinking === 'string') {
    return { kind: 'provider_reasoning', id: `thinking-${event.index}`, phase: 'delta', text: cleanProgress(event.delta.thinking) };
  }
  if (route === 'chat') {
    const delta = event.choices?.[0]?.delta;
    const value = delta?.reasoning_content ?? delta?.reasoning;
    if (typeof value === 'string' && value) return { kind: 'provider_reasoning', id: 'provider-reasoning', phase: 'delta', text: cleanProgress(value) };
  }
  return null;
}

function completedProgress(route, data) {
  if (route === 'responses') return (data?.output ?? []).flatMap((item, itemIndex) => item?.type === 'reasoning'
    ? (item.summary ?? []).filter(part => part?.type === 'summary_text' && typeof part.text === 'string')
      .map((part, summaryIndex) => ({ kind: 'reasoning_summary', id: `summary-${item.id ?? itemIndex}-${summaryIndex}`, phase: 'complete', text: cleanProgress(part.text) }))
    : []);
  if (route === 'messages') return (data?.content ?? []).flatMap((part, index) => part?.type === 'thinking' && typeof part.thinking === 'string' && part.thinking
    ? [{ kind: 'provider_reasoning', id: `thinking-${index}`, phase: 'complete', text: cleanProgress(part.thinking) }] : []);
  const message = data?.choices?.[0]?.message;
  const value = message?.reasoning_content ?? message?.reasoning;
  return typeof value === 'string' && value ? [{ kind: 'provider_reasoning', id: 'provider-reasoning', phase: 'complete', text: cleanProgress(value) }] : [];
}

module.exports = { requestReasoning, streamProgress, completedProgress, cleanProgress };
