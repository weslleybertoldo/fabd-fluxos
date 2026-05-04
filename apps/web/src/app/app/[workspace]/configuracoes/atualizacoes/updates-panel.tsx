"use client";

import { useEffect, useState, useTransition } from "react";

interface Props {
  /** Versao do web app vinda do package.json no build (server). */
  webVersion: string;
}

type Platform = "web" | "desktop" | "android" | "ios";

interface ReleaseInfo {
  tag_name: string;
  html_url: string;
  published_at: string;
}

// Proxy server-side em /api/latest-release usa GITHUB_TOKEN pra
// autenticar (repo eh privado — chamada direta a api.github.com da 404).
const RELEASE_API = "/api/latest-release";

export function UpdatesPanel({ webVersion }: Props) {
  const [platform, setPlatform] = useState<Platform>("web");
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [desktopMsg, setDesktopMsg] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const cap = (window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
    }).Capacitor;
    if (cap?.isNativePlatform?.()) {
      const p = cap.getPlatform?.();
      if (p === "android") setPlatform("android");
      else if (p === "ios") setPlatform("ios");
    } else if (
      navigator.userAgent.toLowerCase().includes("electron") ||
      (window as unknown as { electronAPI?: unknown }).electronAPI
    ) {
      setPlatform("desktop");
    } else {
      setPlatform("web");
    }
  }, []);

  function check() {
    setError(null);
    setRelease(null);
    setDesktopMsg(null);
    start(async () => {
      try {
        if (platform === "desktop") {
          const api = (window as unknown as {
            electronAPI?: { checkForUpdates?: () => Promise<{ status: string; message?: string }> };
          }).electronAPI;
          if (!api?.checkForUpdates) {
            setDesktopMsg(
              "Esta versao do app nao tem atualizacao automatica. Baixe a versao mais recente manualmente.",
            );
            // ainda fazemos fetch pra mostrar link
            const r = await fetch(RELEASE_API);
            if (r.ok) setRelease(await r.json());
            return;
          }
          const result = await api.checkForUpdates();
          setDesktopMsg(result.message ?? `Status: ${result.status}`);
          // Tambem pega info do release pra mostrar links (download manual)
          const r = await fetch(RELEASE_API);
          if (r.ok) setRelease(await r.json());
          return;
        }

        // Web / Android / iOS: consulta proxy /api/latest-release (server usa GH token)
        const r = await fetch(RELEASE_API);
        if (!r.ok) {
          setError(`Endpoint de release retornou ${r.status}`);
          return;
        }
        const data = (await r.json()) as ReleaseInfo;
        setRelease(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro desconhecido");
      }
    });
  }

  function reloadWeb() {
    window.location.reload();
  }

  const platformLabels: Record<Platform, string> = {
    web: "Navegador (Web)",
    desktop: "Desktop (Windows)",
    android: "Android",
    ios: "iOS",
  };

  return (
    <section className="space-y-5">
      {/* Card versao atual */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-500">
              Versao instalada
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              v{webVersion}
            </p>
            <p className="mt-1 text-xs text-slate-600">
              Plataforma: <span className="font-medium">{platformLabels[platform]}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={check}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            {pending ? "Verificando..." : "Verificar atualizacoes"}
          </button>
        </div>
      </div>

      <DownloadLinksCard />


      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {desktopMsg ? (
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
          {desktopMsg}
        </p>
      ) : null}

      {/* Card resultado/info por plataforma */}
      {release ? (
        <ReleaseCard
          platform={platform}
          release={release}
          currentVersion={webVersion}
        />
      ) : null}

      {!pending && !error && !release && !desktopMsg ? (
        <PlatformInfo platform={platform} onReload={reloadWeb} />
      ) : null}
    </section>
  );
}

function DownloadLinksCard() {
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(RELEASE_API)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setRelease(data as ReleaseInfo);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const latest = release?.tag_name?.replace(/^v/, "") ?? "";
  const apkUrl = release && latest
    ? `${release.html_url.replace("/tag/", "/download/")}/FABD-Fluxos-${latest}.apk`
    : "https://github.com/weslleybertoldo/fabd-fluxos/releases/latest";
  const exeUrl = release && latest
    ? `${release.html_url.replace("/tag/", "/download/")}/FABD-Fluxos-Setup-${latest}.exe`
    : "https://github.com/weslleybertoldo/fabd-fluxos/releases/latest";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-sm font-semibold text-slate-900">Baixar app</p>
      <p className="mt-1 text-xs text-slate-600">
        Instale o FABD Fluxos no celular ou no Windows.
        {latest ? ` Versao mais recente: v${latest}.` : ""}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={apkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          Baixar Android (APK)
        </a>
        <a
          href={exeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          Baixar Windows (.exe)
        </a>
      </div>
    </div>
  );
}

function ReleaseCard({
  platform,
  release,
  currentVersion,
}: {
  platform: Platform;
  release: ReleaseInfo;
  currentVersion: string;
}) {
  const latest = release.tag_name.replace(/^v/, "");
  const isOutdated = latest !== currentVersion;
  const apkAsset = `${release.html_url.replace(
    "/tag/",
    "/download/",
  )}/FABD-Fluxos-${latest}.apk`;
  const exeAsset = `${release.html_url.replace(
    "/tag/",
    "/download/",
  )}/FABD-Fluxos-Setup-${latest}.exe`;

  return (
    <div
      className={`rounded-2xl border p-5 ${
        isOutdated
          ? "border-blue-300 bg-blue-50"
          : "border-emerald-300 bg-emerald-50"
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-wider text-slate-600">
        Versao mais recente disponivel
      </p>
      <div className="mt-1 flex flex-wrap items-baseline gap-3">
        <p className="text-2xl font-bold text-slate-900">v{latest}</p>
        {isOutdated ? (
          <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs font-medium text-white">
            Atualizacao disponivel
          </span>
        ) : (
          <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white">
            Voce ja esta na versao mais recente
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-600">
        Publicada em{" "}
        {new Date(release.published_at).toLocaleString("pt-BR", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })}
      </p>

      {isOutdated ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {(platform === "android" || platform === "web") ? (
            <a
              href={apkAsset}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              Baixar APK Android
            </a>
          ) : null}
          {(platform === "desktop" || platform === "web") ? (
            <a
              href={exeAsset}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              Baixar instalador Windows
            </a>
          ) : null}
          <a
            href={release.html_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Ver release no GitHub
          </a>
        </div>
      ) : null}
    </div>
  );
}

function PlatformInfo({
  platform,
  onReload,
}: {
  platform: Platform;
  onReload: () => void;
}) {
  if (platform === "web") {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <p className="text-sm text-slate-700">
          Voce esta usando o app pelo navegador. Toda atualizacao nova fica disponivel
          assim que voce recarrega a pagina.
        </p>
        <button
          type="button"
          onClick={onReload}
          className="mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Recarregar pagina
        </button>
      </div>
    );
  }
  if (platform === "desktop") {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <p className="text-sm text-slate-700">
          Voce esta usando o app desktop. Ao abrir o app, ele checa silenciosamente
          se ha versao nova e mostra uma notificacao do Windows quando houver — voce
          escolhe se quer baixar. Pra checar agora, clique em{" "}
          <strong>Verificar atualizacoes</strong> acima.
        </p>
      </div>
    );
  }
  if (platform === "android" || platform === "ios") {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <p className="text-sm text-slate-700">
          Voce esta usando o app no celular. Atualizacoes do conteudo (web) acontecem
          automaticamente. Pra atualizar o app instalado (APK), clique em{" "}
          <strong>Verificar atualizacoes</strong> acima e baixe a versao mais recente
          do GitHub Release.
        </p>
      </div>
    );
  }
  return null;
}
