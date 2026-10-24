import { useState } from 'react';
import { Check, ChevronRight, KeyRound, RefreshCw, Search } from 'lucide-react';
import type { KiloCatalog, KiloModel } from '../desktop';
import { thinkingLabel } from './openCodeModels';
import './kilo-model-menu.css';

export default function KiloModelMenu({ catalog, loading, selectedId, variants, onChoose, onRefresh, onKeys }: {
  catalog: KiloCatalog; loading: boolean; selectedId: string; variants: Record<string, string>;
  onChoose: (id: string, variant: string | null) => void; onRefresh: () => void; onKeys: () => void;
}) {
  const [source, setSource] = useState<'free' | 'openai'>(() => selectedId.startsWith('kilo/openai/') ? 'openai' : 'free');
  const [query, setQuery] = useState('');
  const [hoveredId, setHoveredId] = useState(selectedId);
  const free = catalog.models.filter(model => model.access !== 'byok');
  const openai = catalog.models.filter(model => model.access === 'byok');
  const candidates = (source === 'free' ? free : openai).filter(model => `${model.name} ${model.apiModelId}`.toLowerCase().includes(query.trim().toLowerCase()));
  const checkFor = (model: KiloModel) => catalog.checks?.models[model.apiModelId];
  const testedAt = catalog.checks?.testedAt ? new Date(catalog.checks.testedAt) : null;
  const testDate = testedAt && Number.isFinite(testedAt.getTime()) ? testedAt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }) : null;
  const groups = source === 'free' ? [
    { id: 'passed', label: 'Passed last tool check', models: candidates.filter(model => checkFor(model)?.status === 'passed').sort((a, b) => (checkFor(a)?.replyMs ?? Infinity) - (checkFor(b)?.replyMs ?? Infinity)) },
    { id: 'untested', label: 'Not checked', models: candidates.filter(model => !checkFor(model)) },
    { id: 'attention', label: 'Needs attention', models: candidates.filter(model => checkFor(model)?.status === 'attention') },
    { id: 'failed', label: 'Last check failed', models: candidates.filter(model => checkFor(model)?.status === 'failed') },
  ] : [
    { id: 'gpt6', label: 'GPT-6 series', models: candidates.filter(model => /^openai\/gpt-6(?:[.-]|$)/.test(model.apiModelId)) },
    { id: 'gpt5', label: 'GPT-5 series', models: candidates.filter(model => /^openai\/gpt-5(?:[.-]|$)/.test(model.apiModelId)) },
    { id: 'other', label: 'Other OpenAI models', models: candidates.filter(model => !/^openai\/gpt-[56](?:[.-]|$)/.test(model.apiModelId)) },
  ];
  const ordered = groups.flatMap(group => group.models);
  const hovered = candidates.find(model => model.id === hoveredId) ?? ordered[0];
  const chosenVariant = hovered && variants[hovered.id];
  const check = hovered && source === 'free' ? checkFor(hovered) : undefined;
  const choose = (model: KiloModel, variant: string | null = variants[model.id] ?? null) => onChoose(model.id, variant && model.variants[variant] ? variant : null);
  const renderModel = (model: KiloModel) => <button key={model.id} type="button" role="menuitemradio" aria-checked={selectedId === model.id}
    aria-label={`${model.name} ${model.access === 'byok' ? 'BYOK' : 'Free'}`}
    className={`agent-opencode-model${selectedId === model.id ? ' selected' : ''}`} onMouseEnter={() => setHoveredId(model.id)} onFocus={() => setHoveredId(model.id)} onClick={() => choose(model)}>
    <span><strong>{model.name}</strong><small className="agent-kilo-row-caption">{model.access === 'byok' ? 'Connected OpenAI' : model.apiModelId.split('/')[0]}</small></span>
    <span className="agent-opencode-model-end">{model.access !== 'byok' && checkFor(model) && <i className={`agent-kilo-check-dot is-${checkFor(model)?.status}`} aria-hidden="true" />}{selectedId === model.id && <Check size={14} />}{Object.keys(model.variants).length > 0 && <ChevronRight size={13} />}</span>
  </button>;
  return <div className="agent-opencode-menu agent-kilo-menu" role="menu" aria-label="Kilo models">
    <div className="agent-opencode-menu-head"><strong>Choose a model</strong><div>
      <button type="button" aria-label="Refresh Kilo models" title="Refresh the catalog; saved test results remain dated" disabled={loading} onClick={onRefresh}><RefreshCw size={13} className={loading ? 'is-refreshing' : ''} /></button>
      <button type="button" onClick={onKeys}><KeyRound size={13} /> Key</button>
    </div></div>
    <div className="agent-kilo-source-switch" role="group" aria-label="Model source">
      {(['free', 'openai'] as const).map(value => <button type="button" key={value} aria-pressed={source === value} onClick={() => { setSource(value); setQuery(''); }}>
        {value === 'free' ? 'Free models' : 'OpenAI models'}<small>{value === 'free' ? free.length : openai.length}</small>
      </button>)}
    </div>
    <label className="agent-kilo-search"><Search size={14} /><input type="search" aria-label="Search Kilo models" placeholder={source === 'free' ? 'Search free models…' : 'Search OpenAI models…'} value={query} onChange={event => setQuery(event.target.value)} /></label>
    <div className="agent-kilo-catalog-status" role="status">{loading ? 'Refreshing live catalog…' : catalog.error ? catalog.error : source === 'free' ? testDate ? `Last tested ${testDate} · Results are a snapshot, not live availability.` : 'Free coding models · No saved checks for this account.' : 'Connected OpenAI account · Model access depends on your connection and plan.'}{catalog.stale && !loading ? ' · Cached list' : ''}</div>
    <div className="agent-opencode-menu-body">
      <div className="agent-opencode-menu-scroll">
        {!candidates.length && <p className="agent-kilo-empty">{query ? 'No matching models in this list.' : loading ? 'Loading models…' : source === 'openai' ? 'No connected OpenAI models. Connect your account in Kilo, then refresh.' : 'No free coding models available. Refresh to check again.'}</p>}
        {groups.filter(group => group.models.length).map(group => group.id === 'failed' ? <details key={group.id} className="agent-kilo-model-group is-failed" open={Boolean(query) || group.models.some(model => model.id === selectedId)}>
          <summary>{group.label}<small>{group.models.length}</small><ChevronRight size={12} /></summary>{group.models.map(renderModel)}
        </details> : <section key={group.id} className="agent-kilo-model-group" aria-label={group.label}>
          <header>{group.label}<small>{group.models.length}</small></header>{group.models.map(renderModel)}
        </section>)}
      </div>
      {hovered && <div className="agent-thinking-panel" aria-label={`Thinking settings for ${hovered.name}`}>
        <div className="agent-thinking-panel-head"><span>Thinking</span><strong>{hovered.name}</strong></div>
        {Object.keys(hovered.variants).length > 0 ? <><p>Levels supported by this model.</p><div className="agent-thinking-options" role="group" aria-label={`Thinking levels for ${hovered.name}`}>
          {[null, ...Object.keys(hovered.variants)].map(variant => <button key={variant ?? 'default'} type="button" className={chosenVariant === variant || (!chosenVariant && !variant) ? 'selected' : ''} onClick={() => choose(hovered, variant)}>
            <span>{variant ? thinkingLabel(variant) : 'Default'}</span>{(chosenVariant === variant || (!chosenVariant && !variant)) && <Check size={14} />}
          </button>)}
        </div></> : <div className="agent-thinking-unavailable">No adjustable thinking levels advertised.</div>}
        {check && <div className={`agent-kilo-check-card is-${check.status}`}><strong>{check.status === 'passed' ? 'Passed last check' : check.status === 'attention' ? 'Needs attention' : 'Last check failed'}</strong><span>{check.note}</span>{check.replyMs !== undefined && <span>Test reply: {(check.replyMs / 1000).toFixed(1)}s</span>}</div>}
        <div className="agent-kilo-model-info"><code>{hovered.apiModelId}</code>{hovered.access === 'byok' && <span>Eligible requests use your connected ChatGPT allowance. OpenAI models are separate from the free list.</span>}{hovered.contextLength && <span>{hovered.contextLength.toLocaleString()} token model context</span>}{hovered.mayTrainOnPrompts && <span>Provider may use prompts for training.</span>}</div>
      </div>}
    </div>
  </div>;
}
