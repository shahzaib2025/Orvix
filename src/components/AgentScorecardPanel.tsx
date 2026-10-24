import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, SlidersHorizontal } from 'lucide-react';
import type { AgentScorecard } from '../desktop';
import './agent-execution.css';

type OutcomeId = 'attempts' | 'verified' | 'partial' | 'failed' | 'cancelled' | 'interrupted';
type MetricId = 'firstAttempt' | 'repeatConsistency' | 'recovery' | 'regressions' | 'unsupportedClaims' | 'falseCompletion' | 'toolWaitTimes';
type ScorecardPreferences = { outcomeOrder: OutcomeId[]; visibleOutcomes: OutcomeId[]; metricOrder: MetricId[]; visibleMetrics: MetricId[] };

const PREFERENCES_KEY = 'orvix.agentScorecardPills.v1';
const OUTCOMES: { id: OutcomeId; label: string }[] = [
  { id: 'attempts', label: 'Attempts' }, { id: 'verified', label: 'Verified' }, { id: 'partial', label: 'Partial' },
  { id: 'failed', label: 'Failed' }, { id: 'cancelled', label: 'Cancelled' }, { id: 'interrupted', label: 'Interrupted' },
];
const METRICS: { id: MetricId; label: string }[] = [
  { id: 'firstAttempt', label: 'First attempt verified' }, { id: 'repeatConsistency', label: 'Repeat consistency' },
  { id: 'recovery', label: 'Resumed runs verified' }, { id: 'regressions', label: 'Observed regressions' },
  { id: 'unsupportedClaims', label: 'Unsupported claim warnings' }, { id: 'falseCompletion', label: 'False completion rate' },
  { id: 'toolWaitTimes', label: 'Tool wait times' },
];
const DEFAULT_PREFERENCES: ScorecardPreferences = {
  outcomeOrder: OUTCOMES.map(item => item.id), visibleOutcomes: OUTCOMES.map(item => item.id),
  metricOrder: METRICS.map(item => item.id), visibleMetrics: METRICS.map(item => item.id),
};

function normalizeOrder<T extends string>(value: unknown, allowed: readonly T[], fallback: readonly T[]): T[] {
  const items = Array.isArray(value) ? value.filter((item): item is T => typeof item === 'string' && allowed.includes(item as T)) : [];
  return [...new Set(items), ...fallback.filter(item => !items.includes(item))];
}

function readPreferences(): ScorecardPreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || 'null') as Partial<ScorecardPreferences> | null;
    if (!saved) return DEFAULT_PREFERENCES;
    const outcomeOrder = normalizeOrder(saved.outcomeOrder, OUTCOMES.map(item => item.id), DEFAULT_PREFERENCES.outcomeOrder);
    const metricOrder = normalizeOrder(saved.metricOrder, METRICS.map(item => item.id), DEFAULT_PREFERENCES.metricOrder);
    const visibleOutcomes = Array.isArray(saved.visibleOutcomes)
      ? saved.visibleOutcomes.filter((item): item is OutcomeId => OUTCOMES.some(outcome => outcome.id === item))
      : DEFAULT_PREFERENCES.visibleOutcomes;
    const visibleMetrics = Array.isArray(saved.visibleMetrics)
      ? saved.visibleMetrics.filter((item): item is MetricId => METRICS.some(metric => metric.id === item))
      : DEFAULT_PREFERENCES.visibleMetrics;
    return { outcomeOrder, visibleOutcomes: [...new Set(visibleOutcomes)], metricOrder, visibleMetrics: [...new Set(visibleMetrics)] };
  } catch { return DEFAULT_PREFERENCES; }
}

const rate = (value: number | null) => value === null ? 'Not measured' : `${Math.round(value * 100)}%`;
const duration = (value: number | null) => value === null ? 'Unknown' : value >= 60000 ? `${(value / 60000).toFixed(1)} min` : `${(value / 1000).toFixed(1)} s`;

export default function AgentScorecardPanel({ active }: { active: boolean }) {
  const [score, setScore] = useState<AgentScorecard | null>(null);
  const [error, setError] = useState('');
  const [customizing, setCustomizing] = useState(false);
  const [preferences, setPreferences] = useState<ScorecardPreferences>(readPreferences);

  useEffect(() => {
    try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)); } catch { /* Keep the current choices for this app session. */ }
  }, [preferences]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    async function load() {
      try {
        const result = await window.orvixDesktop?.getAgentScorecard?.();
        if (alive && result) { setScore(result); setError(''); }
      } catch (cause) { if (alive) setError(String(cause)); }
    }
    void load();
    const unsubscribe = window.orvixDesktop?.onAgentEvent(event => {
      if (event.type === 'run_state' && event.run?.status !== 'running') void load();
    });
    return () => { alive = false; unsubscribe?.(); };
  }, [active]);

  const toggleVisible = (group: 'visibleOutcomes' | 'visibleMetrics', id: OutcomeId | MetricId) => {
    setPreferences(current => {
      const visible = current[group] as (OutcomeId | MetricId)[];
      return { ...current, [group]: visible.includes(id) ? visible.filter(item => item !== id) : [...visible, id] };
    });
  };
  const moveItem = (group: 'outcomeOrder' | 'metricOrder', id: OutcomeId | MetricId, direction: -1 | 1) => {
    setPreferences(current => {
      const order = [...current[group]] as (OutcomeId | MetricId)[];
      const index = order.indexOf(id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return current;
      [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
      return { ...current, [group]: order } as ScorecardPreferences;
    });
  };

  const renderPillChoices = (group: 'outcome' | 'metric') => {
    const entries = group === 'outcome' ? preferences.outcomeOrder.map(id => OUTCOMES.find(item => item.id === id)!) : preferences.metricOrder.map(id => METRICS.find(item => item.id === id)!);
    const visibleGroup = group === 'outcome' ? 'visibleOutcomes' : 'visibleMetrics';
    const orderGroup = group === 'outcome' ? 'outcomeOrder' : 'metricOrder';
    return <div className="agent-scorecard-customizer-list">
      {entries.map((entry, index) => <div className="agent-scorecard-customizer-row" key={entry.id}>
        <label><input type="checkbox" checked={(preferences[visibleGroup] as string[]).includes(entry.id)} onChange={() => toggleVisible(visibleGroup, entry.id)} /><span>{entry.label}</span></label>
        <span className="agent-scorecard-order-controls">
          <button type="button" aria-label={`Move ${entry.label} up`} title="Move up" disabled={index === 0} onClick={() => moveItem(orderGroup, entry.id, -1)}><ArrowUp size={12} /></button>
          <button type="button" aria-label={`Move ${entry.label} down`} title="Move down" disabled={index === entries.length - 1} onClick={() => moveItem(orderGroup, entry.id, 1)}><ArrowDown size={12} /></button>
        </span>
      </div>)}
    </div>;
  };

  const outcomeValue = (id: OutcomeId) => {
    if (!score) return '';
    switch (id) {
      case 'attempts': return `${score.attempts} ${score.attempts === 1 ? 'attempt' : 'attempts'}`;
      case 'verified': return `${score.verified} verified`;
      case 'partial': return `${score.partial} partial`;
      case 'failed': return `${score.failed} failed`;
      case 'cancelled': return `${score.cancelled} cancelled`;
      case 'interrupted': return `${score.interrupted} interrupted`;
    }
  };

  return <section className="agent-scorecard" aria-label="Coding run scorecard" onKeyDown={event => {
    if (event.key === 'Escape' && customizing && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); setCustomizing(false); }
  }}>
        <header className="agent-scorecard-header">
          <div className="agent-scorecard-title"><span className="agent-scorecard-mark" aria-hidden="true">↗</span><div><span className="agent-scorecard-eyebrow">RUN INSIGHTS</span><h2>Coding run scorecard</h2></div></div>
          <button type="button" className="agent-scorecard-customize-button" aria-label="Customize scorecard pills" title="Customize scorecard pills" aria-expanded={customizing} aria-controls="agent-scorecard-customizer" onClick={() => setCustomizing(value => !value)}><SlidersHorizontal size={14} /><span>Customize</span></button>
        </header>
        {customizing && <section className="agent-scorecard-customizer" id="agent-scorecard-customizer" aria-label="Customize scorecard pills">
          <div className="agent-scorecard-customizer-heading"><div><strong>Choose what appears</strong><span>Show, hide, or reorder your pills and metrics.</span></div><button type="button" aria-label="Reset scorecard layout" title="Reset to default" onClick={() => setPreferences(DEFAULT_PREFERENCES)}>Reset</button></div>
          <div className="agent-scorecard-customizer-columns">
            <fieldset><legend>Outcome pills</legend>{renderPillChoices('outcome')}</fieldset>
            <fieldset><legend>Metric cards</legend>{renderPillChoices('metric')}</fieldset>
          </div>
        </section>}
        {error && <p className="agent-scorecard-state is-error" role="alert">{error}</p>}
        {!score && !error && <p className="agent-scorecard-state" role="status">Loading observed runs…</p>}
        {score && <>
          {preferences.visibleOutcomes.length > 0 ? <div className="agent-scorecard-overview" aria-label="Run outcomes">
            <div className="agent-scorecard-outcomes">
              {preferences.outcomeOrder.filter(id => preferences.visibleOutcomes.includes(id)).map(id => <span key={id} className={id === 'verified' ? 'is-verified' : id === 'partial' ? 'is-partial' : id === 'failed' ? 'is-failed' : ''}>{outcomeValue(id)}</span>)}
            </div>
          </div> : <p className="agent-scorecard-empty">No outcome pills selected. Choose Customize to add some.</p>}
          {preferences.visibleMetrics.length > 0 && <dl className="agent-scorecard-metrics">
            {preferences.metricOrder.filter(id => preferences.visibleMetrics.includes(id) && id !== 'toolWaitTimes').map(id => {
              if (id === 'firstAttempt') return <div className="is-primary" key={id}><dt>First attempt verified</dt><dd>{rate(score.firstAttempt.rate)}<small>{score.firstAttempt.passed}/{score.firstAttempt.total} eligible requests</small></dd></div>;
              if (id === 'repeatConsistency') return <div key={id}><dt>Repeat consistency</dt><dd>{rate(score.repeatConsistency.rate)}<small>{score.repeatConsistency.passedGroups}/{score.repeatConsistency.groups} comparable groups</small></dd></div>;
              if (id === 'recovery') return <div key={id}><dt>Resumed runs verified</dt><dd>{rate(score.recovery.rate)}<small>{score.recovery.passed}/{score.recovery.total} resumed attempts</small></dd></div>;
              if (id === 'regressions') return <div key={id}><dt>Observed regressions</dt><dd>{rate(score.regressions.rate)}<small>{score.regressions.failed}/{score.regressions.compared} previously passing commands</small></dd></div>;
              if (id === 'unsupportedClaims') return <div key={id}><dt>Unsupported claim warnings</dt><dd>{score.unsupportedClaimsBlocked}<small>Blocked before completion</small></dd></div>;
              if (id === 'falseCompletion') return <div key={id}><dt>False completion rate</dt><dd>Not measured<small>Requires independent outcome grading</small></dd></div>;
              return null;
            })}
          </dl>}
          {preferences.visibleMetrics.includes('toolWaitTimes') && <details className="agent-scorecard-tools"><summary><span>Tool wait times</span><small>{score.tools.length} tools observed</small></summary>{score.tools.length ? <div className="agent-scorecard-table-wrap"><table><thead><tr><th scope="col">Tool</th><th scope="col">Calls</th><th scope="col">Average</th><th scope="col">Longest</th><th scope="col">Failed / interrupted</th></tr></thead><tbody>{score.tools.map(tool => <tr key={tool.name}><td>{tool.name}</td><td>{tool.count}</td><td>{duration(tool.averageMs)}</td><td>{duration(tool.measured ? tool.maxMs : null)}</td><td><span className={tool.failed || tool.interrupted ? 'has-issues' : ''}>{tool.failed} / {tool.interrupted}</span></td></tr>)}</tbody></table></div> : <p className="agent-scorecard-empty">No tool timings recorded yet.</p>}</details>}
          <details className="agent-scorecard-note-toggle"><summary>About these numbers</summary><p className="agent-scorecard-note">{score.note}</p></details>
        </>}
  </section>;
}
