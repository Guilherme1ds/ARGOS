# ARGOS - Sistema de Achados e Perdidos

ARGOS é um monorepo com backend Express/TypeScript e frontend React/Vite para cadastro, busca, reivindicação, devolução e administração de itens perdidos ou encontrados.

## Stack

- Backend: Node.js, TypeScript, Express, SQLite com `better-sqlite3`, JWT, Zod, Helmet, Multer e Nodemailer.
- Frontend: React, TypeScript, Vite, React Router, Axios e CSS próprio.
- Banco atual: SQLite com migrações versionadas (`backend/src/db/migrations.ts`), adequado a **uma única instância** com disco persistente e backup.
- Contrato: `docs/openapi/argos.v1.yaml`, validado automaticamente contra as rotas Express e os clientes (`backend/test/contract.test.ts`).
- Decisões de produto e operação: [docs/decisoes-de-produto.md](docs/decisoes-de-produto.md) e [docs/operacao.md](docs/operacao.md) (deploy, backup/restore, retenção, migrações).

## Requisitos locais

- Node.js 22 LTS ou 24 e npm 10+. O backend usa `better-sqlite3` 12.x, que publica binários pré-compilados para essas versões (validado com Node.js 24.21 no Windows). Se `node_modules/better-sqlite3/build/Release/better_sqlite3.node` não existir após a instalação, rode `npm rebuild better-sqlite3 --prefix backend`; sem binário para a sua plataforma, é preciso o toolchain C++ (no Windows, workload Desktop development with C++).
- Flutter SDK com Dart compatível com `apps/flutter/pubspec.yaml` (validado com Flutter 3.47.4). No Windows, `flutter pub get` pede o Developer Mode para criar symlinks de plugins; sem ele, as dependências são resolvidas e `analyze`/`test` funcionam, mas builds desktop Windows não.
- O backend usa SQLite local e cria o banco e o diretório de uploads na primeira execução.

## Estrutura

```txt
backend/
  src/
    config/
    db/
    middleware/
    modules/
    shared/policies/
    utils/
frontend/
  src/
    components/
    contexts/
    pages/
    services/
    types/
    utils/
docs/
  openapi/
```

## Funcionalidades

- Autenticação com access token curto em memória e refresh token em cookie httpOnly (SameSite=Lax, rotativo) com verificação de `Origin` nas rotas que usam o cookie.
- Cadastro por senha exige **confirmação de e-mail** (link de uso único, 24 h) antes do primeiro login; reenvio limitado. Google e contas aprovadas pela administração já chegam verificados.
- Logout com revogação server-side do refresh token.
- Permissões de campus único: só `admin` tem alcance global (moderação, provas, relatórios, CSV). Os papéis `space_manager`, `org_admin` e `support` não têm modelo de organização e recebem apenas permissões de cidadão (falha fechada).
- Busca pública com filtros por texto, tipo, categoria, local, status, intervalo de datas, presença de foto e ordenação.
- DTO público de item sem e-mail, histórico interno ou dados de reivindicação.
- Upload autenticado com validação de MIME e magic bytes para JPEG, PNG e WebP.
- Resumo de privacidade com versão definida no servidor (`backend/src/config/privacy-notice.ts`), prazos de retenção aplicados, aceite de nova versão e registro de revogação na exclusão da conta.
- Auditoria para login, refresh, logout, uploads, criação de item, claims, status admin e exportação CSV.
- Conta: troca de senha (encerra as outras sessões), recuperação por e-mail com link de uso único (1 hora), exportação dos próprios dados em JSON e exclusão de conta com anonimização (LGPD).
- Reivindicações: o dono recusa, quem enviou cancela (web e app); sem reivindicação aberta o caso volta a "perdido"/"encontrado".
- Contato: acontece sempre pelo ARGOS (reivindicação/informação privada e notificações); nenhum e-mail é exibido. Os antigos seletores de "preferência de contato", que não tinham efeito, saíram das telas (a API ainda aceita o campo, como informativo).
- Notificações: contador de não lidas no menu, marcar uma como lida ao abrir, e-mail imediato para eventos importantes ou resumo diário, conforme as preferências.
- Moderação: denúncias formam uma fila paginada no painel admin (aberta, em análise, resolvida, descartada), com responsável, nota de resolução, controle de concorrência e auditoria; autor ou moderador remove pistas públicas.
- Restrição anti-spam **manual**: a administração aplica/remove a restrição de publicação (pontuação ≥ 5); não há detecção automática.
- Correspondências perdido/encontrado recalculadas na criação e depois de cada edição, sem avisos duplicados.
- CSV administrativo com proteção contra fórmulas (`=`, `+`, `-`, `@`, tabulação, CR/LF e variantes Unicode).
- Limites de requisição por conta quando autenticado (por IP só para visitantes), para não penalizar redes com NAT. Login: 10 tentativas/min por conta e IP, com teto de 60/min por IP.
- Mensagens de erro para pessoas: validação em português claro (traduzida na web), sessão expirada, falta de conexão e falha do servidor (com código para o suporte) sem endereços técnicos.
- Publicação na web guarda um rascunho de texto na aba (sem foto) que sobrevive à sessão perdida; o logout o apaga.
- Solicitação de acesso institucional sem senha; a administração aprova uma única vez (senha temporária exibida uma vez) e pode bloquear e desbloquear contas.
- Integrações (cada uma liga sozinha quando a chave está em `backend/.env`; sem chave, a opção some da tela — detalhes em `backend/.env.example`):
  - **Mapa** (Leaflet + OpenStreetMap, sem chave): marcar o local ao publicar, mapa do caso e página `/map`.
  - **IA com visão** (Claude API, `ANTHROPIC_API_KEY`): sugere título, categoria e descrição a partir da foto.
  - **Tradução automática** das publicações (`DEEPL_API_KEY` ou `LIBRETRANSLATE_URL`), com cache por idioma.
  - **E-mail real** por SMTP (Gmail, Brevo, Resend); botão "Testar e-mail" no painel admin.
  - **Login com Google** (`GOOGLE_CLIENT_ID`), vinculando contas pelo e-mail verificado.
  - **CAPTCHA Cloudflare Turnstile** no cadastro e na recuperação de senha (`TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY`).
  - **Notificações push no navegador** (Web Push; chaves VAPID geradas automaticamente) — exige https ou localhost.
- Site pronto para o público: página "Como funciona" (`/help`) e rodapé com ajuda, privacidade e contato
  (`SUPPORT_EMAIL`, opcional); título da aba por página; botão "Compartilhar" no caso (compartilhamento do
  sistema no celular, cópia do link no computador); app instalável pelo navegador (manifesto e ícones).
- Publicação (`WEB_DIST_DIR`): a API serve a web no mesmo domínio, com prévia de link (título, local e foto) dos
  casos públicos para WhatsApp e redes sociais, `robots.txt`, `sitemap.xml`, CSP e compressão. Casos ficam fora
  dos buscadores (`noindex`); a prévia continua funcionando. Guia: [docs/publicar-no-ar.md](docs/publicar-no-ar.md).
- Idiomas da interface web: português, inglês e espanhol. Visitantes usam o idioma do navegador (ou o escolhido no menu lateral); com login, a escolha fica salva na conta. Datas seguem o idioma e as mensagens conhecidas do servidor também são traduzidas. Dicionários em `frontend/src/i18n/` (chave = texto em português); `npm run i18n:check --prefix frontend` aponta textos sem tradução.

## Comandos

```bash
npm run install:all
npm run dev
```

Validação:

```bash
npm run typecheck --prefix backend
npm test --prefix backend          # unidade, integração, migrações, backup, contrato OpenAPI (SQLite temporário)
npm run build --prefix backend
npm audit --prefix backend --audit-level=moderate
npm audit --omit=dev --prefix backend --audit-level=moderate
npm run build --prefix frontend    # inclui tsc -b
npm run i18n:check --prefix frontend
npm audit --prefix frontend --audit-level=moderate
npm run test:e2e --prefix frontend # Playwright: sobe API descartável + build de produção (porta 3401/4173)
cd apps/flutter && flutter pub get && flutter analyze && flutter test
node tool/run_live_api_test.mjs    # em apps/flutter: teste HTTP do app contra API descartável
```

Publicação com domínio próprio (Docker + HTTPS automático + backup diário): [docs/publicar-no-ar.md](docs/publicar-no-ar.md).
No Windows, rode o Vitest a partir de um caminho com a letra do disco maiúscula (`C:\...`, como no PowerShell): com
`c:\...` minúsculo (caso do Git Bash) o Vitest falhou com "failed to find the runner" em 12/11/2026.

O E2E web usa o Chromium do Playwright (`npx playwright install chromium` uma vez); `PW_CHANNEL=chrome` usa o navegador instalado. Ele e o teste HTTP do Flutter sobem a API com banco/uploads em pasta temporária, `.env` local ignorado, integrações externas desligadas e uma caixa de e-mails de teste (`ENABLE_TEST_MAIL_SINK`, aceita só com `NODE_ENV=test`, conexões locais e destinatários `.test`). O CI está em `.github/workflows/ci.yml`.

`backend/test/integration.test.ts` cobre erros HTTP (400, 401, 403, 404 JSON, 409, 413, 422, 429), autorização por recurso, concorrência (refresh, reivindicação e devolução simultâneos), exclusão de itens, uploads inválidos e bloqueio de usuários. `auth-privacy.test.ts`, `moderation-integrity.test.ts`, `migrations.test.ts`, `config.test.ts` e `contract.test.ts` cobrem as correções da auditoria de 05/11/2026; `user-journeys.test.ts` cobre o fechamento de 11/11/2026 (relatórios em `AUDITORIA_ARGOS/`).

## Fluxos validados

- Sessão: login (e-mail sem diferenciar maiúsculas/espaços), cadastro, refresh com rotação, logout com revogação da família de tokens. Refresh concorrente (duas abas ou `StrictMode`) recebe 409 em vez de ser tratado como reuso; o cliente repete uma vez. Falhas transitórias (rede, 429, 5xx) não encerram a sessão local.
- Itens: criar (com `Idempotency-Key`), editar (web e app), excluir (autor ou moderação; casos devolvidos só pela moderação), seguir, pistas públicas, reivindicar e registrar devolução.
- Busca pública: filtros, ordenação e paginação sem campos privados.
- Uploads: JPEG/PNG/WebP com verificação de magic bytes e recodificação; tipo incompatível, arquivo corrompido, múltiplos arquivos e excesso de tamanho são recusados.
- Administração: bloquear usuário revoga as sessões; o administrador não pode remover o próprio acesso.
- Web ponta a ponta (Chrome headless): login com retorno ao destino, reivindicar/cancelar/recusar, acompanhar, pista e remoção, abas de Meus itens, notificações, troca e recuperação de senha, exportação, exclusão de conta, denúncias no admin, 404 e 390px sem rolagem horizontal.
- E2E de fechamento (`e2e/journeys.spec.ts`): busca com Enter, falha de rede explicada com "Tentar novamente", foco preso e devolvido nos diálogos, estado real de "Acompanhar", aviso visível perto da ação, rascunho após sessão perdida, abas por teclado, solicitação de acesso sem senha, aprovação única, bloqueio explicado e desbloqueio.
- axe-core (WCAG 2.1 A/AA + boas práticas, falha em impacto moderado ou maior) em 18 telas (públicas, autenticadas e administração), tema claro e escuro (`e2e/a11y.spec.ts`).
- Sem SMTP configurado (só em desenvolvimento), o terminal mostra destinatário mascarado e assunto; links de confirmação e de senha nunca são impressos. Para recebê-los localmente, use um capturador SMTP (ex.: Mailpit) — veja `backend/.env.example`. Em produção/homologação o servidor não inicia sem SMTP.
- Web revisada em 360px, 390px, 768px e 1366px (overflow, rótulos, contraste, chamadas duplicadas).

## Limitações conhecidas

- SQLite e rate limit em banco local: adequado a uma única instância. Várias réplicas exigem banco e armazenamento de limites compartilhados.
- O limite do refresh é por sessão; os demais limites são por IP. Atrás de proxy, defina `TRUST_PROXY` com o número de saltos (ex.: `1`) ou os IPs/CIDRs do proxy; `true` não é aceito em produção.
- O app Flutter não tem login Google nativo nem exportação/exclusão de conta: a recuperação de senha é pedida no app e concluída na página web do link; contas criadas com Google definem uma senha por esse caminho.
- Visitantes anônimos recebem `401` em `/auth/refresh` a cada carregamento: o cookie é httpOnly e o cliente não sabe de antemão se existe sessão.
- Uploads órfãos são removidos após 8 dias; a exclusão de um item não apaga a foto na hora.

## URLs locais

- Frontend: `http://localhost:5173`
- Backend legado: `http://localhost:3333/api`
- Backend versionado: `http://localhost:3333/api/v1`
- Health: `http://localhost:3333/api/health`

## Variáveis de ambiente principais

Backend:

```env
PORT=3333
DATABASE_URL=./argos.sqlite
JWT_SECRET=change-me-in-production
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=30d
FRONTEND_URL=http://localhost:5173
CORS_ORIGINS=http://localhost:5173
API_PUBLIC_URL=http://localhost:3333
TRUST_PROXY=false
MAX_BODY_MB=1
UPLOAD_DIR=uploads
MAX_UPLOAD_MB=5
ADMIN_EMAIL=admin@argos.local
ADMIN_PASSWORD=<defina-uma-senha-forte>
# Opcional, somente NODE_ENV=development: cria/atualiza uma conta citizen de teste.
DEV_TEST_USER_EMAIL=usuario.teste@argos.local
DEV_TEST_USER_PASSWORD=
```

`TRUST_PROXY` aceita `false`, número de saltos (1–10), `loopback`/`linklocal`/`uniquelocal` ou lista de IPs/CIDRs. A conta de teste de desenvolvimento só é criada quando `DEV_TEST_USER_PASSWORD` é definida; nenhuma senha padrão é exibida na interface. Lista completa (cookie, retenção, migrações, e-mail) em `backend/.env.example`.

Frontend:

```env
# Padrão: mesmo domínio (o Vite e o proxy de produção repassam /api e /uploads).
VITE_API_URL=/api
```

Em produção/homologação o backend não inicia com `JWT_SECRET` ausente, padrão ou de baixa entropia, `ADMIN_PASSWORD` fraca, TTLs fora do formato/limites, URLs/origens que não sejam https reais, `TRUST_PROXY=true` ou sem SMTP. As mensagens citam a variável, nunca o valor.

## Observações

O seed admin não sobrescreve mais a senha de uma conta admin já existente. Para trocar essa senha, use um fluxo administrativo ou atualize a credencial de forma explícita no banco/serviço de usuários.
