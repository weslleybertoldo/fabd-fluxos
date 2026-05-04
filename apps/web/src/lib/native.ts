/**
 * Helpers pra integracao Capacitor (Android/iOS native wrapper).
 *
 * O codigo eh tudo dynamic-import pra nao quebrar SSR/web build —
 * window.Capacitor so existe no runtime native.
 */

export interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

export function isNativePlatform(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return cap?.isNativePlatform?.() ?? false;
}

/** Abre URL em Custom Tab nativa (Android) / SFSafariViewController (iOS) */
export async function openExternalUrl(url: string): Promise<void> {
  if (!isNativePlatform()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url });
}

export async function closeNativeBrowser(): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.close();
  } catch {
    /* ja pode ter fechado */
  }
}
