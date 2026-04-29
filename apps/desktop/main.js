const { app, BrowserWindow, shell, Menu, ipcMain, dialog } = require("electron");
const path = require("node:path");
const { autoUpdater } = require("electron-updater");

// IPC: o web app chama window.electronAPI.checkForUpdates() pra
// verificar versao mais recente. Retorna {status, message} pra mostrar
// na pagina de Configuracoes > Atualizacoes.
//
// Como o repo eh PRIVADO, electron-updater nao consegue chamar
// github.com/.../releases.atom (404 sem auth — feed XML do GitHub
// ignora token na URL). Em vez disso, chamamos nosso proxy interno
// /api/latest-release que autentica server-side com GITHUB_TOKEN e
// retorna info do release pelo REST API. Comparamos versao manualmente.
//
// Se o repo virar publico OU configurarmos provider custom (S3/Blob),
// podemos voltar pra autoUpdater.checkForUpdates() pra download
// silencioso de fato.
ipcMain.handle("check-for-updates", async () => {
  const APP_URL = isDev ? "http://localhost:3000" : "https://fluxos.fabd.com.br";
  try {
    const response = await fetch(`${APP_URL}/api/latest-release`);
    if (!response.ok) {
      return {
        status: "error",
        message: `Endpoint retornou ${response.status}`,
      };
    }
    const data = await response.json();
    const latest = String(data.tag_name || "").replace(/^v/, "");
    const current = app.getVersion();
    if (!latest) {
      return { status: "no-result", message: "Sem release publicado ainda." };
    }
    if (latest === current) {
      return {
        status: "ok",
        message: `Voce esta na versao mais recente (v${current}).`,
      };
    }
    return {
      status: "update-available",
      message: `Atualizacao disponivel: v${latest} (atual v${current}). Baixe o instalador em ${data.html_url}`,
      version: latest,
      url: data.html_url,
    };
  } catch (err) {
    return {
      status: "error",
      message: `Erro ao verificar: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
});

const isDev = process.env.FABD_DEV === "1";
const APP_URL = isDev ? "http://localhost:3000" : "https://fluxos.fabd.com.br";

/** @type {BrowserWindow | null} */
let mainWindow = null;

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

  // abrir links externos no browser, nao na janela
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
        {
          label: "Recarregar",
          accelerator: "CmdOrCtrl+R",
          click: () => mainWindow?.reload(),
        },
        {
          label: "Inspecionar (DevTools)",
          accelerator: "CmdOrCtrl+Shift+I",
          click: () => mainWindow?.webContents.toggleDevTools(),
        },
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
          click: () => autoUpdater.checkForUpdatesAndNotify(),
        },
        {
          label: "Site",
          click: () => shell.openExternal("https://fluxos.fabd.com.br"),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();

  if (!isDev) {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.error("[updater] erro ao checar updates:", err);
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Auto-updater eventos
autoUpdater.on("update-available", (info) => {
  console.log("[updater] update disponivel", info?.version);
});

autoUpdater.on("update-downloaded", (info) => {
  console.log("[updater] update baixado, sera aplicado ao sair", info?.version);
});

autoUpdater.on("error", (err) => {
  console.error("[updater] erro:", err);
});
