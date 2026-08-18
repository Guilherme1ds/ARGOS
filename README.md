# ARGOS - Sistema de Achados e Perdidos

ARGOS é um monorepo com backend Express/TypeScript e frontend React/Vite para cadastro, busca, reivindicação, devolução e administração de itens perdidos ou encontrados.

## Stack

- Backend: Node.js, TypeScript, Express, SQLite com `better-sqlite3`, JWT, Zod, Helmet, Multer e Nodemailer.
- Frontend: React, TypeScript, Vite, React Router, Axios e CSS próprio.
- Banco atual: SQLite para desenvolvimento e protótipo.
- Contrato inicial: `docs/openapi/argos.v1.yaml`.

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
npm run build --prefix backend
npm run build --prefix frontend
npm audit --prefix backend --audit-level=moderate
npm audit --prefix frontend --audit-level=moderate
```

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
UPLOAD_DIR=uploads
MAX_UPLOAD_MB=5
ADMIN_EMAIL=admin@argos.local
ADMIN_PASSWORD=change-me
```

Frontend:

```env
VITE_API_URL=http://localhost:3333/api
VITE_API_PUBLIC_URL=http://localhost:3333
```

Em produção, o backend bloqueia defaults inseguros para `JWT_SECRET`, `ADMIN_PASSWORD`, `CORS_ORIGINS` e `API_PUBLIC_URL`.

## Observações

O seed admin não sobrescreve mais a senha de uma conta admin já existente. Para trocar essa senha, use um fluxo administrativo ou atualize a credencial de forma explícita no banco/serviço de usuários.
