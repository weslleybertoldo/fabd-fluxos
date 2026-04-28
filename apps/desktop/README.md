# FABD Fluxos — Desktop (Electron)

Wrapper Windows do app web. Carrega `https://fluxos.fabd.com.br` (ou `localhost:3000` em dev) numa BrowserWindow.

## Dev

```sh
# da raiz do monorepo
pnpm desktop:dev
```

Antes, garantir que `pnpm dev` (web) esta rodando em outro terminal.

## Build instalador (Windows)

```sh
pnpm desktop:build
```

Saida: `apps/desktop/dist/FABD Fluxos Setup *.exe`

## Auto-updater

`electron-updater` checa `github.com/weslleybertoldo/fabd-fluxos/releases` no startup. Pra publicar release nova:

1. Bumpar `version` em `apps/desktop/package.json`
2. `pnpm desktop:build:publish` (precisa `GH_TOKEN` env var com scope `repo`)

O instalador bundled vai consumir o release automaticamente em todos os clients.
