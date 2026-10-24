const { contextBridge, ipcRenderer } = require('electron');
const invoke = (name, ...args) => ipcRenderer.invoke(`orvix:desktop-bar:${name}`, ...args);
const subscribe = (name, callback) => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(`orvix:desktop-bar:${name}`, listener);
  return () => ipcRenderer.removeListener(`orvix:desktop-bar:${name}`, listener);
};
contextBridge.exposeInMainWorld('quickDeck', {
  getControls: () => invoke('controls'),
  setVolume: value => invoke('set-volume', Number(value)),
  setBrightness: value => invoke('set-brightness', Number(value)),
  launch: action => invoke('launch', action),
  setExpanded: (expanded, height) => invoke('expanded', Boolean(expanded), height),
  onBlur: callback => subscribe('blur', callback),
  onHover: callback => subscribe('hover', callback),
  onDragState: callback => subscribe('drag-state', callback),
  onMotion: callback => subscribe('motion', callback),
  motionComplete: phase => ipcRenderer.send('orvix:desktop-bar:motion-complete', phase),
  wake: () => invoke('wake'),
  pointerInside: () => invoke('pointer-inside'),
});
