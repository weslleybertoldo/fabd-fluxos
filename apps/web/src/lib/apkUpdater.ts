import { isNativePlatform, openExternalUrl } from "@/lib/native";

export interface ApkInstallerPlugin {
  download(options: { url: string }): Promise<{ path: string }>;
  install(options: { path: string }): Promise<void>;
  canInstall(): Promise<{ granted: boolean }>;
  openInstallSettings(): Promise<void>;
  addListener(
    eventName: "downloadProgress",
    listenerFunc: (data: { percent: number }) => void,
  ): Promise<{ remove: () => void }>;
}

function isNativeAndroid(): boolean {
  if (!isNativePlatform()) return false;
  const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } })
    .Capacitor;
  return cap?.getPlatform?.() === "android";
}

export type UpdateResult = "installed" | "permission" | "fallback";

/**
 * Atualizacao in-app no Android: baixa o APK dentro do app (emitindo progresso
 * via onProgress 0..100) e abre o instalador do sistema. O Android sempre mostra
 * a tela "Instalar?" — nao ha instalacao 100% silenciosa fora da Play Store.
 *
 * - "installed": download ok, instalador aberto.
 * - "permission": falta liberar "instalar apps desconhecidos"; abriu as
 *   configuracoes. O usuario concede e clica baixar de novo.
 * - "fallback": fora do Android nativo (web/iOS) — abriu o link no navegador.
 */
export async function downloadAndInstall(
  url: string,
  onProgress?: (percent: number) => void,
): Promise<UpdateResult> {
  if (!isNativeAndroid()) {
    await openExternalUrl(url);
    return "fallback";
  }

  const { registerPlugin } = await import("@capacitor/core");
  const ApkInstaller = registerPlugin<ApkInstallerPlugin>("ApkInstaller");

  const { granted } = await ApkInstaller.canInstall();
  if (!granted) {
    await ApkInstaller.openInstallSettings();
    return "permission";
  }

  const listener = await ApkInstaller.addListener("downloadProgress", (d) => {
    onProgress?.(d.percent);
  });
  try {
    const { path } = await ApkInstaller.download({ url });
    await ApkInstaller.install({ path });
    return "installed";
  } finally {
    listener.remove();
  }
}
