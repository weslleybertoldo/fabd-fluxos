const { app, BrowserWindow, shell, Menu, ipcMain, Notification } = require("electron");
const path = require("node:path");

// Atualizacoes manuais (sem download/instalacao automatica) — comportamento
// igual ao FABD Planner: o usuario clica "Verificar atualizacoes" em
// Configuracoes; se houver nova versao, ele baixa o instalador manualmente
// pelo link do release. Adicionalmente, no startup fazemos um check
// silencioso e disparamos uma Notification nativa do SO se houver nova versao.

const isDev = process.env.FABD_DEV === "1";
const APP_URL = isDev ? "http://localhost:3000" : "https://fluxos.fabd.com.br";

/** @type {BrowserWindow | null} */
let mainWindow = null;

async function fetchLatestRelease() {
  const response = await fetch(`${APP_URL}/api/latest-release`);
  if (!response.ok) {
    throw new Error(`Endpoint retornou ${response.status}`);
  }
  return response.json();
}

function compareVersion(latest, current) {
  const norm = (v) => String(v || "").replace(/^v/, "").trim();
  return norm(latest) !== norm(current) ? "outdated" : "current";
}

ipcMain.handle("app:get-version", () => app.getVersion());

ipcMain.handle("check-for-updates", async () => {
  try {
    const data = await fetchLatestRelease();
    const latest = String(data.tag_name || "").replace(/^v/, "");
    const current = app.getVersion();
    if (!latest) {
      return { status: "no-result", message: "Sem release publicado ainda." };
    }
    if (compareVersion(latest, current) === "current") {
      return {
        status: "ok",
        message: `Voce esta na versao mais recente (v${current}).`,
        version: latest,
      };
    }
    return {
      status: "update-available",
      message: `Atualizacao disponivel: v${latest} (atual v${current}).`,
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
          click: () => {
            if (!mainWindow) return;
            mainWindow.loadURL(`${APP_URL}/app`);
            shell.openExternal(`${APP_URL}/app`);
          },
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

async function silentStartupCheck() {
  if (isDev) return;
  try {
    const data = await fetchLatestRelease();
    const latest = String(data.tag_name || "").replace(/^v/, "");
    const current = app.getVersion();
    if (!latest || compareVersion(latest, current) === "current") return;
    if (!Notification.isSupported()) return;
    const notif = new Notification({
      title: "FABD Fluxos — atualizacao disponivel",
      body: `Nova versao v${latest} foi publicada (voce esta na v${current}). Clique para baixar.`,
      silent: false,
    });
    notif.on("click", () => {
      shell.openExternal(data.html_url || `${APP_URL}/app`);
    });
    notif.show();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update-available", {
        version: latest,
        url: data.html_url,
      });
    }
  } catch (err) {
    console.error("[updates] startup check falhou:", err?.message || err);
  }
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  setTimeout(silentStartupCheck, 4000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
