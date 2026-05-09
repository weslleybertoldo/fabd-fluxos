-- ============================================================================
-- Hotfix Copilot review PR #6: grant explicito to service_role + correcoes
-- ============================================================================
-- Copilot apontou 2 problemas na migration 20260509000001:
--
-- 1) BYPASSRLS NAO afeta privilegios EXECUTE em funcoes — afeta apenas
--    POLICIES de tabelas/views. Service_role do Supabase consegue chamar as
--    funcoes hoje porque tem grants default proprios (ou via owner = postgres),
--    nao por causa de BYPASSRLS. Pra evitar surpresa futura caso alguma rota
--    server-side passe a chamar essas RPCs (notify_user, clone_project,
--    find_workspace_by_id, list_discoverable_workspaces), concedemos
--    explicitamente EXECUTE pra service_role aqui.
--
-- 2) `list_discoverable_workspaces` foi DROP+CREATE na migration
--    20260507000001_workspace_discoverability.sql (porque mudou return type),
--    o que descartou todos os grants antigos. A migration 20260509000001 ja
--    restaurou `grant to authenticated`, mas o comentario "ja tinha grant
--    authenticated" estava enganoso — ela tinha PERDIDO esse grant no drop.
--    (Fix puramente cosmetico via header desta migration; SQL estado final
--    da 20260509000001 ja eh o correto.)
-- ============================================================================

-- 1) Helpers de RLS — service_role bypassa RLS de tabelas, entao na pratica
--    nao precisa chamar essas funcoes; mas concede pra defesa em camadas
--    caso alguma rota futura passe a usa-las.
grant execute on function is_workspace_member(uuid, uuid) to service_role;
grant execute on function workspace_role_of(uuid, uuid) to service_role;
grant execute on function is_workspace_admin(uuid, uuid) to service_role;
grant execute on function log_audit(uuid, entity_type, uuid, text, jsonb, jsonb) to service_role;

-- 2) RPCs server-side — notify_user e os de workspace lookup podem ser
--    chamadas por crons/edge functions usando SUPABASE_SERVICE_ROLE_KEY.
grant execute on function notify_user(uuid, uuid, notification_type, text, text, entity_type, uuid, text) to service_role;
grant execute on function clone_project(uuid) to service_role;
grant execute on function find_workspace_by_id(uuid) to service_role;
grant execute on function list_discoverable_workspaces() to service_role;
