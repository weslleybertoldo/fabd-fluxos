-- ============================================================================
-- Notificacoes: insert via RPC SECURITY DEFINER + policy explicita
-- ============================================================================

-- RPC pra criar notificacao pra outro usuario (chamada por server actions).
-- Valida que o caller eh membro do workspace e que o destinatario tambem.
create or replace function notify_user(
  p_target_user_id uuid,
  p_workspace_id uuid,
  p_type notification_type,
  p_title text,
  p_body text default null,
  p_entity entity_type default null,
  p_entity_id uuid default null,
  p_link text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_id uuid;
begin
  if v_caller is null then
    raise exception 'auth required';
  end if;

  -- caller precisa ser membro do workspace
  if not is_workspace_member(p_workspace_id, v_caller) then
    raise exception 'caller not member of workspace';
  end if;

  -- destinatario precisa ser membro do workspace
  if not is_workspace_member(p_workspace_id, p_target_user_id) then
    raise exception 'target not member of workspace';
  end if;

  -- evitar self-notification (sem efeito util)
  if p_target_user_id = v_caller then
    return null;
  end if;

  insert into notifications (
    user_id, workspace_id, type, title, body, entity, entity_id, link
  ) values (
    p_target_user_id, p_workspace_id, p_type, p_title, p_body, p_entity, p_entity_id, p_link
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function notify_user(uuid, uuid, notification_type, text, text, entity_type, uuid, text)
  to authenticated;
