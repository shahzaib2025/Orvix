import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { KeyRound, Plus, X, Pencil, Pause, Play, Trash2 } from 'lucide-react';
import type { SearchKeysSnapshot, SearchKey } from '../searchKeys';
import './search-keys.css';

const number = (value: number) => value.toLocaleString();
const time = (value: number | null) => value ? new Date(value).toLocaleString() : 'Not used yet';
export default function SearchKeysPanel() {
  const bridge = window.orvixDesktop;
  const [data, setData] = useState<SearchKeysSnapshot | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const [label, setLabel] = useState('');
  const [secret, setSecret] = useState('');
  const [balance, setBalance] = useState('2500');
  const [poolId, setPoolId] = useState('');
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<SearchKey | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editBalance, setEditBalance] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!bridge?.listSearchKeys) return;
    let active = true, pushed = false;
    const unsubscribe = bridge.onSearchKeysChanged(value => { pushed = true; if (active) setData(value); });
    void bridge.listSearchKeys().then(value => { if (active && !pushed) setData(value); }).catch(() => { if (active && !pushed) setError('Could not load search keys.'); });
    return () => { active = false; unsubscribe(); };
  }, [bridge]);
  useEffect(() => {
    if (!bridge || !data || data.providerCooldownUntil <= Date.now()) return;
    const timer = window.setTimeout(() => { void bridge.listSearchKeys().then(setData).catch(() => setError('Could not refresh provider status.')); }, data.providerCooldownUntil - Date.now() + 50);
    return () => window.clearTimeout(timer);
  }, [bridge, data?.providerCooldownUntil]);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]') || []);
    focusable()[0]?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { if (!busyRef.current) setExpanded(false); event.preventDefault(); event.stopPropagation(); }
      if (event.key === 'Tab') {
        const items = focusable(), first = items[0], last = items[items.length - 1];
        if (!items.length) { event.preventDefault(); dialog.current?.focus(); }
        else if (!dialog.current?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handle, true);
    return () => { document.removeEventListener('keydown', handle, true); previous?.focus(); };
  }, [expanded]);
  useEffect(() => { if (!expanded) { setSecret(''); setDeleting(null); setEditing(null); } }, [expanded]);
  const keys = data?.keys || [];
  const pages = Math.max(1, Math.ceil(keys.length / 10));
  const currentPage = Math.min(page, pages - 1);
  const remaining = data?.pools.reduce((sum, pool) => sum + pool.remaining, 0) || 0;
  const available = keys.filter(key => key.enabled && !['invalid', 'cooldown'].includes(key.status) && key.remaining > 0).length;
  async function perform(action: () => Promise<SearchKeysSnapshot>, after?: () => void) {
    setBusy(true); setError('');
    try { setData(await action()); after?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Could not update search keys.'); }
    finally { setBusy(false); }
  }
  const totals = data?.totals;
  return <>
    <button type="button" className="search-keys-trigger" aria-label="Open Search API Keys" aria-haspopup="dialog" aria-expanded={expanded} title={`${available} available keys � ${number(remaining)} estimated credits`} onClick={() => setExpanded(true)}><KeyRound size={15}/><span>API Keys</span>{Boolean(error || data?.storageError) && <i aria-label="Needs attention"/>}</button>
    {expanded && createPortal(<div className="search-key-overlay" onClick={event => { if (event.target === event.currentTarget && !busy) setExpanded(false); }}>
      <div className="search-key-dialog" role="dialog" aria-modal="true" aria-labelledby="search-key-title" tabIndex={-1} ref={dialog}>
        <header><div><span className="search-key-eyebrow">ORVIX SEARCH</span><h2 id="search-key-title">Search API Keys</h2><p>Oldest usable key first. Serper → DuckDuckGo.</p></div><button type="button" aria-label="Close search key manager" disabled={busy} onClick={() => setExpanded(false)}><X size={20}/></button></header>
        <div className="search-key-dialog-body">
          {error && <div className="search-key-alert" role="alert">{error}</div>}
          {data?.storageError && <div className="search-key-alert" role="alert">{data.storageError}</div>}
          {!data?.canPersist && <div className="search-key-notice">{bridge?.listSearchKeys ? 'Session-only storage: encryption is unavailable. Keys and counters will not survive restart.' : 'This manager requires Orvix Desktop.'}</div>}
          {Boolean(data?.unresolvedUnknown) && <div className="search-key-notice">{data?.unresolvedUnknown} unknown request outcome(s) still hold reserved credits. Reconcile affected balances with your Serper dashboard.</div>}
          <div className="search-key-metrics search-key-primary-metrics">{[
            ['Available keys', available], ['Orvix queries', totals?.queries], ['Serper API calls', totals?.attempts], ['Estimated credits left', remaining],
          ].map(([title, value]) => <div key={String(title)}><strong>{number(Number(value || 0))}</strong><span>{title}</span></div>)}</div>
          <details className="search-key-usage-details"><summary>Detailed usage & activity{data?.lastProvider ? ` � Last result: ${data.lastProvider}` : ''}</summary><div className="search-key-metrics">{[
            ['Successful Serper calls', totals?.successes], ['Credits consumed', totals?.credits], ['Cache hits', totals?.cacheHits], ['Failed Serper attempts', totals?.failures], ['Unknown outcomes', totals?.unknown], ['DuckDuckGo calls', totals?.fallbackCalls], ['Successful fallback calls', totals?.fallbackSuccesses],
          ].map(([title, value]) => <div key={String(title)}><strong>{number(Number(value || 0))}</strong><span>{title}</span></div>)}</div>{data?.lastSearchAt && <p>Last search: {time(data.lastSearchAt)}</p>}</details>
          {data && data.providerCooldownUntil > Date.now() && <div className="search-key-notice">Serper cooldown until {time(data.providerCooldownUntil)}. DuckDuckGo remains the fallback.</div>}
          <form className="search-key-add" onSubmit={event => { event.preventDefault(); if (bridge) void perform(() => bridge.addSearchKey({ label, key: secret, ...(poolId ? { poolId } : { remaining: Number(balance) }) }), () => { setSecret(''); setLabel(''); setBalance('2500'); }); }}>
            <h3>Add a Serper key</h3><div className="search-key-form-grid">
              <label>Label<input required maxLength={100} value={label} onChange={event => setLabel(event.target.value)} placeholder="My Serper account" disabled={busy}/></label>
              <label>API key<input required type="password" autoComplete="off" spellCheck={false} value={secret} onChange={event => setSecret(event.target.value)} placeholder="Paste your key" disabled={busy}/></label>
              <label>Account credit pool<select value={poolId} onChange={event => setPoolId(event.target.value)} disabled={busy}><option value="">New account / separate balance</option>{data?.pools.map(pool => <option key={pool.id} value={pool.id}>{pool.label} — {number(pool.remaining)} estimated</option>)}</select></label>
              {!poolId && <label>Current remaining credits<input type="number" required min={0} step={1} value={balance} onChange={event => setBalance(event.target.value)} disabled={busy}/></label>}
            </div><p>Enter the balance from your Serper dashboard. Keys belonging to the same account must share a pool. Remaining credits are estimates; usage elsewhere is not visible to Orvix.</p>
            <button type="submit" className="search-key-primary" disabled={busy || !bridge?.addSearchKey || Boolean(data?.storageError)}><Plus size={16}/> Save key</button>
          </form>
          <div className="search-key-list-heading"><h3>Saved keys <span>{keys.length}</span></h3><span>Balances are counted once per account pool</span></div>
          {!keys.length && <div className="search-key-empty"><KeyRound size={28}/><strong>Add your first Serper key</strong><p>Without an available Serper key, searches use DuckDuckGo.</p></div>}
          {keys.slice(currentPage * 10, currentPage * 10 + 10).map(key => <article className="search-key-row" key={key.id}>
            <div className="search-key-row-top"><div><strong>{key.label}</strong><code>{key.masked}</code><span className={`search-key-status ${key.status}`}>{key.status}</span></div><div className="search-key-row-actions">
              <button type="button" aria-label={`Edit ${key.label}`} disabled={busy} onClick={() => { setEditing(key); setEditLabel(key.label); setEditBalance(String(key.remaining)); setDeleting(null); }}><Pencil size={15}/></button>
              <button type="button" aria-label={`${key.enabled ? 'Pause' : 'Enable'} ${key.label}`} disabled={busy} onClick={() => { if (bridge) void perform(() => bridge.updateSearchKey(key.id, { enabled: !key.enabled })); }}>{key.enabled ? <Pause size={15}/> : <Play size={15}/>}</button>
              <button type="button" aria-label={`Delete ${key.label}`} disabled={busy} onClick={() => { setDeleting(key.id); setEditing(null); }}><Trash2 size={15}/></button>
            </div></div>
            <div className="search-key-row-counts"><span>{number(key.attempts)} API calls</span><span>{number(key.successes)} successful</span><span>{number(key.credits)} credits used</span><span>{number(key.remaining)} left, estimated</span><span>{number(key.failures)} failed</span><span>{number(key.unknown)} unknown outcomes</span></div>
            <div className="search-key-row-meta">Pool: {key.poolLabel} · Added {time(key.addedAt)} · Last used {time(key.lastUsedAt)}</div>
            {key.lastError && <p className="search-key-row-error">{key.lastError}</p>}
            {editing?.id === key.id && <form className="search-key-edit" onSubmit={event => { event.preventDefault(); if (bridge) void perform(() => bridge.updateSearchKey(key.id, { label: editLabel, remaining: Number(editBalance) }), () => setEditing(null)); }}>
              <label>Label<input required maxLength={100} value={editLabel} onChange={event => setEditLabel(event.target.value)} disabled={busy}/></label><label>Reconcile account balance<input type="number" required min={0} step={1} value={editBalance} onChange={event => setEditBalance(event.target.value)} disabled={busy}/></label><p>This updates every key in this pool and resolves its unknown reservations. Use the current dashboard balance after active searches finish.</p><button disabled={busy}>Save balance</button><button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
            </form>}
            {deleting === key.id && <div className="search-key-delete-confirm"><span>Delete this saved key? It will no longer be selected for new searches.</span><button disabled={busy} onClick={() => { if (bridge) void perform(() => bridge.deleteSearchKey(key.id), () => setDeleting(null)); }}>Delete key</button><button disabled={busy} onClick={() => setDeleting(null)}>Cancel</button></div>}
          </article>)}
          <nav className="search-key-pagination" aria-label="Search keys pagination"><button disabled={currentPage === 0 || busy} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {pages}</span><button disabled={currentPage + 1 >= pages || busy} onClick={() => setPage(currentPage + 1)}>Next</button></nav>
        </div>
        <footer>{data?.canPersist ? 'Keys stay encrypted in Orvix Desktop.' : 'Keys stay in memory for this session.'} Counters include all profiles; one query may create multiple API attempts.</footer>
      </div>
    </div>, document.body)}
  </>;
}
