function installSessionSafety({ powerMonitor, getMainWindow }) {
  let listening = false;
  const emit = state => {
    const main = getMainWindow();
    if (main && !main.isDestroyed()) main.webContents.send('orvix:session-state', { state });
  };
  const onLock = () => emit('locked');
  const onUnlock = () => emit('unlocked');
  const onSuspend = () => emit('suspended');
  const onResume = () => emit('resumed');

  return {
    start() {
      if (listening) return;
      powerMonitor.on('lock-screen', onLock);
      powerMonitor.on('unlock-screen', onUnlock);
      powerMonitor.on('suspend', onSuspend);
      powerMonitor.on('resume', onResume);
      listening = true;
    },
    stop() {
      if (!listening) return;
      powerMonitor.removeListener('lock-screen', onLock);
      powerMonitor.removeListener('unlock-screen', onUnlock);
      powerMonitor.removeListener('suspend', onSuspend);
      powerMonitor.removeListener('resume', onResume);
      listening = false;
    },
  };
}

module.exports = { installSessionSafety };
