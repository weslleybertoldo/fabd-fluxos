import { requireWorkspaceAdmin } from "@/lib/workspace";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { DirectoriesPanel } from "./directories-panel";
import type { DirectoryRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DirectoriesSettingsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await requireWorkspaceAdmin(slug);

  const supabase = await createSupabaseServerClient();
  const { data: rows } = await supabase
    .from("directories")
    .select("*")
    .eq("workspace_id", ctx.workspace.id)
    .order("order_index", { ascending: true });
  const directories = (rows ?? []) as unknown as DirectoryRow[];

  return (
    <div className="space-y-6 pt-2">
      <p className="text-sm text-slate-600">
        Adicionar, editar ou excluir diretorias. Voce pode subir uma imagem (logo
        oficial, escudo) que substitui as iniciais nos cards.
      </p>
      <DirectoriesPanel
        workspaceId={ctx.workspace.id}
        workspaceSlug={ctx.workspace.slug}
        directories={directories}
      />
    </div>
  );
}
