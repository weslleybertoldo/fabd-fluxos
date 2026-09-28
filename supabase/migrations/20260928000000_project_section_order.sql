-- ============================================================================
-- Ordem das secoes da pagina do projeto (Kanbans / Fluxos / Checklists),
-- escolhida na engrenagem do projeto ("Ordem das secoes"). Vale pro projeto todo.
-- Padrao: Kanban completo em cima, fluxos embaixo e as checklists por ultimo.
-- Aditiva e idempotente. RLS: prj_update ja cobre (admin ou diretor dono/responsavel).
-- ============================================================================

alter table projects
  add column if not exists section_order text[] not null
    default array['kanbans', 'fluxos', 'checklists'];

-- Exatamente as 3 secoes, cada uma uma vez (3 itens contendo as 3 = sem repeticao).
alter table projects drop constraint if exists projects_section_order_check;
alter table projects add constraint projects_section_order_check check (
  cardinality(section_order) = 3
  and section_order @> array['kanbans', 'fluxos', 'checklists']
);
