import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { LoginButton } from "@/components/login-button";

export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/app");
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-gradient-to-br from-[#1e3a8a] to-[#c41e2a] p-6 text-white">
      <section className="w-full max-w-md rounded-3xl border border-white/15 bg-white/8 p-10 text-center backdrop-blur-md shadow-2xl">
        <h1 className="text-4xl font-extrabold tracking-tight">FABD Fluxos</h1>
        <p className="mt-3 text-base text-white/85">
          Gestao de demandas e processos da Federacao Alagoana de Badminton.
        </p>
        <p className="mt-6 text-sm text-white/70">
          Entre com sua conta Google. O acesso ao workspace eh liberado pelo administrador.
        </p>
        <div className="mt-8">
          <LoginButton />
        </div>
        <p className="mt-6 text-xs text-white/50">fluxos.fabd.com.br</p>
      </section>
    </main>
  );
}
