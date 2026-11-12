#!/usr/bin/env bash
# Instala o ARGOS num servidor Ubuntu 22.04/24.04: Docker, HTTPS automático (Caddy), backup diário.
# Uso, no servidor, dentro da pasta do projeto:   sudo bash deploy/instalar.sh
# Antes: o DNS do domínio (e do www) precisa apontar para o IP deste servidor. Guia: docs/publicar-no-ar.md
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mErro: %s\033[0m\n' "$*" >&2; exit 1; }
ask() { local answer; read -rp "$1" answer; printf '%s' "${answer:-${2:-}}"; }

[ "$(id -u)" -eq 0 ] || fail "rode com sudo: sudo bash deploy/instalar.sh"
[ -f ../Dockerfile ] || fail "rode a partir da pasta do projeto ARGOS (onde está o Dockerfile)."

# 1. Docker -------------------------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  say "Instalando Docker e Docker Compose"
  apt-get update
  apt-get install -y docker.io docker-compose-v2 openssl ||
    fail "não foi possível instalar o Docker pelo apt. Siga https://docs.docker.com/engine/install/ubuntu/ e rode de novo."
  systemctl enable --now docker
fi

# 2. Memória: o build da web usa ~1,5 GB. Em servidor de 1 GB, cria 2 GB de swap. ------------------------
mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
if [ "$mem_kb" -lt 2000000 ] && [ -z "$(swapon --show --noheadings)" ]; then
  say "Criando 2 GB de swap (servidor com pouca memória)"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# 3. Configuração (só na primeira vez) ----------------------------------------------------------------
admin_pass=''
if [ ! -f .env ]; then
  say "Configuração do ARGOS (fica em deploy/.env, legível só pelo root)"
  domain=$(ask "Domínio do site, sem https:// (ex.: argos.com.br): ")
  domain=${domain#http://}; domain=${domain#https://}; domain=${domain%/}
  [[ "$domain" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] || fail "domínio inválido: '$domain' (use letras minúsculas, ex.: argos.com.br)."
  admin_email=$(ask "Seu e-mail (administrador do ARGOS): ")
  [[ "$admin_email" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || fail "e-mail inválido."
  echo
  echo "E-mail de envio (confirmação de cadastro e senha esquecida). Gmail: use uma senha de app."
  smtp_host=$(ask "Servidor SMTP [smtp.gmail.com]: " smtp.gmail.com)
  smtp_port=$(ask "Porta SMTP [587]: " 587)
  smtp_user=$(ask "Usuário SMTP (o e-mail que envia): ")
  read -rsp "Senha SMTP (não aparece na tela): " smtp_pass; echo
  [ -n "$smtp_user" ] && [ -n "$smtp_pass" ] || fail "usuário e senha SMTP são obrigatórios."
  support_email=$(ask "E-mail público de atendimento (Enter para não mostrar): ")
  for value in "$domain" "$admin_email" "$smtp_host" "$smtp_port" "$smtp_user" "$smtp_pass" "$support_email"; do
    [[ "$value" != *"'"* ]] || fail "os valores não podem conter aspas simples (')."
  done

  jwt_secret=$(openssl rand -base64 48 | tr -d '\n')
  # Senha forte para o primeiro acesso (12+ caracteres, 3 tipos, sem palavras óbvias).
  while :; do
    admin_pass="$(openssl rand -base64 24 | tr -d '/+=\n' | cut -c1-20)Ar7#"
    echo "$admin_pass" | grep -qiE 'argos|admin|senha|password' || break
  done

  umask 077
  cat > .env <<ENV
# Gerado por deploy/instalar.sh em $(date -u +%Y-%m-%dT%H:%MZ). Não versione este arquivo.
ARGOS_DOMAIN='$domain'
JWT_SECRET='$jwt_secret'
ADMIN_EMAIL='$admin_email'
ADMIN_PASSWORD='$admin_pass'
SMTP_HOST='$smtp_host'
SMTP_PORT='$smtp_port'
SMTP_USER='$smtp_user'
SMTP_PASS='$smtp_pass'
MAIL_FROM='ARGOS <$smtp_user>'
SUPPORT_EMAIL='$support_email'
BACKUP_KEEP='14'
ENV
  umask 022
fi
chmod 600 .env

# 4. Pasta dos backups (o contêiner roda como usuário 1000, sem root) -----------------------------------
mkdir -p backups
chown 1000:1000 backups
chmod 700 backups

# 5. Firewall: se o ufw estiver ativo, libera SSH, HTTP e HTTPS (não liga o ufw sozinho). ----------------
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
  ufw allow OpenSSH >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 443/udp >/dev/null
fi

# 6. Build e início -----------------------------------------------------------------------------------
say "Gerando a imagem e iniciando (a primeira vez leva alguns minutos)"
docker compose up -d --build

say "Aguardando a API ficar pronta"
ready=''
for _ in $(seq 1 60); do
  if docker compose exec -T argos node -e "fetch('http://127.0.0.1:3333/health/ready').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    ready=yes
    break
  fi
  sleep 5
done
[ -n "$ready" ] || fail "a API não respondeu. Veja o motivo com: cd deploy && docker compose logs argos"

# A senha inicial só serve para criar o administrador: depois do primeiro boot sai do arquivo.
sed -i '/^ADMIN_PASSWORD=/d' .env

domain=$(sed -n "s/^ARGOS_DOMAIN='\(.*\)'$/\1/p" .env)
say "ARGOS no ar: https://$domain"
echo "O certificado HTTPS é emitido no primeiro acesso (pode levar até 1 minuto)."
if [ -n "$admin_pass" ]; then
  echo
  echo "Primeiro acesso do administrador (anote; esta senha não será mostrada de novo):"
  echo "  e-mail: $(sed -n "s/^ADMIN_EMAIL='\(.*\)'$/\1/p" .env)"
  echo "  senha:  $admin_pass"
  echo "Troque a senha em Configurações > Segurança logo depois de entrar."
fi
echo
echo "Próximos passos: Administração > \"Testar e-mail\"; copiar deploy/backups para fora do servidor (docs/publicar-no-ar.md)."
