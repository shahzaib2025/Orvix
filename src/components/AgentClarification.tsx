import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, CircleHelp, Pencil, X } from 'lucide-react';
import type { AgentQuestion, AgentQuestionOption, AgentQuestionStep } from '../desktop';

function optionDetails(option: AgentQuestionOption, index: number) {
  return typeof option === 'string'
    ? { label: option, description: '', recommended: false, key: `${index}-${option}` }
    : { label: option.label, description: option.description ?? '', recommended: option.recommended === true, key: `${index}-${option.label}` };
}

export default function AgentClarification({ taskId, requestId, enabled = true }: { taskId: string; requestId: string; enabled?: boolean }) {
  const [question, setQuestion] = useState<AgentQuestion | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    setQuestion(null); setAnswers([]); setStepIndex(0); setError(''); setBusy(false);
    if (!enabled) return;
    let eventObserved = false;
    const unsubscribe = window.orvixDesktop?.onAgentEvent(event => {
      if (event.taskId !== taskId || event.requestId !== requestId || event.type !== 'clarification') return;
      eventObserved = true;
      if (event.phase === 'remove') { setQuestion(null); setAnswers([]); setStepIndex(0); return; }
      const next: AgentQuestion = {
        questionId: event.questionId!, question: event.question!, options: event.options ?? [],
        ...(event.questions?.length ? { questions: event.questions } : {}),
      };
      setQuestion(next); setAnswers([]); setStepIndex(event.questionIndex ?? 0); setError('');
    });
    void window.orvixDesktop?.getAgentQuestion(taskId, requestId).then(value => {
      if (current === generation.current && !eventObserved && value) { setQuestion(value); setAnswers([]); setStepIndex(0); }
    }).catch(() => {});
    return () => { generation.current++; unsubscribe?.(); };
  }, [taskId, requestId, enabled]);

  const steps = useMemo<AgentQuestionStep[]>(() => question?.questions?.length
    ? question.questions
    : question ? [{ question: question.question, options: question.options }] : [], [question]);
  if (!question || !steps.length) return null;
  const current = steps[Math.min(stepIndex, steps.length - 1)];
  const currentAnswer = answers[stepIndex] ?? '';
  const isBatch = Boolean(question.questions?.length);

  const submit = async (nextAnswers: string[]) => {
    if (busy || !window.orvixDesktop) return;
    const complete = steps.map((_, index) => nextAnswers[index]?.trim() || 'Use your best judgment for this choice.');
    const payload = isBatch ? JSON.stringify(complete) : complete[0];
    const currentGeneration = generation.current;
    setBusy(true); setError('');
    try {
      const accepted = await window.orvixDesktop.answerAgentQuestion(question.questionId, payload);
      if (!accepted) throw new Error('Orvix could not deliver that answer. Please try again.');
      if (currentGeneration === generation.current) { setQuestion(null); setAnswers([]); setStepIndex(0); }
    } catch (cause) { if (currentGeneration === generation.current) setError(String(cause)); }
    finally { if (currentGeneration === generation.current) setBusy(false); }
  };
  const setCurrentAnswer = (value: string) => setAnswers(previous => {
    const next = [...previous]; next[stepIndex] = value; return next;
  });
  const skipCurrent = () => {
    const nextAnswers = [...answers]; nextAnswers[stepIndex] = 'Use your best judgment for this choice.';
    setAnswers(nextAnswers);
    if (stepIndex < steps.length - 1) setStepIndex(index => index + 1);
    else void submit(nextAnswers);
  };
  const goNext = () => {
    if (!currentAnswer.trim()) { setError('Choose an option or add a short answer to continue.'); return; }
    setError('');
    if (stepIndex < steps.length - 1) setStepIndex(index => index + 1);
    else void submit(answers);
  };

  return <form className="agent-clarification" aria-label="Agent question" onSubmit={event => { event.preventDefault(); goNext(); }}>
    <div className="agent-clarification-topline">
      <span className="agent-clarification-heading"><CircleHelp size={14} /><strong>Question</strong></span>
      <div className="agent-clarification-navigation">
        <button type="button" aria-label="Previous question" title="Previous question" disabled={busy || stepIndex === 0} onClick={() => { setError(''); setStepIndex(index => Math.max(0, index - 1)); }}><ChevronLeft size={16} /></button>
        <span aria-live="polite">{stepIndex + 1} of {steps.length}</span>
        <button type="button" aria-label="Next question" title="Next question" disabled={busy || stepIndex === steps.length - 1} onClick={() => { setError(''); setStepIndex(index => Math.min(steps.length - 1, index + 1)); }}><ChevronRight size={16} /></button>
        <button type="button" className="agent-clarification-close" aria-label="Skip this question" title="Skip this question" disabled={busy} onClick={skipCurrent}><X size={15} /></button>
      </div>
    </div>
    <h3>{current.question}</h3>
    {current.options.length > 0 && <div className="agent-clarification-options" role="group" aria-label="Answer options">
      {current.options.map((option, index) => {
        const item = optionDetails(option, index);
        const selected = currentAnswer === item.label;
        return <button type="button" key={item.key} className={`agent-clarification-option${selected ? ' is-selected' : ''}`} aria-pressed={selected} disabled={busy} onClick={() => setCurrentAnswer(item.label)}>
          <span className="agent-clarification-option-index">{index + 1}</span>
          <span className="agent-clarification-option-copy"><strong>{item.label}</strong>{item.description && <small>{item.description}</small>}</span>
          {item.recommended && <span className="agent-clarification-recommended">Recommended</span>}
          <ChevronRight className="agent-clarification-option-arrow" size={15} aria-hidden="true" />
        </button>;
      })}
    </div>}
    {error && <p className="agent-clarification-error" role="alert">{error}</p>}
    <div className="agent-clarification-footer">
      <label className="agent-clarification-custom"><Pencil size={13} /><span className="agent-sr-only">Your answer or instructions</span><input value={current.options.some(option => optionDetails(option, 0).label === currentAnswer) ? '' : currentAnswer} onChange={event => setCurrentAnswer(event.target.value)} placeholder="Or write your own response" disabled={busy} /></label>
      <div className="agent-clarification-actions">
        <button type="button" className="agent-clarification-skip" disabled={busy} onClick={skipCurrent}>Skip</button>
        <button type="submit" className="agent-clarification-continue" disabled={busy}>{busy ? 'Sending…' : stepIndex < steps.length - 1 ? 'Next' : 'Send'}{busy ? null : <ChevronRight size={15} />}</button>
      </div>
    </div>
  </form>;
}
