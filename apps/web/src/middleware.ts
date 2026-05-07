import { NextResponse, type NextRequest } from "next/server";
import { updateSupabaseSession } from "@fabd-fluxos/db/middleware";

const PROTECTED_PREFIXES = ["/app", "/admin"];
const LAST_WS_COOKIE = "fluxos_last_ws";

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSupabaseSession(request);

  const path = request.nextUrl.pathname;
  const requiresAuth = PROTECTED_PREFIXES.some((p) => path.startsWith(p));

  if (requiresAuth && !user) {
    const loginUrl = new URL("/", request.url);
    loginUrl.searchParams.set("redirect", path);
    return NextResponse.redirect(loginUrl);
  }

  // Lembra ultimo workspace aberto pra pular o seletor em /app na proxima visita.
  // Path /app/<slug>/... — pega segmento 2. Slug eh validado server-side em /app
  // antes do redirect, entao cookie sujo (workspace removido) nao quebra nada.
  if (user && path.startsWith("/app/")) {
    const slug = path.split("/")[2];
    if (slug && slug !== "") {
      response.cookies.set(LAST_WS_COOKIE, slug, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
