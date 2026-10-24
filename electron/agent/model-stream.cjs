const maxStreamBytes = 8 * 1024 * 1024;
const { streamProgress } = require('./provider-progress.cjs');

async function readEvents(response, onEvent) {
  if (!response.body) throw new Error('Model returned an empty stream.');
  const decoder = new TextDecoder();
  let buffer = '';
  let received = 0;
  const frame = value => {
    const data = value.split('\n').filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    let parsed;
    try { parsed = JSON.parse(data); }
    catch { throw new Error('Model returned an invalid streaming event.'); }
    onEvent(parsed);
  };
  for await (const chunk of response.body) {
    received += chunk.byteLength;
    if (received > maxStreamBytes) throw new Error('Model stream exceeded the 8 MB response limit.');
    buffer += decoder.decode(chunk, { stream: true });
    buffer = buffer.replaceAll('\r\n', '\n');
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      frame(buffer.slice(0, end));
      buffer = buffer.slice(end + 2);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) frame(buffer);
}

function textContent(value) {
  if (typeof value === 'string') return value;
  return Array.isArray(value) ? value.filter(part => part?.type === 'text').map(part => part.text ?? '').join('') : '';
}

function chatStreamError(value) {
  const data = value && typeof value === 'object' ? value : { message: value };
  const message = String(data.message ?? data.error?.message ?? value ?? 'Model stream failed.').slice(0, 1200);
  const error = new Error(message);
  const status = Number(data.status_code ?? data.status ?? data.http_status ?? data.error?.status_code ?? data.error?.status);
  if (Number.isInteger(status) && status >= 100 && status <= 599) {
    error.status = status;
    error.statusCode = status;
  }
  const code = data.code ?? data.type ?? data.error?.code ?? data.error?.type;
  if (typeof code === 'string' && code.length) error.providerCode = code.slice(0, 100);
  const requestId = data.id ?? data.request_id ?? data.error?.id ?? data.error?.request_id;
  if (typeof requestId === 'string' && /^[\w.:-]{1,120}$/.test(requestId)) error.requestId = requestId;
  return error;
}

function chatCollector(onText, onProgress, onToolInput) {
  const message = { role: 'assistant', content: '', tool_calls: [] };
  const reasoningDetails = new Map();
  let usage = null;
  let complete = false;
  return {
    event(chunk) {
      const progress = streamProgress('chat', chunk);
      if (progress) onProgress?.(progress);
      if (chunk.error) throw chatStreamError(chunk.error);
      if (chunk.usage) usage = chunk.usage;
      const delta = chunk.choices?.[0]?.delta;
      if (chunk.choices?.[0]?.finish_reason) complete = true;
      if (!delta) return;
      const text = textContent(delta.content);
      if (text) { message.content += text; onText(text); }
      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (typeof reasoning === 'string') message.reasoning_content = (message.reasoning_content ?? '') + reasoning;
      for (const detail of delta.reasoning_details ?? []) {
        const id = detail.index ?? detail.id ?? reasoningDetails.size;
        const previous = reasoningDetails.get(id) ?? {};
        const combined = { ...previous, ...detail };
        for (const field of ['text', 'summary', 'data']) if (typeof previous[field] === 'string' && typeof detail[field] === 'string') combined[field] = previous[field] + detail[field];
        reasoningDetails.set(id, combined);
      }
      if (reasoningDetails.size) message.reasoning_details = [...reasoningDetails.values()];
      for (const call of delta.tool_calls ?? []) {
        const index = call.index ?? message.tool_calls.length;
        const target = message.tool_calls[index] ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (call.id) target.id = call.id;
        if (call.function?.name) target.function.name += call.function.name;
        if (call.function?.arguments) target.function.arguments += call.function.arguments;
        if (call.extra_content) target.extra_content = {
          ...target.extra_content, ...call.extra_content,
          ...(call.extra_content.google ? { google: { ...target.extra_content?.google, ...call.extra_content.google } } : {}),
        };
        message.tool_calls[index] = target;
        onToolInput?.({ id: target.id || `chat-${index}`, name: target.function.name, arguments: target.function.arguments });
      }
    },
    result() {
      if (!complete) throw new Error('Model stream ended before its final message.');
      return { raw: message, usage };
    },
  };
}

function responsesCollector(onText, onProgress, onToolInput) {
  const output = new Map();
  let completed = null;
  let usage = null;
  let complete = false;
  const itemAt = index => {
    if (!output.has(index)) output.set(index, { type: 'message', role: 'assistant', content: [] });
    return output.get(index);
  };
  return {
    event(event) {
      const progress = streamProgress('responses', event);
      if (progress) onProgress?.(progress);
      if (event.type === 'error' || event.type === 'response.failed' || event.type === 'response.incomplete' || event.error) {
        throw new Error(String(event.error?.message ?? event.response?.error?.message ?? 'Model stream failed.'));
      }
      if (event.type === 'response.completed') {
        complete = true;
        completed = event.response?.output ?? null;
        usage = event.response?.usage ?? usage;
      }
      if (event.type === 'response.output_item.added' || event.type === 'response.output_item.done') {
        output.set(event.output_index, event.item);
      }
      if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
        const item = itemAt(event.output_index);
        item.content ??= [];
        const index = event.content_index ?? 0;
        item.content[index] ??= { type: 'output_text', text: '' };
        item.content[index].text = (item.content[index].text ?? '') + event.delta;
        onText(event.delta);
      }
      if (event.type === 'response.function_call_arguments.delta' && typeof event.delta === 'string') {
        const item = itemAt(event.output_index);
        item.type = 'function_call';
        item.arguments = (item.arguments ?? '') + event.delta;
      }
      if (event.type === 'response.function_call_arguments.done') {
        const item = itemAt(event.output_index);
        item.type = 'function_call';
        item.arguments = event.arguments;
        item.name = event.name ?? item.name;
      }
      if (/^response\.(?:output_item\.(?:added|done)|function_call_arguments\.(?:delta|done))$/.test(event.type)) {
        const item = output.get(event.output_index);
        if (item?.type === 'function_call') onToolInput?.({ id: item.call_id || item.id || `responses-${event.output_index}`, name: item.name, arguments: item.arguments ?? '' });
      }
    },
    result() {
      if (!complete) throw new Error('Model stream ended before its final response.');
      return { raw: completed ?? [...output.entries()].sort(([a], [b]) => a - b).map(([, item]) => item), usage };
    },
  };
}

function messagesCollector(onText, onProgress, onToolInput) {
  const content = [];
  const jsonInputs = new Map();
  let usage = null;
  let complete = false;
  return {
    event(event) {
      const progress = streamProgress('messages', event);
      if (progress) onProgress?.(progress);
      if (event.type === 'error' || event.error) throw new Error(String(event.error?.message ?? 'Model stream failed.'));
      if (event.type === 'message_start') usage = event.message?.usage ?? usage;
      if (event.type === 'message_stop') complete = true;
      if (event.type === 'message_delta') usage = { ...usage, ...event.usage };
      if (event.type === 'content_block_start') content[event.index] = event.content_block;
      if (event.type === 'content_block_delta') {
        const block = content[event.index];
        if (!block) return;
        if (event.delta?.type === 'text_delta') {
          block.text = (block.text ?? '') + event.delta.text;
          onText(event.delta.text);
        }
        if (event.delta?.type === 'thinking_delta') block.thinking = (block.thinking ?? '') + (event.delta.thinking ?? '');
        if (event.delta?.type === 'signature_delta') block.signature = (block.signature ?? '') + (event.delta.signature ?? '');
        if (event.delta?.type === 'input_json_delta') {
          jsonInputs.set(event.index, (jsonInputs.get(event.index) ?? '') + event.delta.partial_json);
          if (block.type === 'tool_use') onToolInput?.({ id: block.id || `messages-${event.index}`, name: block.name, arguments: jsonInputs.get(event.index) });
        }
      }
      if (event.type === 'content_block_stop' && jsonInputs.has(event.index)) {
        try { content[event.index].input = JSON.parse(jsonInputs.get(event.index)); }
        catch { throw new Error('Model returned invalid tool arguments.'); }
        jsonInputs.delete(event.index);
      }
    },
    result() {
      if (!complete) throw new Error('Model stream ended before its final message.');
      return { raw: content.filter(Boolean), usage };
    },
  };
}

async function collectStream(route, response, onText, onProgress, onToolInput) {
  const collector = route === 'chat' ? chatCollector(onText, onProgress, onToolInput)
    : route === 'messages' ? messagesCollector(onText, onProgress, onToolInput) : responsesCollector(onText, onProgress, onToolInput);
  await readEvents(response, event => collector.event(event));
  return collector.result();
}

module.exports = { collectStream, chatStreamError };
