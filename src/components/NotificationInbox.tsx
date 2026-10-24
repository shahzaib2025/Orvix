import { useEffect, useRef, useState } from 'react';
import { Bell, ArrowUpRight, Check, CircleHelp, ShieldAlert, X } from 'lucide-react';
import type { AgentNotificationFeed, AgentNotificationItem, TinyAgentListing } from '../desktop';
import { subscribeTinyAgentListing } from '../tinyAgentSubscription';
import './notification-inbox.css';

type InboxEntry =
  | { type: 'agent'; item: AgentNotificationItem; at: number }
  | { type: 'tiny'; item: TinyAgentListing['history'][number]; at: number };

export default function NotificationInbox({
  onOpenRule,
  onOpenAgentTask,
}: {
  onOpenRule: (id: string | null) => void;
  onOpenAgentTask: (item: AgentNotificationItem) => void;
}) {
  const [items, setItems] = useState<TinyAgentListing['history']>([]);
  const [failed, setFailed] = useState<NonNullable<TinyAgentListing['deliveries']>>([]);
  const [retryError, setRetryError] = useState('');
  const [storageError, setStorageError] = useState<string | null>(null);
  const [agentFeed, setAgentFeed] = useState<AgentNotificationFeed>({ items: [], storageError: null });
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(() => Number(localStorage.getItem('orvix.notificationsSeen') || 0));
  const root = useRef<HTMLDivElement>(null);
  const markTinyRead = () => {
    const now = Date.now();
    setSeen(now);
    localStorage.setItem('orvix.notificationsSeen', String(now));
  };
  const markAllRead = () => {
    markTinyRead();
    void window.orvixDesktop?.markAllAgentNotificationsRead().then(setAgentFeed).catch(() => {});
  };
  useEffect(() => {
    const bridge = window.orvixDesktop;
    if (!bridge) return;
    const unsubscribeFeed = bridge.onAgentNotifications(setAgentFeed);
    void bridge.getAgentNotifications().then(setAgentFeed).catch(() => {});
    const unsubscribeTiny = subscribeTinyAgentListing(bridge, data => {
      setStorageError(data.storageError || null);
      setFailed((data.deliveries || []).filter(item => item.status === 'needs_retry'));
      const ids = new Set<string>();
      setItems(data.history.filter(item => {
        if (!['notification_queued', 'notification_shown', 'notification_failed', 'capture_gap', 'storage_error'].includes(item.kind)) return false;
        const id = item.noticeId || item.id;
        if (ids.has(id)) return false;
        ids.add(id); return true;
      }).slice(0, 40));
    });
    return () => { unsubscribeFeed?.(); unsubscribeTiny(); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [open]);
  const tinyUnread = items.filter(item => item.at > seen).length;
  const agentUnread = agentFeed.items.filter(item => item.readAt === null).length;
  const badge = Math.max(tinyUnread + agentUnread, failed.length, storageError || agentFeed.storageError ? 1 : 0);
  const entries: InboxEntry[] = [
    ...agentFeed.items.map(item => ({ type: 'agent' as const, item, at: item.createdAt })),
    ...items.map(item => ({ type: 'tiny' as const, item, at: item.at })),
  ].sort((first, second) => second.at - first.at).slice(0, 50);
  return <div className="notification-inbox" ref={root}>
    <button className="icon-button notification-bell" title={failed.length || storageError || agentFeed.storageError ? 'Notifications need attention' : 'Notifications'} aria-label={`Notifications${badge ? `, ${badge} unread or needs attention` : ''}`} aria-expanded={open} onClick={() => setOpen(value => !value)}><Bell size={17} />{badge > 0 && <span className="notification-badge">{badge > 9 ? '9+' : badge}</span>}</button>
    {open && <section className="notification-panel" aria-label="Notifications">
      <header><div><strong>Notifications</strong><span>Agent and Tiny Agent updates</span></div><button title="Mark all as read" aria-label="Mark all notifications as read" onClick={markAllRead}><Check size={16} /></button><button aria-label="Close notifications" onClick={() => setOpen(false)}><X size={16} /></button></header>
      {failed.length > 0 && <div className="notification-retries">{failed.map(item => <div key={item.id} className="notification-retry"><strong>{item.title}</strong><span>Needs retry · {item.error}</span><button onClick={async () => {
        try { setRetryError(''); await window.orvixDesktop?.retryTinyAgentNotification(item.id); }
        catch (error) { setRetryError(error instanceof Error ? error.message : 'Retry failed.'); }
      }}>Retry notification</button></div>)}</div>}
      {storageError && <p role="alert">Tiny Agent notifications cannot be saved: {storageError}</p>}
      {agentFeed.storageError && <p role="alert">Agent notifications cannot be saved: {agentFeed.storageError}</p>}
      {retryError && <p role="alert">{retryError}</p>}
      <div className="notification-items">{entries.length ? entries.map(entry => {
        if (entry.type === 'agent') {
          const item = entry.item;
          const needsAnswer = item.kind === 'question';
          const needsApproval = item.kind === 'permission';
          const actionLabel = needsAnswer ? 'Open question' : needsApproval ? 'Review approval' : null;
          const deliveryLabel = item.delivery === 'failed' ? 'Windows popup failed · saved in inbox · '
            : item.delivery === 'suppressed' ? 'Orvix was focused · '
              : item.delivery === 'shown' ? 'Sent to Windows · '
                : item.delivery === 'unsupported' ? 'System notifications unavailable · ' : '';
          return <button className={`notification-entry agent-notification${needsAnswer ? ' question' : ''}${needsApproval ? ' permission' : ''}${item.readAt === null ? ' unread' : ''}${item.delivery === 'failed' ? ' failed' : ''}`} key={`agent-${item.id}`} aria-label={`${item.title}${actionLabel ? `. ${actionLabel}` : ''}`} onClick={() => {
            setOpen(false);
            void window.orvixDesktop?.markAgentNotificationRead(item.id).catch(() => {});
            onOpenAgentTask(item);
          }}>
            <span className="notification-entry-icon">{needsAnswer ? <CircleHelp size={17} /> : needsApproval ? <ShieldAlert size={17} /> : <Bell size={16} />}</span>
            <span className="notification-entry-copy">
              {(needsAnswer || needsApproval) && <span className="notification-entry-kicker">{needsAnswer ? 'WAITING FOR YOUR ANSWER' : 'APPROVAL NEEDED'}</span>}
              <strong>{item.title}</strong><span>{item.body}</span>
              <small>{deliveryLabel}{new Date(item.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>
              {actionLabel && <span className="notification-entry-action">{actionLabel}<ArrowUpRight size={13} /></span>}
            </span>{!actionLabel && <ArrowUpRight size={14} />}
          </button>;
        }
        const item = entry.item;
        return <button className={`notification-entry${item.at > seen ? ' unread' : ''}${item.kind === 'notification_failed' ? ' failed' : ''}`} key={`tiny-${item.id}`} onClick={() => { markTinyRead(); setOpen(false); onOpenRule(item.ruleId); }}>
          <span className="notification-entry-icon"><Bell size={16} /></span><span className="notification-entry-copy"><strong>{item.title || item.ruleName || 'Orvix notification'}</strong><span>{item.kind === 'notification_failed' ? item.message : item.body || item.message}</span><small>{item.kind === 'notification_failed' ? 'Could not show · ' : ''}{new Date(item.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small></span><ArrowUpRight size={14} />
        </button>;
      }) : <div className="notification-inbox-empty"><Bell size={25} /><strong>You’re all caught up</strong><span>Updates appear here when your agents finish work or need your attention.</span></div>}</div>
      <footer><span>Saved on this device</span><button onClick={() => { setOpen(false); onOpenRule(null); }}>Manage agents <ArrowUpRight size={13} /></button></footer>
    </section>}
  </div>;
}
