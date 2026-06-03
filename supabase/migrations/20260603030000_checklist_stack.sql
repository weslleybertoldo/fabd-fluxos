-- Empilhamento: checklists com o mesmo stack_id formam uma pilha (coluna) no
-- board; stack_pos ordena dentro da pilha. Default: cada checklist na sua propria
-- pilha (stack_id = id). order_index continua sendo a ordem horizontal da pilha.
alter table checklists add column stack_id uuid;
alter table checklists add column stack_pos int not null default 0;
update checklists set stack_id = id where stack_id is null;
