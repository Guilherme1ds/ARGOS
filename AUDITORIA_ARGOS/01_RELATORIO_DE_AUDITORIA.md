# ARGOS — Relatório técnico de auditoria

**Data:** 5 de novembro de 2026  
**Escopo:** leitura do repositório e verificações locais seguras. Nenhum arquivo existente do sistema, banco de desenvolvimento ou configuração foi alterado. Os três documentos desta pasta são os únicos artefatos criados para a auditoria.

## 1. Resumo executivo

O ARGOS é um monorepo funcional para achados e perdidos, com três clientes/serviços que compartilham uma API: frontend web React, backend Express e aplicativo Flutter. O backend persiste em SQLite local e grava imagens em disco local. Os fluxos centrais — cadastro e sessão, busca, publicação, reivindicação privada, devolução, notificações e administração web — estão implementados e a suíte existente cobre uma parte importante deles.

O estado atual **não deve ser considerado pronto para produção**. Há risco de exposição de links de redefinição de senha em logs e na caixa de saída persistida; dependências instaladas estão vulneráveis, inclusive uma vulnerabilidade crítica transitiva no backend; papéis que sugerem escopo organizacional recebem acesso global porque não existe modelo de organização/ espaço no banco; contas criadas por senha ficam ativas sem verificação de e-mail; e a validação de segredos para produção permite valores fracos. Há também riscos de privacidade na exclusão de conta e no registro de consentimento.

Não encontrei um P0 comprovado. Os P1 deste relatório são bloqueadores antes de uso público com dados reais, sobretudo os riscos de segurança e isolamento de dados. O banco SQLite e os uploads locais podem servir uma instalação única, desde que exista persistência e backup/restore operacional comprovado; não encontrei tal configuração ou evidência no repositório.

### Situação das validações executadas

| Comando/cenário | Resultado observado |
|---|---|
| `npm run typecheck --prefix backend` | Passou. |
| `npm test --prefix backend` | 59 testes passaram em 2 arquivos; banco de teste temporário. |
| `npm exec -- tsc --noEmit -p tsconfig.json` em `frontend` | Passou. |
| `npm run i18n:check --prefix frontend` | Passou: 614/614 chaves em inglês e 614/614 em espanhol. |
| `flutter analyze` em `apps/flutter` | Passou: nenhum apontamento. |
| `flutter test` em `apps/flutter` | Passou: 22 testes; 1 teste HTTP real foi ignorado pelo gate padrão. |
| Teste HTTP Flutter contra backend descartável | Passou após apontar dotenv para arquivo vazio e usar SQLite/uploads em diretório temporário. Exercitou cadastro, imagem, publicação, busca, reivindicação, devolução, exclusão e restauração de sessão. |
| `npm audit --prefix backend --audit-level=moderate` | Falhou por vulnerabilidades: 11 no total (3 moderadas, 7 altas, 1 crítica). |
| `npm audit --prefix frontend --audit-level=moderate` | Falhou por 4 vulnerabilidades altas. |
| `npm audit --omit=dev --prefix backend --audit-level=moderate` | Falhou: 7 vulnerabilidades em dependências de produção (1 moderada, 5 altas, 1 crítica). |
| `npm audit --omit=dev --prefix frontend --audit-level=moderate` | Falhou: 2 vulnerabilidades altas em dependências de produção. |
| `flutter devices` | Só Windows, Chrome e Edge. Nenhum emulador Android ou Pixel conectado. |

Não executei builds de distribuição, teste de integração Android em aparelho, navegador automatizado, teste visual manual, carga ou penetração. Portanto, esses resultados não comprovam o comportamento de produção nem a experiência em um Google Pixel 9.

O comando do teste HTTP Flutter que passou foi `flutter test --dart-define=ARGOS_RUN_LIVE_TESTS=true --dart-define=ARGOS_TEST_API=http://localhost:3334/api/v1 test/live_api_test.dart`, executado em `apps/flutter`. O backend foi iniciado em `backend` com `NODE_ENV=test`, porta 3334, banco e uploads exclusivos em diretório temporário, integrações externas vazias e `DOTENV_CONFIG_PATH` apontando para arquivo temporário vazio. A primeira tentativa respondeu 422 no cadastro porque o processo ainda carregou a configuração Turnstile do `.env` local; sem alterar esse arquivo, reiniciei o servidor isolado corretamente e o teste passou. Nenhum dado real foi usado.

Não rodei scripts de build que escrevem nos diretórios `dist`/`build` existentes, para preservar os artefatos locais durante a etapa somente investigativa. TypeScript foi verificado sem emissão; builds de distribuição seguem pendentes.

## 2. Arquitetura identificada

### Repositório e tecnologias

- **Backend:** Node.js 24.21.0 no ambiente desta auditoria, TypeScript, Express 4, SQLite via `better-sqlite3`, Zod, JWT, bcrypt, Multer, Sharp, Nodemailer, Web Push e integrações opcionais com Google, Cloudflare Turnstile, Anthropic, DeepL/LibreTranslate.
- **Frontend web:** React 18, TypeScript, Vite 8, React Router 7, Axios, Leaflet e CSS próprio; interfaces em português, inglês e espanhol.
- **Mobile:** Flutter 3.47.6/Dart 3.13.5 no ambiente, Riverpod, GoRouter, Dio, `flutter_secure_storage`, `image_picker` e `cached_network_image`.
- **Persistência:** tabelas e ajustes de esquema definidos em `backend/src/db/database.ts`. O banco é um arquivo SQLite local, com WAL, chaves estrangeiras e índices. Migrações são aplicadas durante a inicialização da aplicação. Arquivos de imagem são recodificados pelo Sharp e servidos em `/uploads` a partir de diretório local.
- **Contrato:** `docs/openapi/argos.v1.yaml`; as mesmas rotas são montadas em `/api` e `/api/v1`.
- **Execução e deploy:** há scripts locais e exemplos de configuração. Não encontrei workflow de CI, Docker/Compose, manifesto de deploy, configuração de backup ou procedimento de restore no repositório.

### Como as partes se comunicam

O frontend web usa Axios com credenciais de cookie habilitadas. O access token fica em memória; o refresh token é um cookie `HttpOnly`. O Flutter nativo também mantém o access token em memória e grava o cookie de refresh em armazenamento seguro; no Flutter Web, usa cookie do navegador. Ambos os clientes consomem a API Express.

As rotas ficam organizadas por módulos (`auth`, `items`, `admin`, `dashboard`, `notifications`, `reports`, `saved-searches`, `privacy`, `uploads`, `push`, `ai` e `config`). A maior parte da regra de negócio e do SQL de itens está concentrada em `items.routes.ts`; autenticação, conta e recuperação de senha ficam concentradas em `auth.routes.ts`.

### Funcionalidades localizadas

- **Web:** feed e busca com filtros, mapa, detalhe de item, publicação/edição, upload, pistas/comentários, reivindicação privada, acompanhamentos, pesquisas salvas, notificações, perfil, preferências, recuperação de senha, privacidade/exportação/exclusão e administração.
- **API:** autenticação com renovação rotativa, perfis e permissões, CRUD de itens, upload de imagem, comentários, denúncia, claims, devolução, matching, notificações e push, dashboard, exportação CSV, buscas salvas, exportação de dados, auditoria e integrações opcionais.
- **Flutter:** feed, busca paginada, detalhe, comentários, claim e devolução conforme capacidade da API, publicação/edição com rascunhos, imagens, Meus itens, notificações, perfil e privacidade. Administração permanece na web.

## 3. Pontos fortes observados

- Consultas SQL usam parâmetros; validação das entradas da API é centralizada com Zod; respostas de erro incluem identificador de requisição.
- Senhas usam bcrypt; refresh tokens são armazenados como hash, rotacionados e revogáveis. O JWT é verificado no backend em cada requisição autenticada.
- DTOs públicos de item são separados dos dados privados de reivindicação. As provas de claim são lidas por endpoint autenticado e autorizado.
- Upload exige sessão, limita tamanho/quantidade, confere MIME e assinatura do arquivo, recodifica a imagem e remove metadados EXIF/GPS.
- Há limites de requisição, trilha de auditoria, restrições de estado no fluxo de claim/devolução e transações em operações importantes.
- O cliente web tem token apenas em memória; o cliente nativo usa armazenamento seguro e possui testes de concorrência de refresh, troca de conta, rascunhos e respostas assíncronas.
- A UI tem estados de erro/carregamento em várias jornadas, CSS responsivo, temas e contraste, rótulos acessíveis em componentes e dicionários web completos verificados pelo script i18n.
- A suíte backend atual passa e contém testes de autorização, erros HTTP, uploads e concorrência; a suíte Flutter cobre fluxos com API simulada e o teste HTTP descartável também passou.

## 4. Problemas por prioridade

P0 significa falha crítica demonstrada com impacto imediato. Não encontrei achado P0 comprovado neste exame. P1 abaixo inclui riscos de segurança/isolamento que precisam ser resolvidos ou explicitamente mitigados antes de produção.

### SEC-01 — Link de redefinição pode ser gravado em logs e na caixa de saída

1. **Prioridade:** P1.
2. **Localização:** `backend/src/utils/mail.ts:24-27,39-42,63-65`; `backend/src/modules/auth/auth.routes.ts:592-606`; `backend/src/config/env.ts:36-79`.
3. **Descrição e evidência:** `sendMail` grava destinatário, assunto e corpo completo no `console.log` sempre que SMTP não está configurado; a decisão não depende de `NODE_ENV`. A configuração de produção não exige SMTP. O endpoint de recuperação cria um token de uso único, inclui-o na URL enviada e a fila persiste o corpo. Ao marcar a mensagem como enviada, atualiza o status mas mantém o corpo.
4. **Impacto:** logs centralizados ou leitura do arquivo SQLite podem revelar um token ainda válido por até uma hora e permitir redefinição da senha enquanto ele não expira/é consumido. Também retém o token depois do envio.
5. **Correção recomendada:** impedir envio em produção sem transporte real/alternativa segura; restringir fallback de console a desenvolvimento e nunca registrar corpos de autenticação; apagar ou redigir o corpo após envio e expurgar mensagens/tokens expirados segundo retenção definida. Não registrar o valor do token.
6. **Dependências:** decisão de transporte de e-mail em produção e política de retenção.
7. **Validação:** teste de recuperação com SMTP desligado em `NODE_ENV=production` deve falhar de modo seguro sem registrar link; teste com SMTP mock deve confirmar que o link é enviado sem permanecer em log/outbox após entrega; verificar expiração e uso único.

### SEC-02 — Dependências instaladas vulneráveis

1. **Prioridade:** P1.
2. **Localização:** `backend/package-lock.json`, `frontend/package-lock.json` e manifests correspondentes.
3. **Descrição e evidência:** os `npm audit` executados em 5/11/2026 apontaram, entre outros: backend `proxy-addr@2.0.7` (crítico; correção 2.0.8), `body-parser@1.20.8`, `multer@2.4.0`, `nodemailer@9.1.1`, `sharp@0.35.4` e `zod@3.25.76`; frontend `axios@1.19.0` e `follow-redirects@1.16.0`. O relatório completo inclui dependências de desenvolvimento. Mesmo excluindo dev, backend tem 7 achados (um crítico) e frontend tem 2 altos. O advisory do proxy-addr descreve spoofing de IP em subnet IPv4-mapped IPv6; a aplicação habilita proxy trust via configuração booleana. O advisory do Multer cobre versões instaladas abaixo de 2.5.0. O Zod requer planejamento porque o caminho sugerido cruza major version.
3. **Impacto:** negação de serviço, controle incorreto de IP/proxy, risco em transporte de e-mail e manipulação de requisições, conforme o advisory e a superfície atingida. `axios` é dependência de runtime do cliente; outras ocorrências são transitivas ou de desenvolvimento. Reachability de cada CVE não foi explorada nesta auditoria.
4. **Correção recomendada:** atualizar com mudanças pontuais revisadas, resolver transitivos vulneráveis no lockfile e avaliar breaking changes de Nodemailer/Zod; não executar atualização major automática sem adaptar código. Fixar versão corrigida, conferir SBOM/audit após e registrar exceções de advisories sem correção compatível.
5. **Dependências:** revisão de changelogs e testes de e-mail, upload, autenticação, HTTP e schemas.
6. **Validação:** repetir `npm audit` e `npm audit --omit=dev` para backend/frontend; executar typecheck, testes backend, build e fluxos de upload/e-mail.
7. **Referências primárias:** [proxy-addr GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h), [Multer GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m), [Zod GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), [Axios GHSA-vh66-26gq-q6x8](https://github.com/advisories/GHSA-vh66-26gq-q6x8), [Vite GHSA-9jrq-w75r-8gcw](https://github.com/advisories/GHSA-9jrq-w75r-8gcw), [Nodemailer GHSA-6vj9-mwq6-2f5v](https://github.com/advisories/GHSA-6vj9-mwq6-2f5v).

### SEC-03 — Cadastro por senha ativa conta sem verificar posse do e-mail

1. **Prioridade:** P1.
2. **Localização:** `backend/src/modules/auth/auth.routes.ts:304-313,330-345`; `backend/src/db/database.ts:25-46`.
3. **Descrição e evidência:** cadastro por senha grava `status='active'` sem preencher `email_verified_at`; login confere senha e status, mas não exige e-mail verificado. O fluxo Google exige `emailVerified`, o que confirma uma diferença entre provedores.
4. **Impacto:** alguém pode reservar o endereço de outra pessoa e operar no sistema com essa identidade até que o titular recupere a senha. Também pode impedir o cadastro legítimo pelo endereço único.
5. **Correção recomendada:** adicionar verificação por token de uso único e expiração, e impedir sessão/ações relevantes antes da confirmação, ou definir uma política explícita alternativa (por exemplo, domínio institucional validado). Não marcar endereço como verificado apenas por cadastro.
6. **Dependências:** transporte de e-mail seguro (SEC-01), UX web/mobile e regra para contas existentes.
7. **Validação:** testar cadastro não verificado, confirmação válida/expirada/reutilizada, usuário existente, reset de senha e login em ambos os clientes.

### SEC-04 — Guardas de produção aceitam segredo fraco

1. **Prioridade:** P1.
2. **Localização:** `backend/src/config/env.ts:24-35,70-79`.
3. **Descrição e evidência:** `JWT_SECRET` exige somente 16 caracteres e `ADMIN_PASSWORD` 8. Em produção o código rejeita apenas os valores padrão exatos; valores fracos que atendem ao comprimento passam. `JWT_EXPIRES_IN` também é string sem validação de formato; TTL inválido pode causar erro ao emitir token, e TTL de refresh inválido cai silenciosamente para 30 dias.
4. **Impacto:** segredo previsível pode permitir falsificação de JWT; senha fraca facilita comprometimento da conta administrativa; valores de TTL com erro de digitação geram falha ou configuração inesperada em runtime.
5. **Correção recomendada:** exigir segredo de alta entropia (pelo menos 32 bytes aleatórios), senha de admin fornecida por secret store/fluxo de bootstrap forte, validar formato/limites dos TTLs ao iniciar e nunca usar defaults em produção. Manter valores fora do repositório.
6. **Dependências:** procedimento de provisionamento da primeira conta e configuração de ambientes.
7. **Validação:** testes de configuração de produção devem rejeitar segredo curto/previsível, senha padrão e TTL inválido antes de abrir porta ou banco.

### SEC-05 — CSV administrativo pode interpretar conteúdo do usuário como fórmula

1. **Prioridade:** P2.
2. **Localização:** `backend/src/modules/reports/reports.routes.ts:11-24`; entradas em `backend/src/modules/items/items.routes.ts:46-62`.
3. **Descrição e evidência:** `csvCell` envolve valores em aspas e duplica aspas, mas não neutraliza prefixos de fórmula. Título, categoria e local são conteúdo controlado por usuários e acabam no CSV administrativo. Uma célula iniciada por `=`, `+`, `-` ou `@` pode ser interpretada por planilha como fórmula. Aspas CSV sozinhas não são uma defesa universal; o impacto depende da planilha e do fluxo em que o admin abre/salva o arquivo.
4. **Impacto:** conteúdo público pode virar fórmula em uma exportação aberta por um administrador, permitindo fraude visual/phishing e, em algumas configurações, ações ou exfiltração dependentes de aplicativo/consentimento.
5. **Correção recomendada:** exportar campos de texto como texto literal por formato robusto (por exemplo, XLSX com células explicitamente textuais) ou aplicar sanitização compatível com as planilhas alvo antes do quoting CSV. Documentar trade-offs e preservar valores para leitores programáticos quando necessário.
6. **Dependências:** formato de exportação e planilhas oficialmente suportadas.
7. **Validação:** inserir títulos/local/categoria com `=`, `+`, `-`, `@`, tab, CR/LF, Unicode equivalente, aspas e separadores; inspecionar bytes CSV e abrir/salvar em Excel/LibreOffice do ambiente alvo. Não afirmar proteção universal sem validar o consumidor.
8. **Referência:** [OWASP CSV Injection](https://community.owasp.org/attacks/CSV_Injection) descreve a interpretação de fórmulas e os limites das estratégias de escape por consumidor.

### AUTH-01 — Permissões organizacionais não têm escopo de organização

1. **Prioridade:** P1 condicional ao uso desses papéis.
2. **Localização:** `backend/src/shared/policies/permissions.ts:28-60`; `backend/src/modules/reports/reports.routes.ts:8-20`; `backend/src/modules/dashboard/dashboard.routes.ts:13-38`; `backend/src/modules/items/items.routes.ts:740-760`; `backend/src/db/database.ts` (esquema não contém organizações/ espaços); `backend/src/modules/admin/admin.routes.ts:29,112-152`.
3. **Descrição e evidência:** `org_admin` recebe `reports:export_org`, `space_manager`/`org_admin` recebem `reports:read_org`, e `support`/papéis de gestão recebem capacidades globais de moderação/leitura de claims. O CSV seleciona itens sem filtro de organização; o dashboard define escopo “organization” sem filtro quando a permissão existe. O endpoint de claims verifica papel/owner, mas não tenant. Não há `organization_id`/`space_id` nas entidades relevantes. Os papéis podem ser atribuídos pela API administrativa.
4. **Impacto:** se um desses papéis for atribuído em uma instalação multi-institucional, a pessoa poderá ver, exportar ou moderar registros de outras organizações, inclusive publicações ainda não aprovadas e provas privadas.
5. **Correção recomendada:** até existir relação de tenant, restringir papéis organizacionais às permissões pessoais ou não os habilitar. Se multi-tenant for requisito, criar organização/espaço, associar usuários e itens, e aplicar filtro de tenant em cada leitura, escrita, exportação, matching e auditoria. Não simular escopo organizacional por nome de papel.
6. **Dependências:** decisão de produto: instalação de campus único ou multi-institucional.
7. **Validação:** teste de isolamento com dois tenants para dashboard, CSV, itens, claims, busca, moderação e auditoria; usuário do tenant A não lê/escreve/exporta dados de B. Se ARGOS for estritamente single-tenant, testar que somente admin de plataforma recebe acesso global.

### DATA-01 — Exclusão de conta deixa identificadores e mensagens em tabelas independentes

1. **Prioridade:** P1 para privacidade e veracidade da confirmação de exclusão.
2. **Localização:** `backend/src/modules/auth/auth.routes.ts:640-689`; `backend/src/db/database.ts:50-60,232-243`; `backend/src/utils/mail.ts:39-74`.
3. **Descrição e evidência:** a exclusão anonimiza a linha de `users` e limpa várias tabelas, mas não trata `access_requests` nem `mail_outbox`. A tabela de solicitações contém nome/e-mail/motivo sem vínculo de cascata ao usuário; a caixa de saída mantém destinatário e corpo depois de enviada. Logs de auditoria podem manter e-mail em `entity_id` de eventos de login falho. A API, porém, confirma que dados pessoais foram removidos.
4. **Impacto:** dados identificáveis podem persistir após a pessoa receber confirmação de exclusão; a exportação de dados não inclui todos esses registros residuais. O prazo e a finalidade de retenção não estão definidos no código.
5. **Correção recomendada:** classificar cada tabela por finalidade/retenção; apagar ou anonimizar solicitações/mensagens quando cabível, redigir destinatário e conteúdo enviado, e definir retenção mínima para auditoria com pseudonimização. Ajustar a mensagem de confirmação para refletir o que de fato foi removido.
6. **Dependências:** política de retenção aprovada pelo responsável de privacidade; SEC-01.
7. **Validação:** criar conta por cadastro e por solicitação aprovada, preencher dados nas tabelas, solicitar exclusão e verificar por consultas no banco de teste quais identificadores permanecem e por quanto tempo; comparar exportação e resposta do endpoint.

### FUNC-01 — Atualização administrativa de item não é atômica

1. **Prioridade:** P2.
2. **Localização:** `backend/src/modules/admin/admin.routes.ts:73-99`.
3. **Descrição e evidência:** o schema aceita `approvalStatus` e `status` juntos. A rota persiste aprovação e envia notificação antes de validar a transição de status. Se a transição for inválida, devolve erro depois de já ter alterado a aprovação e notificado o dono.
4. **Impacto:** resposta de falha pode esconder alteração parcialmente concluída; estado e mensagem administrativa divergem.
5. **Correção recomendada:** validar todas as transições antes de qualquer escrita; executar atualizações e histórico em uma transação única; emitir notificações após commit via outbox.
6. **Dependências:** nenhuma além da regra existente `item-state.ts`.
7. **Validação:** enviar payload combinado com status inválido e confirmar que aprovação, status, histórico e notificações não mudaram; testar payload combinado válido e falha concorrente.

### DATA-02 — Consentimento não usa versão autoritativa e revogação anunciada não está implementada

1. **Prioridade:** P2; revisão de privacidade necessária antes de lançamento.
2. **Localização:** `backend/src/modules/auth/auth.routes.ts:20,30-38,312-315,383-385`; `backend/src/modules/privacy/privacy.routes.ts:10-48`; `frontend/src/pages/LoginPage.tsx`.
3. **Descrição e evidência:** a versão dos termos é enviada pelo cliente e qualquer string de 3 a 40 caracteres é persistida como versão aceita. A versão corrente está repetida em strings fixas. O resumo de privacidade lista “revogação” entre os direitos, mas a API expõe somente resumo e exportação; não há endpoint para revogar/alterar consentimento.
4. **Impacto:** o registro não demonstra de forma confiável qual texto o servidor apresentou/aceitou e a interface pode prometer uma ação que a conta não consegue executar.
5. **Correção recomendada:** manter versão e texto ativo no servidor, persistir essa versão independentemente do valor enviado pelo cliente, implementar o fluxo de revogação aplicável e explicar efeitos no produto; remover direitos/funcionalidades anunciados que não sejam aplicáveis. Validar conteúdo com responsável de privacidade.
6. **Dependências:** versão oficial do aviso, finalidades, prazos de retenção e regra de consentimento.
7. **Validação:** testar versão apresentada/persistida, atualização de versão, aceite, recusa e revogação; confirmar alinhamento entre resumo, web, Flutter e endpoints.

### DATA-03 — Migrações executadas no boot sem registro de versão

1. **Prioridade:** P2.
2. **Localização:** `backend/src/db/database.ts:291-339` e chamadas de `migrate()` em `backend/src/app.ts`.
3. **Descrição e evidência:** o banco cria tabelas, adiciona colunas via `ensureColumn`, corrige duplicidades e executa backfill de `category_key`/`location_key` a partir de um `SELECT` de todos os itens na inicialização. Não há tabela de versão de migração, arquivos de migração ordenados ou trilha de rollback.
4. **Impacto:** cada boot repete varredura proporcional ao histórico de itens; uma falha entre comandos pode deixar o esquema parcialmente ajustado; deploy simultâneo/múltiplas instâncias pode competir por lock do SQLite.
5. **Correção recomendada:** introduzir migrações sequenciais com versão, transação quando suportada, backfill incremental/idempotente e política explícita de backup antes de alteração. Manter migração compatível com dados atuais e evitar troca de banco sem requisito de escala.
6. **Dependências:** snapshot/backup do banco e plano de rollback.
7. **Validação:** migrar cópias descartáveis de versões antigas e atuais; executar duas vezes sem mudança adicional; testar falha no meio e restart; medir backfill com dataset representativo.

### API-01 — OpenAPI não documenta todas as rotas atuais

1. **Prioridade:** P2.
2. **Localização:** `docs/openapi/argos.v1.yaml`; rotas em `backend/src/modules/dashboard/dashboard.routes.ts`, `backend/src/modules/saved-searches/saved-searches.routes.ts`, `backend/src/modules/items/items.routes.ts:585-618` e `backend/src/app.ts`.
3. **Descrição e evidência:** o contrato não contém dashboard, CRUD de pesquisas salvas, leitura de possíveis correspondências (`GET /items/{id}/matches`) ou readiness (`GET /health/ready`). O frontend consome buscas salvas, e o backend publica essas operações.
4. **Impacto:** consumidores, testes de contrato e a futura execução por Claude/terceiros podem usar payloads ou comportamento incorretos; cobertura OpenAPI não prova paridade com runtime.
5. **Correção recomendada:** documentar endpoints, esquemas, erros, permissões e paginação; manter explícito que existe prefixo legado `/api` e versão `/api/v1`; adicionar teste automatizado que compare rotas/payloads relevantes ao contrato.
6. **Dependências:** definição de contrato atual de cada handler.
7. **Validação:** validar YAML/OpenAPI, resolver `$ref`, comparar operações com inventário Express e rodar testes de contrato contra API de banco temporário.

### WEB-01 — Frontend não possui suíte automatizada de comportamento

1. **Prioridade:** P2.
2. **Localização:** `frontend/package.json`; páginas em `frontend/src/pages`.
3. **Descrição e evidência:** os scripts incluem build e checagem i18n, mas não teste unitário, integração, navegação ou E2E. A auditoria executou typecheck e i18n; não executou navegador nem validação visual. Backend e Flutter têm testes, web não.
4. **Impacto:** regressões de login, publicação, reivindicação, recuperação de senha, configurações e admin podem passar sem detecção automatizada.
5. **Correção recomendada:** adicionar a infraestrutura de teste web mínima adequada ao projeto e E2E para jornadas críticas; usar backend e banco temporários, fixtures determinísticas e sem produção. Cobrir erros, estados vazios, formulários e autorização.
6. **Dependências:** harness de API descartável e decisão de CI.
7. **Validação:** executar teste web headless em viewport estreito e desktop; cobrir login/retorno de rota, publicação, claim, retorno, recovery, privacidade e admin; integrar ao CI.

### FUNC-02 — Correspondências não são recalculadas após edição

1. **Prioridade:** P2.
2. **Localização:** `backend/src/modules/items/items.routes.ts:468-475,768-820`; `backend/src/modules/items/item-matching.ts:93-126`.
3. **Descrição e evidência:** `discoverItemMatches` é chamado após criação. A rota de edição altera título, descrição, data, local e imagem, mas não recalcula correspondências nem atualiza os scores/reasons existentes.
4. **Impacto:** notificações e lista de possíveis correspondências podem ficar desatualizadas depois que um item é corrigido.
5. **Correção recomendada:** após edição bem-sucedida, atualizar ou invalidar resultados e recalcular por estratégia idempotente; decidir como reemitir notificações sem duplicidade. Tratar custo como tarefa assíncrona se o volume justificar.
6. **Dependências:** política para remoção/recalculo de pares e deduplicação de alertas.
7. **Validação:** editar título/categoria/data/local/foto em fixture de itens compatíveis e incompatíveis; conferir score, motivos, remoção de pares inválidos e número de notificações.

### ABUSE-01 — `spam_score` só muda por ação administrativa

1. **Prioridade:** P2.
2. **Localização:** `backend/src/modules/items/items.routes.ts:417`; `backend/src/modules/admin/admin.routes.ts:112-128`; `frontend/src/pages/AdminPage.tsx`.
3. **Descrição e evidência:** a criação bloqueia conta com pontuação 5+, mas buscas no código mostram escrita de `spam_score` somente na atualização de usuário do admin; não há cálculo/incremento automático ou fila de revisão. A tela chama a área de “anti-spam”.
4. **Impacto:** o bloqueio é manual e não detecta abuso por si só; o nome da funcionalidade pode levar a crer que há prevenção automática.
5. **Correção recomendada:** decidir se a pontuação é apenas indicador manual ou uma regra automatizada. Se manual, ajustar rótulo/documentação e criar processo de revisão. Se automática, definir sinais, limites, auditoria e proteção contra falsos positivos; não inventar heurísticas sem aprovação do produto.
6. **Dependências:** política antiabuso e limite de impacto aceitável.
7. **Validação:** teste que comprove a regra declarada, trilha de alteração, desbloqueio e ausência de bloqueio indevido; teste de limites de cadastro/publicação por conta e IP.

### MOD-01 — Denúncias têm lista curta, sem estado de tratamento

1. **Prioridade:** P2.
2. **Localização:** `backend/src/modules/items/items.routes.ts:678-701`; `frontend/src/pages/AdminPage.tsx:40-51,215-226`; `backend/src/modules/audit/audit.routes.ts`.
3. **Descrição e evidência:** denúncia é gravada como evento de auditoria; o painel busca só as 20 mais recentes. Não há estado “em análise/resolvida”, atribuição, paginação na tela ou ação de arquivamento.
4. **Impacto:** depois de volume maior que 20, denúncias antigas saem da fila visual sem resolução rastreável; notificação não equivale a triagem concluída.
5. **Correção recomendada:** persistir denúncia como entidade de moderação com status, timestamps e responsável, mantendo audit log como trilha; criar paginação/filtros e ação de resolução. Se o uso esperado for baixo, pelo menos permitir paginação no endpoint/tela e marcar decisão.
6. **Dependências:** política de moderação, retenção e quem pode resolver.
7. **Validação:** criar mais de 20 denúncias e dois moderadores; conferir fila, filtro, concorrência de resolução, histórico e acesso autorizado.

### MOB-01 — Login Flutter não cobre recuperação de senha nem Google

1. **Prioridade:** P2.
2. **Localização:** `apps/flutter/lib/features/auth/presentation/login_screen.dart`; rotas em `apps/flutter/lib/app/router.dart:94-101`; rotas web e API em `frontend/src/pages/LoginPage.tsx` e `backend/src/modules/auth/auth.routes.ts:348-390,581-638`.
3. **Descrição e evidência:** o backend/web oferecem Google e recuperação de senha, mas o router/tela Flutter expõem login/cadastro sem fluxo de recuperação ou login Google. `/reset-password` não é rota mobile. O Flutter é documentado como cliente do mesmo sistema.
4. **Impacto:** pessoas com conta criada somente pelo Google não conseguem entrar no aplicativo sem definir senha por outro canal; quem esquece a senha não tem recuperação descoberta no app.
5. **Correção recomendada:** adicionar recuperação pelo contrato existente e decidir OAuth nativo seguro ou um fluxo explícito para criar senha/abrir recuperação web. Não guardar ID token ou senha localmente; manter redirect controlado.
6. **Dependências:** SDK/OAuth escolhido, URL web segura e decisão de UX para browser externo.
7. **Validação:** testar cadastro/entrar Google ou alternativa, recuperação válida/expirada, deep link seguro, retorno ao destino e Android/iOS suportados.

### OPS-01 — Persistência local não tem evidência de backup/restore ou operação multi-instância

1. **Prioridade:** P1 como gate de lançamento; risco operacional, não perda de dados já comprovada.
2. **Localização:** `backend/src/db/database.ts`; `backend/src/config/env.ts`; `backend/src/utils/orphan-uploads.ts`; `README.md`.
3. **Descrição e evidência:** banco, rate limits, mail outbox e VAPID podem residir no SQLite local; uploads ficam no disco local. A documentação reconhece uso para uma instância. Não há configuração de backup/restore, armazenamento persistente em deploy, alerta de espaço/disco ou procedimento de recuperação no repo. Nenhum destino de produção foi fornecido para auditoria.
4. **Impacto:** container/disco efêmero ou segunda réplica pode perder/divergir banco, imagens, sessões, limites e fila de e-mail. Ainda não há prova de restore.
5. **Correção recomendada:** para single-instance, especificar disco persistente, backup criptografado, retenção e restore testado. Para múltiplas réplicas, escolher banco/armazenamento/limites compartilhados com migração justificada. Não trocar a arquitetura sem requisito e plano.
6. **Dependências:** provedor e topologia de produção, RPO/RTO e classificação de dados.
7. **Validação:** simular perda/restauração em ambiente descartável, conferir integridade SQLite, imagens, sessões e outbox; documentar RPO/RTO e alertas.

### OPS-02 — Cookie fixo `SameSite=Lax` pode bloquear sessão em domínios cross-site

1. **Prioridade:** P2 condicional à topologia escolhida.
2. **Localização:** `backend/src/modules/auth/auth.routes.ts:174-188`; `frontend/src/services/api.ts:58`; `backend/src/app.ts` CORS.
3. **Descrição e evidência:** clientes web enviam credenciais, CORS aceita origens configuradas, mas refresh cookie é sempre `SameSite=Lax`. Se frontend e API estiverem em sites registráveis diferentes, o navegador não envia esse cookie em XHR/fetch cross-site.
4. **Impacto:** login pode parecer funcionar, mas refresh/restauração da sessão falha no navegador; o Flutter Web também usa credenciais do browser.
5. **Correção recomendada:** preferir deploy same-site com reverse proxy. Se cross-site for requisito, configurar `SameSite=None; Secure` e adotar proteção CSRF adequada; não mudar cookie isoladamente.
6. **Dependências:** domínios reais de produção e modelo de ameaça CSRF.
7. **Validação:** E2E em browser real nos domínios de homologação, com login, reload, refresh, logout e requisição cross-site forjada.

## 5. Riscos, ausências e limites

### Riscos comprovados no código

- SEC-01, SEC-02, SEC-03, SEC-04, AUTH-01 (caso papéis sejam usados), DATA-01 e FUNC-01 acima.
- Toda nova publicação é inserida com `approval_status='approved'` em `items.routes.ts`. O admin pode alterar aprovação depois. Não existe aprovação prévia para publicações novas; confirmar se esse é o comportamento intencional do campus.
- `spam_score` é uma trava manual, não mecanismo automático (ABUSE-01).
- O painel de denúncias só exibe 20 eventos e não acompanha resolução (MOD-01).
- O contrato OpenAPI não está sincronizado com todos os handlers (API-01).

### Riscos potenciais que dependem de ambiente ou decisão de produto

- Escala, backup e disponibilidade dependem de persistência de disco e topologia externa, que não foram fornecidas.
- Isolamento organizacional só é violado se forem usados papéis org/space/support em implantação com mais de um tenant; hoje o banco não modela tenants.
- Cookies cross-site só falham quando web/API forem publicados em sites diferentes; os domínios não foram informados.
- Integrações AI/tradução enviam conteúdo/foto a terceiros quando habilitadas. Revisar aviso de privacidade, finalidade, fornecedor e retenção antes de ativar em dados reais.
- Nenhuma validação física no Pixel 9, iOS, câmera, permissão recusada ou TalkBack foi realizada neste ambiente.

### Funcionalidades ausentes ou limitadas

- Flutter não oferece recuperação de senha, login Google, mapa ou administração nativa; as duas últimas existem/ficam na web e podem permanecer fora do escopo mobile se isso for deliberado.
- Flutter documenta apenas português, embora a web ofereça três idiomas.
- Não há CI ou testes automáticos de comportamento web.
- Não há infraestrutura no repositório para fila de jobs, object storage, backups, métricas/alertas ou restore.
- Não existe modelo de organização/espaço apesar de papéis e permissões com nomes organizacionais.

### Pontos de UX observados sem validação visual

Há estrutura de carregamento/erro, tokens CSS, breakpoints, foco visível, labels e feedback. O feed usa lazy load de páginas; o Flutter tem testes de layout e lista sob demanda. Isso é evidência de intenção e cobertura automatizada, não comprovação visual atual. Não foi possível validar contraste real em todas as combinações, leitor de tela, navegação por teclado completa ou tamanhos de tela em browser/aparelho.

## 6. Recomendação de decisão

1. Bloquear produção até resolver SEC-01/02/03/04, decidir o escopo de papéis AUTH-01 e definir a retenção DATA-01.
2. Confirmar se o produto é single-campus ou multi-tenant. Manter SQLite pode ser adequado a uma única instância com backup/restore demonstrado; não iniciar migração de banco só por preferência arquitetural.
3. Corrigir atomicidade administrativa, sincronizar OpenAPI e consentimento, criar teste web automatizado e completar recuperação mobile conforme escopo de produto.
4. Repetir validações com CI e ambiente de homologação, e testar no Pixel 9 real antes de declarar compatibilidade.

## 7. Fontes locais examinadas

`README.md`, manifests/lockfiles de npm e pub, `backend/src/**`, `backend/test/**`, `frontend/src/**`, `frontend/scripts/i18n-check.mjs`, `apps/flutter/lib/**`, `apps/flutter/test/**`, `apps/flutter/integration_test/**`, `docs/openapi/argos.v1.yaml` e documentação existente em `docs/`. A documentação anterior foi tratada como contexto, não como prova de funcionamento atual.

O diretório local `backend/.env` existe, é ignorado pelo Git e não está rastreado. Os valores não foram exibidos nem copiados para este relatório. A busca por nomes de arquivos rastreados de segredo não encontrou `.env`, chave privada ou keystore; isso não substitui varredura de histórico Git ou secret scanner dedicado.
