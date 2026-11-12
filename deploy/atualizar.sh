#!/usr/bin/env bash
# Atualiza o ARGOS no servidor: backup verificado, código novo, nova imagem e conferência da saúde.
# Uso, no servidor, dentro da pasta do projeto:   sudo bash deploy/atualizar.sh
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mErro: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "rode com sudo: sudo bash deploy/atualizar.sh"
[ -f .env ] || fail "deploy/.env não existe. Para a primeira instalação use: sudo bash deploy/instalar.sh"

keep=$(sed -n "s/^BACKUP_KEEP='\{0,1\}\([0-9][0-9]*\)'\{0,1\}$/\1/p" .env)
say "Backup antes de atualizar"
docker compose exec -T backup node dist/ops/backup-cli.js backup --out /backups --keep "${keep:-14}" ||
  fail "o backup falhou; nada foi alterado. Veja: docker compose logs backup"

if [ -d ../.git ]; then
  say "Baixando a versão nova do código"
  git -C .. pull --ff-only || fail "git pull falhou (alterações locais?). Resolva e rode de novo."
fi

say "Gerando a imagem nova e reiniciando (as migrações do banco rodam sozinhas, com cópia prévia)"
docker compose up -d --build

for _ in $(seq 1 60); do
  if docker compose exec -T argos node -e "fetch('http://127.0.0.1:3333/health/ready').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    say "Atualizado. Versão do banco: $(docker compose exec -T argos node -e "fetch('http://127.0.0.1:3333/health/ready').then((r)=>r.json()).then((b)=>console.log(b.schemaVersion))")"
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 5
done
fail "a API não ficou pronta. Veja: docker compose logs argos  (para voltar: docs/publicar-no-ar.md, seção Problemas)"
