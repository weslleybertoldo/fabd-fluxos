import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proxy server-side pra GitHub Releases API. Mantido como proxy (mesmo com
 * o repo publico) pra (1) cache server-side de 5min evitando rate-limit
 * GitHub quando varios users clicam, (2) consistencia entre Web/Desktop/
 * Android, (3) resiliencia se o repo voltar a ser privado.
 *
 * Se `GITHUB_TOKEN` estiver setado, usa pra autenticar (rate-limit maior).
 * Se nao, chama anonimo (repo precisa ser publico).
 */
export async function GET() {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "fabd-fluxos-web",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(
      "https://api.github.com/repos/weslleybertoldo/fabd-fluxos/releases/latest",
      {
        headers,
        next: { revalidate: 300 },
      },
    );
    if (!res.ok) {
      const txt = await res.text();
      return NextResponse.json(
        { error: `GitHub API ${res.status}: ${txt.slice(0, 200)}` },
        { status: res.status },
      );
    }
    const data = (await res.json()) as {
      tag_name: string;
      html_url: string;
      published_at: string;
      assets?: Array<{ name: string; browser_download_url: string; size: number }>;
    };
    return NextResponse.json({
      tag_name: data.tag_name,
      html_url: data.html_url,
      published_at: data.published_at,
      assets: (data.assets ?? []).map((a) => ({
        name: a.name,
        url: a.browser_download_url,
        size: a.size,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro desconhecido" },
      { status: 500 },
    );
  }
}
