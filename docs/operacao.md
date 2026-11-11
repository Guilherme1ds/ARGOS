# ARGOS — Operação de instância única

Este guia descreve como implantar e manter o ARGOS numa **única instância** (uma API Node.js + SQLite +
uploads em disco). Ele não cobre várias réplicas: para isso seria preciso banco compartilhado, object
storage e limites de requisição compartilhados, e essa mudança só deve ser feita com requisito de escala
confirmado (ver `docs/decisoes-de-produto.md`).

## 1. Topologia recomendada

```
navegador ──https──> proxy reverso (TLS, mesmo domínio)
                        ├── /            → arquivos estáticos do frontend (frontend/dist)
                        ├── /api, /uploads → API ARGOS (Node.js, porta interna 3333)
app Flutter ──https──> mesmo domínio /api/v1
```

- Web e API **no mesmo site** mantêm o cookie de renovação `SameSite=Lax` funcionando. Se for obrigatório usar
  domínios diferentes, configure `COOKIE_SAMESITE=none` (só com HTTPS) e liste a origem web em `CORS_ORIGINS`;
  valide login, recarga, refresh e logout num navegador real nos domínios de homologação antes de liberar.
- `TRUST_PROXY`: número de saltos até a API (normalmente `1`) ou os IPs/CIDRs do proxy. Com `1`, a API usa o
  endereço que o proxy anexou por último ao `X-Forwarded-For` e ignora o que o cliente enviou antes dele. A API
  **não pode** ficar acessível diretamente pela internet (sem o proxy, um cliente forjaria o cabeçalho).
- Disco persistente para `DATABASE_URL` (arquivo `.sqlite` + `-wal` + `-shm`) e `UPLOAD_DIR`. Contêiner sem volume
  persistente perde banco, imagens, sessões e a fila de e-mails a cada reinício.
- Não rode duas instâncias apontando para o mesmo arquivo SQLite.
- O passo a passo de instalação (build, variáveis, proxy, serviço, primeiro acesso e atualização) está na seção 8;
  o checklist de homologação no domínio real, na seção 7.

## 2. Configuração obrigatória em produção

O processo **não inicia** se faltar algo abaixo (a mensagem cita a variável, nunca o valor):

| Variável | Regra |
|---|---|
| `NODE_ENV` | `production` (ou `staging` para homologação) |
| `JWT_SECRET` | 32+ caracteres aleatórios (`openssl rand -base64 48`), fora do repositório |
| `ADMIN_PASSWORD` | só para criar o administrador inicial; 12+ caracteres, 3 tipos, sem "admin/argos/senha/password". Pode ser removida depois do primeiro boot |
| `JWT_EXPIRES_IN` / `REFRESH_TOKEN_EXPIRES_IN` | `<n><s|m|h|d>`; access de 1m a 24h, refresh de 1h a 90d |
| `FRONTEND_URL`, `API_PUBLIC_URL`, `CORS_ORIGINS` | https e domínio real; `CORS_ORIGINS` só com origens exatas |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | obrigatórios; conexão exige TLS (STARTTLS ou porta 465) |
| `TRUST_PROXY` | saltos ou IPs/CIDRs (`true` é recusado) |

Segredos ficam no cofre do provedor (variáveis de ambiente injetadas), nunca em arquivo versionado, log ou print.

## 3. Migrações de banco

- As migrações são numeradas em `backend/src/db/migrations.ts` e registradas na tabela `schema_migrations`.
  Cada uma roda uma única vez, dentro de transação; uma falha desfaz só aquela migração e o processo não sobe.
- Antes de aplicar migrações num banco existente, a API grava uma cópia consistente
  (`VACUUM INTO`) em `MIGRATION_BACKUP_DIR` (padrão: `backups/` ao lado do banco), por exemplo
  `argos-pre-migration-v0-to-v4-<data>.sqlite`.
- Código mais antigo que o banco **não inicia** ("versão de esquema mais nova"): isso impede rodar uma versão
  anterior por engano sobre um banco já migrado.
- `GET /health/ready` informa `schemaVersion`.

### Primeira atualização para esta versão (v0 → v4)

1. Faça um backup completo (seção 4) e confirme `verify` com `ok: true`.
2. Pare a API (uma instância só).
3. Publique o novo código e inicie. O log mostra a cópia prévia e as migrações 1 a 4.
4. Confira `GET /health/ready` (`schemaVersion: 4`) e faça login com uma conta de teste.

O que muda nos dados existentes:

- Corpos de e-mails já enviados são apagados; links de redefinição pendentes há mais de 1 hora viram `expired`.
- E-mails digitados em logins falhos e pedidos de acesso na auditoria viram pseudônimos (`email:<hash>`).
- Denúncias antigas (eventos `item.reported`) entram na nova fila como abertas.
- Pares de correspondência existentes são marcados como já notificados.
- Contas criadas por senha sem `email_verified_at` passam a ter de confirmar o e-mail no próximo login
  (avise os usuários antes do deploy).

### Rollback

- **Antes de qualquer gravação nova relevante:** pare a API, restaure a cópia `argos-pre-migration-*.sqlite`
  (ou o backup da seção 4) e volte ao código anterior.
- **Depois de uso real:** prefira corrigir para frente (nova migração). Restaurar a cópia prévia descarta os dados
  gravados depois dela.

## 4. Backup, verificação e restauração

Ferramenta: `backend/src/ops/backup-cli.ts` (compilada em `dist/ops/backup-cli.js`). Usa a API de backup online do
SQLite (cópia consistente com a API rodando, compatível com WAL), copia `UPLOAD_DIR` e grava `manifest.json` com hash
SHA-256, versão de esquema e contagens.

```bash
# backend/ com DATABASE_URL e UPLOAD_DIR do ambiente
node dist/ops/backup-cli.js backup --out /var/backups/argos --keep 14
node dist/ops/backup-cli.js verify /var/backups/argos/argos-backup-<data>
# restauração: API PARADA
node dist/ops/backup-cli.js restore /var/backups/argos/argos-backup-<data> --force
```

- `verify` confere o hash do banco, `PRAGMA integrity_check`, chaves estrangeiras, versão de esquema e se cada imagem
  referenciada por itens/perfis está no backup.
- `restore` só aceita backup válido. Sem `--force`, não sobrescreve nada; com `--force`, renomeia o estado atual para
  `*.before-restore-<data>` (dá para desfazer).
- Em desenvolvimento: `npm run backup -- --out ../backups`, `npm run backup:verify -- <dir>`, `npm run restore -- <dir>`.
- O teste automatizado (`backend/test/migrations.test.ts`) cria um banco WAL com imagens, faz backup com a base em uso,
  restaura em outro local e detecta adulteração e imagem ausente.

### Política sugerida (aprovar com a infraestrutura)

| Item | Proposta |
|---|---|
| Frequência | backup a cada 24 h + antes de cada deploy |
| Retenção | 14 diários (`--keep 14`) + 1 mensal por 12 meses |
| RPO / RTO | até 24 h de perda / restauração em até 2 h |
| Armazenamento | cópia fora do servidor, criptografada em repouso (ex.: bucket com SSE ou `age`/`gpg` antes do envio) |
| Teste de restore | mensal, em ambiente isolado, com `verify` + login + abertura de um item com foto |

Os backups contêm dados pessoais: aplique o mesmo controle de acesso do banco de produção.

## 5. Retenção e expurgo automáticos

Rodam a cada hora junto da limpeza de uploads (`backend/src/utils/retention.ts`). Valores padrão provisórios,
configuráveis e a serem aprovados pelo responsável pela privacidade:

| Dado | Regra padrão | Variável |
|---|---|---|
| Corpo de e-mails (links de confirmação/senha) | apagado ao enviar, falhar definitivamente ou expirar | — |
| Registro de e-mails processados (destinatário, assunto, status) | 30 dias | `MAIL_OUTBOX_RETENTION_DAYS` |
| Links de confirmação e de senha usados ou vencidos | 30 dias | `AUTH_TOKEN_RETENTION_DAYS` |
| Solicitações de acesso já avaliadas | 180 dias | `ACCESS_REQUEST_RETENTION_DAYS` |
| Auditoria | mantida (0) até haver prazo aprovado | `AUDIT_LOG_RETENTION_DAYS` |
| Refresh tokens vencidos | 1 dia após expirar | — |
| Uploads sem vínculo | 8 dias | — |
| Aceites e revogações do aviso de privacidade | mantidos como prova | — |

Na **exclusão de conta**: itens abertos, pistas, acompanhamentos, buscas salvas, notificações, inscrições push,
tokens, solicitações de acesso e e-mails do endereço são apagados; fotos sem uso são removidas do disco; mensagens e
provas das reivindicações em casos de terceiros são substituídas por "[removido: conta excluída]"; casos devolvidos,
trilha de auditoria (com e-mail pseudonimizado) e aceite/revogação permanecem sem identificação direta.

## 6. Monitoramento mínimo

- Liveness: `GET /health/live`; readiness: `GET /health/ready` (banco + versão de esquema).
- Alertas sugeridos: readiness ≠ 200; disco do volume > 80%; arquivo `-wal` crescendo sem checkpoint;
  `mail_outbox` com `status='failed'` ou pendentes antigos; taxa de respostas 5xx.
- Logs HTTP (morgan `combined`) não incluem corpo de requisição. Erros de envio de e-mail são registrados sem
  token nem endereço.
- Erros 500 respondem com `requestId`; a web mostra os 12 primeiros caracteres ("informe o código …") para a pessoa
  repassar ao suporte, que localiza a falha nos logs pelo mesmo identificador (`x-request-id`).

## 7. Checklist de homologação (não executado neste repositório)

Executar no domínio real, com a mesma configuração da produção e dados fictícios. Cada item tem o comando ou o
gesto que comprova o resultado; registre data, versão e quem executou.

- [ ] **HTTPS e cabeçalhos**: `curl -sSI https://<dominio>/` responde 200 com certificado válido;
      `curl -sS https://<dominio>/health/ready` mostra `"status":"ready"` e `schemaVersion` atual.
- [ ] **Sessão no navegador real** (Chrome e um segundo navegador): cadastro → e-mail de confirmação → login →
      recarregar a página (continua logado) → esperar 16 min ou forçar `JWT_EXPIRES_IN=1m` em homologação (a sessão
      renova sozinha) → logout. Nas ferramentas do navegador, o cookie `argos_refresh` aparece com `HttpOnly`,
      `Secure`, `SameSite=Lax`, `Path=/api`, e nada de token em `localStorage`.
- [ ] **CSRF/Origin**: `curl -sS -X POST https://<dominio>/api/v1/auth/refresh -H 'Origin: https://site-falso.example'`
      responde 403; sem `Origin` (app nativo) responde 401 sem cookie.
- [ ] **Links diretos (SPA)**: abrir `https://<dominio>/items/1` e um link de confirmação de e-mail recebido; ambos
      carregam a página (o proxy devolve `index.html` para rotas do frontend).
- [ ] **Proxy e IP real**: `TRUST_PROXY` com o número de saltos correto; nos logs aparece o IP do cliente, não o do
      proxy. A API (porta 3333) **não** responde de fora do servidor (`curl http://<ip-publico>:3333/health/live` falha).
      Duas pessoas atrás do mesmo NAT conseguem entrar ao mesmo tempo (limite de login é por conta + IP).
- [ ] **Upload pelo proxy**: publicar um item com foto de ~4,5 MB (o proxy aceita corpos de até 6 MB; sem 413 do
      proxy) e conferir a imagem em `/uploads/...` com `Cache-Control` e `Content-Security-Policy` da API.
- [ ] **E-mail real**: "Testar e-mail" no painel admin; confirmação de cadastro, redefinição de senha e um aviso de
      reivindicação chegam na caixa de entrada (não no spam). Conferir SPF, DKIM e DMARC do domínio remetente.
- [ ] **Persistência**: reiniciar o serviço/contêiner; banco, fotos, sessões e e-mails pendentes continuam.
- [ ] **Backup e restauração** (seção 4): `backup` + `verify` ok; restaurar em outra máquina/pasta, subir a API
      apontando para a cópia, entrar e abrir um item com foto.
- [ ] **Administração**: aprovar uma solicitação de acesso (senha temporária aparece uma vez), bloquear e
      desbloquear uma conta de teste, tratar uma denúncia e baixar o CSV.
- [ ] **Android**: build assinado de release (`flutter build apk --release --dart-define-from-file=...`) apontando
      para o domínio https; em aparelho real: login, sessão restaurada após fechar o app, publicar com câmera e
      galeria, negar a permissão de câmera (mensagem clara), reivindicar, cancelar a solicitação, TalkBack.
- [ ] **Responsável pela privacidade**: aprovar o texto de `backend/src/config/privacy-notice.ts`, os prazos de
      retenção (seção 5) e a ativação de IA/tradução (enviam conteúdo a terceiros) antes de ligar as chaves.

## 8. Instalação de uma instância (passo a passo)

Exemplo para um servidor Linux com Node.js 22 ou 24, um disco persistente montado em `/srv/argos` e um proxy
reverso com TLS no mesmo host. Ajuste caminhos e domínio; os exemplos de proxy e de serviço **não foram
validados em infraestrutura real** neste repositório.

### 8.1 Build

```bash
git clone <repositório> /opt/argos && cd /opt/argos
npm ci --prefix backend && npm run build --prefix backend        # gera backend/dist
npm ci --prefix frontend
# Web e API no mesmo domínio: a web chama /api e carrega /uploads do próprio domínio.
VITE_API_URL=/api npm run build --prefix frontend                # gera frontend/dist (estático)
```

### 8.2 Variáveis de ambiente

Guarde-as no cofre do provedor ou num arquivo legível só pelo usuário do serviço (ex.: `/etc/argos/argos.env`,
`chmod 600`). Nunca no repositório.

```env
NODE_ENV=production
PORT=3333
DATABASE_URL=/srv/argos/data/argos.sqlite
UPLOAD_DIR=/srv/argos/uploads
MIGRATION_BACKUP_DIR=/srv/argos/backups/pre-migration
JWT_SECRET=<openssl rand -base64 48>
ADMIN_EMAIL=<e-mail institucional do administrador>
ADMIN_PASSWORD=<12+ caracteres; só no primeiro boot>
FRONTEND_URL=https://argos.exemplo.edu.br
API_PUBLIC_URL=https://argos.exemplo.edu.br
CORS_ORIGINS=https://argos.exemplo.edu.br
TRUST_PROXY=1
SMTP_HOST=<servidor SMTP>
SMTP_PORT=587
SMTP_USER=<usuário>
SMTP_PASS=<senha ou chave do provedor>
MAIL_FROM=ARGOS <no-reply@exemplo.edu.br>
MAP_CENTER_LAT=<latitude do campus>
MAP_CENTER_LNG=<longitude do campus>
```

Integrações opcionais (IA, tradução, Google, Turnstile) ficam vazias até a aprovação do responsável pela
privacidade; sem chave, a opção some da tela. Lista completa e comentada em `backend/.env.example`.

### 8.3 Proxy reverso

Requisitos: TLS; `/api/*`, `/uploads/*` e `/health/*` para a API em `127.0.0.1:3333`; demais caminhos servem
`frontend/dist` com fallback para `index.html`; corpo de requisição de até 6 MB (foto de 5 MB + formulário);
`X-Forwarded-For` anexado pelo proxy. Exemplo com nginx:

```nginx
server {
  listen 443 ssl http2;
  server_name argos.exemplo.edu.br;
  # ssl_certificate / ssl_certificate_key do certificado do domínio
  client_max_body_size 6m;

  location ~ ^/(api|uploads|health)/ {
    proxy_pass http://127.0.0.1:3333;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    root /opt/argos/frontend/dist;
    try_files $uri /index.html;
  }
}
```

Com Caddy, o equivalente é `reverse_proxy` para os três prefixos e `try_files {path} /index.html` + `file_server`
para o restante (o Caddy já cuida do certificado). Em ambos, `TRUST_PROXY=1` (um salto).

### 8.4 Serviço

Exemplo de unidade systemd (`/etc/systemd/system/argos.service`):

```ini
[Unit]
Description=ARGOS API
After=network-online.target

[Service]
User=argos
WorkingDirectory=/opt/argos/backend
EnvironmentFile=/etc/argos/argos.env
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
# A API encerra requisições e fecha o SQLite ao receber SIGTERM (até 10 s).
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
```

`systemctl daemon-reload && systemctl enable --now argos`. Uma única instância por banco.

### 8.5 Primeiro boot

1. O log mostra as migrações aplicadas (`[db] Migração N ... aplicada.`) e `ARGOS API on ...`. Se a configuração for
   inválida, o processo para e a mensagem cita a variável (nunca o valor).
2. `curl -sS https://argos.exemplo.edu.br/health/ready` → `status: ready` e `schemaVersion: 4`.
3. Entre na web com `ADMIN_EMAIL`/`ADMIN_PASSWORD`, troque a senha em Configurações > Segurança e **remova
   `ADMIN_PASSWORD` do ambiente** (ela só cria o administrador inicial).
4. Administração > "Testar e-mail" deve entregar a mensagem na caixa do administrador.
5. Agende o backup (seção 4), por exemplo no crontab do usuário `argos`:
   `0 3 * * * cd /opt/argos/backend && node dist/ops/backup-cli.js backup --out /srv/argos/backups/daily --keep 14`
   e copie a pasta, criptografada, para fora do servidor.
6. Execute o checklist da seção 7 antes de abrir para usuários reais.

### 8.6 Atualização

1. Backup completo + `verify` (seção 4).
2. `git pull` (ou nova versão), `npm ci` e builds da seção 8.1.
3. `systemctl restart argos`; o log mostra a cópia prévia e as migrações novas, se houver.
4. Conferir `/health/ready`, entrar com uma conta de teste e abrir um item com foto.
5. Problema depois da atualização: seção 3 ("Rollback").
