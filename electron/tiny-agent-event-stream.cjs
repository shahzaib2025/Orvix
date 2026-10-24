const fields = { brightness_percent: 'Brightness', volume_percent: 'Volume', muted: 'Muted' };
function consumeEvents(batch, cursor, now) {
  if (!batch || typeof batch.Session !== 'string' || !Number.isSafeInteger(batch.LastSequence) || !Array.isArray(batch.Events)) return { cursor, events: [], baseline: false };
  const next = { session: batch.Session, sequence: batch.LastSequence, dropped: batch.Dropped || 0, error: batch.Error || null };
  // First connection/restart establishes the present baseline, never replaying
  // historical actions as newly observed changes.
  if (!cursor || cursor.session !== batch.Session) return { cursor: next, events: [], baseline: true, gap: batch.Error || undefined };
  const gap = next.sequence < cursor.sequence || next.dropped !== cursor.dropped || batch.FirstSequence > cursor.sequence + 1 || next.error !== (cursor.error || null);
  if (gap) return { cursor: next, events: [], baseline: true, gap: batch.Error || 'Native events were missed; monitoring resumed from the current values.' };
  const events = batch.Events.filter(e => e.Sequence > cursor.sequence && e.Sequence <= next.sequence).sort((a, b) => a.Sequence - b.Sequence);
  let expected = cursor.sequence + 1;
  for (const event of events) {
    if (event.Sequence !== expected++ || !Object.hasOwn(fields, event.Signal) || !Number.isFinite(event.ReceiptUtcMs) || !Number.isFinite(event.MonotonicMs) || typeof event.Device !== 'string' || (event.Signal === 'muted' ? typeof event.Value !== 'boolean' : !Number.isFinite(event.Value) || event.Value < 0 || event.Value > 100)) return { cursor: next, events: [], baseline: true, gap: 'Native event sequence was incomplete or invalid; current values became the baseline.' };
    // Companion monotonic receipt age is robust to a wall-clock adjustment.
    const age = Number.isFinite(batch.ObservedMonotonicMs) ? Math.max(0, batch.ObservedMonotonicMs - event.MonotonicMs) : Math.max(0, now - event.ReceiptUtcMs);
    event.observedAt = now - age;
  }
  if (expected - 1 !== next.sequence) return { cursor: next, events: [], baseline: true, gap: 'Native event batch was incomplete; current values became the baseline.' };
  return { cursor: next, events, baseline: false };
}
module.exports = { consumeEvents, fields };
