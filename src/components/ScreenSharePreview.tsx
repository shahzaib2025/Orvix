import { useEffect, useState } from 'react';
import { isScreenFrameFresh, type ScreenFrame } from '../screenSharing';

export default function ScreenSharePreview({ frame, sourceName }: { frame: ScreenFrame | null; sourceName: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  const fresh = !!frame && isScreenFrameFresh(frame.capturedAt, Math.max(now, Date.now()));
  return <figure className={`screen-frame-preview${fresh ? '' : ' is-stale'}`} aria-label="Shared screen preview">
    {frame ? <img src={`data:image/jpeg;base64,${frame.jpeg}`} alt={`Frame sent from ${sourceName}`} /> : <div className="screen-preview-wait">Waiting for the first frame…</div>}
    <figcaption>
      <span role="status">{fresh ? frame?.petExclusion==='masked'?'Live · Pet area masked':'Live · Pet excluded' : frame ? 'Frame is stale · Waiting for an update' : 'Preparing your shared view'}</span>
      {frame && <small>{frame.width} × {frame.height}</small>}
    </figcaption>
  </figure>;
}
