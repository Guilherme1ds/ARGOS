# ARGOS — Relatório de fechamento (jornadas, interface e operação)

**Data:** 11 de novembro de 2026 · **Branch:** `gusargos` (alterações no working tree, sem commit)
**Base:** `01_RELATORIO_DE_AUDITORIA.md`, `02_PLANO_DE_IMPLEMENTACAO.md`, `04_RELATORIO_DE_IMPLEMENTACAO.md`,
`docs/decisoes-de-produto.md`, `docs/operacao.md` e o contrato OpenAPI.
**Ambiente:** Windows 11 Education 10.0.26200, Node.js 24.21.0, npm 11.19.0, Flutter 3.47.6 / Dart 3.13.5,
Playwright 1.64.1 (Chromium 1248, headless), Android SDK local. Nada foi commitado, implantado, publicado ou enviado
a serviço externo. O banco de desenvolvimento `backend/argos.sqlite` não foi tocado (datas 29/09 e 08/10 preservadas).

O trabalho de 05/11 (ainda não commitado) foi preservado. Cada lacuna abaixo foi reconfirmada no código ou com teste
automatizado antes da correção; o que já funcionava não foi refeito.

## 1. Linha de base reconfirmada

| Verificação | Resultado antes das correções |
|---|---|
| `npm run typecheck` + `npx vitest run` (backend) | ok; 108 testes |
| `npm run build` + `npm run i18n:check` (web) | ok; 684/684 |
| `npx playwright test` (web, API descartável) | 14/14 |
| `flutter analyze` + `flutter test` | sem apontamentos; 29 + 1 ignorado |

Exploração adicional (axe-core com boas práticas, 360/768/1366 px, tema escuro, teclado e API fora do ar) revelou as
lacunas da seção 2.

## 2. Lacunas confirmadas e corrigidas (por impacto)

| # | Lacuna confirmada | Correção | Evidência |
|---|---|---|---|
| 1 | **Chave de API no repositório:** `backend/.env.example` trazia `DEEPL_API_KEY` preenchida (também no histórico, commit `5ea4299`). | Valor removido do exemplo. **Ação externa:** revogar/rotacionar a chave no painel DeepL (o histórico do Git continua com ela). | varredura de segredos no working tree e no histórico (só esse achado) |
| 2 | **Edição parcial alterava dado:** com Zod 4, `PATCH /items/:id` sem `contactPreference` voltava a preferência para `in_app` (o `.default()` vale mesmo em `.partial()`). | Schema de edição sem padrão; histórico registra só o que mudou. | `user-journeys.test.ts`; teste falha com a correção revertida |
| 3 | **Controles sem efeito:** "E-mail autorizado"/"Contato preferido" (web e app) não mudavam nada; a grade mostrava "Chat interno" inexistente. | Seletores removidos; texto explica que o contato é pelo ARGOS e o e-mail não é exibido. API aceita o campo como informativo (OpenAPI atualizado). | inspeção do código + E2E |
| 4 | **Solicitação de acesso pedia senha que era descartada;** pedido aprovado podia ser "rejeitado" depois (conta ativa com pedido rejeitado) ou reaberto/sobrescrito. | Sem senha no pedido (web e app) e resposta que explica o próximo passo; só pedidos pendentes são avaliados (409); pedido aprovado não é reaberto. Painel mostra status traduzido e ações só para pendentes, sem clique duplo. | `user-journeys.test.ts`, `journeys.spec.ts`, `claims_notifications_test.dart`, teste HTTP do app |
| 5 | **Bloqueio irreversível pela interface** e conta bloqueada recebia mensagem genérica (app: "sem permissão"). | Botão "Desbloquear"; `details.code = account_inactive` com mensagem clara (só após senha correta). | `user-journeys.test.ts`, `journeys.spec.ts`, teste Flutter |
| 6 | **App sem cancelar a própria solicitação** (jornada pedida) nem recusar uma recebida ou remover a própria pista. | Ações no detalhe do Flutter, com confirmação e mensagens específicas (antes: "Operação concluída."). | `claims_notifications_test.dart`; teste HTTP do app contra API real descartável |
| 7 | **Notificação no app não ficava lida ao abrir** (contador não baixava). | Tocar marca como lida e atualiza o contador; estado lido/não lido anunciado ao leitor de tela. | `claims_notifications_test.dart` |
| 8 | **Mensagens técnicas:** sem rede, a web mostrava "verifique o backend em http://localhost:3333 e reinicie o Vite"; 401 virava "Token inválido."; validação do Zod chegava em inglês ("Too small: expected string…"); textos do servidor sem acento. | Web: mensagens por situação (sem conexão, sessão expirada, falha do servidor com código para suporte), dica técnica só em desenvolvimento. Servidor: mensagens de validação em português claro, traduzidas na web por padrão; acentos corrigidos. | `user-journeys.test.ts`, `journeys.spec.ts` |
| 9 | **Falha de carregamento parecia lista vazia** ("Nenhum caso publicado ainda" junto com o erro). | Painel de erro com "Tentar novamente" no mural e na grade; falha ao carregar mais mostra retry no lugar. | `journeys.spec.ts` (rede abortada) |
| 10 | **Busca não respondia ao Enter** (campos fora de `<form>`). | Barra de busca virou formulário `role="search"`. | `journeys.spec.ts` |
| 11 | **Diálogos sem gestão de foco** (foco ficava atrás do modal; Tab saía dele). | Foco entra no "Fechar", Tab circula dentro, Escape devolve o foco ao cartão. | `journeys.spec.ts` |
| 12 | **Feedback longe da ação** no mural/grade/detalhe (mensagem no topo da página) e "Acompanhar" sempre desmarcado mesmo para casos acompanhados. | Aviso flutuante visível (região viva, não cobre a navegação móvel); pistas com aviso no próprio painel; estado real de acompanhamento carregado da API. | `journeys.spec.ts` (inclui 360 px) |
| 13 | **"Ver todas as N pistas" mostrava só 2.** | Leva à página do caso com a lista completa. | inspeção + E2E de pistas |
| 14 | **Acessibilidade (axe):** crítico em Meus itens (`aria-pressed` em aba), contraste sério no seletor de idioma do mural e em todos os botões primários no tema escuro, páginas sem `h1`, ordem de títulos no mapa; foco visível com contraste baixo; alvos de 21 px. | Abas no padrão WAI-ARIA (setas/Home/End); token `--on-primary` para o tema escuro; `h1` nas telas de entrada e no mural; foco com contraste; botões e caixas de seleção ≥ 24 px; erros de formulário associados por `aria-describedby` e foco no primeiro campo inválido. | `a11y.spec.ts`: 18 telas × tema claro/escuro, WCAG 2.1 A/AA + boas práticas, **falha em impacto moderado ou maior** — 0 violações |
| 15 | **Sessão perdida apagava o formulário de publicação** (redirecionamento ao login). | Rascunho de texto por conta na aba (sem foto), recuperado após login; logout, exclusão e login de outra conta o apagam. | `journeys.spec.ts` |
| 16 | **Exclusão de conta sem aviso a terceiros:** quem reivindicava/acompanhava casos abertos da conta não era avisado (a exclusão de caso avisa). | "Caso removido" para quem dependia dos casos; "Reivindicação cancelada" para quem recebeu solicitação da pessoa excluída, sem identificá-la. | `user-journeys.test.ts` |
| 17 | **Limite de login por IP (10/min)** barraria logins legítimos de um campus atrás de NAT. | 10/min por conta + IP e teto de 60/min por IP. | `user-journeys.test.ts` (NAT simulado e teto) |
| 18 | Outros: botão de push sem ação quando a configuração não carrega; conta Google sem saber como confirmar exclusão/troca de senha; marcadores do mapa nomeados por número; `frontend/.env.example` apontando para `localhost:3333`; README do app dizendo que não havia recuperação de senha. | Explicações e correções pontuais. | inspeção + build |

## 3. Arquivos alterados nesta etapa

- **Backend:** `src/modules/auth/auth.routes.ts` (acesso sem senha, `account_inactive`, limite de login, avisos na exclusão, acentos), `src/modules/admin/admin.routes.ts` (avaliação só de pendentes), `src/modules/items/items.routes.ts` (edição parcial, motivo padrão), `src/shared/policies/permissions.ts`, `src/utils/validation-messages.ts` (novo), `src/config/env.ts` (carrega as mensagens), `.env.example`, `test/user-journeys.test.ts` (novo, 10 testes).
- **Contrato:** `docs/openapi/argos.v1.yaml` (cadastro/solicitação, 403/429 do login, avaliação de acesso, edição parcial, campos informativos, códigos de erro).
- **Web:** `services/api.ts`, `services/following.ts` (novo), `components/FloatingFeedback.tsx` (novo), `utils/useDialogFocus.ts` (novo), `utils/itemDraft.ts` (novo), `contexts/AuthContext.tsx`, páginas `HomeFeedPage`, `ItemsPage`, `ItemDetailPage`, `ItemFormPage`, `MyItemsPage`, `LoginPage`, `ResetPasswordPage`, `AdminPage`, `ProfilePage`, `SettingsPage`, `NotificationsPage`, `MapPage`, `components/AccountSettings.tsx`, `components/MapView.tsx`, `styles.css`, `i18n/en.ts`, `es.ts`, `server-messages.ts`, `.env.example`; E2E `e2e/journeys.spec.ts` (novo) e `e2e/a11y.spec.ts` (ampliado).
- **Flutter:** `features/items/presentation/item_detail_screen.dart`, `account_screens.dart`, `item_form_screen.dart`, `features/auth/presentation/login_screen.dart`, `features/auth/application/auth_controller.dart`, `features/feed/data/items_repository.dart`, `core/network/api_client.dart`, `test/claims_notifications_test.dart` (novo, 6 testes), `test/live_api_test.dart` (cancelar, recusar, remover pista, acesso sem senha), `README.md`.
- **Documentação:** `README.md`, `docs/decisoes-de-produto.md` (seção "Fechamento de 11/11/2026"), `docs/operacao.md` (seção 7 reescrita como checklist executável; seção 8 nova: instalação passo a passo).

## 4. Validações executadas (resultado final)

| Comando | Resultado |
|---|---|
| `npm run typecheck --prefix backend` | exit 0 |
| `npx vitest run` (backend) | 8 arquivos, **118 testes** passando |
| `npm run build --prefix backend` | exit 0 |
| `npm audit` e `npm audit --omit=dev` (backend, frontend e raiz, `--audit-level=moderate`) | 0 vulnerabilidades nos seis |
| `npm run build --prefix frontend` (inclui `tsc -b`) | exit 0 |
| `npm run i18n:check --prefix frontend` | en-US 736/736, es-ES 736/736 |
| `npx playwright test` (frontend; API e banco descartáveis, build de produção) | **22/22** (18 em 1366 px, 4 em 360 px com toque) |
| `npx playwright test e2e/journeys.spec.ts --repeat-each=3` | 15/15 (estabilidade) |
| `flutter analyze` | sem apontamentos |
| `flutter test` | **35 passando**, 1 ignorado (o teste HTTP, executado à parte) |
| `node tool/run_live_api_test.mjs` (apps/flutter) | 1/1 contra API descartável |
| `flutter build apk --debug --dart-define-from-file=config/development.example.json` | `app-debug.apk` gerado (Gradle 126,7 s) |
| Varredura de layout 360/768/1366 px (mural, grade, detalhe, publicar, meus itens, notificações, perfil, configurações, mapa, admin) | sem rolagem horizontal; aviso flutuante não cobre a navegação móvel |

Jornadas cobertas por teste automatizado com API real descartável: visitante (busca, filtros, Enter, detalhe, mapa,
falha de rede); cadastro → confirmação → login → recarga → logout → recuperação de senha; publicar com e sem foto,
foto inválida, validação com foco e rascunho após sessão perdida; acompanhar, pista e remoção, reivindicar, cancelar,
recusar e devolver (web e app); notificações; privacidade, exportação e exclusão; denúncias, CSV, restrição,
solicitação de acesso, aprovação única, bloqueio e desbloqueio.

**Não executado nesta etapa:** teste de interface no emulador Android (`integration_test`, executado em 05/11),
aparelho físico, iOS, Firefox/WebKit, leitor de tela real (TalkBack/NVDA) — a navegação por teclado foi validada
por testes automatizados, não manualmente.

## 5. Pendências externas para liberar usuários reais

Nenhuma delas pode ser feita neste ambiente; os passos concretos estão em `docs/operacao.md`:

1. **Revogar a chave DeepL** exposta no histórico do Git e gerar outra, guardada só no cofre do ambiente.
2. **Instalação** no servidor real (seção 8: build, variáveis, proxy com 6 MB e fallback SPA, serviço, primeiro boot, remoção de `ADMIN_PASSWORD`).
3. **Homologação no domínio real** (seção 7): HTTPS, cookie/CSRF em navegador real, links diretos, IP real atrás do proxy e NAT, upload de 4,5 MB pelo proxy, SMTP real com SPF/DKIM/DMARC, persistência após reinício, backup + restauração em outra máquina, administração e Android release assinado em aparelho.
4. **Aprovações do responsável pela privacidade:** texto do aviso (`backend/src/config/privacy-notice.ts`), prazos de retenção (auditoria segue sem expurgo) e ativação de IA/tradução.

## 6. Riscos residuais e decisões que continuam com o responsável do produto

- **Contato entre as partes:** não há canal privado de resposta do responsável para quem reivindica; a combinação da entrega depende da mensagem da reivindicação e de comunicação fora do sistema. Criar esse canal (ou compartilhar contato com consentimento) é decisão de produto.
- Campus único, aprovação automática de publicações, anti-spam manual, Google nativo e deep links no app: mantidos como em `docs/decisoes-de-produto.md`.
- Cadastro e recuperação de senha seguem limitados por IP (5/min); em um dia de cadastro em massa atrás de NAT podem aparecer 429. Avaliar com tráfego real.
- Rascunho web fica em `sessionStorage` da aba (texto público do caso, sem foto) por até 24 h; apagado no logout.
- SQLite e uploads locais continuam restritos a uma instância; CAPTCHA ligado ainda impede cadastro/recuperação pelo app.
- A validação automática de acessibilidade não substitui teste com leitor de tela e pessoas usuárias.

**Produção não está liberada:** o software está revisado e validado localmente; a liberação depende das etapas da seção 5.
