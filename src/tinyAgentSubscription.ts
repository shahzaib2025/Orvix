import type { TinyAgentListing } from './desktop';
type Bridge = Pick<NonNullable<Window['orvixDesktop']>, 'listTinyAgents' | 'onTinyAgentEvent'>;

// Subscribe before loading. A pushed state invalidates older in-flight reads,
// so a slow initial response can never undo a newer rule or notification.
export function subscribeTinyAgentListing(bridge: Bridge, update: (listing: TinyAgentListing) => void, error?: (cause: unknown) => void) {
  let live = true, version = 0;
  const refresh = () => {
    const request = ++version;
    void bridge.listTinyAgents().then(listing => { if (live && request === version) update(listing); })
      .catch(cause => { if (live && request === version) error?.(cause); });
  };
  const off = bridge.onTinyAgentEvent(event => {
    if (!live || event.kind === 'snapshot') return;
    if (event.listing) { version++; update(event.listing); } else refresh();
  });
  refresh();
  return () => { live = false; version++; off(); };
}
