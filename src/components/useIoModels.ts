import { useCallback, useEffect, useRef, useState } from 'react';
import type { AntigravityCatalog } from '../desktop';

export function useIoModels() {
  const [catalog, setCatalog] = useState<AntigravityCatalog>({ models: [], quota: null, updatedAt: 0, stale: true, error: '' });
  const [loading, setLoading] = useState(false);
  const mounted = useRef(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async (force = false) => {
    if (!window.orvixDesktop?.getAntigravityModels || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const result = await window.orvixDesktop.getAntigravityModels(force);
      if (mounted.current) setCatalog(result);
    } catch {
      if (mounted.current) {
        setCatalog(current => ({ ...current, stale: true, error: 'Could not refresh Antigravity (I/O) models. Try again.' }));
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const focus = () => { void refresh(); };
    window.addEventListener('focus', focus);
    const timer = window.setInterval(focus, 3 * 60 * 1000);
    return () => {
      mounted.current = false;
      window.removeEventListener('focus', focus);
      window.clearInterval(timer);
    };
  }, [refresh]);

  return { catalog, loading, refresh };
}
