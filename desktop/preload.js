const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  setFocus: state => ipcRenderer.send('focus-state', state),
  remind: () => ipcRenderer.send('remind'),   // a planned task is due: surface the window without stealing the keyboard
  show: () => ipcRenderer.send('show-window'),
  setChrome: (color, symbolColor) => ipcRenderer.send('chrome', color, symbolColor), // colours of the window buttons
  getMcpInfo: () => ipcRenderer.invoke('mcp-info'), // where the Claude bridge script is, for the Settings card
  // start with Windows; resolves to null when the app is run from source (nothing sensible to register)
  getAutostart: () => ipcRenderer.invoke('autostart-get'),
  setAutostart: on => ipcRenderer.invoke('autostart-set', !!on),
});
