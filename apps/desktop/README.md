# @fabd-fluxos/desktop — Electron Windows wrapper

App desktop Windows que carrega https://fluxos.fabd.com.br via Electron BrowserWindow. Auto-updater via GitHub Releases.

## Estrutura

- `main.js` — processo principal Electron (window + menu + auto-updater)
- `preload.js` — contextIsolation bridge (vazio por enquanto)
- `assets/icon.ico` — ícone gerado via Pillow (gradient FABD + texto FF)
- `dist/` — output do electron-builder (gitignore)

## Build do .exe

### Build local (sem publicar no GitHub)
```bash
pnpm desktop:build
```
Saída: `apps/desktop/dist/FABD Fluxos Setup 0.1.0.exe` (~82 MB, NSIS instalador). Copia esse arquivo pra distribuir manualmente.

### Build + publish no GitHub Releases (ativa auto-updater)
Precisa env var `GH_TOKEN` com scope `repo`:
```bash
GH_TOKEN=ghp_xxx pnpm desktop:build:publish
```
electron-builder cria release `v0.1.0` no `weslleybertoldo/fabd-fluxos` com o instalador + `latest.yml` que o auto-updater lê.

## Auto-update
1. Bump `version` em `apps/desktop/package.json` (ex: 0.1.0 → 0.2.0)
2. `pnpm desktop:build:publish` cria release nova
3. Apps instalados detectam via `latest.yml` em release+startup, baixam e instalam silenciosamente
4. Menu **Ajuda → Verificar atualizações** força check manual

## Code signing
Builds atuais não têm certificado. Windows mostra aviso "Editor desconhecido" no SmartScreen. Pra remover:
1. Comprar certificado EV (~US$ 200/ano) ou OV (~US$ 75/ano) em CA como SSL.com, DigiCert
2. Setar env vars `CSC_LINK` (path .pfx) e `CSC_KEY_PASSWORD`
3. Re-rodar `pnpm desktop:build`
4. SmartScreen aceita após reputation building (~30 dias).

## Dev (rodar Electron apontando pra localhost:3000)
```bash
pnpm desktop:dev
```
Carrega web em `http://localhost:3000` (precisa `pnpm dev` rodando em paralelo).
