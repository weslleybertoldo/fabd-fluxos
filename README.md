# FABD Fluxos

App de gestao de demandas/processos para federacoes desportivas — comecando pela FABD (Federacao Alagoana de Badminton).

## Stack
- **Web/PWA:** Next.js 16 + App Router + Tailwind v4 + shadcn/ui
- **Mobile:** Capacitor (Android)
- **Desktop:** Electron (Windows)
- **Backend:** Supabase (Postgres + Auth Google + Storage + Realtime)
- **Deploy:** Vercel

## Estrutura

```
fabd-fluxos/
├── apps/web/        # Next.js 16 PWA
├── apps/mobile/     # Capacitor wrapper
├── apps/desktop/    # Electron wrapper
├── packages/db/     # Supabase client + tipos
└── packages/ui/     # shadcn components compartilhados
```

## Hierarquia funcional

```
Workspace (FABD)
  └── Diretoria (Marketing, Financeira, Tecnica, Relacoes Exteriores, Geral)
        └── Projeto (1a Etapa Campeonato Alagoano)
              └── Fluxo (Pre e pos torneio | Pendencias gerais)
                    └── Fase (datas, campos, checkboxes, anexos, comentarios)
```

## Status
Em desenvolvimento — Fase 0 (setup externo) em andamento.

## Plano por fases
Ver `docs/PLAN.md` para roteiro completo de 10 fases.
