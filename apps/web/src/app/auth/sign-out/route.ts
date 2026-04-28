import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
