# ARGOS

Sistema web de achados e perdidos para cadastro, busca, reivindicação, devolução e administração de itens. A arquitetura foi inspirada nos conceitos do `Projeto_3DEV/ProjetoSenaiHub` (autenticação, dashboard, permissões, notificações, busca global, aprovação e relatórios), sem copiar código Laravel/PHP.

## Stack

- Backend: Node.js + TypeScript + Express
- Frontend: React + TypeScript + Vite
- Banco: SQLite no protótipo (`better-sqlite3`), com caminho aberto para PostgreSQL em produção
- Auth: JWT
- Validação: Zod
- Upload: Multer em armazenamento local

## Estrutura

```txt
backend/
  src/
    config/          envs
    db/              conexão, migração e seed admin
    middleware/      JWT, admin, rate limit
    modules/         auth, items, admin, uploads, dashboard, reports, notifications
    utils/           erros HTTP, auditoria, e-mail
frontend/
  src/
    components/      layout e rotas protegidas
    contexts/        AuthContext
    pages/           login, dashboard, itens, detalhes, formulário, admin
    services/        cliente Axios
    types/           tipos compartilhados da UI
    utils/           labels de status
```

## Modelos e Tabelas

- `users`: nome, e-mail, senha hash, papel (`user|admin`), status (`pending|active|blocked`), score anti-spam.
- `access_requests`: solicitação de acesso, justificativa e revisão admin.
- `items`: item perdido/encontrado, categoria, local, bloco, data, imagem, status operacional e aprovação.
- `claims`: reivindicações com mensagem e provas, ligando usuário ao item.
- `uploads`: metadados dos arquivos enviados.
- `notifications`: notificações in-app.
- `item_history`: trilha de auditoria e mudanças de status.

## API

- `GET /api/health`: status da API.
- `POST /api/auth/login`: autentica e retorna JWT.
- `POST /api/auth/register`: cria conta ou gera `request access` com `requestAccess: true`.
- `GET /api/auth/me`: usuário autenticado.
- `GET /api/items/search`: busca pública por texto, tipo, categoria, local, status e data.
- `GET /api/items`: itens do usuário autenticado.
- `POST /api/items`: cria item pendente de aprovação.
- `GET /api/items/:id`: detalhes e histórico.
- `PATCH /api/items/:id`: edição do dono ou admin.
- `POST /api/items/:id/claim`: reivindicação segura.
- `PATCH /api/items/:id/return`: dono/admin aceita devolução.
- `POST /api/uploads`: upload de imagem autenticado.
- `GET /api/dashboard`: métricas rápidas e itens recentes.
- `GET /api/notifications`: notificações do usuário.
- `POST /api/notifications/read-all`: marca notificações como lidas.
- `GET /api/admin/items`: fila admin.
- `PATCH /api/admin/items/:id/status`: aprova/rejeita e muda status.
- `GET /api/admin/users`: moderação de usuários.
- `PATCH /api/admin/users/:id`: altera status, papel e score anti-spam.
- `GET /api/admin/access-requests`: fila de acesso.
- `PATCH /api/admin/access-requests/:id`: aprova/rejeita solicitação.
- `GET /api/reports/items.csv`: exporta relatório CSV para admin.

## Fluxos

1. Cadastro/login: usuário cria conta ou solicita acesso; login gera JWT e libera rotas protegidas.
2. Publicar item: usuário envia descrição, local, categoria, data e foto; item entra como `approval_status=pending`.
3. Aprovação admin: admin aprova/rejeita publicações e pode moderar usuários.
4. Buscar: qualquer visitante consulta itens aprovados com filtros avançados.
5. Reivindicar: usuário autenticado envia mensagem e provas; dono recebe notificação.
6. Aceitar devolução: dono ou admin marca o item como `returned`; histórico registra ação.
7. Relatórios: admin baixa CSV de achados/perdidos.
8. Suporte futuro: frontend já possui botão/entrada visual para assistente estilo chatbot.

## Validação e Segurança

- Senhas com mínimo de 8 caracteres e hash `bcrypt`.
- JWT obrigatório nas rotas privadas.
- Papel `admin` nas rotas administrativas.
- Zod em entradas de autenticação, itens, reivindicações e moderação.
- Rate limit simples para login/cadastro.
- Upload limitado por tamanho e tipo (`jpeg`, `png`, `webp`).
- Score anti-spam bloqueia novas publicações quando alto.
- Histórico de item para auditoria.
- E-mail via SMTP quando configurado; em dev, logs no console.

## Instalação e Execução

```bash
npm run install:all
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env
npm run dev
```

URLs padrão:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3333/api`
- Health: `http://localhost:3333/api/health`

Credenciais seed:

- E-mail: `admin@argos.local`
- Senha: `Admin@123`

## Exemplos de Envs

Backend:

```env
PORT=3333
DATABASE_URL=./argos.sqlite
JWT_SECRET=change-me-in-production
FRONTEND_URL=http://localhost:5173
UPLOAD_DIR=uploads
ADMIN_EMAIL=admin@argos.local
ADMIN_PASSWORD=Admin@123
```

Frontend:

```env
VITE_API_URL=http://localhost:3333/api
```

## Plano em Etapas

1. Configuração inicial: monorepo simples, scripts, envs, TypeScript e estrutura modular.
2. Backend: Express, SQLite, migração, JWT, CRUD de itens, upload, admin, notificações e CSV.
3. Frontend: React, layout, login/cadastro, busca, dashboard, formulário, detalhes, meus itens e admin.
4. Integração: Axios com token, uploads por `FormData`, filtros e fluxo de aprovação.
5. Testes: adicionar testes de API para health/auth/items/admin e e2e dos fluxos principais.
6. Deploy local: usar `npm run dev`; para produção, trocar SQLite por PostgreSQL, configurar SMTP e servir frontend estático ou publicar em Vercel/Render.
