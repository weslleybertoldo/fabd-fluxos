#!/usr/bin/env bash
# Procura termos proibidos no repositório: arquivos versionados, nomes de
# arquivo, mensagens de commit novas e, num PR, o título e a descrição.
#
# PADRAO (obrigatório): regex estendida, sem diferenciar maiúscula. Escreva
# cada termo com colchetes (ex.: a[b]c) pra este arquivo e o workflow não
# casarem consigo mesmos.
# EVENTO: pull_request | push | outro (padrão: local). No pull_request usa
# PR_BASE, PR_HEAD, PR_TITULO e PR_CORPO; no push, PUSH_ANTES.
#
# Saída: 0 = nada encontrado · 1 = achou (as linhas aparecem no log) · 2 = erro.
set -uo pipefail

if [[ -z "${PADRAO:-}" ]]; then
  echo "::error::PADRAO não definido"
  exit 2
fi
EVENTO="${EVENTO:-local}"
tmp="$(mktemp -d)" || exit 2
trap 'rm -rf "$tmp"' EXIT
achou=0

# $1 = código de saída do grep · $2 = arquivo com os acertos · $3 = onde procurou
resultado() {
  case "$1" in
    0) achou=1
       echo "::error::Termo proibido em $3:"
       sed 's/^/  /' "$2" ;;
    1) echo "ok: $3" ;;
    *) echo "::error::Falha ao procurar em $3 (saída $1)"
       exit 2 ;;
  esac
}

# $1 = arquivo com o texto · $2 = onde procurou
confere() {
  local rc=0
  grep -n -i -E -e "$PADRAO" -- "$1" > "$tmp/acertos" || rc=$?
  resultado "$rc" "$tmp/acertos" "$2"
}

# 1) Arquivos versionados. Lockfiles ficam de fora: são hashes gerados, e um
#    hash pode conter as letras do termo por acaso.
rc=0
git grep -n -I -i -E -e "$PADRAO" -- . \
  ':(exclude,glob)**/package-lock.json' \
  ':(exclude,glob)**/pnpm-lock.yaml' \
  ':(exclude,glob)**/yarn.lock' \
  ':(exclude,glob)**/bun.lock' > "$tmp/arquivos" || rc=$?
resultado "$rc" "$tmp/arquivos" "arquivos versionados"

# 2) Nomes de arquivo
git ls-files > "$tmp/nomes" || { echo "::error::git ls-files falhou"; exit 2; }
confere "$tmp/nomes" "nomes de arquivo"

# 3) Mensagens de commit novas (o histórico antigo fica como está)
faixa=(-1 HEAD)
if [[ "$EVENTO" == "pull_request" ]]; then
  if [[ -z "${PR_BASE:-}" || -z "${PR_HEAD:-}" ]]; then
    echo "::error::PR_BASE e PR_HEAD são obrigatórios no pull_request"
    exit 2
  fi
  faixa=("$PR_BASE..$PR_HEAD")
elif [[ "$EVENTO" == "push" && -n "${PUSH_ANTES:-}" && ! "$PUSH_ANTES" =~ ^0+$ ]] \
     && git cat-file -e "${PUSH_ANTES}^{commit}" 2>/dev/null; then
  faixa=("$PUSH_ANTES..HEAD")
fi
git log --format='%h %s%n%b' "${faixa[@]}" > "$tmp/commits" \
  || { echo "::error::git log falhou"; exit 2; }
confere "$tmp/commits" "mensagens de commit"

# 4) Título e descrição do PR
if [[ "$EVENTO" == "pull_request" ]]; then
  printf '%s\n%s\n' "${PR_TITULO:-}" "${PR_CORPO:-}" > "$tmp/pr"
  confere "$tmp/pr" "título e descrição do PR"
fi

if (( achou )); then
  echo "::error::Achei termo proibido (linhas acima). Descreva o comportamento sem citar a origem."
  exit 1
fi
echo "Nenhum termo proibido."
