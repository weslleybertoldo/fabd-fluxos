import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proxy server-side pra GitHub Releases API. Repo eh privado entao
 * client nao consegue acessar `api.github.com` direto (404 sem auth).
 * Aqui usamos `GITHUB_TOKEN` (env var, scope `repo` no PAT) pra autenticar.
 *
 * Endpoint protegido pelo middleware de auth do Next (so member logado
 * acessa essa pagina, entao chamar /api/latest-release sem cookie nao
 * vaza nada pra alguem que ja nao tinha acesso ao repo).
 */
export async function GET() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "GITHUB_TOKEN nao configurada" },
      { status: 500 },
    );
  }

  try {
    const res = await fetch(
      "https://api.github.com/repos/weslleybertoldo/fabd-fluxos/releases/latest",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "fabd-fluxos-web",
        },
        // Cache leve — atualizacoes nao saem mais que 1x por dia
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
    };
    return NextResponse.json({
      tag_name: data.tag_name,
      html_url: data.html_url,
      published_at: data.published_at,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro desconhecido" },
      { status: 500 },
    );
  }
}
