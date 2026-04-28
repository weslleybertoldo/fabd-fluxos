import { NextResponse, type NextRequest } from "next/server";
import { updateSupabaseSession } from "@fabd-fluxos/db/middleware";

const PROTECTED_PREFIXES = ["/app", "/admin"];

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSupabaseSession(request);

  const path = request.nextUrl.pathname;
  const requiresAuth = PROTECTED_PREFIXES.some((p) => path.startsWith(p));

  if (requiresAuth && !user) {
    const loginUrl = new URL("/", request.url);
    loginUrl.searchParams.set("redirect", path);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
