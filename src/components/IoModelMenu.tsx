import { useState } from 'react';
import { Check, ChevronRight, RotateCcw } from 'lucide-react';
import type { AntigravityCatalog, AntigravityModel } from '../desktop';
import { thinkingLabel } from './openCodeModels';
import './io-model-menu.css';

const FALLBACK_MODELS: AntigravityModel[] = [
  {
    id: 'antigravity/gemini-3.8-flash',
    apiModelId: 'gemini-3.8-flash',
    modelEnum: 'MODEL_PLACEHOLDER_M318',
    name: 'Gemini 3.8 Flash',
    group: 'Google Gemini',
    route: 'chat',
    input: ['text', 'image'],
    contextLength: 1048576,
    maxOutputTokens: 65536,
    variants: ['high', 'medium', 'low'],
    description: 'Flagship reasoning model with 1M context and adjustable thinking levels'
  },
  {
    id: 'antigravity/claude-sonnet-4-6',
    apiModelId: 'claude-sonnet-4-6',
    modelEnum: 'MODEL_PLACEHOLDER_M35',
    name: 'Claude Sonnet 4.6 (Thinking)',
    group: 'Anthropic Claude',
    route: 'chat',
    input: ['text', 'image'],
    contextLength: 250000,
    maxOutputTokens: 64000,
    variants: ['extended'],
    description: 'Anthropic Claude Sonnet with reasoning under Antigravity quota'
  },
  {
    id: 'antigravity/claude-opus-4-6-thinking',
    apiModelId: 'claude-opus-4-6-thinking',
    modelEnum: 'MODEL_PLACEHOLDER_M26',
    name: 'Claude Opus 4.6 (Thinking)',
    group: 'Anthropic Claude',
    route: 'chat',
    input: ['text', 'image'],
    contextLength: 250000,
    maxOutputTokens: 64000,
    variants: ['extended'],
    description: 'Deep architectural and complex coding intelligence'
  },
  {
    id: 'antigravity/gpt-oss-120b-medium',
    apiModelId: 'gpt-oss-120b-medium',
    modelEnum: 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM',
    name: 'GPT-OSS 120B (Medium)',
    group: 'Open Source',
    route: 'chat',
    input: ['text'],
    contextLength: 131072,
    maxOutputTokens: 32768,
    variants: [],
    description: 'Open-weight 120B model via Vertex AI integration'
  }
];

export default function IoModelMenu({ catalog, loading, selectedId, variants, onChoose, onRefresh }: {
  catalog: AntigravityCatalog;
  loading: boolean;
  selectedId: string;
  variants: Record<string, string>;
  onChoose: (id: string, variant: string | null) => void;
  onRefresh: () => void;
}) {
  const normalizedSelectedId = selectedId.startsWith('antigravity/gemini-3.8-flash')
    ? 'antigravity/gemini-3.8-flash'
    : selectedId;

  const [hoveredId, setHoveredId] = useState(normalizedSelectedId);

  const rawModels = catalog.models && catalog.models.length > 0 ? catalog.models : FALLBACK_MODELS;
  // Filter out any obsolete models and unify any legacy flash models into single Gemini 3.8 Flash
  const filtered = rawModels.filter(m => !/(?:gemini-3-flash\b|gemini-3\.5-flash-lite)/i.test(m.apiModelId));
  const models: AntigravityModel[] = [];
  let addedFlash = false;
  for (const m of filtered) {
    if (m.id.includes('gemini-3.8-flash')) {
      if (!addedFlash) {
        models.push({
          ...m,
          id: 'antigravity/gemini-3.8-flash',
          apiModelId: 'gemini-3.8-flash',
          name: 'Gemini 3.8 Flash',
          modelEnum: 'MODEL_PLACEHOLDER_M320',
          variants: ['low', 'medium', 'high'],
          description: 'Ultra-fast flagship model with 1M context and adjustable reasoning'
        });
        addedFlash = true;
      }
    } else {
      models.push(m);
    }
  }

  const geminiModels = models.filter(m => m.group === 'Google Gemini');
  const claudeModels = models.filter(m => m.group === 'Anthropic Claude');
  const ossModels = models.filter(m => m.group === 'Open Source' || (m.group !== 'Google Gemini' && m.group !== 'Anthropic Claude'));

  const groups = [
    { title: 'Google Gemini', badge: 'Flash', models: geminiModels },
    { title: 'Anthropic Claude', badge: 'Thinking', models: claudeModels },
    { title: 'Open Source', badge: '120B', models: ossModels }
  ].filter(g => g.models.length > 0);

  const allModels = groups.flatMap(g => g.models);
  const hovered = allModels.find(m => m.id === hoveredId) ?? allModels.find(m => m.id === normalizedSelectedId) ?? allModels[0] ?? FALLBACK_MODELS[0];
  const chosenVariant = hovered && (variants[hovered.id] ?? (selectedId.endsWith('-medium') ? 'medium' : selectedId.endsWith('-low') ? 'low' : null));

  const choose = (id: string, variant: string | null = variants[id] ?? null) => {
    const target = allModels.find(m => m.id === id);
    onChoose(id, variant && target?.variants.includes(variant) ? variant : null);
  };

  const q = catalog.quota;
  const statusSubtitle = q
    ? `Gemini: ${Math.round((q.geminiWeeklyRemaining ?? 1) * 100)}% · Claude: ${Math.round((q.claudeWeeklyRemaining ?? 1) * 100)}% · Zero-cost quota`
    : `${models.length} free models · updated ${new Date(catalog.updatedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  return (
    <div className="agent-opencode-menu agent-io-menu" role="menu" aria-label="Antigravity I/O models">
      <div className="agent-opencode-menu-head">
        <div className="agent-opencode-menu-title">
          <strong>Antigravity I/O models</strong>
          <small className="agent-opencode-menu-status" role="status" title={catalog.error || undefined}>
            {catalog.error || (loading ? 'Refreshing Antigravity models…' : statusSubtitle)}
          </small>
        </div>
        <div>
          <button type="button" onClick={onRefresh} disabled={loading}>
            <RotateCcw size={13} className={loading ? 'is-refreshing' : ''} /> {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="agent-opencode-menu-body">
        <div className="agent-opencode-menu-scroll">
          {groups.map(group => (
            <div className="agent-opencode-group" role="group" aria-label={`${group.title} ${group.badge} models`} key={group.title}>
              <div className="agent-opencode-group-heading">
                <span>{group.title}</span>
                <small>{group.badge}</small>
                <em>{group.models.length}</em>
              </div>
              {group.models.map(model => (
                <button
                  key={model.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={normalizedSelectedId === model.id}
                  title={model.name}
                  className={`agent-opencode-model${normalizedSelectedId === model.id ? ' selected' : ''}`}
                  onMouseEnter={() => setHoveredId(model.id)}
                  onFocus={() => setHoveredId(model.id)}
                  onClick={() => choose(model.id)}
                >
                  <span><strong>{model.name}</strong></span>
                  <span className="agent-opencode-model-end">
                    {normalizedSelectedId === model.id && <Check size={14} />}
                    {model.variants.length > 0 && <ChevronRight size={13} />}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>

        {hovered && (
          <div className="agent-thinking-panel" aria-label={`Thinking settings for ${hovered.name}`}>
            <div className="agent-thinking-panel-head">
              <span>Thinking</span>
              <strong>{hovered.name}</strong>
            </div>
            {hovered.variants.length > 0 ? (
              <>
                <p>Choose a level for this model.</p>
                <div className="agent-thinking-options" role="group" aria-label={`Thinking levels for ${hovered.name}`}>
                  <button
                    type="button"
                    className={!chosenVariant ? 'selected' : ''}
                    onClick={() => choose(hovered.id, null)}
                  >
                    <span>Default</span>
                    {!chosenVariant && <Check size={14} />}
                  </button>
                  {hovered.variants.map(variant => (
                    <button
                      key={variant}
                      type="button"
                      className={chosenVariant === variant ? 'selected' : ''}
                      onClick={() => choose(hovered.id, variant)}
                    >
                      <span>{thinkingLabel(variant)}</span>
                      {chosenVariant === variant && <Check size={14} />}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="agent-thinking-unavailable">
                No adjustable thinking level is configured for this model.
              </div>
            )}
            <div className="agent-io-model-info">
              <code>{hovered.apiModelId}</code>
              <span>{hovered.description}</span>
              <span>{(hovered.contextLength).toLocaleString()} token context window</span>
              <span>{(hovered.maxOutputTokens).toLocaleString()} max generation tokens</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
