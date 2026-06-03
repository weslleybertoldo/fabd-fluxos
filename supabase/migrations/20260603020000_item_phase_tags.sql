-- Tags (nome livre) por item de checklist e por fase. Indicador visual (traco roxo)
-- aparece quando ha qualquer tag.
alter table checklist_items add column tags text[] not null default '{}';
alter table phases add column tags text[] not null default '{}';
