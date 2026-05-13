const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fabdDesktop", {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});

contextBridge.exposeInMainWorld("electronAPI", {
  getInstalledVersion: () => ipcRenderer.invoke("app:get-version"),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),

  // Auto-updater (electron-updater) — fluxo Planner
  updaterDownload: () => ipcRenderer.invoke("updater:download"),
  updaterInstall: () => ipcRenderer.invoke("updater:install"),
  onUpdateAvailable: (cb) => {
    const listener = (_e, d) => cb(d);
    ipcRenderer.removeAllListeners("updater:update-available");
    ipcRenderer.on("updater:update-available", listener);
    return () => ipcRenderer.removeListener("updater:update-available", listener);
  },
  onUpdateProgress: (cb) => {
    const listener = (_e, d) => cb(d);
    ipcRenderer.removeAllListeners("updater:download-progress");
    ipcRenderer.on("updater:download-progress", listener);
    return () => ipcRenderer.removeListener("updater:download-progress", listener);
  },
  onUpdateDownloaded: (cb) => {
    const listener = (_e, d) => cb(d);
    ipcRenderer.removeAllListeners("updater:update-downloaded");
    ipcRenderer.on("updater:update-downloaded", listener);
    return () => ipcRenderer.removeListener("updater:update-downloaded", listener);
  },
  onUpdateError: (cb) => {
    const listener = (_e, d) => cb(d);
    ipcRenderer.removeAllListeners("updater:error");
    ipcRenderer.on("updater:error", listener);
    return () => ipcRenderer.removeListener("updater:error", listener);
  },
});
