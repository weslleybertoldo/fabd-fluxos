"use client";

import { useEffect, useState, useTransition } from "react";
import { isNativePlatform, openExternalUrl } from "@/lib/native";

interface Props {
  /** Versao do web app vinda do package.json no build (server). */
  webVersion: string;
}

type Platform = "web" | "desktop" | "android" | "ios";

interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}

interface ReleaseInfo {
  tag_name: string;
  html_url: string;
  published_at: string;
  assets?: ReleaseAsset[];
}

/**
 * Encontra um asset da release pelo sufixo do nome (ex: ".apk", ".exe").
 * GitHub normaliza espacos em pontos quando o asset eh enviado com nome com
 * espaco — usar a URL real do asset eh mais robusto que construir o nome.
 */
function findAsset(release: ReleaseInfo | null, suffix: string): string | null {
  if (!release?.assets) return null;
  const a = release.assets.find((x) => x.name.toLowerCase().endsWith(suffix));
  return a?.url ?? null;
}

/**
 * Click handler universal pra download.
 * - APK Capacitor (dentro do app): abre Custom Tab via @capacitor/browser.
 *   O Custom Tab eh Chrome real, sabe lidar com Content-Disposition.
 * - Web/Mobile Chrome/Desktop: deixa o navegador baixar direto. Como os URLs
 *   apontam pro proxy server-side (/api/download/apk|exe), Chrome trata como
 *   same-origin e nao bloqueia. target=_blank no <a> garante nova aba pra
 *   feedback visual claro.
 */
function handleDownloadClick(directUrl: string) {
  return async (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (isNativePlatform()) {
      e.preventDefault();
      // Se for URL relativa, prepende origin
      const fullUrl = directUrl.startsWith("/")
        ? `${window.location.origin}${directUrl}`
        : directUrl;
      await openExternalUrl(fullUrl);
    }
  };
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
  const fallbackUrl = "https://github.com/weslleybertoldo/fabd-fluxos/releases/latest";
  // Mesma origem (proxy server-side) — Chrome Android nao bloqueia download
  // como faz com asset cross-origin do GitHub.
  const apkUrl = "/api/download/apk";
  const exeUrl = "/api/download/exe";
  const releasePageUrl = release?.html_url ?? fallbackUrl;
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
          download
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleDownloadClick(apkUrl)}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          Baixar Android (APK)
        </a>
        <a
          href={exeUrl}
          download
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleDownloadClick(exeUrl)}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          Baixar Windows (.exe)
        </a>
        <InstallPwaButton />
        <a
          href={releasePageUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleDownloadClick(releasePageUrl)}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
          Ver no GitHub
        </a>
      </div>
      <p className="mt-3 text-[11px] text-slate-500">
        <strong>PWA</strong> eh a forma mais rapida de usar no celular: instala
        em 2 toques, sem APK. Se o navegador bloquear o download direto (.apk
        pode aparecer como &quot;arquivo perigoso&quot;), clique em{" "}
        <strong>Ver no GitHub</strong> e baixe pela pagina do release.
      </p>
    </div>
  );
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

type DevicePlatform = "android" | "ios" | "desktop" | "other";

function InstallPwaButton() {
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [device, setDevice] = useState<DevicePlatform>("other");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ua = navigator.userAgent.toLowerCase();
    const iOS =
      /iphone|ipad|ipod/.test(ua) ||
      (ua.includes("mac") && "ontouchend" in document);
    const android = /android/.test(ua);
    if (iOS) setDevice("ios");
    else if (android) setDevice("android");
    else setDevice("desktop");

    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone ===
        true;
    if (standalone) setInstalled(true);

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) {
    return (
      <span className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        PWA instalado
      </span>
    );
  }

  function handleClick() {
    if (installPrompt) {
      installPrompt.prompt();
      installPrompt.userChoice.then(({ outcome }) => {
        if (outcome === "accepted") setInstallPrompt(null);
      });
      return;
    }
    setShowHelp(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex items-center gap-2 rounded-xl border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2" /><line x1="12" y1="18" x2="12.01" y2="18" /></svg>
        Baixar PWA (celular)
      </button>
      {showHelp ? (
        <PwaHelpModal device={device} onClose={() => setShowHelp(false)} />
      ) : null}
    </>
  );
}

function PwaHelpModal({
  device,
  onClose,
}: {
  device: DevicePlatform;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl">
        <header>
          <h2 className="text-lg font-semibold text-slate-900">
            Instalar PWA no celular
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            PWA nao tem arquivo pra baixar — eh o proprio site que vira app.
          </p>
        </header>

        {device === "ios" ? (
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
            <li>
              Abra <code>fluxos.fabd.com.br</code> no <strong>Safari</strong>{" "}
              (precisa ser Safari, nao Chrome).
            </li>
            <li>
              Toque no botao <strong>Compartilhar</strong> (quadrado com seta
              pra cima, na barra inferior).
            </li>
            <li>
              Role e toque em <strong>Adicionar a Tela de Inicio</strong>.
            </li>
            <li>Confirme — vai aparecer um icone na tela inicial.</li>
          </ol>
        ) : (
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
            <li>
              Abra <code>fluxos.fabd.com.br</code> no <strong>Chrome</strong> do
              celular.
            </li>
            <li>
              Toque no menu <strong>⋮</strong> (canto superior direito).
            </li>
            <li>
              Toque em <strong>Instalar app</strong> (ou{" "}
              <em>Adicionar a tela inicial</em>, depende da versao).
            </li>
            <li>Confirme — vai aparecer um icone na tela inicial.</li>
          </ol>
        )}

        <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          Apos instalar, o PWA mantem voce logado, recebe notificacoes via Web
          Push e abre em modo standalone (sem barra do navegador).
        </p>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Entendi
          </button>
        </div>
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
  const apkAsset = "/api/download/apk";
  const exeAsset = "/api/download/exe";

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
