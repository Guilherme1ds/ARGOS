# ARGOS — Plano de implementação pós-auditoria

Este plano deriva dos achados em [01_RELATORIO_DE_AUDITORIA.md](01_RELATORIO_DE_AUDITORIA.md). Não foi executado nesta auditoria. A ordem mantém primeiro segurança e integridade, depois contrato/jornadas, validação de clientes e operação.

## Regras gerais de execução

- Revalidar cada achado no branch de implementação antes de alterar o código; o estado pode ter mudado.
- Preservar a arquitetura React + Express + Flutter e o contrato existente. Não substituir SQLite por PostgreSQL nem separar serviços sem requisito confirmado de escala/tenant.
- Nunca executar teste com o SQLite/upload de desenvolvimento ou produção. Testes de integração devem usar processo/backend descartável, `DATABASE_URL` e `UPLOAD_DIR` únicos em pasta temporária, integrações externas desligadas e limpeza limitada ao diretório criado pelo próprio teste.
- Atualizar OpenAPI, testes e documentação no mesmo change set das alterações de API. Não armazenar valores de segredo em prompts, logs, screenshots ou artefatos de CI.
- Ao final de cada etapa, registrar comandos reais, resultado, ambiente e falhas. Um build não substitui testes de fluxo.

## Etapa 0 — Decisões e baseline

**Prioridade:** pré-requisito.  
**Dependências:** nenhuma.

### Trabalho

1. Confirmar se o ARGOS seguirá como sistema de campus único ou se deve suportar várias organizações/espaços. Enquanto isso não for decidido, não promover contas a `org_admin`, `space_manager` ou `support` com alcance global.
2. Definir se cada publicação nova é pública imediatamente (`approval_status='approved'`) ou deve aguardar moderação. Não mudar esse comportamento por suposição.
3. Definir domínios web/API, transportador de e-mail, armazenamento de dados/imagens, RPO/RTO, prazo de retenção, responsável/versão oficial do aviso de privacidade e recuperação mobile.
4. Registrar versões instaladas e rodar a baseline segura do relatório em branch de implementação.

### Arquivos e áreas

Documentação de produto/deploy; `backend/.env.example`; `README.md`; decisão de papéis em `backend/src/shared/policies/permissions.ts`.

### Aceite

- Documento curto de decisões com single-tenant/multi-tenant, política de moderação, domínios, e-mail, retenção e restauração.
- Testes continuam usando caminhos isolados; nenhuma variável local ou valor de produção é copiado para o repositório.

## Etapa 1 — Bloqueadores de segurança e dependências

**Prioridade:** P1.  
**Dependências:** Etapa 0 para domínios, SMTP e implantação; nenhuma para iniciar correções independentes.

### 1.1 Remover exposição de links de recuperação

- Em `backend/src/utils/mail.ts`, restringir modo de log local a ambiente explicitamente não produtivo; não registrar destinatário/corpo de mensagens de autenticação.
- Em `backend/src/config/env.ts`, exigir transporte seguro (SMTP ou provedor equivalente) em produção. Se ausente, falhar o envio com erro operacional rastreável e sem vazar token.
- Em `backend/src/modules/auth/auth.routes.ts`, manter token aleatório, hash no banco, uso único e expiração; avaliar remover o token da query string após o formulário o ler.
- Ao concluir envio em `mail_outbox`, redigir campos sensíveis e criar expurgo de mensagens entregues/falhas conforme retenção. Remover/expirar registros antigos de `password_resets` sem apagar tokens ainda necessários para auditoria mínima.

**Aceite:** teste automatizado prova que URL/token não aparece em stdout, erro, log ou outbox após entrega; ambiente de produção sem transporte não inicia ou não oferece recuperação silenciosamente.

### 1.2 Atualizar dependências vulneráveis

- Revisar e atualizar `backend/package.json` e `backend/package-lock.json`: `proxy-addr`, `body-parser`, `multer`, `nodemailer`, `sharp`, `zod`, `qs` e outras dependências sinalizadas por `npm audit` na data de execução.
- Revisar e atualizar `frontend/package.json` e `frontend/package-lock.json`: `axios`, `follow-redirects`, Vite e source map transitivo.
- Conferir correções em advisories atuais e changelogs; Zod/Nodemailer podem exigir major upgrade. Atualizar código/testes compatíveis e evitar `npm audit fix --force` indiscriminado.
- Se `TRUST_PROXY` for ativado, validar range/hops/proxy confiável ou exigir que a borda remova cabeçalhos recebidos do cliente. Uma flag booleana que confia indiscriminadamente no X-Forwarded-For não basta.

**Aceite:** `npm audit` e `npm audit --omit=dev` sem vulnerabilidade alta/crítica sem exceção aceita; typecheck, testes e builds reais passam; risco residual por advisory documentado com alcance e plano.

### 1.3 Endurecer validação de produção

- Em `backend/src/config/env.ts`, validar comprimento/entropia do segredo JWT, obrigatoriedade e política forte de senha administrativa, TTLs permitidos, URL/origens válidas e valores necessários à recuperação de senha.
- Remover defaults inseguros de todos os modos de produção; falhar no boot com mensagem que nomeie variável, sem revelar valores.

**Aceite:** testes de configuração rejeitam segredos fracos, defaults, TTL malformado, URL inválida e ausência de transporte exigido antes de abrir a API.

## Etapa 2 — Identidade, sessão e papéis

**Prioridade:** P1.  
**Dependências:** Etapa 0 (política de cadastro/domínios) e Etapa 1.1 (transporte de verificação).

### 2.1 Verificar e-mail de cadastro por senha

- Implementar tabela/colunas e endpoints mínimos para token de confirmação com hash, validade, uso único e reenvio com limite.
- Criar por senha em estado não verificado e bloquear ações definidas pela política até confirmação; não conflitar com contas Google verificadas e aprovações institucionais legítimas.
- Atualizar telas web em `frontend/src/pages/LoginPage.tsx` e Flutter em `apps/flutter/lib/features/auth/presentation/login_screen.dart` para explicar estado, reenviar e continuar após confirmação.
- Definir política de migração para contas existentes sem `email_verified_at`; não presumir que estão verificadas.

### 2.2 Resolver escopo de autorização

- Se single-tenant: remover/ocultar permissões de organização/espaço que sugerem isolamento inexistente, mantendo acesso global só para `platform:admin`; documentar o suporte/moderação que ainda deve ser global.
- Se multi-tenant: adicionar organização/espaço e chaves estrangeiras às entidades necessárias, contexto de tenant ao usuário e filtro obrigatório em dashboard, CSV, claims, matching, admin, auditoria, busca e notificações.
- Atualizar `backend/src/shared/policies/permissions.ts`, `backend/src/modules/reports/reports.routes.ts`, `dashboard.routes.ts`, `items.routes.ts`, `admin.routes.ts`, `database.ts`, DTOs frontend e OpenAPI.

**Aceite:** teste negativo de IDOR prova que usuário/papel de tenant A não acessa nenhum dado de B; acesso global só é concedido explicitamente. Cadastro não verificado não pode operar conforme política acordada.

### 2.3 Sessão cross-site

- Com domínios da Etapa 0, preferir proxy same-site; se cross-site for necessário, configurar cookies `SameSite=None; Secure` e CSRF/origem para mutações baseadas em cookie.
- Atualizar os clientes em `frontend/src/services/api.ts` e `apps/flutter/lib/core/network/browser_config_web.dart` apenas se contrato/domínio exigir.

**Aceite:** teste de browser nos domínios reais cobre login, reload, refresh, logout, origem permitida/negada e tentativa CSRF.

## Etapa 3 — Privacidade, retenção e exclusão de conta

**Prioridade:** P1/P2.  
**Dependências:** Etapa 0 para política e Etapa 1.1 para e-mail.

### Trabalho

- Tornar a versão do aviso autoritativa no servidor; não aceitar versão de consentimento arbitrária do cliente. Centralizar versão/copy em um só lugar.
- Implementar o fluxo de revogação aplicável ou corrigir a lista de direitos/ações na página, API e Flutter. Registrar evento, data e efeito do consentimento.
- Revisar `anonymizeAccount` em `backend/src/modules/auth/auth.routes.ts`: tratar `access_requests`, `mail_outbox`, auditoria, uploads, claims e associações; distinguir o que é apagado, anonimizado ou retido por finalidade.
- Fazer `/privacy/export` cobrir todas as categorias pessoais sob controle do titular e garantir que dados de terceiros não sejam expostos.
- Publicar uma tabela de retenção com responsável para auditoria, notificações, logs, e-mail, reset tokens, uploads órfãos e consentimentos.

### Arquivos prováveis

`backend/src/modules/auth/auth.routes.ts`, `backend/src/modules/privacy/privacy.routes.ts`, `backend/src/modules/admin/admin.routes.ts`, `backend/src/db/database.ts`, telas de `frontend/src/pages/PrivacyPage.tsx`, `SettingsPage.tsx` e `apps/flutter/lib/features/items/presentation/account_screens.dart`.

### Aceite

- Teste cria registros em todas as tabelas relevantes, exporta, apaga/anônimiza a conta e comprova o destino de cada dado segundo a política.
- O texto de sucesso não afirma remoção de dados que foram retidos. Direitos exibidos têm fluxo real ou texto corrigido.

## Etapa 4 — Integridade do banco e operação

**Prioridade:** P1 como requisito de lançamento e P2 para implementação.  
**Dependências:** Etapa 0; Etapa 3 para regras de retenção.

### Trabalho

- Substituir sequência implícita de `ensureColumn`/backfills em `backend/src/db/database.ts` por migrações numeradas e verificáveis; preservar compatibilidade com SQLite e criar snapshot antes da primeira migração.
- Tornar backfill incremental, mensurável e idempotente; documentar rollback/forward-fix, travas e janelas de manutenção.
- Para instalação única, documentar disco persistente, backup criptografado, restore, monitoração de disco e limites de upload/rate limit.
- Para várias réplicas, somente após requisito confirmado, planejar banco compartilhado, object storage, rate limit/fila compartilhados e migração de dados. Não manter SQLite local concorrendo em réplicas.

### Arquivos prováveis

`backend/src/db/database.ts`, novos arquivos de migração, `backend/src/utils/orphan-uploads.ts`, `backend/src/config/env.ts`, `README.md` e documentação operacional.

### Aceite

- Migrações executam uma vez e podem ser reaplicadas sem alteração; restore de backup é demonstrado em ambiente isolado; verificação confirma relações, imagens e índices.
- Há procedimento de recuperação com RPO/RTO e sem segredos versionados.

## Etapa 5 — Integridade de endpoints e fluxos de moderação

**Prioridade:** P2.  
**Dependências:** Etapa 2 para autorização; Etapa 4 se houver alteração de esquema.

### Trabalho

1. Em `backend/src/modules/admin/admin.routes.ts`, validar aprovação e estado antes de gravar, executar atualização/histórico transacional e emitir notificações após commit/outbox.
2. Atualizar matching após edição em `backend/src/modules/items/items.routes.ts` e `item-matching.ts`, com score/reasons atualizados e notificações deduplicadas.
3. Resolver a semântica de `spam_score`: deixar claro que é manual ou adicionar regra de pontuação auditável, explicável e testada. Ajustar rótulo da UI.
4. Dar paginação e estado de resolução às denúncias em `items.routes.ts`, `audit.routes.ts`/módulo de moderação e `frontend/src/pages/AdminPage.tsx`; manter auditoria como trilha, não como única entidade de fila.
5. Atualizar `docs/openapi/argos.v1.yaml` para dashboard, pesquisas salvas, matches, readiness e demais handlers faltantes. Documentar autenticação, status HTTP, schemas, paginação, erros e aliases de versão.
6. Corrigir a exportação CSV administrativa contra formula injection em valores controlados por usuários. Preferir células XLSX explicitamente textuais ou sanitização compatível com os consumidores suportados; documentar trade-offs e cobrir prefixos de fórmula, controles, Unicode, aspas e separadores.

### Aceite

- Atualização administrativa combinada inválida não deixa escrita/notificação parcial.
- Matching reflete edição e não duplica notificação.
- Denúncia pode ser listada além das 20 mais recentes, atribuída/resolvida e auditada.
- Gerador/teste de contrato comprova que todos os endpoints usados por web e Flutter estão documentados e compatíveis.
- Conteúdo iniciado por `=`, `+`, `-`, `@`, tab, CR/LF e variantes Unicode é tratado como texto nos consumidores de planilha suportados; teste automatizado cobre a serialização e validação manual registra Excel/LibreOffice quando disponíveis.

## Etapa 6 — Cobertura web e UX acessível

**Prioridade:** P2/P3.  
**Dependências:** Etapas 2, 3 e 5 para contratos estáveis.

### Trabalho

- Criar testes de integração/E2E para `LoginPage`, `ItemFormPage`, `ItemDetailPage`, `ItemsPage`, `MyItemsPage`, notificações, Settings/Privacy e Admin.
- Cobrir autenticação/cookie, caminho após login, erros 401/403/404/409/413/422/429/5xx, recuperação, envio repetido, imagem inválida, claim privada, follow, devolução, exclusão, exportação e permissões.
- Revisar teclado, foco, contraste e labels nos formulários, modais, menus, tabelas e mapa; testar 320/360/390/768/1366px e zoom/fontes ampliadas.
- Incluir build e testes web no CI junto de backend e Flutter; manter serviços de teste isolados.

### Arquivos prováveis

`frontend/package.json`, arquivos de teste novos, configuração de CI, `frontend/src/pages/**`, `components/**`, `styles.css`.

### Aceite

- Jornadas críticas têm teste automatizado que falha diante de regressão observável; estados vazios/erro/sucesso usam API real de teste ou mocks controlados.
- Build de produção web e auditoria acessível automatizada passam; falhas manuais documentadas com viewport/cenário.

## Etapa 7 — Paridade de autenticação e homologação Flutter

**Prioridade:** P2.  
**Dependências:** Etapa 2 e domínios da Etapa 0.

### Trabalho

- Adicionar recuperação de senha ao `LoginScreen` e decidir integração OAuth Google nativa ou caminho de criação de senha para contas Google.
- Atualizar rotas/repository/client Flutter se novos endpoints ou deep links forem necessários; preservar armazenamento seguro e a regra de redirect local.
- Confirmar necessidade de mapa, notificações push, idiomas adicionais e funções admin no app. Implementar somente as que fizerem parte da experiência móvel aprovada; não deslocar painel admin web por acidente.
- Validar Android em emulador Pixel 9 e aparelho físico: sessão, câmera/galeria, rotação, teclado, permissões negadas, encerramento do seletor, TalkBack, rede ruim e build assinado de release. Validar iOS em macOS/Xcode se fizer parte do lançamento.

### Arquivos prováveis

`apps/flutter/lib/features/auth/presentation/login_screen.dart`, `auth_controller.dart`, `app/router.dart`, `core/network/api_client.dart`, `apps/flutter/README.md`, testes Flutter e configuração Android/iOS.

### Aceite

- Recuperação e login web/Google têm jornada descoberta no app ou decisão de produto documentada.
- `flutter analyze`, `flutter test`, teste HTTP contra backend descartável e build Android passam; teste físico Pixel 9 é registrado com versão/dispositivo. iOS não é declarado aprovado sem build/run em macOS.

## Etapa 8 — Gate de homologação e produção

**Prioridade:** P1.  
**Dependências:** Etapas 1–7 conforme funcionalidades incluídas no release.

### Checklist objetivo

- Sem P0/P1 conhecido aberto; exceções aprovadas com responsável, mitigação, validade e evidência.
- `npm audit` e `npm audit --omit=dev` em backend/frontend sem high/critical sem exceção documentada.
- Typecheck, testes e builds de backend/web/mobile executados em CI; resultado do ambiente consta no release.
- OpenAPI validado e smoke tests de API autenticada, pública e de erro aprovados.
- Backup/restore, persistência de uploads, migração, rollback/forward-fix, monitoração e resposta a incidente demonstrados.
- Domínios, cookies, CORS, SMTP, proxy e segredos validados em homologação equivalente à produção.
- Jornadas web e Flutter ponta a ponta validadas sem dados reais; aparelho Pixel 9 homologado se Android for alvo.
- Aviso de privacidade, retenção, provedores externos AI/tradução e comunicação de recuperação revisados pelo responsável adequado.
- Riscos residuais e limites de plataforma listados. Não afirmar “zero erros”.

## Ordem resumida

1. Definir escopo, topologia e política de dados.
2. Fechar exposição de token, atualizar dependências e endurecer configuração.
3. Verificar e-mail e restringir papéis ao escopo real.
4. Corrigir exportação/exclusão/consentimento e retenção.
5. Versionar migrações e comprovar backup/restore.
6. Corrigir atomicidade, matching, denúncias, antiabuso e OpenAPI.
7. Adicionar testes E2E web e integrar CI.
8. Completar jornadas mobile aprovadas e validar em dispositivo.
9. Liberar apenas após gate de homologação e registrar riscos residuais.
