import { useEffect, useRef, useState } from 'react';
import type { AgentEvidence, AgentExecution, AgentProjectOverview } from '../desktop';
import AgentClarification from './AgentClarification';
import './agent-execution.css';

export function AgentEvidenceViewer({ taskId, requestId, id }: { taskId: string; requestId: string; id: string }) {
  const [open, setOpen] = useState(false);
  const [output, setOutput] = useState('');
  const [next, setNext] = useState<number | null>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => { generation.current++; setOpen(false); setOutput(''); setNext(0); setError(''); setBusy(false); }, [taskId, requestId, id]);
  async function load() {
    if (busy || next === null || !window.orvixDesktop) return;
    const current = generation.current; setBusy(true); setError('');
    try {
      const value = await window.orvixDesktop.readAgentEvidence(taskId, requestId, id, next);
      if (current === generation.current) { setOutput(previous => previous + value.output); setNext(value.nextOffset); }
    } catch (cause) { if (current === generation.current) setError(String(cause)); }
    finally { if (current === generation.current) setBusy(false); }
  }
  return <div className="agent-evidence-viewer"><button type="button" aria-expanded={open} onClick={() => { setOpen(!open); if (!open && next === 0) void load(); }}>{open ? 'Hide evidence' : 'Read full evidence'}</button>
    {open && <><pre>{output || (busy ? 'Loading…' : '')}</pre>{error && <p role="alert">{error}</p>}{next !== null && <button type="button" disabled={busy} onClick={() => void load()}>{busy ? 'Loading…' : error ? 'Retry' : 'Load more'}</button>}</>}
  </div>;
}

export default function AgentExecutionPanel({ taskId, requestId, pending = false }: { taskId: string; requestId: string; pending?: boolean }) {
  const [execution, setExecution] = useState<AgentExecution | null>(null);
  const [projects, setProjects] = useState<AgentProjectOverview[]>([]);
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<AgentEvidence[]>([]);
  const [next, setNext] = useState<number | null>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [freshness, setFreshness] = useState<'saved' | 'current'>('saved');
  const generation = useRef(0);
  useEffect(() => {
    setOpen(false); setExecution(null); setRecords([]); setNext(0); setBusy(false); setError('');
  }, [taskId, requestId]);
  useEffect(() => {
    const current = ++generation.current; let eventObserved = false;
    if (!open && !pending) { setLoading(false); return; }
    const unsubscribe = window.orvixDesktop?.onAgentEvent(event => {
      if (event.taskId !== taskId || event.requestId !== requestId || event.type !== 'execution') return;
      eventObserved = true; setExecution(event.execution ?? null); setProjects(event.projects ?? []); setFreshness('current');
    });
    setLoading(true); setError('');
    void window.orvixDesktop?.getAgentExecution(taskId, requestId, open).then(value => { if (generation.current === current && !eventObserved) { setExecution(value.execution); setProjects(value.projects); setFreshness(value.freshness ?? 'current'); } }).catch(cause => { if (generation.current === current) setError(String(cause)); }).finally(() => { if (generation.current === current) setLoading(false); });
    return () => { generation.current++; unsubscribe?.(); };
  }, [taskId, requestId, open, pending]);
  async function loadEvidence() {
    if (busy || next === null || !window.orvixDesktop) return;
    const current = generation.current; setBusy(true); setError('');
    try { const value = await window.orvixDesktop.listAgentEvidence(taskId, requestId, next); if (current === generation.current) { setRecords(previous => [...previous, ...value.records]); setNext(value.nextOffset); } }
    catch (cause) { if (current === generation.current) setError(String(cause)); }
    finally { if (current === generation.current) setBusy(false); }
  }
  const intent = execution?.intent, acceptance = execution?.acceptance;
  return <><AgentClarification taskId={taskId} requestId={requestId} enabled={pending} /><section className="agent-execution-panel">
    <button type="button" className="agent-execution-heading" aria-expanded={open} onClick={() => setOpen(!open)}><span>Task understanding & evidence</span>{execution && <small>{freshness === 'saved' ? 'Saved checks · ' : ''}{execution.requirements.filter(item => ['verified', 'supported'].includes(item.status)).length}/{execution.requirements.length} requirements checked</small>}<span aria-hidden="true">{open ? '⌃' : '⌄'}</span></button>
    {open && loading && <p role="status">Refreshing task checks…</p>}{open && error && <p role="alert">{error}</p>}{open && !loading && !execution && !error && <p>No execution record is saved for this turn.</p>}
    {open && execution && <div className="agent-execution-body">
      {intent && <details><summary>Request understanding · {intent.status}</summary>{intent.reason && <p>{intent.reason}</p>}<dl>{[['Goal', intent.goal], ['Feature', intent.feature], ['Trigger', intent.trigger], ['Expected behavior', intent.expectedBehavior]].map(([name, value]) => value && <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>{intent.examples?.map((item, index) => <p key={index}>{item.input} → {item.expected}</p>)}{intent.assumptions?.map((item, index) => <p key={index}>{item.text}<small>{item.basis}</small></p>)}{intent.exclusions?.map((item, index) => <p key={index}>Outside this request: {item}</p>)}{intent.questions?.map(item => <p key={item.id}>{item.question}<small>{item.answer || `${item.impact} question · unanswered`}</small></p>)}</details>}
      {acceptance && <details><summary>Independent acceptance plan · {acceptance.status}</summary>{acceptance.reason && <p>{acceptance.reason}</p>}{acceptance.missingRequirements?.map((item, index) => <p key={index}>Missing: {item}</p>)}{acceptance.criteria?.map(item => <p key={item.id}>{item.description}<small>{item.id} · {item.method} · {item.observable}</small><small>Failure case: {item.negativeCase}</small></p>)}</details>}
      <details><summary>Requirements & actions</summary><p>{execution.objective}</p><ul>{execution.requirements.map(item => <li key={item.id}><span className={`agent-requirement-status is-${item.status}`}>{item.status}</span> {item.text}<small>{item.id} · {item.verificationTypes.join(', ')}</small>{item.evidenceIds.map(id => <AgentEvidenceViewer key={id} taskId={taskId} requestId={requestId} id={id} />)}</li>)}</ul><ul>{execution.actions.map(item => <li key={item.id}>{item.title}<small>{item.state}{item.dependsOn.length ? ` · after ${item.dependsOn.join(', ')}` : ''}{item.reason ? ` · ${item.reason}` : ''}</small>{item.evidenceIds.map(id => <AgentEvidenceViewer key={id} taskId={taskId} requestId={requestId} id={id} />)}</li>)}</ul></details>
      {execution.selectedContext && <details><summary>Selected context</summary>{execution.selectedContext.coverage && <p>{execution.selectedContext.coverage.focusIncluded}/{execution.selectedContext.coverage.focusRequested} requested paths � {execution.selectedContext.coverage.relatedIncluded}/{execution.selectedContext.coverage.relatedCandidates} related paths � {execution.selectedContext.coverage.testsIncluded} test files<small>Path coverage is not proof of correctness. {execution.selectedContext.coverage.omittedFocus.length ? `Missing: ${execution.selectedContext.coverage.omittedFocus.join(', ')}` : ''}</small></p>}{execution.selectedContext.files.map(item => <p key={item.file}>{item.file}<small>{item.reasons.join(' · ')}</small></p>)}<AgentEvidenceViewer taskId={taskId} requestId={requestId} id={execution.selectedContext.evidenceId} /></details>}
      {execution.runtime && <details><summary>Runtime inspection</summary><p>{execution.runtime.scope || 'Environment'} · {execution.runtime.status}</p><small>{execution.runtime.reason || new Date(execution.runtime.observedAt).toLocaleString()}</small></details>}
      {execution.projectSetup && <details><summary>Project setup & commands</summary>{execution.projectSetup.profiles.flatMap(profile => profile.projects.map(project => <div key={project.directory}><p>{project.directory}<small>{project.language} · {project.runtime.name || 'Runtime'} {project.runtime.status}{project.runtime.version ? ` · ${project.runtime.version}` : ''}</small></p>{project.commands.map(command => <p key={command.command}><code>{command.command}</code><small>{command.kind} · {command.status}{command.status === 'declared' ? ' · awaiting a successful execution' : ''}</small></p>)}{project.diagnostics.map((message, index) => <small key={index}>{message}</small>)}</div>))}<AgentEvidenceViewer taskId={taskId} requestId={requestId} id={execution.projectSetup.evidenceId} /></details>}
      <details><summary>Project map · {projects.length} workspaces</summary>{projects.map((item, index) => <pre key={index}>{JSON.stringify(item, null, 2)}</pre>)}</details>
      <details onToggle={event => { if (event.currentTarget.open && next === 0) void loadEvidence(); }}><summary>Saved evidence</summary>{records.map(item => <div key={item.id} className="agent-evidence-record">{item.name}<small>{item.kind} · {item.status || 'recorded'} · {item.outputBytes} bytes</small><AgentEvidenceViewer taskId={taskId} requestId={requestId} id={item.id} /></div>)}{error && <p role="alert">{error}</p>}{next !== null && <button type="button" disabled={busy} onClick={() => void loadEvidence()}>{busy ? 'Loading…' : 'Load more evidence'}</button>}</details>
    </div>}
  </section></>;
}
