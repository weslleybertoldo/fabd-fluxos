import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Proxy server-side pro instalador Windows (.exe) da release mais recente.
 * Mesma estrategia do /api/download/apk: serve do mesmo domain pra evitar
 * bloqueios de cross-origin/restricoes de browser em downloads de binarios.
 */
export async function GET() {
  const token = process.env.GITHUB_TOKEN;
  const apiHeaders: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "fabd-fluxos-web",
  };
  if (token) apiHeaders.Authorization = `Bearer ${token}`;

  try {
    const releaseRes = await fetch(
      "https://api.github.com/repos/weslleybertoldo/fabd-fluxos/releases/latest",
      { headers: apiHeaders, next: { revalidate: 60 } },
    );
    if (!releaseRes.ok) {
      return NextResponse.json(
        { error: `GitHub release ${releaseRes.status}` },
        { status: 502 },
      );
    }
    const release = (await releaseRes.json()) as {
      assets?: Array<{ name: string; browser_download_url: string }>;
    };
    const asset = release.assets?.find((a) =>
      a.name.toLowerCase().endsWith(".exe"),
    );
    if (!asset) {
      return NextResponse.json(
        { error: ".exe asset nao encontrado na release latest" },
        { status: 404 },
      );
    }

    const fileRes = await fetch(asset.browser_download_url, {
      headers: { "User-Agent": "fabd-fluxos-web" },
    });
    if (!fileRes.ok || !fileRes.body) {
      return NextResponse.json(
        { error: `Download asset ${fileRes.status}` },
        { status: 502 },
      );
    }

    return new Response(fileRes.body, {
      headers: {
        "Content-Type": "application/vnd.microsoft.portable-executable",
        "Content-Disposition": `attachment; filename="${asset.name}"`,
        ...(fileRes.headers.get("content-length")
          ? { "Content-Length": fileRes.headers.get("content-length")! }
          : {}),
        "Cache-Control": "public, max-age=300, s-maxage=300",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro desconhecido" },
      { status: 500 },
    );
  }
}
