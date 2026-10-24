import { useEffect, useState } from 'react';
import type { FastWorkSettings as Settings, FastWorkEvent } from '../desktop';

export default function FastWorkSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => { let alive = true; window.orvixDesktop?.getFastSettings().then(value => { if (alive) setSettings(value); }).catch(() => { if (alive) setNotice('Fast settings could not be loaded.'); }); return () => { alive = false; }; }, []);
  async function save(change: Partial<Settings>) {
    setBusy(true); setNotice('');
    try { const value = await window.orvixDesktop!.configureFast(change); setSettings(value); setNotice('Saved. New voice sessions use the updated settings.'); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Settings could not be saved.'); }
    finally { setBusy(false); }
  }
  if (!window.orvixDesktop) return null;
  return <div className="fast-work-settings" aria-labelledby="settings-fast-title">
    <div className="settings-section-heading settings-fast-heading">
      <div><h2 id="settings-fast-title">Fast profile</h2>
        <p>Understand → Work → Check → Report. Fast explains each operation, finishes speaking, and runs one tool at a time. New requests wait until the current response finishes.</p></div>
    </div>
    <div className="settings-fast-controls">
      <div className="settings-card settings-fast-card"><div><strong>Windows app control</strong><p>Launch apps and use their controls. Consequential actions require review.</p></div><button type="button" role="switch" aria-checked={settings?.desktopEnabled || false} aria-label="Windows app control" disabled={!settings || busy} className={`toggle${settings?.desktopEnabled ? ' on' : ''}`} onClick={() => save({ desktopEnabled: !settings?.desktopEnabled })}><span /></button></div>
      <div className="settings-card settings-fast-card"><div><strong>Experimental recognition hints</strong><p>Bengali, English, Hindi, and common app names. Leave off until tested with your recordings.</p></div><button type="button" role="switch" aria-checked={settings?.transcriptionHints || false} aria-label="Experimental recognition hints" disabled={!settings || busy} className={`toggle${settings?.transcriptionHints ? ' on' : ''}`} onClick={() => save({ transcriptionHints: !settings?.transcriptionHints })}><span /></button></div>
    </div>
    <p role="status" aria-live="polite" className="settings-fast-status">{busy ? 'Checking and saving…' : notice}</p>
  </div>;
}

export function FastActionReview() {
  const [pending, setPending] = useState<FastWorkEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => window.orvixDesktop?.onFastWorkEvent(event => {
    if (event.type === 'approval') setPending(items => [...items.filter(item => item.approvalId !== event.approvalId), event]);
    else if (event.type === 'approval_closed') setPending(items => items.filter(item => item.approvalId !== event.approvalId));
  }), []);
  const current = pending[0];
  async function decide(accepted: boolean) {
    if (!current?.approvalId) return;
    setBusy(true); setError('');
    try { await window.orvixDesktop!.approveFastAction(current.approvalId, accepted); setPending(items => items.filter(item => item.approvalId !== current.approvalId)); }
    catch { setError('The action could not be reviewed.'); }
    finally { setBusy(false); }
  }
  if (!current) return null;
  return <div className="dialog-backdrop"><section className="project-dialog" role="dialog" aria-modal="true" aria-labelledby="fast-action-title"><h2 id="fast-action-title">Review this action</h2><p>Orvix is ready to {current.action} on “{current.target}”. Review the selected app or page before confirming.</p><p role="alert">{error}</p><div className="dialog-actions"><button autoFocus className="secondary-button" disabled={busy} onClick={() => decide(false)}>Cancel action</button><button className="primary-button" disabled={busy} onClick={() => decide(true)}>Confirm action</button></div></section></div>;
}
