# FABD Fluxos — Plano de Execucao

App de gestao de demandas/processos para federacoes desportivas.

## Hierarquia funcional

```
Workspace (FABD)
  Workspace_members (admin / diretor / membro) — admin libera acesso
  └── Diretoria (Marketing | Financeira | Tecnica | Relacoes Exteriores | Geral)
        └── Projeto (com responsavel — recebe notif de TODAS as fases)
              └── Fluxo (continuous=cronograma | non_continuous=sem ordem)
                    └── Fase (com responsaveis, due_date, fields, checkboxes, attachments)
                          └── Comentarios (NATIVOS do fluxo, persistem por todas as fases)
                          └── Audit_log (toda mudanca registrada com data/hora/quem/o que)
```

## Permissoes

| Papel | Workspace | Diretoria | Projeto | Fluxo | Fase | Comentar |
|---|---|---|---|---|---|---|
| **admin** | gerencia tudo | cria/edita/exclui | cria/edita/exclui qualquer | cria/edita/exclui qualquer | cria/edita/exclui qualquer | sim |
| **diretor** | só visualiza | só visualiza | cria/edita os que CRIOU | cria/edita os que CRIOU | edita das fases dos seus fluxos | sim em qualquer |
| **membro** | só visualiza | só visualiza | só visualiza | só visualiza, preenche campos | preenche campos | sim em qualquer |

Todo membro pode preencher `phase_field_values` e fazer upload de anexo.

## Stack

- **Web/PWA:** Next.js 16 + App Router + Tailwind v4 + shadcn/ui
- **Mobile:** Capacitor (Android, iOS futuro)
- **Desktop:** Electron (Windows com auto-updater)
- **Backend:** Supabase (Auth Google, Postgres, Storage privado, Realtime)
- **UI extras:** Iconify (icones SVG), TipTap (comentarios ricos opcional), dnd-kit (drag-drop), date-fns
- **Estado servidor:** TanStack Query v5
- **Notificacoes:** Web Push API + Resend (email) + Capacitor Local Notifications
- **Deploy web:** Vercel (conta pessoal weslleybertoldo)
- **DNS:** Cloudflare (zone fabd.com.br) → `fluxos.fabd.com.br`

## Plano por fases

### ✅ Fase 0 — Setup externo
- [x] Repo GitHub `weslleybertoldo/fabd-fluxos` (privado)
- [x] Projeto Supabase `nexvflddmubtcizervda` (conta chicotripa180)
- [x] Senha Postgres setada `Bt8751bt,!1` + conexao validada
- [x] Projeto Vercel criado e ligado ao repo
- [x] Dominio `fluxos.fabd.com.br` adicionado no Vercel
- [ ] **DNS A record `fluxos → 76.76.21.21` no Cloudflare** ⛔ token CF inválido
- [ ] **OAuth Client novo no Google Cloud Project 351550866987** ⛔ user precisa criar
- [ ] Configurar Google provider em Supabase Auth
- [ ] Validar deploy do Hello World em https://fluxos.fabd.com.br

### Fase 1 — Schema DB + RLS + audit_log
- [x] `supabase/migrations/20260428000000_initial_schema.sql` desenhado (review do user pendente)
- [x] `supabase/migrations/20260428000001_storage.sql` desenhado
- [ ] Aplicar migrations no Supabase
- [ ] Validacao E2E: script Python com 20 cenarios (admin lê tudo, diretor só seus fluxos, membro só lê, audit_log registra tudo)

### Fase 2 — Scaffold Next 16 + Capacitor + Electron monorepo
- [ ] pnpm workspace ou turborepo
- [ ] `apps/web/` Next 16 App Router + Tailwind v4 + shadcn
- [ ] `apps/mobile/` Capacitor wrapper
- [ ] `apps/desktop/` Electron wrapper com auto-updater estilo FABD Planner
- [ ] `packages/db/` cliente Supabase + tipos gerados
- [ ] `packages/ui/` componentes shadcn compartilhados
- [ ] Auth Google funcionando nas 3 plataformas (deep link no Capacitor/Electron)
- [ ] Deploy preview Vercel automático no push

### Fase 3 — Workspaces + permissoes + audit log (CORE)
- [ ] Onboarding admin: criar workspace + cadastro automatico como admin
- [ ] Tela admin: lista usuarios pendentes → liberar (admin/diretor/membro)
- [ ] Componente `<MemberAvatar>` com foto Google + nome+sobrenome
- [ ] Funcao central `audit(action, entity, changes, context)` que escreve em `audit_log`
- [ ] Componente `<AuditLog flowId>` renderizando timeline com data/horario/quem/o que
- [ ] Validacao Playwright: 2 contas Google de teste, admin libera diretor, diretor cria fluxo, segundo diretor tenta editar (deve bloquear), comentário do segundo aparece, audit_log mostra tudo

### Fase 4 — Diretorias + Projetos
- [ ] CRUD diretorias (admin)
- [ ] CRUD projetos (admin/diretor)
- [ ] Listar projetos por diretoria com contadores
- [ ] Mover projeto entre diretorias (admin)
- [ ] Validacao E2E: criar 5 diretorias seed, mover projeto, ver no historico

### Fase 5 — Fluxos + fases (visual vertical reordenando)
- [ ] CRUD fluxos com tipo continuous/non_continuous
- [ ] CRUD fases com drag-drop manual (dnd-kit)
- [ ] CSS Grid auto-reordenando por `due_date` (ganha do manual quando setada)
- [ ] Fases mesma data → renderizam lado a lado (mesma row do Grid)
- [ ] Fluxos do mesmo projeto → colunas lado a lado com gap visual
- [ ] Fase verde quando `completed_at IS NOT NULL`
- [ ] Mensagem "Parabéns!" ao todas fases concluídas
- [ ] Validacao Playwright: criar fluxo com 6 fases, mudar datas, confirmar reordenacao, completar todas, ver mensagem

### Fase 6 — Campos, checkboxes, comentarios, tags, anexos
- [ ] CRUD campos com mode=fixed/mobile (mobile passa pra próxima ao concluir)
- [ ] CRUD checkboxes
- [ ] Comentarios nativos do fluxo com auto-link (regex URL → `<a target=_blank>`)
- [ ] Tags reutilizaveis no workspace + tag picker no fluxo
- [ ] Upload anexos pro Supabase Storage privado com signed URL
- [ ] Validacao Playwright: preencher campos, concluir fase, ver campo móvel na proxima, upload PDF, abrir, comentário com link clicavel

### Fase 7 — Listas e lembretes
- [ ] CRUD `simple_lists` + `simple_list_items`
- [ ] CRUD `reminders` com due_date
- [ ] Validacao E2E: projeto com 1 fluxo + 1 lista + 1 lembrete

### Fase 8 — Notificacoes
- [ ] Web Push setup + service worker (PWA + Electron)
- [ ] Email via Resend (fallback / preferencia user)
- [ ] Capacitor Push (Android)
- [ ] Vercel Cron horario varrendo `phases.due_date` próximas
- [ ] Notificar responsaveis fase + responsaveis projeto
- [ ] Validacao: criar fase com due_date = now+1min, esperar, confirmar notificacao

### Fase 9 — Realtime + conflitos
- [ ] Subscribe canal por `project_id`
- [ ] Mudanca remota → invalida cache TanStack + toast "X atualizou Y"
- [ ] Lock soft em comentário longo: "X está editando agora"
- [ ] Validacao: 2 abas, 2 contas, edicao simultanea, sem perda de dados

### Fase 10 — Empacotamento + auditoria final
- [ ] PWA manifest + service worker (cache offline básico)
- [ ] Capacitor APK assinado
- [ ] Electron .exe Windows com auto-updater (estilo FABD Planner)
- [ ] Auditoria de seguranca (6 vetores do CLAUDE.md: funcional E2E, estatica, schema, type check, build, ultra review)
- [ ] Validacao: instalar APK + .exe + PWA, login funciona nos 3, dados sincronizam via Realtime

## Decisoes arquiteturais

1. **Audit log via aplicacao (não trigger)** — melhor controle de contexto (user_id, IP, link, etc)
2. **Realtime + last-write-wins com toast** — start simples; TipTap+Yjs só se conflitos virarem problema real
3. **OAuth: projeto Google Cloud reaproveitado, Client ID novo dedicado** — consent screen mostra "FABD Workflow"
4. **Subdominio fluxos.fabd.com.br** — Capacitor/Electron usam deep link pra voltar do OAuth callback
5. **Drag-drop: dnd-kit** — react-beautiful-dnd está morto
6. **Auto-link em comentário: regex** — TipTap rich-text só se demanda
7. **Diretor edita só seus fluxos** — `can_edit_flow()` checa created_by
8. **Membros podem preencher campos e comentar** — interatividade mas sem editar estrutura
9. **Storage bucket privado + path por workspace** — RLS via path parsing
10. **Notificacoes triplas (Web Push + Email + Capacitor)** — usuario escolhe canal preferido
