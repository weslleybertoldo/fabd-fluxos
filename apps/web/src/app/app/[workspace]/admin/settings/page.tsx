import { redirect } from "next/navigation";

export default async function SettingsIndex({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  redirect(`/app/${slug}/admin/settings/directories`);
}
