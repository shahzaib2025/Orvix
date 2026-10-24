const delay = (ms, signal) => new Promise((resolve, reject) => { if (signal.aborted) return reject(new Error('Task cancelled.')); const done = () => { signal.removeEventListener('abort', abort); resolve(); }; const timer = setTimeout(done, ms); const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new Error('Task cancelled.')); }; signal.addEventListener('abort', abort, { once: true }); });
const compare = (actual, expected, operator, baseline) => operator === 'equals' ? actual === expected : operator === 'at_least' ? actual >= expected : operator === 'at_most' ? actual <= expected : operator === 'changed' ? actual !== baseline : operator === 'increased' ? actual > baseline : operator === 'decreased' ? actual < baseline : false;
async function verifyNativeWorkflow({ steps, signal, snapshot, notifyTest, notificationStatus }) {
  if (!Array.isArray(steps) || !steps.length) throw new Error('Provide native workflow steps.');
  const startedAt = Date.now();
  const results = [], baselines = new Map(); let notice = null, assertionCount = 0;
  for (const step of steps) {
    if (signal.aborted) throw new Error('Task cancelled.');
    let result;
    if (step.action === 'observe_sensor' || step.action === 'assert_sensor') {
      if (!['brightness', 'volume', 'battery'].includes(step.sensor)) throw new Error('Choose brightness, volume or battery.');
      const timeout = Math.min(15000, Math.max(0, Number(step.timeout_ms) || 0));
      const deadline = Date.now() + timeout;
      do {
        const observation = await snapshot(signal);
        const sensor = observation.sensors?.[step.sensor];
        if (observation.status !== 'ok' || !sensor || !Number.isFinite(sensor.value) || !Number.isFinite(observation.observedAt) || (Date.now() - observation.observedAt > 10000 || observation.observedAt > Date.now() + 2000)) { result = { ...step, status: 'unavailable', reason: observation.reason || 'Fresh sensor readings are unavailable.' }; if (Date.now() < deadline) { await delay(Math.min(250, Math.max(1, deadline - Date.now())), signal); continue; } break; }
        if (step.action === 'observe_sensor') { baselines.set(step.sensor, { value: sensor.value, at: observation.observedAt }); result = { ...step, status: 'observed', actual: sensor.value, observedAt: observation.observedAt, source: sensor.source }; break; }
        const baseline = baselines.get(step.sensor);
        if (['changed', 'increased', 'decreased'].includes(step.operator) && !baseline) throw new Error('Observe this sensor before checking a change.');
        if (['equals', 'at_least', 'at_most'].includes(step.operator) && !Number.isFinite(step.expected)) throw new Error('Provide a numeric expected sensor value.');
        if (!['equals', 'at_least', 'at_most', 'changed', 'increased', 'decreased'].includes(step.operator)) throw new Error('Invalid sensor comparison.');
        const passed = (!baseline || observation.observedAt > baseline.at) && compare(sensor.value, step.expected, step.operator, baseline?.value);
        result = { ...step, status: passed ? 'passed' : 'failed', actual: sensor.value, baseline: baseline?.value, observedAt: observation.observedAt, source: sensor.source };
        if (passed || Date.now() >= deadline) break;
        await delay(Math.min(250, Math.max(1, deadline - Date.now())), signal);
      } while (Date.now() <= deadline);
      if (step.action === 'assert_sensor') assertionCount++;
    } else if (step.action === 'notification_test') {
      if (!notifyTest) result = { ...step, status: 'unavailable', reason: 'Notification bridge is unavailable.' };
      else { notice = await notifyTest(signal); result = { ...step, status: notice.status === 'failed' ? 'failed' : 'dispatched', notificationId: notice.id }; }
    } else if (step.action === 'assert_notification') {
      assertionCount++;
      const id = step.notification_id || notice?.id;
      if (!id) throw new Error('Send a test notification or provide its exact ID first.');
      const deadline = Date.now() + Math.min(15000, Math.max(0, Number(step.timeout_ms) || 0));
      do {
        const observed = notificationStatus ? await notificationStatus(id) : null;
        const shown = Number.isFinite(observed?.shownAt) && observed.shownAt >= startedAt && observed.shownAt <= Date.now() + 2000 && observed.id === id;
        result = { ...step, status: shown ? 'passed' : observed?.status === 'failed' ? 'failed' : 'unavailable', notificationId: id, observedStatus: observed?.status ?? 'unknown', shownAt: observed?.shownAt ?? null, reason: shown ? 'Renderer display acknowledgement observed.' : 'Notification display has not been confirmed.' };
        if (shown || observed?.status === 'failed' || Date.now() >= deadline) break;
        await delay(250, signal);
      } while (Date.now() <= deadline);
    } else throw new Error('Unsupported native workflow step.');
    results.push(result);
    if (['failed', 'unavailable'].includes(result.status)) break;
  }
  const failed = results.some(item => item.status === 'failed');
  const incomplete = results.length !== steps.length || results.some(item => item.status === 'unavailable');
  return { status: failed ? 'failed' : incomplete || !assertionCount ? 'skipped' : 'passed', phase: 'user_flow', assertionCount, steps: results, recordedAt: Date.now(), note: 'Sensor observations do not change device settings. Queued notifications are not display evidence.' };
}
module.exports = { verifyNativeWorkflow };
