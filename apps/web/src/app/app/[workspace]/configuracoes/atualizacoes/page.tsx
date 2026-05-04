import { requireWorkspaceMember } from "@/lib/workspace";
import { UpdatesPanel } from "./updates-panel";
import { FcmStatus } from "@/components/fcm-status";
import packageJson from "../../../../../../package.json";

export const dynamic = "force-dynamic";

export default async function AtualizacoesPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  await requireWorkspaceMember(slug);
  const webVersion = (packageJson as { version: string }).version;

  return (
    <div className="space-y-6 pt-2">
      <p className="text-sm text-slate-600">
        Veja a versao instalada do FABD Fluxos e busque atualizacoes. Funciona em{" "}
        <strong>Web</strong>, <strong>Desktop (Windows)</strong> e{" "}
        <strong>Android</strong>.
      </p>
      <UpdatesPanel webVersion={webVersion} />
      <FcmStatus />
    </div>
  );
}
