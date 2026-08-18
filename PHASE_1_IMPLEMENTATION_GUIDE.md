# ARGOS - Guia de Implementacao da Fase 1

Data base: 2026-08-18

Este guia transforma os itens mais urgentes do Plano Mestre em uma execucao objetiva. A Fase 1 aqui cobre estabilizacao imediata, seguranca basica, RBAC inicial, testes smoke e preparacao para producao.

## Objetivo da Fase 1

Sair do prototipo compilavel para uma base segura e evolutiva, sem mudar ainda todo o produto. Ao final:

- Backend e frontend continuam compilando.
- Dependencias vulneraveis foram atualizadas ou possuem decisao tecnica documentada.
- Rotas publicas nao expoem dados pessoais desnecessarios.
- Sessao e autorizacao tem desenho pronto para evoluir.
- Existem testes automatizados dos fluxos criticos.
- Existe contrato OpenAPI inicial.

## Checklist 1 - Dependencias e Build

Backend:

- [ ] Rodar `npm audit --prefix backend`.
- [ ] Atualizar `nodemailer` para versao corrigida.
- [ ] Atualizar ou substituir `multer` 1.x.
- [ ] Rodar `npm run typecheck --prefix backend`.
- [ ] Rodar `npm run build --prefix backend`.
- [ ] Registrar breaking changes no PR.

Frontend:

- [ ] Rodar `npm audit --prefix frontend`.
- [ ] Atualizar `vite`/`esbuild`.
- [ ] Atualizar `react-router-dom`.
- [ ] Atualizar `nanoid` quando presente direta ou transitivamente.
- [ ] Rodar `npm run build --prefix frontend`.
- [ ] Testar navegacao de login, dashboard, itens, detalhe e admin.

Aceite:

- [ ] `npm audit` sem `critical/high`.
- [ ] Build completo passa.
- [ ] Nao ha regressao manual nos fluxos principais.

## Checklist 2 - Encoding e Copy

Arquivos prioritarios:

- [ ] `README.md`
- [ ] `frontend/src/components/Layout.tsx`
- [ ] `frontend/src/pages/LoginPage.tsx`
- [ ] `frontend/src/pages/ItemsPage.tsx`
- [ ] `frontend/src/pages/ItemDetailPage.tsx`
- [ ] `frontend/src/pages/ItemFormPage.tsx`
- [ ] `frontend/src/pages/AdminPage.tsx`
- [ ] `frontend/src/services/api.ts`
- [ ] `backend/src/**/*.ts`

Tarefas:

- [ ] Converter todos os arquivos para UTF-8.
- [ ] Corrigir textos com mojibake: palavras como "descricao", "reivindicacao", "aprovacao" e "notificacoes" devem renderizar corretamente.
- [ ] Remover credencial seed da UI.
- [ ] Padronizar mensagens de erro amigaveis.
- [ ] Criar catalogo de labels para status e permissoes.

Aceite:

- [ ] Nenhum texto quebrado visivel no navegador.
- [ ] README renderiza corretamente.
- [ ] UI nao exibe senha admin padrao.

## Checklist 3 - Autenticacao e Sessao

Estado atual:

- `backend/src/middleware/auth.ts` assina JWT.
- `frontend/src/contexts/AuthContext.tsx` guarda token em `localStorage`.
- Tabela `refresh_tokens` existe, mas o fluxo nao esta implementado.

Tarefas backend:

- [ ] Criar endpoint `POST /api/v1/auth/refresh`.
- [ ] Criar endpoint `POST /api/v1/auth/logout`.
- [ ] Salvar refresh token somente como hash.
- [ ] Implementar rotacao de refresh token.
- [ ] Revogar token anterior a cada refresh.
- [ ] Definir cookie httpOnly/Secure/SameSite para refresh.
- [ ] Reduzir access token para vida curta.
- [ ] Adicionar email verification como pre-requisito para publicar/reivindicar.
- [ ] Adicionar audit log para login, refresh, logout e falhas.

Tarefas frontend:

- [ ] Manter access token em memoria.
- [ ] Remover token de `localStorage`.
- [ ] Implementar `checkingSession`.
- [ ] Tentar refresh silencioso ao abrir app.
- [ ] Redirecionar para login somente apos refresh falhar.
- [ ] Padronizar tela de sessao expirada.

Aceite:

- [ ] XSS nao consegue ler refresh token.
- [ ] Logout invalida sessao no servidor.
- [ ] Refresh token reutilizado e detectado/revogado.

## Checklist 4 - RBAC Inicial

Estado atual:

- Roles: `user` e `admin`.
- Middleware `admin` faz checagem direta.

Modelo inicial:

```txt
citizen
space_manager
org_admin
support
admin
```

Permissoes iniciais:

```txt
items:read_public
items:create
items:update_own
items:moderate
items:return
claims:create
claims:review
claims:read_private
chat:send
chat:moderate
reports:read_org
reports:export_org
users:manage_org
platform:admin
```

Tarefas backend:

- [ ] Criar `backend/src/shared/policies/permissions.ts`.
- [ ] Criar `authorize(permission, scopeResolver?)`.
- [ ] Trocar `admin` em `admin.routes.ts` e `reports.routes.ts`.
- [ ] Adicionar campo `organization_id` futuramente, mas ja desenhar resolver de escopo.
- [ ] Garantir respostas 403 padronizadas.

Tarefas frontend:

- [ ] Criar `RequirePermission`.
- [ ] Renderizar menu por permissao.
- [ ] Criar fallback de acesso negado.

Aceite:

- [ ] Teste negativo prova que citizen nao acessa admin.
- [ ] Teste positivo prova que admin acessa tudo.
- [ ] Codigo nao depende mais de `adminOnly` espalhado.

## Checklist 5 - Privacidade Publica e LGPD Minima

Tarefas backend:

- [ ] Criar DTO publico de item para `GET /items/search`.
- [ ] Criar DTO publico de detalhe para `GET /items/:id`.
- [ ] Nao retornar `owner_email` fora de rotas autorizadas.
- [ ] Nao retornar historico interno para visitante.
- [ ] Mascarar identificadores pessoais.
- [ ] Adicionar termo/consentimento versionado no cadastro.
- [ ] Registrar consentimento em `privacy_consents`.
- [ ] Criar endpoint basico `GET /api/v1/privacy/summary`.

Tarefas frontend:

- [ ] Mostrar termo de privacidade no cadastro.
- [ ] Adicionar checkbox obrigatorio quando base legal exigir consentimento.
- [ ] Adicionar link para central de privacidade.
- [ ] Informar no upload que fotos podem conter dados pessoais e devem evitar documentos completos.

Aceite:

- [ ] Busca publica nao vaza email, telefone, historico sensivel ou local exato desnecessario.
- [ ] Cadastro salva versao do termo aceito.
- [ ] Usuario consegue ver resumo do tratamento de dados.

## Checklist 6 - Upload Seguro

Estado atual:

- `uploads.routes.ts` aceita MIME `jpeg`, `png`, `webp`.
- Arquivo vai para disco local.
- URL e publica em `/uploads`.

Tarefas:

- [ ] Validar magic bytes.
- [ ] Limitar dimensoes e tamanho.
- [ ] Remover EXIF.
- [ ] Gerar thumbnail.
- [ ] Separar arquivos publicos de evidencias privadas.
- [ ] Criar storage abstraction.
- [ ] Planejar migracao para S3/R2/GCS.
- [ ] Usar URL assinada para evidencias.
- [ ] Salvar metadados no banco sem caminho local absoluto.

Aceite:

- [ ] Arquivo com MIME falso e recusado.
- [ ] Evidencia privada nao e acessivel por URL publica.
- [ ] Imagem exibida no frontend usa URL da API/env, nao `localhost` hardcoded.

## Checklist 7 - Busca e Filtros MVP+

Tarefas backend:

- [ ] Adicionar filtros `from`, `to`, `hasImage`, `sort`.
- [ ] Validar datas com formato estrito.
- [ ] Adicionar total ou cursor conforme estrategia.
- [ ] Criar DTO de retorno consistente.
- [ ] Normalizar busca textual.

Tarefas frontend:

- [ ] Adicionar filtro de intervalo de datas.
- [ ] Adicionar chips de filtros ativos.
- [ ] Adicionar botao limpar filtros.
- [ ] Adicionar estado de loading e erro.
- [ ] Adicionar empty state com sugestao de ampliar filtros.

Aceite:

- [ ] Busca nao dispara loop.
- [ ] Busca funciona em mobile.
- [ ] Erro da API aparece de forma amigavel.

## Checklist 8 - Testes Smoke

Backend:

- [ ] Instalar framework de teste.
- [ ] Criar banco temporario por teste.
- [ ] Testar `GET /api/health`.
- [ ] Testar cadastro/login.
- [ ] Testar criacao de item autenticado.
- [ ] Testar busca publica apenas aprovada.
- [ ] Testar claim.
- [ ] Testar devolucao.
- [ ] Testar admin approval.
- [ ] Testar 403 para usuario comum em admin.

Frontend:

- [ ] Testar render da busca.
- [ ] Testar login com mock de API.
- [ ] Testar formulario de item.
- [ ] Testar mensagem de erro.
- [ ] Testar rota protegida.

E2E:

- [ ] Subir backend e frontend em staging local.
- [ ] Criar usuario.
- [ ] Publicar item.
- [ ] Aprovar item como admin.
- [ ] Buscar item como visitante.
- [ ] Reivindicar como outro usuario.
- [ ] Marcar devolvido.

Aceite:

- [ ] Testes rodam em CI.
- [ ] Fluxo critico ponta a ponta passa.

## Checklist 9 - UI/UX Foundation

Tarefas:

- [ ] Criar tokens em `styles.css` ou pacote compartilhado:
  - cor
  - espaco
  - radius
  - sombra
  - tipografia
  - foco
  - z-index
- [ ] Criar componentes reutilizaveis:
  - `Button`
  - `IconButton`
  - `Input`
  - `Select`
  - `Textarea`
  - `Badge`
  - `Alert`
  - `Skeleton`
  - `EmptyState`
  - `DataTable`
- [ ] Refatorar paginas para usar componentes.
- [ ] Garantir foco visivel e navegacao por teclado.
- [ ] Corrigir overflow das tabelas no mobile.
- [ ] Adicionar skeletons nas paginas:
  - busca
  - detalhe
  - dashboard
  - admin
- [ ] Adicionar empty states:
  - nenhum item
  - nenhum resultado
  - nenhuma solicitacao
  - nenhuma notificacao.

Aceite:

- [ ] Lighthouse acessibilidade maior ou igual a 95 no fluxo publico.
- [ ] Nenhum layout quebra em 360px, 768px, 1280px e 1440px.
- [ ] Todos os botoes tem estado loading quando disparam rede.

## Checklist 10 - OpenAPI e Contratos

Tarefas:

- [ ] Criar `docs/openapi/argos.v1.yaml`.
- [ ] Documentar schemas:
  - `User`
  - `PublicItem`
  - `PrivateItem`
  - `Claim`
  - `Notification`
  - `ErrorResponse`
  - `PaginatedResponse`
- [ ] Documentar auth bearer/cookie.
- [ ] Documentar erros 400/401/403/404/409/422/429/500.
- [ ] Gerar cliente TS ou validar tipos contra OpenAPI.
- [ ] Preparar cliente Dart para Flutter futuro.

Aceite:

- [ ] Swagger/OpenAPI renderiza sem erro.
- [ ] Contrato bate com respostas reais dos testes.

## Ordem de Execucao Sugerida

1. Dependencias e build.
2. Encoding e remocao de credenciais da UI.
3. DTOs publicos e mascaramento.
4. Auth refresh/logout.
5. RBAC inicial.
6. Upload seguro minimo.
7. Busca MVP+.
8. Testes smoke.
9. UI foundation.
10. OpenAPI.

## Comandos de Verificacao

```bash
npm run typecheck --prefix backend
npm run build --prefix backend
npm run build --prefix frontend
npm audit --prefix backend --audit-level=moderate
npm audit --prefix frontend --audit-level=moderate
```

## Definition of Done da Fase 1

- [ ] Todos os checklists acima foram concluidos ou possuem decisao formal.
- [ ] Builds passam.
- [ ] Testes smoke passam.
- [ ] `critical/high` zerado em audit.
- [ ] Dados pessoais minimizados em rotas publicas.
- [ ] Sessao nao depende de token persistido em `localStorage`.
- [ ] PR revisado por backend, frontend e seguranca/privacidade.
