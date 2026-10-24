import { useEffect, useState } from 'react';
import type { StartupSettings as StartupState } from '../desktop';
import './startup-settings.css';

export default function StartupSettings() {
  const [state, setState] = useState<StartupState | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let alive = true;
    window.orvixDesktop?.getStartupSettings()
      .then(value => { if (alive) setState(value); })
      .catch(() => { if (alive) setNotice('Windows startup settings could not be read.'); });
    return () => { alive = false; };
  }, []);

  async function toggle() {
    if (!state?.supported || busy) return;
    setBusy(true);
    setNotice('');
    try {
      const next = await window.orvixDesktop!.setStartupAtLogin(!state.enabled);
      setState(next);
      setNotice(next.enabled ? 'Orvix will start minimized when you sign in.' : 'Orvix will not start when you sign in.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Windows startup setting could not be changed.');
    } finally {
      setBusy(false);
    }
  }

  return <section aria-label="Windows startup settings">
    <div className="settings-card">
      <div>
        <strong>Start Orvix at sign-in</strong>
        <p>{state?.supported
          ? <>Off by default. When enabled, Orvix starts minimized. App ID: <code>{state.appId}</code>.</>
          : 'Available in the installed Windows app. It stays off by default.'}</p>
      </div>
      <button role="switch" aria-checked={state?.enabled ?? false} aria-label="Start Orvix at sign-in"
        disabled={!state?.supported || busy} className={`toggle${state?.enabled ? ' on' : ''}`} onClick={() => void toggle()}>
        <span />
      </button>
    </div>
    <p role="status" className="startup-setting-status">{busy ? 'Saving…' : notice}</p>
  </section>;
}
