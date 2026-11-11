# ARGOS — Relatório de implementação das correções da auditoria

**Data:** 5 de novembro de 2026 · **Branch:** `gusargos` (alterações não commitadas, prontas para revisão)
**Base:** `01_RELATORIO_DE_AUDITORIA.md`, `02_PLANO_DE_IMPLEMENTACAO.md`, `03_PROMPT_DEFINITIVO_CLAUDE.md`
**Ambiente:** Windows 11 Education 10.0.26200, Node.js 24.21.0, npm 11.19.0, Flutter 3.47.6 / Dart 3.13.5,
Android SDK (build-tools 36.0.0), Microsoft Excel 16.0.20430. Nada foi publicado, implantado ou enviado a serviço externo.

Cada achado foi reconfirmado no código antes da alteração. A baseline reproduziu o relatório: 59 testes backend e
22 (+1 ignorado) Flutter passando; `npm audit` com 11 vulnerabilidades no backend (1 crítica) e 4 no frontend.

Decisões de produto que a auditoria não podia inferir foram resolvidas de forma conservadora e estão registradas em
[`docs/decisoes-de-produto.md`](../docs/decisoes-de-produto.md). A operação está em [`docs/operacao.md`](../docs/operacao.md).

---

## 1. Achados corrigidos

| ID | O que foi feito | Evidência automatizada |
|---|---|---|
| **SEC-01** | Mensagens de autenticação marcadas como sensíveis: nunca têm corpo registrado em log; fora de desenvolvimento não existe fallback de console (produção/homologação não iniciam sem SMTP e exigem TLS). Corpo apagado do `mail_outbox` ao enviar, falhar definitivamente ou expirar; links vencidos não são enviados; erros de transporte são gravados sem token/e-mail; expurgo do registro após 30 dias. Links usam fragmento (`#token=`) e a página remove o token da barra de endereço. A migração 2 apaga corpos já enviados no banco existente. | `auth-privacy.test.ts` (stdout sem token, outbox redigido, falha segura em modo produção, expiração, expurgo), `config.test.ts`, `migrations.test.ts` |
| **SEC-02** | Atualizações pontuais: proxy-addr 2.0.8, body-parser 1.20.9, qs 6.16.2, multer 2.5.0, sharp 0.35.5, **nodemailer 10.3.1** (major: só exige Node ≥ 20; `@types/nodemailer` removido porque o pacote traz tipos), **zod 4.6.7** (major: compatível sem mudança de código, todos os testes passaram), vitest 4.1.12, vite 8.3.6, axios 1.21.0, follow-redirects 1.16.2, source-map-js 1.2.2; na raiz, concurrently 9.2.5 (shell-quote 1.12.0). Sem `npm audit fix --force`. | `npm audit` = 0 vulnerabilidades em backend, frontend e raiz (com e sem `--omit=dev`) |
| **SEC-03** | Confirmação de e-mail no cadastro por senha: token aleatório (hash no banco), 24 h, uso único, reenvio 1/min e 5/dia por conta, resposta genérica. Sem sessão até confirmar; login/refresh/bearer de conta não confirmada → 403 `email_unverified`. Redefinir senha pelo link confirma a posse. Vincular Google a conta não confirmada invalida a senha não comprovada e as sessões; outro Google na mesma conta é recusado. Contas antigas não são presumidas verificadas. Web e Flutter mostram o estado e o reenvio. | `auth-privacy.test.ts` (6 casos), E2E `auth.spec.ts`, Flutter `auth_flows_test.dart`, `live_api_test.dart` |
| **SEC-04** | `parseEnv` valida no boot: `JWT_SECRET` obrigatório, ≥ 32 caracteres e ≥ 128 bits estimados em produção; `ADMIN_PASSWORD` sem padrão em produção e com política forte; TTLs com formato e limites; URLs/origens https reais; `TRUST_PROXY` sem `true` em produção (saltos ou CIDRs); SMTP obrigatório. Mensagens citam a variável, nunca o valor. O `.env` local continua válido (verificado sem exibir valores). | `config.test.ts` (8 casos) |
| **SEC-05** | CSV: campos de texto livre que começariam fórmula (`=`, `+`, `-`, `@`, tab, CR/LF, espaços/controles antes, largura total, formas pequenas, sinal de menos) recebem apóstrofo; aspas e separadores preservados; CRLF; `Cache-Control: no-store`. | `moderation-integrity.test.ts`, E2E admin; **Excel 16.0.20430** (seção 4) |
| **AUTH-01** | Campus único, falha fechada: `space_manager`, `org_admin` e `support` têm só permissões de cidadão; a API só atribui `citizen`/`admin`. Só `admin` tem dashboard global, CSV, provas de claim, moderação, fila de denúncias e auditoria. Multi-tenancy **não** foi construída (sem requisito). | `auth-privacy.test.ts` (3 papéis × 14 verificações negativas + atribuição recusada) |
| **DATA-01** | Exclusão cobre `access_requests`, `mail_outbox`, `email_verifications`, `mobile_operations`, inscrições push, fotos sem uso (banco e disco), texto/provas das reivindicações em casos de terceiros, reporter das denúncias; auditoria com e-mail vira pseudônimo; aceite fica com revogação registrada. Mensagem de confirmação descreve o que realmente acontece. Login falho grava pseudônimo, não o e-mail. Exportação inclui solicitações de acesso, consentimentos, e-mails (sem corpo), histórico dos itens, denúncias, eventos de segurança e uploads. Retenção periódica configurável. | `auth-privacy.test.ts` (conta por cadastro e por aprovação institucional, tabela a tabela), E2E privacidade |
| **DATA-02** | Versão do aviso definida no servidor (`config/privacy-notice.ts`, `2026-11-05`); cliente com versão diferente recebe 409 `terms_outdated`; aceite de nova versão (`POST /privacy/consents`); situação do aceite e prazos de retenção no resumo; direitos indicam a ação real (e onde ela existe: web ou app). Web e Flutter leem o mesmo texto da API. | `auth-privacy.test.ts`, E2E privacidade |
| **DATA-03 / OPS-01** | Migrações numeradas com `schema_migrations`, transação por migração, cópia `VACUUM INTO` antes de migrar banco existente, recusa de código mais antigo que o banco; backfills saíram do boot. Ferramenta de backup online/verificação/restauração (`ops/backup.ts`, CLI em `dist/ops/backup-cli.js`) e guia de operação para instância única. | `migrations.test.ts` (banco legado, idempotência, falha parcial, versão futura, backup com WAL, restore isolado, adulteração, imagem ausente, rotação) |
| **FUNC-01** | `PATCH /admin/items/:id/status` valida antes de gravar e executa leitura + escrita + histórico + auditoria + notificação numa transação IMMEDIATE (`db/transaction.ts`); push só depois do commit. | `moderation-integrity.test.ts` (payload inválido sem efeito, falha forçada no meio sem dado/notificação/push, concorrência coerente) |
| **API-01** | OpenAPI sincronizado (dashboard, buscas salvas, matches, health/ready/live, verificação de e-mail, consentimento, fila de denúncias, 401 em todas as rotas autenticadas, schemas). Teste de contrato compara rotas Express × OpenAPI nos dois sentidos, endpoints usados por web e Flutter, `$ref`s e respostas reais × schemas. | `contract.test.ts` (5 casos) — detectou exatamente a divergência da auditoria antes da correção |
| **FUNC-02** | `refreshItemMatches` recalcula na criação, após edição de campo relevante e quando o admin aprova: atualiza score/motivos, remove pares inválidos, cria novos; aviso uma vez por par (`item_match_notifications`). Buscas salvas também reavaliadas após edição (já deduplicadas). | `moderation-integrity.test.ts` |
| **ABUSE-01** | Pontuação declarada **manual**: constante única, mensagem e código `publishing_restricted`, auditoria `admin.user_restriction_changed` (antes/depois), botões "Restringir/Remover restrição" e texto explícito no painel. Nenhuma heurística automática inventada. | `moderation-integrity.test.ts`, E2E admin |
| **MOD-01** | Entidade `item_reports` (estado, responsável, nota, resolvido por/em), fila paginada e filtrável, assumir/resolver/descartar/reabrir com transições válidas, controle de concorrência (409), auditoria, denúncia duplicada aberta não repete, denúncia sobrevive à exclusão do caso. Denúncias antigas importadas. | `moderation-integrity.test.ts`, `migrations.test.ts`, E2E admin |
| **WEB-01** | Playwright + axe-core: 9 testes de jornada em 1366 px (3 deles repetidos em 360 px com toque) e 2 testes de acessibilidade (WCAG 2.1 A/AA em 8 telas), contra API descartável e build de produção. CI em `.github/workflows/ci.yml`. | 14/14 E2E passando; axe sem violações |
| **MOB-01** | Flutter: recuperação de senha no app (link concluído na web, sem guardar token), estado de confirmação pendente com reenvio, explicação do servidor para `email_unverified`/`publishing_restricted`, orientação para contas Google (sem OAuth nativo), tela de privacidade com aceite da versão vigente e retenção. Redirect allowlist inalterado. | `auth_flows_test.dart` (7 casos), teste HTTP, integração Android em emulador |
| **OPS-02** | `SameSite=Lax` mantido (topologia same-site recomendada); `COOKIE_SAMESITE=none` só com HTTPS; `Secure` também em homologação; refresh/logout/login/Google recusam `Origin` não autorizado (CSRF). | `auth-privacy.test.ts`, `config.test.ts`, E2E (cookie httpOnly/Lax/`/api`, nada em localStorage) |

## 2. Arquivos alterados

**Backend — configuração e segurança:** `src/config/env.ts` (validação de produção, proxy, cookie, retenção), `src/config/privacy-notice.ts` (novo, texto/versão do aviso), `src/utils/duration.ts`, `src/utils/pseudonym.ts`, `src/middleware/origin.ts`, `src/middleware/auth.ts` (exige e-mail confirmado), `src/utils/mail.ts` (SEC-01), `.env.example`.
**Backend — banco e operação:** `src/db/migrations.ts` (novo, migrações 1–4), `src/db/database.ts` (runner + bootstrap), `src/db/transaction.ts` (`atomic`/`afterCommit`), `src/ops/backup.ts` e `backup-cli.ts`, `src/utils/retention.ts`, `src/utils/orphan-uploads.ts`, `src/app.ts` (readiness com versão de esquema, lista de rotas exportada, caixa de teste condicional).
**Backend — regras:** `modules/auth/auth.routes.ts` (verificação, Google, exclusão), `modules/privacy/privacy.routes.ts`, `modules/admin/admin.routes.ts` (atomicidade, fila, restrição, papéis), `modules/items/items.routes.ts` e `item-matching.ts`, `modules/reports/reports.routes.ts`, `shared/policies/permissions.ts` e `abuse.ts`, `utils/audit.ts`, `modules/testing/test-mail.routes.ts` (só testes).
**Backend — testes:** `test/support/harness.ts`, `config`, `migrations`, `auth-privacy`, `moderation-integrity`, `contract` (novos); `integration`/`smoke` ajustados ao novo cadastro (nenhum assert removido).
**Contrato:** `docs/openapi/argos.v1.yaml`.
**Web:** `pages/VerifyEmailPage.tsx` (nova), `LoginPage`, `ResetPasswordPage`, `PrivacyPage`, `AdminPage`, `App.tsx`, `contexts/AuthContext.tsx`, `services/api.ts`, `types/api.ts`, `utils/permissions.ts`, `styles.css`, `i18n/en.ts`, `es.ts`, `server-messages.ts` (684/684 chaves), `vite.config.ts` (destino do proxy configurável), `playwright.config.ts`, `e2e/*`.
**Flutter:** `core/network/api_client.dart`, `features/auth/application/auth_controller.dart`, `features/auth/presentation/login_screen.dart`, `features/items/presentation/account_screens.dart`, `test/auth_flows_test.dart` (novo), `test/live_api_test.dart`, `integration_test/mobile_journey_test.dart`, `tool/run_live_api_test.mjs` (novo), `README.md`.
**Raiz/docs/CI:** `.github/workflows/ci.yml`, `docs/decisoes-de-produto.md`, `docs/operacao.md`, `README.md`, `.gitignore`, `package.json`/lock.

## 3. Comandos executados (resultado final)

| Comando | Resultado |
|---|---|
| `npm run typecheck --prefix backend` | exit 0 |
| `npm test --prefix backend` | 7 arquivos, **108 testes** passando (59 originais + 49 novos) |
| `npm run build --prefix backend` | exit 0 |
| `npm audit --prefix backend --audit-level=moderate` | 0 vulnerabilidades |
| `npm audit --omit=dev --prefix backend --audit-level=moderate` | 0 vulnerabilidades |
| `npm exec -- tsc --noEmit -p tsconfig.json` (frontend) | exit 0 |
| `npm run build --prefix frontend` | exit 0 |
| `npm run i18n:check --prefix frontend` | en-US 684/684, es-ES 684/684 |
| `npm audit --prefix frontend --audit-level=moderate` / `--omit=dev` | 0 / 0 vulnerabilidades |
| `npm audit --audit-level=moderate` (raiz) | 0 vulnerabilidades (era 2 críticas em `shell-quote`) |
| `npx playwright test` (frontend) | **14/14** (Chromium 1.64 do Playwright; Edge/Chrome instalados recusam automação por política do dispositivo) |
| `flutter analyze` | sem apontamentos |
| `flutter test` | **29 passando**, 1 ignorado (o teste HTTP, que roda à parte) |
| `node tool/run_live_api_test.mjs` (apps/flutter) | 1/1 passando contra API descartável; pasta temporária removida |
| `flutter build apk --debug` | `app-debug.apk` gerado (Gradle 138,7 s) |
| `node tool/run_live_api_test.mjs --device emulator-5554` | 1/1 passando no emulador (detalhes na seção 4) |

Verificações adicionais: mutação manual (reverter a redação do outbox e devolver permissões globais a `org_admin`) fez os testes correspondentes falharem — e os arquivos foram restaurados. O banco de desenvolvimento `backend/argos.sqlite` não foi tocado (datas de 29/09 e 08/10 preservadas).

## 4. Testes de fluxo realizados

- **API (real, banco temporário):** todos os testes backend sobem o app Express com SQLite/uploads em pasta temporária exclusiva e integrações externas desligadas. SMTP, Google, push, IA e tradução são substituídos por mocks (`mailTransport`, `googleVerifier`, `web-push`, `fetch`).
- **Web (real, sem mocks de API):** Playwright sobe a API descartável (`e2e/start-backend.mjs`, `.env` local ignorado) e o build de produção via `vite preview`. Jornadas: cadastro → confirmação pendente → login recusado → reenvio → link → confirmação → login → link reutilizado recusado; rota protegida → login → retorno ao destino → recarga mantém sessão (cookie httpOnly/Lax/`/api`, nada em storage) → logout; recuperação de senha (token sai da URL, confirmação divergente, link reutilizado); publicação sem foto, com foto e com imagem inválida (erro e campos preservados); busca pública; acompanhar, pista, reivindicação privada (prova invisível a visitantes), devolução e notificação; 403 de edição; privacidade (versão, retenção, exportação JSON, exclusão e login recusado); fila de denúncias (assumir, resolver, filtro) e CSV; restrição manual. Mapas externos bloqueados no teste. axe-core: 0 violações WCAG 2.1 A/AA em login, consulta, detalhe, privacidade, confirmação de e-mail, publicação, configurações e administração (tema claro, desktop).
- **Flutter com respostas controladas:** cadastro sem sessão + reenvio, login não confirmado, recuperação, layouts 320×640 e 640×320 com fonte 200%, allowlist de redirect, prioridade das mensagens do servidor.
- **Flutter contra API real descartável:** cadastro → login recusado (`email_unverified`) → confirmação pela caixa de teste → login → foto → publicação idempotente → busca → acompanhar → pista → reivindicação (409 na duplicada) → devolução → exclusão → recuperação de senha pedida pelo app → restauração da sessão em outro cliente → logout.
- **Android (emulador, não aparelho físico):** AVD "Pixel 10 Pro XL", imagem `sdk_gphone16k_x86_64`, **Android 17 (API 37)**, aceleração WHPX, GPU `host`. Não havia AVD nem aparelho Pixel 9. Primeira tentativa com `-gpu swiftshader_indirect`: o emulador travou (exit 139). Com `-gpu host`, a jornada completa passou (cadastro com confirmação, sessão persistida no armazenamento seguro e restaurada, busca, reivindicação, devolução, rascunho guardado e validação do formulário) depois de um ajuste no próprio teste: um SnackBar da tela anterior cobria o botão "Revisar e publicar" e o toque não chegava ao botão. O teste agora limpa os SnackBars antes do toque; nenhuma verificação foi removida.
- **CSV no Excel 16.0.20430 (pt-BR):** um `.txt` com o mesmo conteúdo foi aberto via COM com separador vírgula (o Excel ignora o separador em `.csv` e usa o `;` regional — com duplo clique, cada linha cai inteira na coluna A). Arquivo de controle sem proteção: `=1+1`, `+1+1` e `-1+1` viraram fórmulas. Arquivo do ARGOS: **nenhuma célula virou fórmula**; o texto aparece com apóstrofo visível; aspas, vírgulas e `;` preservados. LibreOffice e Google Sheets não estavam disponíveis: **não validados**.

## 5. Migrações, dados afetados, backup e rollback

Migrações aplicadas na primeira inicialização desta versão (com cópia prévia automática em `backups/`):

1. `baseline_schema` — esquema anterior (idempotente para bancos legados) + backfill único das chaves normalizadas + deduplicação de reivindicações.
2. `email_verification_and_mail_privacy` — tabela `email_verifications`; colunas `sensitive`/`expires_at` em `mail_outbox`; **apaga corpos de e-mails já processados**; marca links de senha pendentes há mais de 1 h como `expired`; **pseudonimiza e-mails** em `auth.login_failed`/`auth.access_requested`. Contas antigas sem `email_verified_at` passam a confirmar o e-mail no próximo login.
3. `moderation_reports` — tabela `item_reports`; **importa denúncias antigas** da auditoria como abertas.
4. `match_refresh_and_notification_dedup` — `item_matches.updated_at` e `item_match_notifications` (pares existentes marcados como já avisados).

Rollback: parar a API, restaurar a cópia `argos-pre-migration-*.sqlite` ou um backup (`backup-cli restore --force`, que preserva o estado atual) e voltar ao código anterior. Depois de uso real, preferir correção para frente. Procedimento, política sugerida de RPO/RTO e checklist em `docs/operacao.md`.

## 6. Vulnerabilidades

Corrigidas: todas as listadas no `npm audit` da baseline (backend 11, frontend 4) e as 2 críticas da raiz. Restantes: **nenhuma** reportada pelo `npm audit` em 05/11/2026. Isso não cobre varredura de segredos no histórico Git nem análise de alcance das CVEs; também não substitui um teste de penetração.

## 7. Pendências, decisões e validações não realizadas

**Decisões que precisam de dono** (detalhes em `docs/decisoes-de-produto.md`): campus único vs multi-tenant; prazos de retenção (auditoria está mantida sem expurgo); texto jurídico do aviso de privacidade (versão alterada para `2026-11-05`; usuários antigos veem o pedido de novo aceite); Google nativo e deep links no app; regras automáticas anti-spam, se desejadas.

**Mudanças de comportamento a comunicar antes do deploy:**
- Contas criadas por senha que nunca confirmaram o e-mail precisarão confirmar no próximo login; sessões delas deixam de valer.
- Usuários com papel `space_manager`, `org_admin` ou `support` perdem moderação/relatórios (passam a cidadão).
- Em desenvolvimento, sem SMTP, links de autenticação não aparecem mais no terminal (use Mailpit ou a conta `DEV_TEST_USER`).
- `TRUST_PROXY=true` em desenvolvimento passa a significar 1 salto; em produção é recusado.

**Não validado neste ambiente:**
- Domínios reais, HTTPS, proxy, cookies cross-site e CSRF num navegador real em homologação.
- SMTP real (entrega, SPF/DKIM, caixa de spam).
- Aparelho Pixel 9 físico ou emulado; TalkBack, câmera/galeria reais, permissões negadas, rede ruim; build de release assinado; iOS.
- Firefox/WebKit; leitor de tela e navegação completa por teclado (só a auditoria automática axe); tema escuro/alto contraste no axe.
- LibreOffice/Google Sheets para o CSV.
- Restore em infraestrutura real e monitoramento/alertas.

**Riscos residuais e observações:**
- SQLite/uploads locais continuam limitados a uma instância.
- A caixa de e-mails de teste existe no código; só é montada com `NODE_ENV=test` + `ENABLE_TEST_MAIL_SINK=true` (o boot recusa a flag em outros ambientes), responde só a loopback e a destinatários `.test`.
- No Flutter, SnackBars do `ScaffoldMessenger` raiz podem cobrir por alguns segundos o rodapé da tela seguinte (observado no emulador; não alterado no app).
- Com CAPTCHA ligado no servidor, cadastro e recuperação pelo app recebem 422 (limitação anterior).
- O app não tem exportação/exclusão de conta; o texto dos direitos indica que essas ações estão na web.
- No CSV, o apóstrofo fica visível no Excel e aparece para leitores programáticos; a proteção vale para os consumidores testados, não é universal.

## 8. Publicação

Nada foi commitado, enviado, implantado ou publicado. As alterações estão no working tree do branch `gusargos` para revisão.
