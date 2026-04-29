import { redirect } from "next/navigation";

export default async function ConfiguracoesIndex({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  // Default: aba Atualizacoes (visivel pra todos)
  redirect(`/app/${slug}/configuracoes/atualizacoes`);
}
