# ARGOS - Sistema de Achados e Perdidos

ARGOS é um monorepo com backend Express/TypeScript e frontend React/Vite para cadastro, busca, reivindicação, devolução e administração de itens perdidos ou encontrados.

## Stack

- Backend: Node.js, TypeScript, Express, SQLite com `better-sqlite3`, JWT, Zod, Helmet, Multer e Nodemailer.
- Frontend: React, TypeScript, Vite, React Router, Axios e CSS próprio.
- Banco atual: SQLite para desenvolvimento e protótipo.
- Contrato inicial: `docs/openapi/argos.v1.yaml`.

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

- Autenticação com access token curto em memória e refresh token em cookie httpOnly.
- Logout com revogação server-side do refresh token.
- RBAC inicial com permissões como `items:create`, `items:moderate`, `reports:export_org` e `platform:admin`.
- Busca pública com filtros por texto, tipo, categoria, local, status, intervalo de datas, presença de foto e ordenação.
- DTO público de item sem e-mail, histórico interno ou dados de reivindicação.
- Upload autenticado com validação de MIME e magic bytes para JPEG, PNG e WebP.
- Consentimento básico de privacidade no cadastro e endpoint de resumo de privacidade.
- Auditoria para login, refresh, logout, uploads, criação de item, claims, status admin e exportação CSV.

## Comandos

```bash
npm run install:all
npm run dev
```

Validação:

```bash
npm run typecheck --prefix backend
npm test --prefix backend          # smoke + integração (banco SQLite temporário)
npm run build --prefix backend
npm run build --prefix frontend    # inclui tsc -b
npm audit --prefix backend --audit-level=moderate
npm audit --prefix frontend --audit-level=moderate
cd apps/flutter && flutter pub get && flutter analyze && flutter test
```

`backend/test/integration.test.ts` cobre erros HTTP (400, 401, 403, 404 JSON, 409, 413, 422, 429), autorização por recurso, concorrência (refresh, reivindicação e devolução simultâneos), exclusão de itens, uploads inválidos e bloqueio de usuários. O teste Flutter contra API real (`live_api_test.dart`) está descrito em `apps/flutter/README.md`.

## Fluxos validados

- Sessão: login (e-mail sem diferenciar maiúsculas/espaços), cadastro, refresh com rotação, logout com revogação da família de tokens. Refresh concorrente (duas abas ou `StrictMode`) recebe 409 em vez de ser tratado como reuso; o cliente repete uma vez. Falhas transitórias (rede, 429, 5xx) não encerram a sessão local.
- Itens: criar (com `Idempotency-Key`), editar (web e app), excluir (autor ou moderação; casos devolvidos só pela moderação), seguir, pistas públicas, reivindicar e registrar devolução.
- Busca pública: filtros, ordenação e paginação sem campos privados.
- Uploads: JPEG/PNG/WebP com verificação de magic bytes e recodificação; tipo incompatível, arquivo corrompido, múltiplos arquivos e excesso de tamanho são recusados.
- Administração: bloquear usuário revoga as sessões; o administrador não pode remover o próprio acesso.
- Web revisada em 360px, 390px, 768px e 1366px (overflow, rótulos, contraste, chamadas duplicadas).

## Limitações conhecidas

- SQLite e rate limit em banco local: adequado a uma única instância. Várias réplicas exigem banco e armazenamento de limites compartilhados.
- O limite do refresh é por sessão; os demais limites são por IP. Atrás de proxy, defina `TRUST_PROXY=true` para usar o IP real.
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

`TRUST_PROXY` aceita `true/false`, `1/0` ou `yes/no`. A conta de teste de desenvolvimento só é criada quando `DEV_TEST_USER_PASSWORD` é definida; nenhuma senha padrão é exibida na interface.

Frontend:

```env
VITE_API_URL=http://localhost:3333/api
VITE_API_PUBLIC_URL=http://localhost:3333
```

Em produção, o backend bloqueia defaults inseguros para `JWT_SECRET`, `ADMIN_PASSWORD`, `CORS_ORIGINS` e `API_PUBLIC_URL`.

## Observações

O seed admin não sobrescreve mais a senha de uma conta admin já existente. Para trocar essa senha, use um fluxo administrativo ou atualize a credencial de forma explícita no banco/serviço de usuários.
