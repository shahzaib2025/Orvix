// Only public option prose and the public storyboard field enter this stream.
// Reasoning, other tool arguments and tool results must never be passed here.
const LIMIT = 64000;
const optionStart = /(?:^|\n)[ \t]*(?:[-*•+]\s*|\d+[.)]\s*)?(?:#{1,6}\s*)?(?:\*\*)?(?:(?:SELECTED|CHOSEN)\s*[-—–:]\s*)?(?:option|direction|prompt|concept)\s+[AB12]\b/i;
const briefTool = /^(?:orvix_visual_)?set_design_brief$/;

function storyboardFromPartialJson(raw) {
  // Decode only complete JSON string characters. A trailing escape or partial
  // unicode escape stays buffered until the next real provider chunk arrives.
  const match = /"storyboard"\s*:\s*"/.exec(raw);
  if (!match) return '';
  let result = '';
  for (let index = match.index + match[0].length; index < raw.length && result.length < LIMIT; index++) {
    const character = raw[index];
    if (character === '"') break;
    if (character !== '\\') { result += character; continue; }
    const escaped = raw[++index];
    if (escaped === undefined) break;
    if (escaped === 'u') {
      const code = raw.slice(index + 1, index + 5);
      if (!/^[a-f\d]{4}$/i.test(code)) break;
      result += String.fromCharCode(parseInt(code, 16)); index += 4;
    } else {
      const escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };
      if (!Object.hasOwn(escapes, escaped)) break;
      result += escapes[escaped];
    }
  }
  return result;
}

function createDesignOptionsStream({ enabled, emit, signal }) {
  const texts = new Map(), tools = new Map();
  let active = null, recorded = false, timer = null, last = '', disposed = false;
  const publish = (phase = 'update', suffix = '') => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!enabled || disposed || signal?.aborted && phase !== 'complete' || !active) return;
    const text = ['Design options and selection', active.text, suffix].filter(Boolean).join('\n\n');
    if (text === last && phase !== 'complete') return;
    last = text;
    emit({ type: 'model_progress', progressKind: 'agent_update', progressId: 'website-design-options', phase, text });
  };
  const accept = (id, kind, value) => {
    if (!enabled || disposed || signal?.aborted || typeof value !== 'string') return false;
    const match = optionStart.exec(value);
    if (!match) return false;
    const text = value.slice(match.index).trimStart().slice(0, LIMIT);
    if (active?.id === id && active.text === text) return true;
    const first = !active || active.id !== id;
    active = { id, kind, text }; recorded = false;
    if (first) publish();
    else if (!timer) timer = setTimeout(() => publish(), 75);
    return true;
  };
  const remember = (map, id, value) => {
    map.set(id, value);
    if (map.size > 16) map.delete(map.keys().next().value);
  };
  return {
    text(id, value, delta = false) {
      if (!enabled || typeof value !== 'string') return false;
      const previous = texts.get(id) ?? '';
      // Ignore replayed older snapshots, but accept an explicit replacement.
      if (!delta && previous.startsWith(value)) return Boolean(optionStart.test(previous));
      const next = (delta ? previous + value : value).slice(0, LIMIT);
      remember(texts, id, next);
      return accept(id, 'text', next);
    },
    tool({ id, name, input, arguments: raw, delta = false }) {
      if (!enabled) return;
      const previous = tools.get(id) ?? { name: '', raw: '' };
      if (typeof raw === 'string' && !delta && raw.length < previous.raw.length && previous.raw.startsWith(raw)) return;
      const next = { name: name || previous.name, raw: typeof raw === 'string' ? (delta ? previous.raw + raw : raw).slice(0, LIMIT * 2) : previous.raw };
      remember(tools, id, next);
      if (!briefTool.test(next.name)) return;
      // Full public prose has more detail than its compact tool digest.
      if (active?.kind === 'text' && !recorded) return;
      const storyboard = typeof input?.storyboard === 'string' ? input.storyboard : storyboardFromPartialJson(next.raw);
      accept(id, 'tool', storyboard);
    },
    checking(summary) {
      if (recorded || !active) accept('recorded-brief', 'tool', summary);
      publish('update', 'Comparing the selected direction…');
    },
    record(summary, outcome) {
      if (!active || recorded) accept('recorded-brief', 'tool', summary);
      if (!active && enabled) active = { id: 'recorded-brief', kind: 'tool', text: String(summary).slice(0, LIMIT) };
      // The submitted brief owns the final choice, even if drafting changed it.
      const selected = /\bselected\s+option\s*:\s*([AB])\b/i.exec(summary)?.[1];
      if (active && selected) active.text = `Selected option: ${selected}\n\n${active.text.replace(/^Selected option: [AB]\n\n/, '')}`;
      publish('complete', outcome);
      recorded = true;
    },
    finish(interrupted = false) {
      if (!recorded) publish('complete', interrupted ? 'Option generation interrupted; this draft is incomplete.' : '');
      if (timer) clearTimeout(timer);
      timer = null;
    },
    reset() {
      if (timer) clearTimeout(timer);
      timer = null;
      if (active && !recorded) emit({ type: 'model_progress', progressId: 'website-design-options', phase: 'remove' });
      texts.clear(); tools.clear(); active = null; recorded = false; last = '';
    },
    dispose() { if (timer) clearTimeout(timer); timer = null; disposed = true; },
  };
}

module.exports = { createDesignOptionsStream, storyboardFromPartialJson };
