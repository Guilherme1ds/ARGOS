# Prompt definitivo para Claude — implementar correções do ARGOS

Copie o bloco abaixo e forneça ao Claude acesso ao repositório atualizado.

---

```text
Atue como engenheiro de software sênior responsável por segurança, backend Express/TypeScript, React web, Flutter, SQLite, APIs e testes. Implemente as correções necessárias no ARGOS deste repositório. Não entregue apenas recomendações: altere o código, execute validações seguras e documente os resultados reais.

CONTEXTO VERIFICADO

O ARGOS é um monorepo de achados e perdidos com:
- backend Express/TypeScript em backend/, SQLite better-sqlite3, Zod, JWT/bcrypt, Multer/Sharp, Nodemailer e módulos de auth, itens, admin, notificações, privacidade, uploads, busca salva, matching e integrações opcionais;
- frontend web React/TypeScript/Vite em frontend/, com busca, mapa, publicação, reivindicação, notificações, perfil, recuperação de senha e administração;
- app Flutter em apps/flutter/, com feed/busca, detalhe, publicação/edição, claim/devolução, itens do usuário, notificações, perfil e privacidade;
- API comum em /api e /api/v1, com contrato em docs/openapi/argos.v1.yaml;
- SQLite e imagens em armazenamento local. Isso atende uma única instância se disco, backup e restore estiverem configurados; não presuma que suporta múltiplas réplicas.

Leia `AUDITORIA_ARGOS/01_RELATORIO_DE_AUDITORIA.md` e `AUDITORIA_ARGOS/02_PLANO_DE_IMPLEMENTACAO.md`. Eles descrevem evidências e uma baseline de 05/11/2026. Reconfirme cada achado no código atual antes de alterá-lo. O branch ou arquivos podem ter mudado desde a auditoria.

ACHADOS QUE DEVEM SER TRATADOS

1. SEC-01: backend/src/utils/mail.ts grava corpo completo no console quando SMTP não está configurado, sem verificar NODE_ENV. backend/src/modules/auth/auth.routes.ts coloca token de reset no link; mail_outbox mantém o corpo depois do envio. Bloqueie produção sem transporte de e-mail seguro, remova token/corpo de logs, redija a mensagem entregue e aplique retenção/expurgo.
2. SEC-02: npm audit encontrou dependências vulneráveis. Baseline instalou, entre outras, backend proxy-addr 2.0.7, body-parser 1.20.8, multer 2.4.0, nodemailer 9.1.1, sharp 0.35.4 e zod 3.25.76; frontend axios 1.19.0, follow-redirects 1.16.0, Vite 8.2.1 e source-map-js 1.2.1. Atualize de forma pontual, verifique advisories atuais e compatibilidade. Nodemailer/Zod podem exigir major. Não use `npm audit fix --force` sem revisar cada quebra.
3. SEC-03: cadastro por senha em backend/src/modules/auth/auth.routes.ts cria conta ativa sem confirmar posse do e-mail, enquanto login Google confere `emailVerified`. Implemente verificação de e-mail com token hash, expiração, uso único, limite de reenvio, política para contas antigas e estados compreensíveis nos dois clientes.
4. SEC-04: backend/src/config/env.ts aceita JWT_SECRET de apenas 16 caracteres, senha de admin de 8 e TTL sem formato; produção rejeita somente valores padrão exatos. Valide segredo de alta entropia, senha de bootstrap, formato/limites de TTL e URLs no startup. Nenhum segredo pode ser exposto em erro ou versionado.
5. AUTH-01: backend/src/shared/policies/permissions.ts atribui permissões organizacionais/globais a papéis sem escopo de tenant. reports.routes.ts exporta todos os itens; dashboard.routes.ts chama todos os itens de escopo organizacional; itens/claims também autorizam por papel sem tenant. O banco não possui organização/espaço. Reconfirme a decisão de produto. Na ausência de requisito multi-tenant explícito, mantenha ARGOS como instalação single-campus e faça papéis não-platform falharem fechados/sem acesso global. Não construa multi-tenancy apenas por inferência. Se houver requisito formal, filtre todo endpoint e escreva testes de isolamento.
6. DATA-01: o fluxo de exclusão/anônimização em auth.routes.ts não limpa access_requests nem mail_outbox; auditoria pode reter e-mail de login falho. Defina retenção, exportação e apagamento/anonimização coerentes. Não apague auditoria necessária sem política; minimize e registre retenção. Não confirme “dados pessoais removidos” quando dados identificáveis continuam.
7. DATA-02: versão do consentimento vem do cliente e aceita qualquer string; resumo promete revogação, mas só há GET summary/export. Faça a versão do aviso ser definida no servidor; implemente a revogação aplicável ou ajuste os direitos exibidos. Mantenha o texto sincronizado web/API/Flutter. Não declare conformidade jurídica sem revisão do responsável.
8. DATA-03/OPS-01: schema/backfills estão no startup de backend/src/db/database.ts sem ledger de versão, e SQLite/uploads são locais. Implemente migrações sequenciais, verificáveis e seguras com dados existentes. Documente backup/restore e persistent storage para uma instância. Migre para outro banco/object storage somente se um requisito de escala for confirmado; explique impacto, rollout e rollback.
9. FUNC-01: PATCH admin/items/:id/status grava approval antes de validar status. Valide tudo antes e execute dados/histórico atomicamente; emita notificação depois de commit por outbox ou mecanismo equivalente.
10. API-01: docs/openapi/argos.v1.yaml omite dashboard, CRUD saved-searches, GET items/{id}/matches e health/ready, entre outros handlers reais. Sincronize operações, schemas, erros, paginação e permissões. Automatize a validação do contrato para não reintroduzir drift.
11. FUNC-02: matching é calculado após criação, não após edição de item. Recalcule/atualize scores/reasons e evite notificações duplicadas.
12. ABUSE-01: `spam_score` só é atualizado pelo admin; a tela sugere anti-spam automático. Defina e implemente um comportamento deliberado, auditável e testado ou apresente claramente a pontuação como manual. Não invente critérios sem base de produto.
13. MOD-01: AdminPage busca apenas as 20 denúncias mais recentes; denúncias não têm estado/atribuição de resolução. Se a capacidade de moderação fizer parte do produto, implemente fila paginada com status, responsável e audit log, preservando denúncia existente.
14. WEB-01: frontend não possui testes de comportamento/E2E. Adicione cobertura para jornadas web críticas e inclua CI.
15. MOB-01: Flutter não expõe recuperação de senha nem Google login existentes na API/web. Adicione os fluxos ou uma alternativa clara e segura, incluindo retorno a rota interna validada. Não coloque token ou senha em localStorage.
16. OPS-02: refresh cookie é SameSite=Lax fixo. Confira domínios reais. Prefira frontend/API same-site com proxy; se cross-site for requisito, configure cookie Secure/SameSite=None com proteção CSRF adequada e testes de browser. Não relaxe SameSite sem justificativa.

ESCOPO FUNCIONAL QUE DEVE SER PRESERVADO

Preserve busca pública, filtros, localização, criação/edição de itens, upload sanitizado, pistas públicas, reivindicações privadas, acompanhamento, notificações, devolução, exportação de dados, exclusão/anônimização, permissões e administração web que já funcionem. Preserve o modelo atual de access token curto e refresh token protegido/rotativo. Preserve os DTOs que impedem exposição pública de e-mail, provas de reivindicação e histórico interno. Preserve idempotência de publicação. Não remova função apenas para fazer os testes passarem.

O fluxo de publicação está atualmente aprovado automaticamente. Não mude para aprovação prévia sem requisito confirmado. O painel admin continua web; não transfira sua função para Flutter sem decisão de produto. Mapa, push e outros recursos mobile só entram se estiverem no escopo aprovado.

ORDEM DE EXECUÇÃO OBRIGATÓRIA

FASE 0 — BASELINE E DECISÕES
1. Verifique git status e instruções locais; não sobrescreva mudanças existentes.
2. Reproduza SEC-01/02/03/04, AUTH-01 e DATA-01 em ambiente isolado. Registre versões instaladas e testes de baseline.
3. Confirme single-campus vs multi-tenant, política de moderação, domínios, SMTP, retenção e topologia. Não invente essas decisões. Se o dono do produto não estiver disponível, mantenha single-campus, fail-closed para permissões globais e preserve autoaprovação, documentando as escolhas conservadoras.

FASE 1 — SEGURANÇA IMEDIATA
1. Feche vazamento de token/corpo de reset em console, log e outbox; exija entrega segura em produção.
2. Atualize dependências vulneráveis uma a uma. Corrija transitivos no lockfile; para majors, adapte a API e rode testes antes de seguir.
3. Faça configuração de produção falhar no startup para segredos fracos/defaults, URLs inválidas, TTLs inválidos e requisitos de e-mail ausentes.
4. Confirme proxy trust seguro; não confie cabeçalho encaminhado de qualquer origem.

FASE 2 — IDENTIDADE E AUTORIZAÇÃO
1. Implemente verificação de e-mail em cadastro por senha sem quebrar Google OAuth e aprovação de acesso institucional.
2. Faça política de papel single-tenant fail-closed ou implemente tenant completo somente com requisito; cubra reports/CSV, dashboard, claims, leitura de provas, moderação, busca, matching, auditoria e admin.
3. Teste cookie/CSRF e restauração de sessão nos domínios de homologação.

FASE 3 — PRIVACIDADE E BANCO
1. Centralize versão do aviso no servidor e implemente/corrija revogação.
2. Corrija exportação, exclusão, anonimização e retenção de dados em access_requests, outbox, logs, uploads, notificações, claims e consentimentos. Separe retenção de auditoria de dados operacionais.
3. Introduza migrações versionadas e procedimento de backup/restore; teste cópia de banco atual e caminho de atualização. Não altere banco de desenvolvimento/prod durante testes.

FASE 4 — API E INTEGRIDADE
1. Faça atualização administrativa atômica; cubra concorrência e falha parcial.
2. Recalcule matching após edição com deduplicação de alertas.
3. Resolva formalmente a semântica anti-spam e conclua fila de denúncias conforme escopo.
4. Atualize OpenAPI e seus testes em cada alteração.
5. Corrija formula injection no CSV administrativo: trate títulos, categorias e locais como texto literal para os consumidores suportados. Avalie XLSX com células tipadas como texto ou sanitização CSV específica; cubra `=`, `+`, `-`, `@`, tab, CR/LF, variantes Unicode, aspas e delimitadores. Não prometa proteção universal sem validar a planilha alvo.

FASE 5 — CLIENTES E COBERTURA
1. Adicione E2E web para login, rota protegida, recuperação, busca, publicação com/sem foto, erro de upload, claim, pistas, follow, devolução, privacidade/exportação/exclusão e moderação.
2. Adicione recuperação de senha e Google/alternativa no Flutter, se aprovados. Teste deep links, redirect allowlist e erros de API.
3. Preserve layout e valide teclado, acessibilidade, fonte grande, telas estreitas, landscape e loading/empty/error/success.

FASE 6 — HOMOLOGAÇÃO
1. Execute validação completa e build Android, web e backend. Rode teste HTTP Flutter e E2E web contra serviços temporários, nunca produção.
2. Teste dispositivo Pixel 9 real/emulador configurado se disponível; registre modelo, Android, passos e resultado. Não declare validação física sem executá-la.
3. Valide deploy de homologação: CORS, cookies, proxy, SMTP, persistência, backup/restore, logs, monitoramento e rollback.

REGRAS DE TESTE E DADOS

- Não use banco real/desenvolvimento nos testes de integração. Use diretório temporário exclusivo e desligue AI, Google, CAPTCHA, push, tradução e SMTP reais.
- Ao rodar teste HTTP Flutter, inicie servidor descartável com banco e uploads temporários e variáveis de integração vazias. Limpe apenas o diretório temporário criado pelo processo, depois de verificar seu caminho absoluto.
- Crie testes para cada correção, inclusive testes negativos de autorização, estado de sessão, consumo/expiração do token, concorrência e resposta de erro.
- Inclua testes de exportação para prefixos de fórmula e caracteres de controle/Unicode; valide no Excel/LibreOffice suportados quando disponíveis e registre limites do método escolhido.
- Não enfraqueça validações nem apague asserts para fazer a suíte passar. Não adicione resultado manual como se fosse teste automatizado.
- Execute e informe, conforme alterações: `npm run typecheck --prefix backend`, `npm test --prefix backend`, `npm run build --prefix backend`, `npm audit --prefix backend --audit-level=moderate`, `npm audit --omit=dev --prefix backend --audit-level=moderate`, `npm exec -- tsc --noEmit -p tsconfig.json` em frontend, `npm run build --prefix frontend`, `npm audit --prefix frontend --audit-level=moderate`, `npm audit --omit=dev --prefix frontend --audit-level=moderate`, `flutter analyze`, `flutter test`, teste HTTP Flutter contra API isolada, e testes E2E definidos.
- Se um comando não puder ser executado, diga exatamente por quê e qual validação ficou pendente. Não invente aprovação, captura de tela, resultado de aparelho ou ausência de vulnerabilidade.

CRITÉRIOS DE QUALIDADE

- Não há vulnerabilidade crítica/alta sem exceção de risco aprovada; dependências e lockfiles são compatíveis e reproduzíveis.
- Nenhum token, senha, prova de claim ou segredo é exposto em log, resposta pública, cache público ou documentação.
- Usuários só leem/moderam/exportam dados de seu escopo; toda negação é validada no servidor.
- Operação que retorna erro não deixa mudança parcial; gravações concorrentes preservam integridade.
- Consentimento, exportação, revogação, exclusão e retenção correspondem ao que o produto declara.
- OpenAPI descreve as rotas realmente consumidas por web e Flutter.
- Jornadas essenciais terminam com estado persistido e feedback real; nenhuma ação essencial fica como placeholder ou sucesso simulado.
- Testes E2E/integração cobrem falhas e regressão. Build aprovado não substitui teste funcional.
- Código existente correto permanece. Qualquer mudança arquitetural significativa exige justificativa, impacto, migração, plano de rollback e testes.
- Não prometa “zero erros”; informe limites e riscos residuais.

ENTREGA FINAL OBRIGATÓRIA

1. Resumo das mudanças e achados corrigidos, com IDs SEC/AUTH/DATA/FUNC/API/WEB/MOB/OPS.
2. Arquivos alterados e motivo de cada grupo.
3. Comandos exatos executados, resultado real e ambiente usado.
4. Testes de fluxo realizados em web, API e Flutter; identifique mocks versus API real e aparelho/emulador.
5. Migrações, dados afetados, backup e rollback, caso existam.
6. Vulnerabilidades corrigidas e advisories/exceções restantes.
7. Pendências, decisões do produto e validações impossíveis neste ambiente.
8. Não faça deploy, publicação em loja ou alteração de serviço externo. Prepare a entrega revisável e pare antes de qualquer publicação.
```

---

Esse prompt orienta uma execução em fases, exige validação real por cliente e preserva decisões de produto que a auditoria não pode inferir (multi-tenancy e política de aprovação de publicações).
