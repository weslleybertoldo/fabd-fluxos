import { redirect } from "next/navigation";
import { requireWorkspaceMember } from "@/lib/workspace";
import { WorkspaceVisibilityToggle } from "./visibility-toggle";

export default async function ConfiguracoesGeralPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await requireWorkspaceMember(slug);
  if (ctx.member.role !== "admin") {
    redirect(`/app/${slug}/configuracoes/atualizacoes`);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-900">Visibilidade</h2>
        <p className="mt-1 text-sm text-slate-600">
          Controla se o workspace aparece publicamente pra quem ainda nao eh membro.
        </p>
        <div className="mt-4">
          <WorkspaceVisibilityToggle
            workspaceId={ctx.workspace.id}
            initialIsDiscoverable={ctx.workspace.is_discoverable}
          />
        </div>
      </section>
    </div>
  );
}
