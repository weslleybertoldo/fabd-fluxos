-- ============================================================================
-- Realtime publication: tabelas adicionais que afetam a UI em tempo real
-- ============================================================================

do $$
begin
  -- projects (status, responsavel)
  begin
    alter publication supabase_realtime add table projects;
  exception when duplicate_object then null;
  end;

  -- directories (criar/excluir/renomear)
  begin
    alter publication supabase_realtime add table directories;
  exception when duplicate_object then null;
  end;

  -- phase_attachments
  begin
    alter publication supabase_realtime add table phase_attachments;
  exception when duplicate_object then null;
  end;

  -- phase_fields (criacao/exclusao)
  begin
    alter publication supabase_realtime add table phase_fields;
  exception when duplicate_object then null;
  end;

  -- flow_tags
  begin
    alter publication supabase_realtime add table flow_tags;
  exception when duplicate_object then null;
  end;

  -- reminders
  begin
    alter publication supabase_realtime add table reminders;
  exception when duplicate_object then null;
  end;

  -- simple_lists + items
  begin
    alter publication supabase_realtime add table simple_lists;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table simple_list_items;
  exception when duplicate_object then null;
  end;
end $$;
