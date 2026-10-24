// One lazily launched browser per agent turn; captures still use fresh contexts.
function createPreviewBrowser(signal, launch) {
  let browser = null, pending = null, stopped = false;
  async function get() {
    if (stopped || signal.aborted) throw new Error('Task cancelled.');
    if (browser?.isConnected()) return browser;
    if (!pending) {
      pending = Promise.resolve().then(launch).then(async value => {
        if (stopped || signal.aborted) { await value.close(); throw new Error('Task cancelled.'); }
        browser = value;
        return value;
      }).finally(() => { pending = null; });
    }
    return pending;
  }
  async function stop() {
    stopped = true;
    signal.removeEventListener('abort', abort);
    const current = browser;
    const starting = pending;
    browser = null;
    await current?.close().catch(() => {});
    const launched = await starting?.catch(() => null);
    if (launched && launched !== current) await launched.close().catch(() => {});
  }
  const abort = () => { void stop(); };
  signal.addEventListener('abort', abort, { once: true });
  return { get, stop };
}
module.exports = { createPreviewBrowser };
