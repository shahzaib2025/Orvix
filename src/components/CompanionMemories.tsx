import { useEffect, useState } from 'react';
import { emptyMemorySnapshot } from '../companionMemory';
import type { CompanionMemory, MemoryInput, MemoryKind, MemorySnapshot } from '../companionMemory';
import './companion-memories.css';

export default function CompanionMemories({ projects }: { projects: { id: string; name: string }[] }) {
  const [snapshot, setSnapshot] = useState<MemorySnapshot>(emptyMemorySnapshot);
  const [text, setText] = useState(''), [kind, setKind] = useState<MemoryKind>('fact');
  const [editing, setEditing] = useState<CompanionMemory | null>(null);
  const [projectId, setProjectId] = useState('');
  const [occurredAt, setOccurredAt] = useState(''), [expiresAt, setExpiresAt] = useState('');
  const [filter, setFilter] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [confirmClear, setConfirmClear] = useState(false);
  const bridge = window.orvixDesktop;
  useEffect(() => {
    let mounted = true;
    const refresh = () => bridge?.listCompanionMemories().then(value => { if (mounted) setSnapshot(value); }).catch(() => { if (mounted) setNotice('Memory storage could not be opened.'); });
    void refresh(); const unsubscribe = bridge?.onCompanionMemoryChanged(refresh);
    return () => { mounted = false; unsubscribe?.(); };
  }, [bridge]);
  const reset = () => { setText(''); setEditing(null); setKind('fact'); setProjectId(''); setOccurredAt(''); setExpiresAt(''); };
  const mutate = async (operation: () => Promise<MemorySnapshot>, message: string, clearEditor = false) => {
    if (busy) return;
    setBusy(true); setNotice('');
    try { const value = await operation(); if (value.error) throw Error(value.error); setSnapshot(value); setNotice(message); if (clearEditor) reset(); setConfirmClear(false); }
    catch (failure) { setNotice(failure instanceof Error ? failure.message : 'Memory change failed. Nothing was confirmed saved.'); }
    finally { setBusy(false); }
  };
  const localDate = (time: number | null) => time === null ? '' : new Date(time - new Date(time).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  return <section className="companion-memories" aria-labelledby="memory-heading">
    <div className="memory-heading"><div><h2 id="memory-heading">Memories</h2><p>Confirmed notes that Orvix can recall in Fast and Thinking.</p></div>
      <label className="memory-enabled"><input type="checkbox" checked={snapshot.enabled} disabled={!bridge || busy || !!snapshot.error} onChange={event => {
        const enabled = event.target.checked;
        void mutate(() => bridge!.configureCompanionMemory({ enabled }), enabled ? 'Saved memories are available to new conversations.' : 'Memory use disabled. Your notes remain on this device.');
      }} />Use saved memories</label></div>
    <p className="memory-help">Only an explicit “remember…” request or a manual entry saves a note. Guesses stay temporary. Notes are encrypted on this Windows device; up to five relevant notes can be sent to the voice provider when enabled. Old chats and their logs are separate from this encrypted store.</p>
    {!bridge && <p role="status">Persistent memory requires the Orvix desktop app.</p>}
    {snapshot.error && <p role="alert">{snapshot.error}</p>}
    <div className="memory-heading"><h3>Your notes <span>{snapshot.records.length}/{snapshot.limit}</span></h3>
      {!!snapshot.records.length && <button disabled={busy} onClick={() => setConfirmClear(true)}>Clear all</button>}</div>
    {confirmClear && <div className="memory-confirm" role="alert"><span>Forget all companion memories? Earlier chats remain visible.</span>
      <button disabled={busy} onClick={() => setConfirmClear(false)}>Cancel</button><button disabled={busy} onClick={() => void mutate(() => bridge!.clearCompanionMemories(), 'All companion memories forgotten.', true)}>Forget all memories</button></div>}
    <form onSubmit={event => {
      event.preventDefault(); if (!bridge) return;
      const input: MemoryInput = { ...(editing ? { id: editing.id } : {}), text, kind, scope: projectId ? 'project' : 'personal', projectId: projectId || null,
        occurredAt: occurredAt ? new Date(occurredAt).getTime() : null, expiresAt: expiresAt ? new Date(expiresAt).getTime() : null, source: { type: 'manual' } };
      void mutate(() => bridge.saveCompanionMemory(input), 'Memory saved. Start voice again to use the updated context.', true);
    }}>
      <label htmlFor="memory-text">{editing ? 'Edit memory' : 'Add a memory'}</label>
      <textarea id="memory-text" rows={3} maxLength={snapshot.textLimit} value={text} onChange={event => setText(event.target.value)} placeholder="For example: I prefer short replies in Banglish." disabled={!bridge || busy || !!snapshot.error} />
      <div className="memory-fields"><label>Kind<select aria-label="Memory kind" value={kind} disabled={busy} onChange={event => setKind(event.target.value as MemoryKind)}><option value="fact">Confirmed fact</option><option value="preference">Preference</option><option value="event">Event</option></select></label>
        <label>Scope<select value={projectId} disabled={busy} onChange={event => setProjectId(event.target.value)}><option value="">Personal</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}{editing?.projectId && !projects.some(project => project.id === editing.projectId) && <option value={editing.projectId}>Earlier project</option>}</select></label>
        <label>Event date/time (optional)<input type="datetime-local" value={occurredAt} disabled={busy} onChange={event => setOccurredAt(event.target.value)} /></label>
        <label>Expires (optional)<input type="datetime-local" value={expiresAt} disabled={busy} onChange={event => setExpiresAt(event.target.value)} /></label></div>
      <div className="memory-actions"><span>{text.length}/{snapshot.textLimit}</span>{editing && <button type="button" disabled={busy} onClick={reset}>Cancel edit</button>}
        <button type="submit" disabled={!bridge || busy || !text.trim() || !!snapshot.error || !editing && snapshot.records.length >= snapshot.limit}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add memory'}</button></div>
    </form>
    <label className="memory-search">Find a memory<input type="search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Search your saved notes" /></label>
    <div className="memory-list">{snapshot.records.filter(item => item.text.toLocaleLowerCase().includes(filter.toLocaleLowerCase())).map(item => <article key={item.id}>
      <div><span className="memory-meta">{item.kind} · {item.scope} · recorded {new Date(item.updatedAt).toLocaleDateString()}{item.expired ? ' · expired' : ''}</span><p>{item.text}</p>
        <small>Source: {item.source.type === 'manual' ? 'Your manual entry' : `Your explicit ${item.source.profile || ''} message`}{item.occurredAt !== null ? ` · event: ${new Date(item.occurredAt).toLocaleString()}` : ''}{item.expiresAt !== null ? ` · expires: ${new Date(item.expiresAt).toLocaleString()}` : ''}</small></div>
      <div className="memory-note-actions"><button disabled={busy} aria-label={`Edit memory: ${item.text}`} onClick={() => { setEditing(item); setText(item.text); setKind(item.kind); setProjectId(item.projectId || ''); setOccurredAt(localDate(item.occurredAt)); setExpiresAt(localDate(item.expiresAt)); setNotice(''); }}>Edit</button>
        <button disabled={busy} aria-label={`Forget memory: ${item.text}`} onClick={() => void mutate(() => bridge!.forgetCompanionMemory(item.id), 'Memory forgotten. Old chat messages remain visible.', editing?.id === item.id)}>Forget</button></div></article>)}
      {!snapshot.records.length && <p>No saved memories yet.</p>}</div>
    <p className="memory-help">Type or say “remember this: …”, “mone rakho …”, “show my memories”, or “forget …”. An ambiguous forget request opens this list so you can choose. Changes end the current voice session and screen share to remove old context; restart voice when ready. Earlier chats remain visible but are not automatically sent again after a memory change. Forgetting cannot retract information already sent to the provider.</p>
    {notice && <p className="memory-notice" role="status">{notice}</p>}
  </section>;
}
