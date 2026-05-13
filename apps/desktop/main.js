const { app, BrowserWindow, shell, Menu, ipcMain } = require("electron");
const path = require("node:path");

// Auto-update via electron-updater + GitHub Releases (mesmo fluxo do FABD Planner):
//   1) Startup -> check silencioso -> renderer recebe 'updater:update-available'
//   2) Renderer mostra popup "Atualizar agora? / Mais tarde"
//   3) "Agora" -> downloadUpdate() em background -> progresso -> 'update-downloaded'
//   4) Popup "Reiniciar agora / Reiniciar depois" -> quitAndInstall ou adia
//   5) Se adiou: arquivo fica no cache. Proxima abertura, checkForUpdates()
//      detecta cache valido e emite 'update-downloaded' direto.

const isDev = process.env.FABD_DEV === "1";
const APP_URL = isDev ? "http://localhost:3000" : "https://fluxos.fabd.com.br";

/** @type {BrowserWindow | null} */
let mainWindow = null;

function log(level, ...args) {
  const line = `[${new Date().toISOString()}] [${level}] ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}`;
  console.log(line);
}

ipcMain.handle("app:get-version", () => app.getVersion());

ipcMain.handle("app:open-external", async (_event, url) => {
  if (typeof url !== "string" || !url.startsWith("http")) {
    return { ok: false, error: "URL invalida" };
  }
  await shell.openExternal(url);
  return { ok: true };
});

function setupAutoUpdater() {
  if (isDev) {
    log("INFO", "[updater] dev mode, skip");
    return;
  }
  try {
    const { autoUpdater } = require("electron-updater");
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.logger = {
      info: (m) => log("INFO", "[updater]", m),
      warn: (m) => log("WARN", "[updater]", m),
      error: (m) => log("ERROR", "[updater]", m),
      debug: () => {},
    };

    autoUpdater.on("update-available", (info) => {
      log("INFO", "[updater] disponivel:", info.version);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("updater:update-available", {
          version: info.version,
          releaseNotes: info.releaseNotes || "",
          releaseDate: info.releaseDate,
        });
      }
    });
    autoUpdater.on("update-not-available", () => log("INFO", "[updater] sem update"));
    autoUpdater.on("download-progress", (p) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("updater:download-progress", {
          percent: Math.round(p.percent),
          bytesPerSecond: p.bytesPerSecond,
          transferred: p.transferred,
          total: p.total,
        });
      }
    });
    autoUpdater.on("update-downloaded", (info) => {
      log("INFO", "[updater] baixado:", info.version);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("updater:update-downloaded", {
          version: info.version,
        });
      }
    });
    autoUpdater.on("error", (err) => {
      log("ERROR", "[updater] erro:", err?.message || String(err));
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("updater:error", {
          message: err?.message || String(err),
        });
      }
    });

    ipcMain.handle("updater:download", async () => {
      try {
        await autoUpdater.downloadUpdate();
        return { ok: true };
      } catch (err) {
        const msg = err?.message || String(err);
        log("ERROR", "[updater] downloadUpdate falhou:", msg);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("updater:error", { message: msg });
        }
        return { ok: false, error: msg };
      }
    });
    ipcMain.handle("updater:install", () => {
      log("INFO", "[updater] quitAndInstall");
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
      return { ok: true };
    });

    setTimeout(() => {
      autoUpdater
        .checkForUpdates()
        .catch((err) => log("WARN", "[updater] checkForUpdates falhou:", err?.message));
    }, 5000);
  } catch (e) {
    log("WARN", "[updater] setup falhou:", e?.message);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#0f172a",
    title: "FABD Fluxos",
    icon: path.join(__dirname, "assets", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadURL(APP_URL);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(APP_URL)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function buildMenu() {
  const template = [
    {
      label: "Arquivo",
      submenu: [
        { label: "Recarregar", accelerator: "CmdOrCtrl+R", click: () => mainWindow?.reload() },
        { label: "Inspecionar (DevTools)", accelerator: "CmdOrCtrl+Shift+I", click: () => mainWindow?.webContents.toggleDevTools() },
        { type: "separator" },
        { role: "quit", label: "Sair" },
      ],
    },
    {
      label: "Editar",
      submenu: [
        { role: "undo", label: "Desfazer" },
        { role: "redo", label: "Refazer" },
        { type: "separator" },
        { role: "cut", label: "Recortar" },
        { role: "copy", label: "Copiar" },
        { role: "paste", label: "Colar" },
        { role: "selectAll", label: "Selecionar tudo" },
      ],
    },
    {
      label: "Ajuda",
      submenu: [
        {
          label: "Verificar atualizacoes",
          click: () => {
            try {
              const { autoUpdater } = require("electron-updater");
              autoUpdater.checkForUpdates().catch(() => {});
            } catch {
              /* dev mode */
            }
          },
        },
        { label: "Site", click: () => shell.openExternal("https://fluxos.fabd.com.br") },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  if (process.platform === "win32") {
    app.setAppUserModelId("br.com.fabd.fluxos");
  }
  buildMenu();
  createWindow();
  setupAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
