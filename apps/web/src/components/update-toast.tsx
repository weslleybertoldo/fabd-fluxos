"use client";

import { useEffect, useState } from "react";
import { isNativePlatform, openExternalUrl } from "@/lib/native";

type UpdatePayload = { version?: string; url?: string };
type ProgressPayload = { percent?: number };

type ElectronAPI = {
  onUpdateAvailable?: (cb: (payload: UpdatePayload) => void) => () => void;
  onUpdateProgress?: (cb: (payload: ProgressPayload) => void) => () => void;
  onUpdateDownloaded?: (cb: (payload: UpdatePayload) => void) => () => void;
  onUpdateError?: (cb: (payload: { message?: string }) => void) => () => void;
  updaterDownload?: () => Promise<{ ok: boolean; error?: string }>;
  updaterInstall?: () => Promise<{ ok: boolean }>;
  getInstalledVersion?: () => Promise<string>;
  openExternal?: (url: string) => Promise<{ ok: boolean }>;
};

type Platform = "desktop" | "android" | "ios" | "web";
type State = "available" | "downloading" | "ready";

/**
 * Toast de atualizacao:
 * - Desktop (Electron): popup 3 estados via electron-updater. "Atualizar agora"
 *   baixa em background, mostra progresso, depois "Reiniciar agora / depois".
 *   Se adiar, arquivo fica no cache do electron-updater — proxima abertura
 *   re-emite 'update-downloaded' direto pulando o download.
 * - Android (Capacitor): fallback antigo (Custom Tab pra baixar APK).
 */
export function UpdateToast() {
  const [info, setInfo] = useState<UpdatePayload | null>(null);
  const [state, setState] = useState<State>("available");
  const [progress, setProgress] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [platform, setPlatform] = useState<Platform>("web");

  // Listeners IPC do electron-updater (desktop)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const api = (window as unknown as { electronAPI?: ElectronAPI }).electronAPI;
    if (!api?.onUpdateAvailable) return;

    const offs: Array<(() => void) | undefined> = [];
    offs.push(
      api.onUpdateAvailable((payload) => {
        setInfo(payload);
        setState("available");
        setDismissed(false);
      }),
    );
    if (api.onUpdateProgress) {
      offs.push(
        api.onUpdateProgress((p) => {
          if (typeof p?.percent === "number") setProgress(p.percent);
        }),
      );
    }
    if (api.onUpdateDownloaded) {
      offs.push(
        api.onUpdateDownloaded((payload) => {
          setInfo((prev) => ({ ...(prev ?? {}), ...payload }));
          setState("ready");
          setDismissed(false);
        }),
      );
    }
    if (api.onUpdateError) {
      offs.push(
        api.onUpdateError(() => {
          setState("available");
        }),
      );
    }
    return () => {
      for (const off of offs) {
        try {
          off?.();
        } catch {
          /* noop */
        }
      }
    };
  }, []);

  // Check ativo Android (Capacitor) — desktop ja recebe via IPC
  useEffect(() => {
    if (typeof window === "undefined") return;

    const electronAPI = (window as unknown as { electronAPI?: ElectronAPI })
      .electronAPI;
    const isElectron = Boolean(electronAPI?.updaterDownload);
    const isCapacitor = isNativePlatform();

    if (isElectron) {
      setPlatform("desktop");
      return; // desktop usa IPC, sem check ativo
    }
    if (isCapacitor) {
      const cap = (window as unknown as {
        Capacitor?: { getPlatform?: () => string };
      }).Capacitor;
      const p = cap?.getPlatform?.();
      setPlatform(p === "ios" ? "ios" : "android");
    } else {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const appMod = await import("@capacitor/app").catch(() => null);
        if (!appMod || cancelled) return;
        const { App } = appMod as typeof import("@capacitor/app");
        const appInfo = await App.getInfo().catch(() => null);
        const installed = String(appInfo?.version ?? "").trim();
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
          setState("available");
        }
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!info || dismissed) return null;

  const electronAPI = (window as unknown as { electronAPI?: ElectronAPI })
    .electronAPI;
  const isDesktopAuto = Boolean(electronAPI?.updaterDownload);

  // Android: fluxo manual antigo
  if (!isDesktopAuto) {
    const releasePageUrl =
      info.url ?? "https://github.com/weslleybertoldo/fabd-fluxos/releases/latest";
    const downloadUrl =
      platform === "android" ? "/api/download/apk" : releasePageUrl;

    const openDownload = async () => {
      const fullUrl = downloadUrl.startsWith("/")
        ? `${window.location.origin}${downloadUrl}`
        : downloadUrl;
      if (isNativePlatform()) {
        await openExternalUrl(fullUrl);
      } else {
        window.open(downloadUrl, "_blank", "noopener,noreferrer");
      }
      setDismissed(true);
    };

    return (
      <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-lg">
        <p className="text-sm font-semibold text-blue-900">
          Nova versão disponível{info.version ? ` (v${info.version})` : ""}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={openDownload}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
          >
            {platform === "android" ? "Baixar Android (APK)" : "Ver no GitHub"}
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

  // Desktop: fluxo automatico (3 estados)
  const v = info.version ? `v${info.version}` : "";

  const onAccept = async () => {
    setState("downloading");
    setProgress(0);
    try {
      const res = await electronAPI?.updaterDownload?.();
      if (res && res.ok === false) {
        setState("available");
      }
    } catch {
      setState("available");
    }
  };

  const onInstall = async () => {
    try {
      await electronAPI?.updaterInstall?.();
    } catch {
      /* noop */
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-2xl border border-blue-200 bg-white p-4 shadow-lg">
      {state === "available" && (
        <>
          <p className="text-sm font-semibold text-slate-900">
            Nova atualização disponível {v && <>({v})</>}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Atualizar agora baixa em background e depois reinicia o app.
          </p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Mais tarde
            </button>
            <button
              type="button"
              onClick={onAccept}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              Atualizar agora
            </button>
          </div>
        </>
      )}

      {state === "downloading" && (
        <>
          <p className="text-sm font-semibold text-slate-900">
            Baixando {v}...
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded bg-slate-200">
            <div
              className="h-full bg-blue-600 transition-[width] duration-200"
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </div>
          <p className="mt-2 text-center text-xs text-slate-500">{progress}%</p>
        </>
      )}

      {state === "ready" && (
        <>
          <p className="text-sm font-semibold text-emerald-700">
            Atualização baixada{v && <> ({v})</>}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            App vai reiniciar pra aplicar. Pode adiar — fica pronto pra próxima abertura.
          </p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Atualizar mais tarde
            </button>
            <button
              type="button"
              onClick={onInstall}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              Atualizar agora
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Compara versoes semver. true se `a` > `b`. */
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
