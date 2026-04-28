-- ============================================================================
-- Seed inicial: workspace "FABD" + admin (weslleybertoldo18@gmail.com) + 5 diretorias
-- Idempotente — pode rodar varias vezes sem efeito colateral.
-- ============================================================================

DO $$
DECLARE
  admin_uid uuid;
  admin_full_name text;
  admin_avatar text;
  ws_id uuid;
  fabd_workspace_id constant uuid := '11111111-1111-1111-1111-fabdfabdfabd';
BEGIN
  -- Pega user do admin
  SELECT id,
         raw_user_meta_data->>'full_name',
         raw_user_meta_data->>'avatar_url'
    INTO admin_uid, admin_full_name, admin_avatar
    FROM auth.users
   WHERE email = 'weslleybertoldo18@gmail.com'
   LIMIT 1;

  IF admin_uid IS NULL THEN
    RAISE NOTICE 'User weslleybertoldo18@gmail.com nao existe ainda em auth.users — fazer login pelo menos uma vez antes de rodar este seed.';
    RETURN;
  END IF;

  -- Workspace FABD com ID fixo (pra ser determinístico em futuros seeds)
  INSERT INTO workspaces (id, name, slug, created_by)
  VALUES (fabd_workspace_id, 'FABD', 'fabd', admin_uid)
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

  ws_id := fabd_workspace_id;

  -- Admin como member ativo
  INSERT INTO workspace_members
    (workspace_id, user_id, role, status, approved_by, approved_at, google_full_name, google_avatar_url)
  VALUES
    (ws_id, admin_uid, 'admin', 'active', admin_uid, now(), admin_full_name, admin_avatar)
  ON CONFLICT (workspace_id, user_id) DO UPDATE SET
    role = 'admin',
    status = 'active',
    google_full_name = EXCLUDED.google_full_name,
    google_avatar_url = EXCLUDED.google_avatar_url,
    approved_at = COALESCE(workspace_members.approved_at, EXCLUDED.approved_at);

  -- 5 diretorias seed
  INSERT INTO directories (workspace_id, name, slug, icon, color, order_index, created_by)
  VALUES
    (ws_id, 'Marketing',           'marketing',           'mdi:bullhorn-outline',     '#C41E2A', 1, admin_uid),
    (ws_id, 'Financeira',          'financeira',          'mdi:cash-multiple',        '#10B981', 2, admin_uid),
    (ws_id, 'Tecnica',             'tecnica',             'mdi:trophy-outline',       '#1E3A8A', 3, admin_uid),
    (ws_id, 'Relacoes Exteriores', 'relacoes-exteriores', 'mdi:earth',                '#F59E0B', 4, admin_uid),
    (ws_id, 'Juridica',            'juridica',            'mdi:scale-balance',        '#7C3AED', 5, admin_uid),
    (ws_id, 'Geral',               'geral',               'mdi:office-building-cog',  '#64748B', 6, admin_uid)
  ON CONFLICT (workspace_id, slug) DO NOTHING;

  -- Audit log da criacao do workspace + diretorias (so se ainda nao existir entrada)
  IF NOT EXISTS (SELECT 1 FROM audit_log WHERE workspace_id = ws_id AND action = 'seed') THEN
    INSERT INTO audit_log (workspace_id, user_id, entity, entity_id, action, changes, context)
    VALUES (ws_id, admin_uid, 'workspace', ws_id, 'seed',
            jsonb_build_object('summary', 'Workspace FABD seed criado'),
            jsonb_build_object('initial', true));
  END IF;

  RAISE NOTICE 'Seed FABD aplicado: workspace=%, admin=%', ws_id, admin_uid;
END $$;
