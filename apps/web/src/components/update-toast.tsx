"use client";

import { useEffect, useState } from "react";
import { isNativePlatform, openExternalUrl } from "@/lib/native";

type UpdatePayload = { version?: string; url?: string };

type ElectronAPI = {
  onUpdateAvailable?: (cb: (payload: UpdatePayload) => void) => () => void;
  getInstalledVersion?: () => Promise<string>;
  openExternal?: (url: string) => Promise<{ ok: boolean }>;
};

/**
 * Toast de atualizacao universal pra Desktop (Electron) e Android (Capacitor).
 *
 * Inspirado no `<UpdateChecker>` do PhysiqCalc: faz check ativo na montagem
 * comparando versao instalada (do binario) com a latest release no GitHub.
 *
 * - Desktop Electron: lê app.getVersion() via IPC `getInstalledVersion`.
 * - Android Capacitor: lê App.getInfo().version via @capacitor/app.
 * - Web puro: nao faz nada (web sempre esta na ultima).
 *
 * Tambem ouve evento IPC `update-available` (silentStartupCheck) pra
 * cobrir o caso de desktop antigo que ja tinha esse handler.
 *
 * Montado no RootLayout pra estar sempre ativo.
 */
type Platform = "desktop" | "android" | "ios" | "web";

export function UpdateToast() {
  const [info, setInfo] = useState<UpdatePayload | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [platform, setPlatform] = useState<Platform>("web");

  // Listener do evento IPC do Electron
  useEffect(() => {
    if (typeof window === "undefined") return;
    const api = (window as unknown as { electronAPI?: ElectronAPI }).electronAPI;
    if (!api?.onUpdateAvailable) return;
    const off = api.onUpdateAvailable((payload) => {
      setInfo(payload);
      setDismissed(false);
    });
    return () => {
      try {
        off?.();
      } catch {
        /* noop */
      }
    };
  }, []);

  // Check ativo (Desktop + Android) na montagem
  useEffect(() => {
    if (typeof window === "undefined") return;

    const electronAPI = (window as unknown as { electronAPI?: ElectronAPI })
      .electronAPI;
    const isElectron = Boolean(electronAPI?.getInstalledVersion);
    const isCapacitor = isNativePlatform();

    if (isElectron) setPlatform("desktop");
    else if (isCapacitor) {
      const cap = (window as unknown as {
        Capacitor?: { getPlatform?: () => string };
      }).Capacitor;
      const p = cap?.getPlatform?.();
      setPlatform(p === "ios" ? "ios" : "android");
    }

    if (!isElectron && !isCapacitor) return;

    let cancelled = false;

    (async () => {
      try {
        let installed = "";

        if (isElectron && electronAPI?.getInstalledVersion) {
          installed = await electronAPI.getInstalledVersion().catch(() => "");
        } else if (isCapacitor) {
          const appMod = await import("@capacitor/app").catch(() => null);
          if (!appMod || cancelled) return;
          const { App } = appMod as typeof import("@capacitor/app");
          const appInfo = await App.getInfo().catch(() => null);
          installed = appInfo?.version ?? "";
        }

        installed = String(installed).trim();
        if (!installed || cancelled) return;

        const res = await fetch("/api/latest-release", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { tag_name?: string; html_url?: string };
        const latest = String(data.tag_name || "")
          .replace(/^v/, "")
          .trim();
        if (!latest) return;

        if (isNewer(latest, installed) && !cancelled) {
          setInfo({ version: latest, url: data.html_url });
        }
      } catch {
        /* best-effort, ignora silencioso */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!info || dismissed) return null;

  // Asset URL especifico por plataforma:
  // - Desktop -> /api/download/exe (proxy server-side, mesma origem)
  // - Android -> /api/download/apk (idem)
  // - Web/iOS -> pagina da release no GitHub (fallback)
  const releasePageUrl =
    info.url ?? "https://github.com/weslleybertoldo/fabd-fluxos/releases/latest";
  const downloadUrl =
    platform === "desktop"
      ? "/api/download/exe"
      : platform === "android"
        ? "/api/download/apk"
        : releasePageUrl;

  async function openDownload() {
    const electronAPI = (window as unknown as { electronAPI?: ElectronAPI })
      .electronAPI;
    const fullUrl = downloadUrl.startsWith("/")
      ? `${window.location.origin}${downloadUrl}`
      : downloadUrl;

    if (isNativePlatform()) {
      // Capacitor: Custom Tab (Chrome real)
      await openExternalUrl(fullUrl);
    } else if (electronAPI?.openExternal) {
      // Desktop: shell.openExternal abre no navegador do SO (Chrome/Edge),
      // que baixa direto e fecha a aba. Evita abrir BrowserWindow do
      // Electron que ficava aberta apos download.
      await electronAPI.openExternal(fullUrl);
    } else {
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
    }
    setDismissed(true);
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-lg">
      <p className="text-sm font-semibold text-blue-900">
        Nova versão disponível{info.version ? ` (v${info.version})` : ""}
      </p>
      <p className="mt-1 text-xs text-blue-800">
        Nada é baixado automaticamente.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={openDownload}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
        >
          {platform === "desktop"
            ? "Baixar Windows (.exe)"
            : platform === "android"
              ? "Baixar Android (APK)"
              : "Ver no GitHub"}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Depois
        </button>
      </div>
    </div>
  );
}

/** Compara versoes semver-style. Retorna true se `a` > `b`. */
function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}
