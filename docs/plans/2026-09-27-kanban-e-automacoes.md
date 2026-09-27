# Kanban + Automações — Plano de implementação

> **Execução:** inline nesta sessão (`superpowers:executing-plans`), esteira `Skill-wbs-local-stg-prod-ate-o-fim`
> (sem gates humanos; validação autônoma com evidência). Checklist espelhado no TaskCreate da sessão.

**Goal:** Kanban estilo Pipefy dentro do projeto (fases editáveis, cards que se movem) e automação
"card entra na fase X → cria card na fase Z do Kanban Y".

**Architecture:** 5 tabelas novas (`kanbans`, `kanban_phases`, `kanban_cards`, `kanban_card_responsibles`,
`kanban_card_comments`) com RLS espelhando fluxos/checklists; página própria do Kanban com dnd-kit
multi-container; coluna-resumo no board do projeto. W2 adiciona `kanban_automations` + `kanban_automation_runs`
e um trigger `SECURITY DEFINER` em `kanban_cards` que cria o card no destino no mesmo commit do movimento.

**Tech Stack:** Next.js 15 (App Router, Server Actions), Supabase (Postgres 17 + RLS + Realtime),
@dnd-kit/core + sortable, Tailwind v4. Testes: smoke psycopg2 (transação + rollback) e Playwright (Python).

**Spec:** `docs/specs/2026-09-27-kanban-e-automacoes.md`

---

## Mapa de arquivos

| Arquivo | Entrega | Responsabilidade |
|---|---|---|
| `supabase/migrations/20260927000000_kanbans.sql` | W1 | tabelas, FKs, helpers, RLS, triggers, realtime, enum |
| `packages/db/src/domain.ts` + `packages/db/src/database.types.ts` | W1 | `EntityType` += `kanban`, `kanban_card` |
| `apps/web/src/lib/types.ts` | W1/W2 | `Kanban*Row` |
| `apps/web/src/lib/audit-format.ts` | W1 | rótulos PT + caminho do Kanban + ação `move` |
| `apps/web/src/lib/actions/kanbans.ts` | W1 | server actions do Kanban/fases/cards/responsáveis/comentários |
| `apps/web/src/lib/actions/checklists.ts` | W1 | `reorderBoard` aceita coluna `kanban`; ordem nova conta Kanbans |
| `apps/web/src/app/app/[workspace]/[directory]/[project]/page.tsx` | W1 | carrega Kanbans + resumo; botão; realtime |
| `.../[project]/flows-board.tsx` | W1 | coluna `kanban` no board (resumo por fase, link) |
| `.../[project]/create-kanban-button.tsx` | W1 | modal de criação com fases padrão |
| `.../[project]/kanban/[kanban]/page.tsx` + `loading.tsx` | W1 | página do Kanban (server) |
| `.../[project]/kanban/[kanban]/kanban-board.tsx` | W1 | quadro dnd, fases, novo card |
| `.../[project]/kanban/[kanban]/kanban-card-modal.tsx` | W1 | modal do card + comentários |
| `.../[project]/kanban/[kanban]/kanban-header-actions.tsx` | W1 | editar/excluir Kanban |
| `scripts/smoke_kanban.py` | W1 | RLS + integridade (positivo/negativo, rollback) |
| `supabase/migrations/20260927010000_kanban_automations.sql` | W2 | tabelas, trigger de disparo, RLS |
| `apps/web/src/lib/actions/kanban-automations.ts` | W2 | criar/pausar/excluir automação |
| `.../[project]/kanban/[kanban]/kanban-automations-panel.tsx` | W2 | painel + aviso sem Kanban |
| `scripts/smoke_kanban_automations.py` | W2 | disparo, idempotência, laço, workspace |

## W1 — Kanban

### Task 1: Migration W1
- [ ] Escrever `20260927000000_kanbans.sql` (idempotente: `if not exists`, `drop policy if exists`,
  `create or replace`). Conteúdo: enum `entity_type` += `kanban`,`kanban_card`; 5 tabelas com checks de tamanho;
  `kanban_phases unique(id, kanban_id)`; FK composta `kanban_cards(phase_id, kanban_id) → kanban_phases(id,
  kanban_id)` (NO ACTION = bloqueia apagar fase com card); triggers `tg_updated_at` + imutabilidade
  (`kanbans.project_id/created_by`, `kanban_phases.kanban_id`, `kanban_cards.kanban_id/created_by`,
  `kanban_card_comments.card_id/author_id`); helpers `workspace_of_kanban`, `workspace_of_kanban_card`,
  `kanban_of_card`, `can_edit_kanban`, `is_kanban_card_responsible`; políticas `kb_*`, `kbp_*`, `kbc_*`, `kcr_*`,
  `kcc_*` conforme a tabela de permissões da spec §2.4; publication `supabase_realtime` nas 5 tabelas.
- [ ] Escrever `scripts/smoke_kanban.py` (psycopg2, 1 transação, `rollback()` no fim; usuários fake em
  `auth.users`; impersonar com `set local role authenticated` + `set_config('request.jwt.claims', …, true)`).
  Casos: admin cria Kanban/fases/cards (PASS); diretor não-dono não edita (bloqueado); diretor dono edita;
  diretor responsável do projeto edita; membro não cria/move (bloqueado); membro responsável do card move e
  comenta; card não vai pra fase de outro Kanban (erro FK); fase com card não é apagada (erro); apagar Kanban
  com cards funciona (cascade); diretor não exclui Kanban; membro de outro workspace não lê nada.
- [ ] Aplicar a migration no banco (pooler aws-1, psycopg2) e rodar o smoke → **N/N PASS**.
- [ ] Commit: `feat(kanban): tabelas, RLS e realtime do Kanban`.

### Task 2: Tipos e auditoria
- [ ] `domain.ts`/`database.types.ts`: `EntityType` += `"kanban" | "kanban_card"`.
- [ ] `types.ts`: `KanbanRow`, `KanbanPhaseRow`, `KanbanCardRow`, `KanbanCardResponsibleRow`,
  `KanbanCardCommentRow`.
- [ ] `audit-format.ts`: `ENTITY_PT` (`kanban: "kanban"`, `kanban_card: "card"`), `ACTION_PT.move = "moveu"`,
  `buildPath` com `kanban_name`.

### Task 3: Server actions `lib/actions/kanbans.ts`
Padrão do repo: `"use server"`, `getDb()`, `resolveProject()`, casts `as unknown as`, `ActionResult`,
`audit()` em toda mutação, `revalidatePath` do projeto e do Kanban.
- [ ] `createKanban({workspaceSlug, directorySlug, projectId, name, description, phases[]})` → `{kanbanId}`
  (order_index = max(fluxos, checklists, kanbans)+1; fases em lote; rollback se falhar).
- [ ] `updateKanban`, `deleteKanban`.
- [ ] `addKanbanPhase`, `renameKanbanPhase`, `moveKanbanPhase(direction)`, `deleteKanbanPhase` (bloqueia com
  card ou se for a última fase).
- [ ] `createKanbanCard` (1ª fase, topo), `updateKanbanCard`, `moveKanbanCard({cardId, phaseId, position})`,
  `deleteKanbanCard`.
- [ ] `setKanbanCardResponsibles({cardId, userIds[]})` (diff), `addKanbanCardComment`, `deleteKanbanCardComment`.
- [ ] `checklists.ts`: `reorderBoard` com `{type:"kanban", id}`; `createChecklist` conta Kanbans no próximo
  order_index.

### Task 4: Board do projeto
- [ ] `page.tsx`: carregar `kanbans`, `kanban_phases`, contagem de cards por fase; botão `CreateKanbanButton`;
  estado vazio considera Kanbans; realtime `kanbans/kanban_phases/kanban_cards`.
- [ ] `flows-board.tsx`: `Column` ganha `kind:"kanban"`; `SortableKanbanColumn` (selo Kanban, fases com
  contagem, última com ✓, link "Abrir Kanban"); payload do `reorderBoard`.
- [ ] `create-kanban-button.tsx`: modal nome/descrição/fases (padrão A fazer, Fazendo, Concluído).

### Task 5: Página do Kanban
- [ ] `kanban/[kanban]/page.tsx`: contexto, visibilidade de diretoria, dados em lote, permissões
  (`canEditKanban`, `canDeleteKanban`, `canComment`), `RealtimeWatcher`, `?card=<id>` abre o modal.
- [ ] `kanban-board.tsx`: `DndContext` (Mouse distância 6, Touch delay 200/tolerância 8, teclado),
  `closestCorners`, colunas `useDroppable` + `SortableContext` vertical, `DragOverlay`; `onDragOver` troca de
  coluna no estado local; `onDragEnd` calcula `position` (meio dos vizinhos; topo = menor−1024; fim =
  maior+1024) e chama `moveKanbanCard`; erro → volta ao estado do servidor. Menu da fase (renomear, ←, →,
  excluir), "+ Nova fase", "+ Novo card" na 1ª fase, última fase verde.
- [ ] `kanban-card-modal.tsx`: título, fase (select = mover), descrição, vencimento, tags (`TagSelect`),
  responsáveis (chips + select), comentários, excluir.
- [ ] `kanban-header-actions.tsx`: editar nome/descrição, excluir (admin).

### Task 6: Validar W1 local
- [ ] `pnpm --filter @fabd-fluxos/web build` sem erro.
- [ ] Fixture de teste oculta (workspace `teste-kanban-claude`, `is_discoverable=false`, usuários admin e membro
  via Admin API) + cookie de sessão gerado pelo `@supabase/ssr` (nada de bypass no código).
- [ ] Playwright (Python) em contexto limpo: criar Kanban → abrir → criar card → arrastar pra "Fazendo" →
  recarregar e conferir → nova fase/renomear/excluir vazia → bloqueio de excluir fase com card → modal
  (descrição, data, responsável, comentário) → membro não vê botões de edição. Prints conferidos com `Read`.

### Task 7: Staging + produção W1
- [ ] Check anti-sobrescrita isolado; commit só dos arquivos; push; PR.
- [ ] Preview Vercel com env só do deploy (`vercel deploy --build-env/--env`) → Playwright no preview + prints.
- [ ] Check de novo → `gh pr merge --squash --delete-branch` → esperar deploy Production Ready e o run de
  release + bump → Playwright em `fluxos.fabd.com.br` (workspace de teste) + prints.

## W2 — Automação

### Task 8: Migration W2 + smoke
- [ ] `20260927010000_kanban_automations.sql`: `kanban_automations` (FKs compostas fase↔Kanban cascade, `check
  source<>target`, `unique(source_phase_id, target_phase_id)`, trigger mesmo workspace), `kanban_automation_runs`
  (PK automation+card), colunas `source_card_id`/`created_by_automation_id` em `kanban_cards`, função
  `tg_kanban_card_automations()` (`SECURITY DEFINER`, `search_path=public`, sai se `pg_trigger_depth() > 3`,
  `insert … on conflict do nothing` no run, card no topo da fase destino, `audit_log` se `auth.uid()`), trigger
  `after insert or update of phase_id`, RLS (`ka_*`, `kar_select`), revoke execute da função, realtime.
- [ ] `scripts/smoke_kanban_automations.py`: mover dispara e copia dados; voltar e entrar não duplica; criar
  direto na fase X dispara; laço A→B→A para (3 saltos); destino de outro workspace recusado; membro não cria
  automação; diretor dono do Kanban de origem cria; pausada não dispara; excluir fase destino remove a regra.
- [ ] Aplicar + smoke N/N PASS + commit.

### Task 9: UI W2
- [ ] `types.ts`: `KanbanAutomationRow`, `KanbanAutomationRunRow`; `KanbanCardRow` += `source_card_id`,
  `created_by_automation_id`.
- [ ] `kanban-automations.ts`: `createKanbanAutomation`, `setKanbanAutomationActive`, `deleteKanbanAutomation`
  (audit `kanban` update).
- [ ] `page.tsx` do Kanban: automações do Kanban, opções de destino (Kanbans das diretorias visíveis, menos o
  próprio, agrupados Diretoria › Projeto, com fases), runs e cards de origem pro "Veio de"/"Gerou".
- [ ] `kanban-automations-panel.tsx`: lista em frase, ativa/pausada, excluir, formulário com 3 selects, aviso
  quando não há outro Kanban.
- [ ] `kanban-card-modal.tsx`: blocos "Veio de" / "Gerou" / "Criado por automação"; `kanban-board.tsx`: selo.

### Task 10: Validar W2 + staging + produção
- [ ] Build; Playwright: aviso sem Kanban → criar Kanban no Marketing → criar regra → mover card → card
  aparece no Marketing com "Veio de" → voltar/entrar não duplica. Prints conferidos.
- [ ] Mesma esteira da Task 7 (preview + prod + prints), 1 PR por vez.

## Fechamento
- [ ] Apagar a fixture de teste (workspace + usuários) depois da validação em produção.
- [ ] Memória (`Projeto fabd-fluxos.md`, `MEMORY.md`), `claude-orfaos.sh`, relatório com prints.
