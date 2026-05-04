type SupaLike = {
  from(table: string): {
    select(cols?: string): {
      eq(col: string, val: string): Promise<{
        data: Array<Record<string, string>> | null;
        error: { message: string } | null;
      }>;
    };
  };
};

/**
 * Resolve quais directory_ids do workspace o user logado pode ver.
 *
 * Regras:
 * - Admin do workspace: todas as diretorias (retorna null = sem filtro)
 * - Membro/diretor sem nenhuma linha em member_directory_access: todas (default)
 * - Com 1+ linhas: apenas essas
 *
 * Retornar `null` significa "ver tudo" (nao filtrar). Caller deve checar
 * por `null` antes de aplicar `.in("id", ids)`.
 */
export async function getVisibleDirectoryIds(
  supabase: unknown,
  workspaceMemberId: string,
  role: string,
): Promise<string[] | null> {
  if (role === "admin") return null;

  const sb = supabase as SupaLike;
  const { data } = await sb
    .from("member_directory_access")
    .select("directory_id")
    .eq("workspace_member_id", workspaceMemberId);
  const rows = (data ?? []) as Array<{ directory_id: string }>;
  if (rows.length === 0) return null;
  return rows.map((r) => r.directory_id);
}

