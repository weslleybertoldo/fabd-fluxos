# Spec — Kanban (estilo Pipefy) + automações entre Kanbans

- **Data:** 27/09/2026
- **Pedido do Weslley:** "Na parte dos fluxos vamos adicionar o modelo Kanban. E automações, ex: quando o card
  chegar na fase 2 é criado um card no kanban do marketing (…) na automação precisaria escolher os Kanbans da
  automação (igual o pipefy) e poderia ter Kanban e fluxos no mesmo projeto. O modelo de Kanban é igual o pipefy,
  cria um card e vai movendo entre as fases, podendo criar mais ou menos fases."
- **Regra da automação (fechada com ele):** "quando entrar na fase X caia na área Z no Kanban Y (se não tiver
  Kanban criado aparecerá uma observação de que não tem Kanban e precisa criar para criar a automação)". A regra
  vale só pro Kanban; entrar na última fase = concluído.
- **Execução:** até produção sem gates humanos (`Skill-wbs-local-stg-prod-ate-o-fim`), em 2 entregas:
  **W1 Kanban** e **W2 Automação**.

## 1. Onde fica

- O Kanban mora dentro do **Projeto**, ao lado dos fluxos e das checklists (hierarquia:
  Workspace › Diretoria › Projeto › {Fluxo | Checklist | Kanban}).
- No board do projeto, cada Kanban vira **uma coluna** (mesma largura das outras), com o nome, o selo "Kanban"
  e o resumo por fase ("A fazer 3", "Fazendo 1"…). Admin reordena arrastando, igual aos fluxos.
- Clicar no nome abre a **página do Kanban** (`/app/<ws>/<dir>/<projeto>/kanban/<id>`) com o quadro inteiro.
- Kanban não tem status: aparece nas abas Ativos/Arquivados/Concluídos do projeto, igual às checklists hoje.
- Botão **"+ Criar Kanban"** ao lado de "+ Criar checklist" e "+ Criar fluxo" (mesma regra: admin ou diretor,
  projeto ativo).

## 2. Kanban (W1)

### 2.1 Criar
- Modal com **nome** (obrigatório, até 200), **descrição** (opcional, até 2000) e a lista de **fases**, que já vem
  com 3: "A fazer", "Fazendo", "Concluído". Dá pra renomear, tirar e pôr fases antes de criar (mín. 1, máx. 30).

### 2.2 Fases (colunas)
- **Adicionar fase** ("+ Nova fase" no fim do quadro), **renomear** e **mover pra esquerda/direita** pelo menu da
  fase (setas; funciona igual no celular).
- **Excluir fase:** só se estiver **vazia** — com card, a mensagem pede pra mover os cards antes (igual Pipefy).
  O Kanban sempre fica com pelo menos 1 fase.
- A **última fase** é a de concluído: cards nela ficam verdes, com ✓, e não aparecem como vencidos.

### 2.3 Cards
- **"+ Novo card"** fica na **primeira fase** (igual Pipefy). O card novo entra no topo.
- Campos do card: **título** (obrigatório, até 300), **descrição** (até 5000), **data de vencimento**,
  **responsáveis** (membros ativos do workspace) e **tags** (as tags do workspace, geridas em Ações; até 20).
- **Mover:** arrastar o card entre as fases (e reordenar na mesma fase). No modal do card há também o campo
  **"Fase"** pra mover sem arrastar (celular).
- **Comentários** no modal do card (lista + novo comentário; autor edita/apaga o seu, admin apaga qualquer um).
- Card no quadro mostra: título, data (vermelha se vencida e fora da última fase), barras das tags, avatares dos
  responsáveis, nº de comentários e "!" quando tem descrição.
- **Excluir card:** quem edita o Kanban (confirmação). Diferente do fluxo (lá só admin exclui), porque o card é a
  unidade do dia a dia: o diretor dono do Kanban precisa conseguir limpar card errado.

### 2.4 Permissões (espelham fluxos/checklists — dupla camada UI + RLS)
| Ação | Quem |
|---|---|
| Ver Kanban e cards | qualquer membro ativo do workspace (visibilidade de diretoria continua na UI, como hoje) |
| Criar Kanban | admin ou diretor |
| Editar Kanban (nome, fases, automações) e criar/mover/excluir qualquer card | admin, diretor que criou o Kanban, diretor responsável do projeto |
| Mover e editar o conteúdo de um card | também os **responsáveis do card** (qualquer papel) |
| Comentar | admin, diretor, ou responsável do card |
| Excluir Kanban | só admin (igual fluxo) |

### 2.5 Dados (migration `20260927000000_kanbans.sql`)
- `kanbans` (id, project_id → projects cascade, name, description, order_index, created_by, timestamps).
- `kanban_phases` (id, kanban_id → kanbans cascade, name, position, timestamps; `unique(id, kanban_id)`).
- `kanban_cards` (id, kanban_id → kanbans cascade, phase_id, title, description, due_date, tags text[],
  position double precision, created_by, timestamps). FK composta `(phase_id, kanban_id) → kanban_phases(id,
  kanban_id)` garante que a fase é do mesmo Kanban e impede apagar fase com card (NO ACTION).
- `kanban_card_responsibles` (card_id, user_id, assigned_by, assigned_at; PK card+user).
- `kanban_card_comments` (id, card_id, author_id, content, timestamps). Excluir comentário apaga de vez.
- Triggers: `updated_at`; `project_id`/`kanban_id` imutáveis (não se move Kanban/fase/card de lugar pela API).
- Helpers: `workspace_of_kanban`, `workspace_of_kanban_card`, `can_edit_kanban`, `is_kanban_card_responsible`.
- `entity_type` ganha `kanban` e `kanban_card` (auditoria); `audit-format` traduz ("kanban", "card") e a ação
  `move` ("moveu").
- Realtime nas 5 tabelas (o quadro atualiza sozinho pra quem estiver olhando).
- Ordem no board do projeto: `order_index` no mesmo espaço de fluxos/checklists; `reorderBoard` aceita coluna
  `kanban`.
- Posição do card: `position` fracionária (meio entre os vizinhos) → mover = 1 update.

## 3. Automação (W2)

### 3.1 Regra
- **"Quando o card entrar na fase X (deste Kanban) → criar um card na fase Z do Kanban Y."**
- "Entrar" = o card foi **movido** pra X **ou criado** direto em X (inclusive por outra automação).
- O Kanban Y pode estar em **qualquer projeto/diretoria do mesmo workspace** que a pessoa enxerga (mesma regra
  de visibilidade de diretoria do app; admin vê todas) — ex.: Kanban do Marketing. Não pode ser o próprio Kanban
  de origem.
- O card novo leva **título, descrição, data e tags** do card de origem e guarda o vínculo com ele. Responsáveis e
  comentários não são copiados (é outra equipe).
- **Dispara uma vez por card por automação**: se o card sair de X e voltar, não cria outro.
- **Encadeamento** (Y também tem automação) vale até **3 saltos**; passou disso, para — protege contra laço
  A→B→A.
- Automação pode ser **pausada** (toggle) e **excluída**. Se a fase de origem/destino ou o Kanban de destino for
  excluído, a automação some junto.

### 3.2 Tela
- Na página do Kanban, botão **"Automações"** (com o nº de regras) abre o painel:
  - lista das regras em frase ("Quando entrar em **Fazendo** → criar card em **Marketing › Divulgação › Kanban
    Artes**, fase **A fazer**"), com Ativa/Pausada e Excluir;
  - **"+ Nova automação"**: escolher a fase de origem (deste Kanban), o **Kanban de destino** (lista agrupada por
    Diretoria › Projeto) e a **fase de destino**.
  - **Sem outro Kanban no workspace:** aviso "Não existe outro Kanban para receber o card. Crie o Kanban de
    destino (ex.: no projeto do Marketing) para criar a automação." e o formulário fica desabilitado.
- Quem vê o painel: todos; quem cria/pausa/exclui: quem edita o Kanban de origem.
- No modal do card:
  - card criado por automação mostra "Veio de: **Kanban A › Título do card**" (link abre o card de origem);
  - card de origem mostra "Gerou: **Kanban Y › fase Z**" (link abre o card criado);
  - se o card de origem for excluído, o card criado continua, só com "Criado por automação" (sem link).
- No quadro, card criado por automação ganha o selo "Automação".

### 3.3 Dados (migration `20260927010000_kanban_automations.sql`)
- `kanban_automations` (id, source_kanban_id, source_phase_id, target_kanban_id, target_phase_id, active,
  created_by, timestamps). FKs compostas fase↔Kanban com `on delete cascade`; `check (source <> target)`;
  `unique (source_phase_id, target_phase_id)`; trigger garante **mesmo workspace**.
- `kanban_automation_runs` (automation_id, source_card_id, created_card_id, created_at; PK automation+card) —
  o "dispara uma vez".
- `kanban_cards` ganha `source_card_id` e `created_by_automation_id` (on delete set null).
- Disparo: trigger `AFTER INSERT OR UPDATE OF phase_id` em `kanban_cards`, função `SECURITY DEFINER` (cria o card
  no Kanban de destino mesmo que quem moveu não tenha acesso a ele), limite por `pg_trigger_depth() > 3`, grava
  `audit_log` do card criado (só quando há usuário logado — `audit_log.user_id` é obrigatório). Atômico com o
  movimento: se a criação falhar, o movimento volta.
- RLS: ver = membro do workspace; criar/editar/excluir = `can_edit_kanban(source_kanban_id)`; `runs` só leitura.

## 4. Fora do escopo (follow-up)
- Anexos e campos personalizados no card; notificação para a equipe do Kanban de destino; aviso de vencimento do
  card (o cron de hoje só olha fases de fluxo); relatórios de Kanban; `clone_project` copiar Kanbans; outros
  gatilhos/ações de automação (mover card, atribuir responsável, e-mail).

## 4b. Fronteiras de execução
- ✅ Sozinho: código, migrations **aditivas** (só tabelas/tipos novos) aplicadas no banco único (é o de produção),
  testes com dados isolados num workspace de teste oculto (`is_discoverable = false`) apagado no fim.
- 🚫 Nunca: tocar nos workspaces reais (FABD, VIDA PESSOAL), commitar segredo ou bypass de login, subir versão
  que não contenha a `main` atual.

## 5. Critérios de pronto
- W1: criar Kanban com fases padrão; adicionar/renomear/mover/excluir fase (bloqueia com card); criar card na 1ª
  fase; arrastar entre fases e persistir; editar card (campos, responsáveis, tags, fase) e comentar; membro
  sem responsabilidade não edita (UI e banco); Kanban aparece e reordena no board do projeto.
- W2: regra criada com os seletores; mover card pra X cria card em Y/Z com os dados; voltar e entrar de novo não
  duplica; laço A→B→A para em 3 saltos; alvo de outro workspace é recusado; sem outro Kanban aparece o aviso;
  vínculos "Veio de"/"Gerou" aparecem e abrem o card.
- Os dois: `pnpm --filter @fabd-fluxos/web build` sem erro, smoke SQL (positivo e negativo, rollback) N/N PASS,
  Playwright logado com prints conferidos em local, staging (preview) e produção.
