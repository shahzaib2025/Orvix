import { useEffect, useRef } from 'react';

// Display refresh only. Execution, audio capture and notifications must keep
// their own lifecycles rather than depending on whether this window is visible.
export function useVisibleInterval(callback: () => void, delay: number | null) {
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => {
    if (delay === null) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => { clearInterval(timer); timer = undefined; };
    const refresh = () => { if (!document.hidden) latest.current(); };
    const sync = () => {
      stop();
      if (document.hidden) return;
      refresh();
      timer = setInterval(refresh, delay);
    };
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => { stop(); document.removeEventListener('visibilitychange', sync); };
  }, [delay]);
}
