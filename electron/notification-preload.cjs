const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('orvixNotice', {
  data: () => ipcRenderer.invoke('orvix:notice-data'),
  loaded: () => ipcRenderer.send('orvix:notice-loaded'),
  ready: (id, attempt) => ipcRenderer.send('orvix:notice-ready', id, attempt),
  displayed: (id, attempt) => ipcRenderer.send('orvix:notice-displayed', id, attempt),
  onVisible: callback => ipcRenderer.on('orvix:notice-visible', (_event, value) => callback(value)),
  action: (action, id, attempt) => ipcRenderer.send('orvix:notice-action', action, id, attempt),
  onUpdate: callback => {
    const listener = (_event, notice) => callback(notice);
    ipcRenderer.on('orvix:notice-update', listener);
    return () => ipcRenderer.removeListener('orvix:notice-update', listener);
  },
});
