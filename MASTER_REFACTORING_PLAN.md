# ARGOS - Plano Mestre de Refatoracao, Ajustes e Melhorias

Data base: 2026-08-18

## 1. Diagnostico Executivo

O ARGOS atual e um monorepo com:

- Backend: Node.js, TypeScript, Express, SQLite com `better-sqlite3`, JWT, Zod, Helmet, Multer, Nodemailer.
- Frontend: React, TypeScript, Vite, React Router, Axios e CSS proprio.
- Modulos existentes: `auth`, `items`, `admin`, `dashboard`, `notifications`, `reports`, `uploads`.
- Fluxos existentes: login/cadastro, busca publica, cadastro de item, aprovacao admin, reivindicacao, devolucao, notificacoes in-app e CSV.
- Validacao local executada: `npm run typecheck --prefix backend`, `npm run build --prefix backend` e `npm run build --prefix frontend` passaram.

Principais lacunas para producao:

- Nao ha app Flutter no repositorio. A solicitacao cita Flutter Mobile/Web, mas o frontend atual e React + Vite.
- RBAC esta limitado a `user` e `admin`; faltam `citizen`, `space_manager`, `org_admin`, `support/moderator` e escopos por organizacao/espaco.
- SQLite e upload local servem para prototipo, mas nao para producao multi-institucional.
- Tokens ficam em `localStorage`, sem refresh token operacional, rotacao, revogacao real, MFA ou email verification obrigatoria.
- `refresh_tokens`, `favorites`, `saved_searches`, `notification_preferences` e `audit_logs` existem na base, mas parte relevante ainda nao tem fluxo de API/UI.
- Busca nao tem geolocalizacao estruturada, ranking, facetas, sinonimos, full-text search nem filtros dinamicos reais.
- Matchmaking automatico ainda nao existe.
- Chat seguro/moderado ainda nao existe.
- Protocolo de validacao de propriedade ainda e simplificado por texto livre.
- LGPD ainda nao esta operacionalizada por consentimento versionado, direitos do titular, retencao, mascaramento sistematico, criptografia seletiva e relatorio de impacto.
- Dashboard B2B nao e multi-tenant e ainda nao separa inventario institucional, cadeia de custodia e estatisticas por unidade.
- Nao ha suite de testes automatizados, CI/CD, OpenAPI, observabilidade, backup/restore validado ou plano de incidentes.
- `npm audit` apontou vulnerabilidades: `nodemailer` no backend; `vite/esbuild`, `nanoid` e `react-router` no frontend. Ha tambem aviso de `multer` 1.x depreciado/vulneravel no lockfile.
- Ha textos com possivel problema de encoding/mojibake em README e componentes, ex.: palavras como "descricao" e "reivindicacao" aparecem quebradas na leitura atual.

## 2. Definicao de Pronto para Producao

Para o ARGOS ser considerado pronto para lancamento, a meta "zero falhas" deve significar:

- Zero bugs conhecidos P0/P1 abertos.
- Zero vulnerabilidades `critical` ou `high` em dependencias; vulnerabilidades `moderate` so com justificativa aceita.
- 100% dos fluxos criticos cobertos por testes automatizados.
- Backup e restore testados com evidencia.
- Logs, metricas, tracing, alertas e auditoria ativados.
- Checklist LGPD aprovado por responsavel juridico/privacidade.
- Testes de acessibilidade AA, responsividade, carga, seguranca e regressao visual aprovados.
- Plano de rollback validado.

## 3. Arquitetura-Alvo Recomendada

### Decisao de frontend

O repositorio atual tem React, nao Flutter. Para reduzir risco:

- Recomendada: manter React como painel B2B/admin web e criar `apps/flutter` para experiencia cidadao mobile/web com Material Design 3.
- Alternativa: migrar tudo para Flutter Web/Mobile e apos paridade remover React.
- Regra: a API deve ser o contrato central, documentado em OpenAPI, consumido por React e Flutter.

### Topologia alvo

```txt
argos/
  backend/
    src/
      modules/
        auth/
        users/
        organizations/
        spaces/
        items/
        claims/
        matching/
        chat/
        notifications/
        reports/
        admin/
        privacy/
        uploads/
      shared/
        db/
        policies/
        jobs/
        events/
        observability/
  frontend/
    # React B2B/admin web atual, refatorado
  apps/
    flutter/
      lib/
        app/
        core/
        features/
  docs/
    openapi/
    privacy/
    architecture/
```

### Stack alvo

- Banco: PostgreSQL + PostGIS.
- ORM/migrations: Prisma, Drizzle ou Kysely. Escolher uma ferramenta e remover migracao manual por `db.exec`.
- Cache/rate-limit/jobs: Redis + BullMQ ou equivalente.
- Objetos: S3, Cloudflare R2 ou Google Cloud Storage com URLs assinadas.
- Autenticacao: access token curto + refresh token httpOnly/Secure/SameSite, revogacao e rotacao.
- Autorizacao: RBAC/ABAC com policies centralizadas.
- Busca: PostgreSQL full-text/trigram no inicio; OpenSearch/Meilisearch se volume exigir.
- Observabilidade: logs estruturados, metricas, tracing e Sentry/OpenTelemetry.
- Contratos: OpenAPI + geracao de cliente TypeScript/Dart.

## 4. Checklist Tecnico por Fases

### Fase 0 - Estabilizacao Imediata e Higiene de Release

Backend:

- [ ] Atualizar `nodemailer` para versao sem advisories e revisar breaking changes.
- [ ] Atualizar `multer` para 2.x ou trocar por upload direto para storage com URL assinada.
- [ ] Impedir defaults perigosos em producao: `ADMIN_PASSWORD`, `JWT_SECRET`, `CORS_ORIGINS`, `API_PUBLIC_URL`.
- [ ] Corrigir seed admin para nao sobrescrever senha em toda migracao.
- [ ] Trocar mensagens de erro duplicaveis por catalogo padronizado com `requestId`.
- [ ] Registrar `audit_logs` em login, logout, falha de login, CRUD admin, reivindicacao, devolucao, upload e mudancas de permissao.
- [ ] Remover vazamento de dados em respostas publicas: detalhes publicos nao devem expor email, dono completo ou historico sensivel.
- [ ] Adicionar limite por rota para upload, claim, search, register e login.

Frontend:

- [ ] Atualizar `vite`, `react-router-dom` e dependencias afetadas por audit.
- [ ] Remover credencial seed da tela de login.
- [ ] Remover URLs hardcoded `http://localhost:3333` nas imagens e usar `VITE_API_PUBLIC_URL` ou URL retornada pela API.
- [ ] Corrigir encoding de textos e garantir UTF-8 em todo o repositorio.
- [ ] Criar estados globais de `loading`, `empty`, `error`, `offline` e `unauthorized`.
- [ ] Proteger rotas por permissao real, nao apenas `adminOnly`.

Banco de Dados:

- [ ] Criar migrations versionadas em vez de `CREATE TABLE IF NOT EXISTS` dentro do bootstrap.
- [ ] Adicionar constraints `CHECK` para enums (`role`, `status`, `approval_status`, `type`).
- [ ] Adicionar `updated_at` automatizado por trigger ou camada de dominio.
- [ ] Definir indices para filtros atuais e futuros.

APIs:

- [ ] Criar OpenAPI inicial para todos os endpoints existentes.
- [ ] Padronizar envelope de resposta: `{ data, meta, error, requestId }`.
- [ ] Criar versionamento `/api/v1`.

Testes:

- [ ] Adicionar Vitest/Jest + Supertest no backend.
- [ ] Adicionar React Testing Library + Playwright no frontend.
- [ ] Cobrir smoke tests: health, auth, items/search, item create, claim, return, admin approval.

UI/UX:

- [ ] Corrigir textos quebrados e labels tecnicos em dashboard.
- [ ] Substituir "Carregando..." por skeletons contextuais.
- [ ] Criar design tokens: cor, tipografia, espacamento, radius, foco e estados.
- [ ] Validar contraste, foco visivel, navegacao por teclado e labels acessiveis.

Criterio de aceite:

- [ ] Build backend e frontend passam.
- [ ] `npm audit` sem `critical/high`.
- [ ] Nenhum endpoint publico expoe dado pessoal desnecessario.
- [ ] Fluxos MVP rodam do cadastro a devolucao com testes.

### Fase 1 - Base de Dominio, RBAC e Multi-Tenancy

Backend:

- [ ] Criar modulo `organizations` para parceiros: shopping, universidade, estacao, evento, orgao publico.
- [ ] Criar modulo `spaces` para unidades/lugares: campus, bloco, loja, achados e perdidos, sala, terminal.
- [ ] Expandir roles:
  - `citizen`: cadastra, busca, reivindica, conversa dentro do app.
  - `space_manager`: gere inventario e fluxo do espaco vinculado.
  - `org_admin`: gere usuarios e relatorios da organizacao.
  - `admin`: opera a plataforma inteira.
  - `support` ou `moderator`: revisa conteudo, claims e chat sem acesso irrestrito.
- [ ] Implementar policies por recurso: `canReadItem`, `canUpdateItem`, `canModerateItem`, `canViewPrivateClaim`, `canExportReport`.
- [ ] Trocar `admin(req)` por `authorize(permission, scopeResolver)`.
- [ ] Isolar dados por `organization_id` e `space_id`.
- [ ] Criar trilha de auditoria generica `audit_logs` com ator, entidade, antes/depois, IP, user agent e request id.

Frontend:

- [ ] Trocar `ProtectedRoute adminOnly` por `RequirePermission`.
- [ ] Mostrar menus por permissao efetiva.
- [ ] Criar telas de organizacao, espacos e convites de gestores.
- [ ] Adicionar seletor de contexto institucional quando o usuario pertencer a mais de uma organizacao.

Banco de Dados:

- [ ] Adicionar tabelas `organizations`, `organization_members`, `spaces`, `space_members`.
- [ ] Adicionar `organization_id`, `space_id`, `created_by`, `custodian_id` em `items`.
- [ ] Adicionar indices compostos por tenant: `(organization_id, approval_status, status, created_at)`.
- [ ] Planejar migracao de dados SQLite para PostgreSQL.

APIs:

- [ ] Criar endpoints:
  - `POST /api/v1/organizations`
  - `GET /api/v1/organizations/:id/dashboard`
  - `POST /api/v1/organizations/:id/invitations`
  - `GET /api/v1/spaces`
  - `PATCH /api/v1/spaces/:id`
- [ ] Garantir que nenhum endpoint admin retorne dados de outra organizacao sem permissao global.

Testes:

- [ ] Testar matriz RBAC com casos positivos e negativos.
- [ ] Testar tenant isolation com dois parceiros simultaneos.
- [ ] Testar auditoria em cada acao privilegiada.

UI/UX:

- [ ] Criar IA de navegacao separando "Cidadao" de "Gestao".
- [ ] Painel B2B com densidade profissional: tabelas filtraveis, tabs, quick actions, sem layout promocional.
- [ ] Estados de permissao: acesso negado, contexto inexistente, convite expirado.

### Fase 2 - Banco de Dados de Producao e Modelo de Custodia

Backend:

- [ ] Migrar persistencia para PostgreSQL.
- [ ] Adicionar transacoes em operacoes compostas: item + upload + historico + notificacao.
- [ ] Criar camada repository/service para remover SQL direto das rotas.
- [ ] Separar dominio de transporte HTTP.
- [ ] Criar workers para notificacoes, processamento de imagens, matching e relatorios.

Banco de Dados:

- [ ] Modelo alvo minimo:
  - `users`
  - `user_profiles`
  - `organizations`
  - `organization_members`
  - `spaces`
  - `items`
  - `item_photos`
  - `item_history`
  - `claims`
  - `claim_evidence`
  - `custody_events`
  - `match_candidates`
  - `conversations`
  - `messages`
  - `notification_devices`
  - `notifications`
  - `privacy_consents`
  - `data_subject_requests`
  - `audit_logs`
  - `files`
  - `webhook_events`
- [ ] Campos geoespaciais:
  - `latitude`
  - `longitude`
  - `geohash`
  - `place_id`
  - `location_precision`
  - `public_location_label`
- [ ] Campos para ML/matching:
  - `normalized_title`
  - `normalized_description`
  - `color`
  - `brand`
  - `model`
  - `serial_last4_hash`
  - `image_labels_json`
  - `embedding_vector` opcional se houver busca vetorial.
- [ ] Retencao:
  - itens abertos: conforme politica por organizacao.
  - evidencias de claim: remover ou anonimizar apos encerramento e prazo definido.
  - logs de auditoria: prazo juridico e operacional definido.

APIs:

- [ ] Criar endpoints de cadeia de custodia:
  - `POST /api/v1/items/:id/check-in`
  - `POST /api/v1/items/:id/transfer`
  - `POST /api/v1/items/:id/claim-approval`
  - `POST /api/v1/items/:id/return`
  - `GET /api/v1/items/:id/custody`
- [ ] Gerar comprovante de guarda/devolucao com protocolo, QR code e hash de integridade.

Testes:

- [ ] Testar migracoes forward/backward.
- [ ] Testar integridade referencial e constraints.
- [ ] Testar concorrencia: duas reivindicacoes aprovadas ao mesmo tempo nao podem devolver o mesmo item.

UI/UX:

- [ ] Tela de custodia com timeline clara.
- [ ] Modal de confirmacao para acoes irreversiveis.
- [ ] Badges por estado: aberto, aguardando aprovacao, em analise, reservado, devolvido, arquivado.

### Fase 3 - Cadastro, Busca Avancada e Matchmaking

Backend:

- [ ] Criar service `ItemCreationService` para validar, normalizar e enriquecer dados.
- [ ] Criar taxonomia controlada de categorias: documentos, eletronicos, acessorios, vestuario, chaves, bolsas, material escolar, pets, outros.
- [ ] Normalizar texto com lower-case, remocao de acentos, stopwords e sinonimos.
- [ ] Criar busca avancada com:
  - texto livre
  - categoria
  - subcategoria
  - tipo (`lost` ou `found`)
  - intervalo de datas
  - raio geografico
  - organizacao/espaco
  - status
  - possui foto
  - cor/marca/modelo
  - ordenacao por relevancia, proximidade, data, confianca.
- [ ] Implementar paginacao cursor-based para feeds grandes.
- [ ] Implementar `saved_searches` com notificacao quando surgir match.

Algoritmo de cruzamento:

- [ ] Criar modulo `matching`.
- [ ] Rodar matching ao criar/editar/aprovar item e tambem por job periodico.
- [ ] Cruzar apenas itens complementares: item `lost` contra `found`, e vice-versa.
- [ ] Excluir itens devolvidos, rejeitados, bloqueados ou sem permissao de visibilidade.
- [ ] Salvar candidatos em `match_candidates` com score, fatores e versao do algoritmo.
- [ ] Expor sugestoes em:
  - detalhe do item
  - dashboard do cidadao
  - painel do gestor
  - notificacoes.

Pontuacao sugerida v1:

```txt
score_total =
  0.25 * categoria
+ 0.20 * similaridade_textual
+ 0.15 * atributos_estruturados
+ 0.15 * proximidade_geografica
+ 0.10 * proximidade_temporal
+ 0.10 * similaridade_visual
+ 0.05 * confianca_do_usuario_ou_espaco
```

Detalhamento:

- Categoria:
  - 1.0 se categoria igual.
  - 0.7 se mesma familia.
  - 0.0 se incompativel.
- Texto:
  - trigram/FTS para titulo e descricao.
  - sinonimos: "celular", "smartphone"; "carteira", "porta cartao"; "fone", "airpods".
- Atributos:
  - cor, marca, modelo, material, tamanho, ultimos 4 caracteres de identificador quando aplicavel.
- Geografia:
  - score decai com distancia; raio padrao por categoria.
  - documentos podem ter raio maior; itens em campus/shopping devem priorizar mesmo espaco.
- Tempo:
  - score alto para datas proximas; tolerancia configuravel por categoria.
- Visual:
  - labels de visao computacional e, se aprovado juridicamente, embeddings de imagem.

Pseudofluxo:

```txt
on ItemApproved(item):
  candidates = findComplementaryItems(item, filters)
  for candidate in candidates:
    factors = calculateFactors(item, candidate)
    score = weightedScore(factors)
    if score >= threshold:
      upsert match_candidates(item, candidate, score, factors, algorithm_version)
      if score >= notify_threshold:
        enqueueNotification()
```

Frontend/Flutter:

- [ ] Cadastro em wizard de 3 passos: tipo, detalhes, local/data/foto, revisao.
- [ ] Auto-save local e recuperacao de rascunho.
- [ ] Preview de foto, crop simples, compressao e aviso de privacidade.
- [ ] Busca com filtros colapsaveis no mobile e sidebar no desktop.
- [ ] Resultados em lista/mapa, com chips de filtro e ordenacao.
- [ ] Cartao de sugestao com "possivel match", fatores de confianca e acao segura.

Banco de Dados:

- [ ] Adicionar indices FTS/trigram.
- [ ] Adicionar PostGIS para raio geografico.
- [ ] Adicionar `match_candidates`.
- [ ] Adicionar `item_attributes` se atributos variarem muito por categoria.

APIs:

- [ ] `GET /api/v1/items/search`
- [ ] `GET /api/v1/items/:id/matches`
- [ ] `POST /api/v1/items/:id/recompute-matches`
- [ ] `PATCH /api/v1/matches/:id/feedback`

Testes:

- [ ] Unit tests de score por fator.
- [ ] Golden tests com pares esperados.
- [ ] Testes de regressao para evitar recomendacoes absurdas.
- [ ] Testes de privacidade: sugestoes nao podem revelar dados pessoais.

UI/UX:

- [ ] Skeleton para busca e detalhe.
- [ ] Empty states com proximas acoes: ampliar raio, remover filtros, salvar busca.
- [ ] Feedback de confianca sem prometer certeza absoluta.

### Fase 4 - Validacao de Propriedade, Claims e Anti-Fraude

Backend:

- [ ] Transformar `claims` em workflow:
  - `draft`
  - `submitted`
  - `under_review`
  - `needs_more_info`
  - `approved`
  - `rejected`
  - `cancelled`
  - `returned`
- [ ] Criar perguntas de verificacao por categoria:
  - documentos: campos parciais e mascarados.
  - eletronicos: marca/modelo/cor/acessorios/senha de tela nao solicitada.
  - bolsas/mochilas: conteudo interno sem expor dados publicamente.
  - chaves: quantidade, chaveiro, marca/identificador parcial.
- [ ] Permitir anexos de evidencia com storage seguro e expiracao.
- [ ] Criar scoring anti-fraude: claims repetidas, padroes de texto, conta nova, IP suspeito, baixa similaridade.
- [ ] Criar fila de revisao humana para casos ambiguos.
- [ ] Bloquear auto-aprovacao quando score de risco for alto.

Frontend/Flutter:

- [ ] Formulario de reivindicacao orientado por categoria.
- [ ] Avisos claros: nao pedir senhas, PIN, token bancario, foto completa de documento ou dados sensiveis desnecessarios.
- [ ] Status tracking da reivindicacao.
- [ ] Fluxo de "mais informacoes solicitadas".

Banco de Dados:

- [ ] `claim_questions`
- [ ] `claim_answers`
- [ ] `claim_evidence`
- [ ] `claim_reviews`
- [ ] `risk_signals`

APIs:

- [ ] `POST /api/v1/items/:id/claims`
- [ ] `GET /api/v1/claims/:id`
- [ ] `PATCH /api/v1/claims/:id/status`
- [ ] `POST /api/v1/claims/:id/evidence`
- [ ] `POST /api/v1/claims/:id/request-more-info`

Testes:

- [ ] Testar que o dono nao reivindica o proprio item.
- [ ] Testar que usuario sem permissao nao ve evidencias.
- [ ] Testar rejeicao/aprovacao com auditoria.
- [ ] Testar mascaramento nos payloads.

UI/UX:

- [ ] Formularios com linguagem humana e progresso visivel.
- [ ] Microcopy de seguranca contextual.
- [ ] Estados: enviado, em analise, aprovado, rejeitado, devolvido.

### Fase 5 - Seguranca, Sessao e LGPD

Backend:

- [ ] Implementar refresh token de verdade usando tabela existente, hash do token, rotacao e revogacao.
- [ ] Mover access token para memoria no cliente e refresh token para cookie httpOnly/Secure/SameSite.
- [ ] Adicionar logout server-side revogando refresh token.
- [ ] Adicionar MFA para administradores e gestores.
- [ ] Adicionar verificacao de email antes de publicar ou reivindicar.
- [ ] Adicionar reset de senha com token de uso unico e expiracao curta.
- [ ] Padronizar politica de senha e defesa contra credential stuffing.
- [ ] Substituir rate limit em memoria por Redis.
- [ ] Adicionar CORS estrito por ambiente.
- [ ] Adicionar CSP revisada para mapas, storage e analytics.
- [ ] Sanitizar/validar uploads por magic bytes, nao so MIME.
- [ ] Remover EXIF das imagens.
- [ ] Adicionar antivirus/antimalware em anexos se houver upload de documentos.
- [ ] Assinar URLs de arquivos privados.
- [ ] Criptografar dados sensiveis seletivos no banco com KMS ou envelope encryption.
- [ ] Registrar data access logs para acesso a evidencias, emails e claims.

LGPD:

- [ ] Mapear bases legais por finalidade:
  - cadastro e autenticacao
  - publicacao de item
  - reivindicacao
  - comunicacao
  - auditoria e prevencao a fraude
  - relatorios institucionais
  - notificacoes e marketing, se existir.
- [ ] Criar `privacy_consents` versionado por termo, finalidade, data, IP e user agent.
- [ ] Criar tela de privacidade com termos, consentimentos e preferencias.
- [ ] Criar direitos do titular:
  - acesso
  - correcao
  - portabilidade quando aplicavel
  - revogacao de consentimento
  - exclusao/anonimizacao
  - informacao sobre compartilhamento.
- [ ] Criar `data_subject_requests` com SLA e auditoria.
- [ ] Definir encarregado/canal de privacidade.
- [ ] Fazer RIPD/DPIA para fotos, geolocalizacao, claims e visao computacional.
- [ ] Implementar retencao automatizada e anonimizacao.
- [ ] Implementar mascaramento:
  - email: `m***@dominio.com`
  - telefone: ultimos 4 digitos apenas, se telefone existir.
  - documentos: nunca exibir numero completo.
  - local: publico deve ser aproximado, exato so para gestor autorizado.

Frontend/Flutter:

- [ ] Criar centro de privacidade.
- [ ] Criar banner/fluxo de consentimento quando necessario.
- [ ] Criar controles de notificacao por canal.
- [ ] Garantir que dados pessoais nao fiquem em logs/client storage.

Banco de Dados:

- [ ] Adicionar colunas/tabelas de consentimento, requests de titular, retencao e criptografia.
- [ ] Criar views publicas mascaradas para listagem.
- [ ] Criar politicas de row-level security no PostgreSQL quando viavel.

APIs:

- [ ] `GET /api/v1/privacy/summary`
- [ ] `POST /api/v1/privacy/consents`
- [ ] `GET /api/v1/privacy/export`
- [ ] `POST /api/v1/privacy/delete-request`
- [ ] `PATCH /api/v1/users/me/preferences`

Testes:

- [ ] Testes de acesso indevido a dados pessoais.
- [ ] Testes de retencao/anonimizacao.
- [ ] Testes de cookies e CSRF.
- [ ] SAST/DAST no pipeline.

UI/UX:

- [ ] Linguagem clara sobre uso de foto, localizacao e dados de reivindicacao.
- [ ] Nao usar dark patterns para consentimento.
- [ ] Feedback claro quando usuario revoga notificacoes ou pede exclusao.

### Fase 6 - Chat Interno Seguro e Comunicacao

Backend:

- [ ] Criar `conversations` associadas a item/claim.
- [ ] Criar `messages` com participantes, corpo, status, anexos e moderacao.
- [ ] Nunca expor email/telefone/endereco pessoal no chat.
- [ ] Adicionar detector de PII para bloquear/mascarar contatos pessoais.
- [ ] Adicionar report/block user.
- [ ] Adicionar moderacao por palavra-chave, ML ou fila humana.
- [ ] Implementar WebSocket/SSE para tempo real ou polling no MVP.
- [ ] Criar notificacoes in-app, email e push desacopladas via fila.

Frontend/Flutter:

- [ ] Tela de inbox.
- [ ] Chat contextual do item/claim.
- [ ] Estados de mensagem: enviando, enviado, lido, bloqueado por politica, denunciado.
- [ ] UX para agendamento de entrega em local seguro sem compartilhar contato pessoal.

Banco de Dados:

- [ ] `conversations`
- [ ] `conversation_participants`
- [ ] `messages`
- [ ] `message_moderation_events`
- [ ] `delivery_appointments`

APIs:

- [ ] `GET /api/v1/conversations`
- [ ] `POST /api/v1/conversations`
- [ ] `GET /api/v1/conversations/:id/messages`
- [ ] `POST /api/v1/conversations/:id/messages`
- [ ] `POST /api/v1/messages/:id/report`
- [ ] `POST /api/v1/delivery-appointments`

Testes:

- [ ] Usuario fora da conversa nao le mensagens.
- [ ] Mensagens com telefone/email sao mascaradas ou bloqueadas conforme politica.
- [ ] Moderador ve somente o necessario.
- [ ] Notificacao e enviada sem conteudo sensivel.

UI/UX:

- [ ] Chat com foco em seguranca, sem solicitar contato externo.
- [ ] Avisos discretos antes do envio quando texto contem dado pessoal.
- [ ] Botao claro para reportar abuso.

### Fase 7 - Painel Administrativo, B2B e Relatorios

Backend:

- [ ] Separar admin global de painel institucional.
- [ ] Criar inventario interno por organizacao e espaco.
- [ ] Criar workflow de guarda:
  - entrada
  - armazenamento
  - transferencia
  - analise de claim
  - agendamento
  - devolucao
  - arquivamento/descarte conforme politica.
- [ ] Criar relatorios agregados por periodo, categoria, local, SLA, taxa de devolucao, backlog, itens expirados.
- [ ] Criar export CSV/XLSX com filtros e mascaramento.
- [ ] Criar relatorios assincronos para grandes volumes.

Frontend React B2B/Admin:

- [ ] Dashboard institucional com KPIs compactos.
- [ ] Tabela de inventario com filtros, busca, bulk actions e colunas configuraveis.
- [ ] Tela de item com cadeia de custodia e historico.
- [ ] Fila de claims com priorizacao por score/risco/SLA.
- [ ] Relatorios com graficos simples e exportacao.
- [ ] Gestao de usuarios, roles, convites e espacos.

Flutter:

- [ ] Views mobile para gestor em campo: check-in rapido, leitura de QR, foto, transferencia e devolucao.

Banco de Dados:

- [ ] `custody_events`
- [ ] `inventory_locations`
- [ ] `return_receipts`
- [ ] `report_jobs`
- [ ] `report_snapshots`

APIs:

- [ ] `GET /api/v1/orgs/:id/metrics`
- [ ] `GET /api/v1/orgs/:id/inventory`
- [ ] `POST /api/v1/report-jobs`
- [ ] `GET /api/v1/report-jobs/:id/download`
- [ ] `GET /api/v1/audit-logs`

Testes:

- [ ] Testar escopo de relatorios.
- [ ] Testar export sem PII indevida.
- [ ] Testar trilha de auditoria imutavel para acoes criticas.

UI/UX:

- [ ] Visual de ferramenta operacional: denso, legivel, previsivel.
- [ ] Evitar cards decorativos em excesso.
- [ ] Usar tabelas robustas, filtros salvos e indicadores de SLA.

### Fase 8 - Integracoes Externas

Geolocalizacao:

- [ ] Escolher Google Maps ou Mapbox por custo, cobertura, termos e experiencia.
- [ ] Criar interface `GeoProvider` para nao prender regra de negocio ao fornecedor.
- [ ] Implementar autocomplete de local, geocoding, reverse geocoding e mapa.
- [ ] Salvar `place_id`, lat/lng, precisao e label publico.
- [ ] Nunca publicar localizacao exata por padrao quando isso expuser pessoa fisica.
- [ ] Proteger chaves no backend sempre que possivel; no cliente, restringir por dominio/app.

Visao Computacional:

- [ ] Escolher Google Vision ou AWS Rekognition.
- [ ] Rodar classificacao de foto em job assincrono.
- [ ] Salvar labels, confianca, provedor e versao do modelo.
- [ ] Usar labels para sugerir categoria/cor e alimentar matching.
- [ ] Moderar imagens inadequadas.
- [ ] Permitir revisao humana quando confianca for baixa.

Push Notifications:

- [ ] Integrar Firebase Cloud Messaging em Flutter e Web.
- [ ] Criar `notification_devices` com token, plataforma, usuario, opt-in e ultima atividade.
- [ ] Implementar templates por evento.
- [ ] Nunca incluir dados sensiveis no corpo da push.
- [ ] Criar fallback email/in-app.

Compartilhamento Social:

- [ ] Implementar Web Share API no web quando disponivel.
- [ ] Implementar share nativo no Flutter.
- [ ] Compartilhar link publico com dados minimizados.
- [ ] Adicionar Open Graph com imagem segura e texto sem PII.

APIs internas:

- [ ] Adicionar webhooks para organizacoes parceiras quando necessario.
- [ ] Assinar webhooks com HMAC.
- [ ] Criar rate limit e quotas por organizacao.

Testes:

- [ ] Mockar provedores externos em testes.
- [ ] Testar fallback quando API externa falhar.
- [ ] Testar quotas, timeouts, retry e circuit breaker.

UI/UX:

- [ ] Mostrar sugestoes de categoria por foto sem parecer decisao final.
- [ ] Mostrar permissao de localizacao com contexto claro.
- [ ] Fornecer input manual quando geolocalizacao falhar.

### Fase 9 - Redesign Profissional: Material 3, HIG e Acessibilidade

Direcao visual:

- [ ] Definir identidade ARGOS: confianca, clareza, acolhimento e eficiencia operacional.
- [ ] Paleta com bom contraste, evitando dominio de uma unica cor.
- [ ] Tipografia responsiva por escala sem `viewport font scaling`.
- [ ] Componentes com radius maximo de 8px salvo excecoes de sistema.
- [ ] Iconografia consistente com Material Symbols no Flutter e lucide no React.
- [ ] Estados de foco sempre visiveis.

Flutter Mobile/Web:

- [ ] Criar tema Material 3 com `ColorScheme.fromSeed` ou tokens customizados.
- [ ] Usar `NavigationBar` no mobile e `NavigationRail`/`NavigationDrawer` no tablet/desktop.
- [ ] Criar `SliverAppBar`/top app bars adequados a cada fluxo.
- [ ] Usar `FilledButton`, `OutlinedButton`, `TextButton`, `IconButton`, `SegmentedButton`, `SearchBar`, `DateRangePicker`, `FilterChip`, `Badge`, `SnackBar`, `Dialog` e `BottomSheet`.
- [ ] Usar `Semantics`, labels, hints e ordem de foco correta.
- [ ] Suportar Dynamic Type/text scale sem quebra de layout.
- [ ] Suportar dark mode sem perder contraste.

React Web atual:

- [ ] Criar camada de componentes: `Button`, `IconButton`, `TextField`, `Select`, `Textarea`, `Badge`, `Alert`, `Skeleton`, `Dialog`, `Tabs`, `DataTable`, `Pagination`, `EmptyState`.
- [ ] Refatorar CSS global para tokens e componentes.
- [ ] Trocar topbar generica por cabecalhos contextuais por tela.
- [ ] Reorganizar navegacao:
  - publico: busca, detalhe, login.
  - cidadao: dashboard, meus itens, reivindicacoes, conversas, privacidade.
  - gestor: inventario, claims, relatorios, equipe.
  - admin: plataforma, tenants, auditoria.
- [ ] Criar layout responsivo com barra inferior ou nav compacta no mobile.
- [ ] Evitar texto explicativo de funcionalidades dentro da UI quando a acao ja e clara.

Telas:

- [ ] Busca publica:
  - SearchBar proeminente.
  - chips de filtros.
  - filtros avancados colapsaveis.
  - alternancia lista/mapa.
  - ordenacao por relevancia/proximidade/data.
  - cards com imagem, status, categoria, distancia aproximada e data.
- [ ] Cadastro:
  - wizard curto.
  - upload com preview.
  - sugestao de categoria por foto.
  - validacao inline.
  - revisao antes de enviar.
- [ ] Detalhe:
  - imagem com aspect ratio fixo.
  - dados publicos minimizados.
  - CTA contextual: reivindicar, editar, conversar, marcar devolvido.
  - matches relacionados.
- [ ] Minhas publicacoes:
  - tabs por status.
  - filtros.
  - acoes rapidas.
- [ ] Claims:
  - progresso.
  - solicitacao de info adicional.
  - mensagens seguras.
- [ ] Admin/B2B:
  - KPIs.
  - tabelas.
  - filas de revisao.
  - auditoria.
  - relatorios.
- [ ] Privacidade:
  - consentimentos.
  - preferencias.
  - exportar meus dados.
  - solicitar exclusao.

Acessibilidade:

- [ ] WCAG 2.2 AA como baseline.
- [ ] Contraste minimo 4.5:1 para texto normal.
- [ ] Todos inputs com label visivel ou programatico.
- [ ] Imagens de itens com alt text util ou decorativo quando aplicavel.
- [ ] Navegacao completa por teclado.
- [ ] Ordem de tab previsivel.
- [ ] Estados anunciados por leitores de tela.
- [ ] Alvos de toque minimos adequados.
- [ ] Formulario sem depender apenas de cor.

Testes UI:

- [ ] Storybook ou equivalente para React.
- [ ] Golden tests no Flutter.
- [ ] Playwright com screenshots desktop/mobile.
- [ ] Axe/pa11y no pipeline.
- [ ] Teste manual com leitor de tela.

### Fase 10 - Observabilidade, DevOps e Deploy

Backend:

- [ ] Dockerfile multi-stage.
- [ ] Health checks: live, ready, startup.
- [ ] Logs JSON com request id, user id, org id e latencia.
- [ ] OpenTelemetry para tracing.
- [ ] Sentry para exceptions.
- [ ] Metricas Prometheus/OpenMetrics.
- [ ] Graceful shutdown.
- [ ] Jobs resilientes com retry e dead-letter queue.

Frontend/Flutter:

- [ ] Build por ambiente.
- [ ] Source maps protegidos.
- [ ] Monitoramento de erro frontend.
- [ ] Web vitals/performance.
- [ ] PWA opcional para web cidadao.

Banco de Dados:

- [ ] Backup automatico.
- [ ] Restore testado.
- [ ] Migracoes em CI.
- [ ] Seeds separados por ambiente.
- [ ] Politica de retencao e arquivamento.

APIs:

- [ ] OpenAPI publicada internamente.
- [ ] Contract tests.
- [ ] Idempotency keys para acoes criticas.
- [ ] Timeout/retry/circuit breaker em provedores externos.
- [ ] Rate limit e quotas por IP, usuario e organizacao.

Testes:

- [ ] Pipeline CI: lint, typecheck, unit, integration, e2e, audit, SAST.
- [ ] Pipeline CD com staging e aprovacao manual para producao.
- [ ] Smoke tests pos-deploy.
- [ ] Rollback automatizado ou runbook validado.

UI/UX:

- [ ] Monitorar funis: busca, cadastro, claim, match aceito, devolucao.
- [ ] Coletar feedback in-app sem expor PII.

### Fase 11 - Testes Finais, UAT e Go-Live

Backend:

- [ ] Congelar API v1.
- [ ] Fazer pentest ou revisao externa.
- [ ] Rodar carga nos fluxos de busca, upload, matching e chat.
- [ ] Validar tempos de resposta:
  - search p95 menor que 500 ms no dataset esperado.
  - detalhe p95 menor que 300 ms.
  - upload assincrono com feedback imediato.

Frontend/Flutter:

- [ ] Validar dispositivos principais Android/iOS/tablet/web.
- [ ] Validar navegadores modernos.
- [ ] Validar fluxo offline/parcial quando aplicavel.
- [ ] Corrigir regressao visual.

Banco de Dados:

- [ ] Validar restore em ambiente isolado.
- [ ] Validar retencao e anonimizacao em staging.
- [ ] Validar indices em dataset parecido com producao.

APIs:

- [ ] Testar limites e respostas amigaveis quando provedores externos falham.
- [ ] Validar chaves restritas e rotacao de secrets.
- [ ] Validar webhooks assinados.

Testes:

- [ ] UAT com cidadao.
- [ ] UAT com gestor de espaco.
- [ ] UAT com administrador.
- [ ] Checklist LGPD/juridico assinado.
- [ ] Checklist de acessibilidade assinado.
- [ ] Checklist de seguranca assinado.

UI/UX:

- [ ] Nenhum texto quebrado.
- [ ] Nenhum layout com overflow em mobile.
- [ ] Nenhum botao sem estado de loading.
- [ ] Nenhum formulario sem erro inline.
- [ ] Nenhuma tela sem empty/error state.

## 5. Mapa de Refatoracao por Arquivo Atual

Backend:

- `backend/src/db/database.ts`
  - Refatorar migracao manual para ferramenta versionada.
  - Expandir schema para multi-tenancy, geodados, matching, chat, LGPD e custodia.
  - Corrigir seed admin para nao resetar senha.
- `backend/src/middleware/auth.ts`
  - Trocar `admin` fixo por policies.
  - Implementar refresh token e revogacao.
  - Reduzir dados no `req.user` ao necessario.
- `backend/src/middleware/rateLimit.ts`
  - Trocar Map em memoria por Redis.
  - Criar politicas por rota e usuario.
- `backend/src/modules/items/items.routes.ts`
  - Separar rotas de services/repositories.
  - Adicionar geolocalizacao, busca avancada, matching, claims estruturadas.
  - Ocultar dados privados em detalhe publico.
- `backend/src/modules/admin/admin.routes.ts`
  - Separar admin global de org admin.
  - Adicionar auditoria generica.
  - Remover senha temporaria fixa `Argos@123`.
- `backend/src/modules/uploads/uploads.routes.ts`
  - Validar magic bytes.
  - Remover EXIF.
  - Migrar para storage externo.
  - Criar URLs assinadas.
- `backend/src/modules/reports/reports.routes.ts`
  - Adicionar filtros, mascaramento, export assincrono e permissao por org.

Frontend:

- `frontend/src/contexts/AuthContext.tsx`
  - Remover JWT de `localStorage`.
  - Adicionar refresh flow seguro.
  - Adicionar estado `checkingSession`.
- `frontend/src/services/api.ts`
  - Padronizar base URL publica/privada.
  - Adicionar retry controlado, request id, interceptadores de erro padronizados.
- `frontend/src/components/ProtectedRoute.tsx`
  - Trocar por permissao granular.
- `frontend/src/components/Layout.tsx`
  - Navegacao responsiva e contextual.
  - Remover textos genericos e corrigir encoding.
- `frontend/src/pages/ItemsPage.tsx`
  - Loading/error state.
  - Filtros dinamicos, data, geolocalizacao, map/list view.
  - Evitar URL hardcoded em imagem.
- `frontend/src/pages/ItemDetailPage.tsx`
  - Skeleton, erro 404, claim estruturada, chat e matches.
  - Nao mostrar historico sensivel ao publico.
- `frontend/src/pages/ItemFormPage.tsx`
  - Wizard, preview, auto-save, sugestao por foto e validacao inline.
- `frontend/src/pages/AdminPage.tsx`
  - Quebrar em subrotas/tabs.
  - Fila de revisao, usuarios, orgs, auditoria e relatorios.
  - Remover senha temporaria fixa.
- `frontend/src/styles.css`
  - Evoluir para tokens + componentes.
  - Corrigir responsividade fina, estados, contraste e acessibilidade.

## 6. Backlog Priorizado

P0 - Bloqueia producao:

- [ ] Dependencias vulneraveis corrigidas.
- [ ] Tokens fora de `localStorage`; refresh token seguro.
- [ ] RBAC por permissao e escopo.
- [ ] Remocao de dados pessoais em endpoints publicos.
- [ ] Upload seguro.
- [ ] PostgreSQL + migrations.
- [ ] Testes criticos automatizados.
- [ ] LGPD minima: termos, consentimento, privacidade, mascaramento, retencao e requests do titular.
- [ ] Observabilidade e backup/restore.

P1 - Necessario para produto robusto:

- [ ] Matchmaking v1.
- [ ] Busca avancada com geolocalizacao.
- [ ] Claims estruturadas.
- [ ] Dashboard B2B multi-tenant.
- [ ] Chat seguro moderado.
- [ ] Push notifications.
- [ ] Redesign Material 3/HIG.

P2 - Diferenciadores:

- [ ] Visao computacional para auto-categorizacao.
- [ ] Busca vetorial por imagem/texto.
- [ ] Relatorios avancados e previsoes.
- [ ] Webhooks para parceiros.
- [ ] App Flutter completo com paridade web/mobile.

## 7. Sequencia Recomendada de Implementacao

1. Fase 0: estabilizacao, seguranca basica, audit, encoding e testes smoke.
2. Fase 1: RBAC, organizacoes, espacos e tenant isolation.
3. Fase 2: PostgreSQL, migrations e modelo de custodia.
4. Fase 3: busca avancada e matchmaking.
5. Fase 4: claims estruturadas e anti-fraude.
6. Fase 5: LGPD completa e endurecimento de sessao.
7. Fase 6: chat e comunicacao segura.
8. Fase 7: painel B2B e relatorios.
9. Fase 8: APIs externas.
10. Fase 9: redesign profissional React/Flutter.
11. Fase 10: DevOps/observabilidade.
12. Fase 11: UAT, pentest, go-live.

## 8. Riscos e Mitigacoes

- Risco: Migrar tudo para Flutter imediatamente atrasar producao.
  - Mitigacao: manter React para admin/B2B e criar Flutter para cidadao, com API compartilhada.
- Risco: Fotos e claims coletarem dados sensiveis em excesso.
  - Mitigacao: minimizacao, aviso no upload, EXIF stripping, mascaramento, revisao e retencao curta.
- Risco: Matchmaking gerar falso positivo e entregar item a pessoa errada.
  - Mitigacao: sugestao nunca e aprovacao; exigir verificacao humana/protocolo para devolucao.
- Risco: Multi-tenancy vazar dados entre organizacoes.
  - Mitigacao: policies centralizadas, testes negativos e row-level security quando possivel.
- Risco: APIs externas ficarem caras/instaveis.
  - Mitigacao: abstracao de provider, cache, quotas, fallback manual e circuit breaker.
- Risco: Chat virar canal de troca de contatos ou abuso.
  - Mitigacao: PII detection, moderacao, denuncia, bloqueio e auditoria.

## 9. Referencias Oficiais Consultadas

- Material Design 3: https://m3.material.io/
- Flutter Material 3 migration: https://docs.flutter.dev/release/breaking-changes/material-3-migration
- Flutter accessibility: https://docs.flutter.dev/ui/accessibility
- Apple Human Interface Guidelines: https://developer.apple.com/design/human-interface-guidelines/
- LGPD, Lei 13.709/2018: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm
- ANPD, guia de seguranca da informacao: https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia-vf.pdf/@@display-file/file
- OWASP ASVS: https://owasp.org/www-project-application-security-verification-standard/
- Google Maps Platform docs: https://developers.google.com/maps/documentation
- Mapbox docs: https://docs.mapbox.com/
- Firebase Cloud Messaging para Flutter: https://firebase.google.com/docs/cloud-messaging/flutter/get-started
- Google Cloud Vision label detection: https://docs.cloud.google.com/vision/docs/labels
- AWS Rekognition DetectLabels: https://docs.aws.amazon.com/rekognition/latest/APIReference/API_DetectLabels.html
- MDN Web Share API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API




