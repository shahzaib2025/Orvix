import { useCallback, useEffect, useRef, useState } from 'react';
import type { OpenCodeCatalog } from '../desktop';
import { ZEN_FREE_MODELS } from './openCodeModels';

export function useOpenCodeModels() {
  const [catalog, setCatalog] = useState<OpenCodeCatalog>({ models: ZEN_FREE_MODELS, excluded: [], updatedAt: 0, stale: true, error: '' });
  const [loading, setLoading] = useState(false);
  const mounted = useRef(false), inFlight = useRef(false);
  const refresh = useCallback(async (force = false) => {
    if (!window.orvixDesktop?.getOpenCodeModels || inFlight.current) return;
    inFlight.current = true; setLoading(true);
    try { const next = await window.orvixDesktop.getOpenCodeModels(force); if (mounted.current) setCatalog(next); }
    catch (error) { if (mounted.current) setCatalog(current => ({ ...current, error: error instanceof Error ? error.message : 'Could not refresh OpenCode models.' })); }
    finally { inFlight.current = false; if (mounted.current) setLoading(false); }
  }, []);
  useEffect(() => {
    mounted.current = true; void refresh(false);
    const unsubscribe = window.orvixDesktop?.onOpenCodeCatalog?.(next => { if (mounted.current) setCatalog(next); });
    // A cache read never starts a background runtime or a polling loop.
    return () => { mounted.current = false; unsubscribe?.(); };
  }, [refresh]);
  return { catalog, loading, refresh };
}
