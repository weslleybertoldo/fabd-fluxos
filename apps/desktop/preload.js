const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fabdDesktop", {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});

// API exposta pro web app: chama checkForUpdates do main process
contextBridge.exposeInMainWorld("electronAPI", {
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
});
