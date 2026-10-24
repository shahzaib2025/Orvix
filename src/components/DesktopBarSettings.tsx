import { useEffect, useRef, useState } from 'react';
import type { DesktopBarState } from '../desktop';

export default function DesktopBarSettings() {
  const [state, setState] = useState<DesktopBarState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestBusy = useRef(false);
  useEffect(() => {
    const desktop = window.orvixDesktop;
    if (!desktop || typeof desktop.getDesktopBarState !== 'function' || typeof desktop.onDesktopBarStateChanged !== 'function') return;
    let alive = true;
    let receivedUpdate = false;
    const unsubscribe = desktop.onDesktopBarStateChanged(value => { receivedUpdate = true; if (alive) setState(value); });
    desktop.getDesktopBarState().then(value => { if (alive && !receivedUpdate) setState(value); })
      .catch(() => { if (alive) setError('The desktop top bar setting could not be read.'); });
    return () => { alive = false; unsubscribe(); };
  }, []);
  async function change(next: boolean) {
    if (!state?.supported || requestBusy.current) return;
    requestBusy.current = true;
    setBusy(true); setError('');
    try { setState(await window.orvixDesktop!.setDesktopBarEnabled(next)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'The desktop top bar could not be changed.'); }
    finally { requestBusy.current = false; setBusy(false); }
  }
  const changing = busy || state?.status === 'starting' || state?.status === 'stopping';
  const message = error || state?.error || (state?.status === 'starting' ? 'Opening the top bar…'
    : state?.status === 'stopping' ? 'Stopping the top bar and its controls…'
      : state?.status === 'on' ? 'On · Available above your other windows.'
        : state?.supported === false ? 'Available in the Windows desktop app.' : state ? 'Off · No top bar or controls are running.' : '');
  return <section id="settings-desktop-bar" className="settings-section" aria-labelledby="settings-desktop-bar-title">
    <div className="settings-section-heading">
      <h2 id="settings-desktop-bar-title">Desktop top bar</h2>
      <p>Keep shortcuts, the clock and quick controls within reach.</p>
    </div>
    <div className="settings-rows">
      <div className="settings-row">
        <div className="settings-row-copy">
          <strong>Show desktop top bar</strong>
          <p>Off by default. Your choice is remembered. Turning it off completely stops its windows and controls.</p>
        </div>
        <button type="button" role="switch" aria-label="Show desktop top bar" aria-checked={state?.enabled ?? false}
          aria-describedby="desktop-bar-setting-status" disabled={!state?.supported || changing}
          className={`toggle${state?.enabled ? ' on' : ''}`} onClick={() => void change(!state?.enabled)}><span /></button>
      </div>
    </div>
    <p id="desktop-bar-setting-status" role="status" className="startup-setting-status">{message}</p>
    {state?.status === 'error' && <button type="button" className="desktop-bar-retry" disabled={changing}
      onClick={() => void change(false)}>Stop top bar controls</button>}
  </section>;
}
