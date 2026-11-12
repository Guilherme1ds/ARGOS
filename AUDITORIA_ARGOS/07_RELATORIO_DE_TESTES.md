# ARGOS — Relatório de testes de software

**Data:** 12 de novembro de 2026 · **Branch:** `gusargos` · **Base:** commit `08c73b0` + alterações no working tree (sem commit)
**Ambiente:** Windows 11 Education 10.0.26200, Node.js 24.21.0, Playwright 1.64.1 (Chromium, Firefox e WebKit,
headless), Flutter 3.47.6, emulador Android Pixel_10_Pro_XL (API 37).
**Relação com os outros relatórios:** complementa `06_RELATORIO_DE_FECHAMENTO.md` (jornadas e interface). Aqui estão
os tipos de teste executados contra a aplicação rodando, os defeitos que eles revelaram e o que foi corrigido.

Nada foi commitado, implantado, publicado ou enviado a serviço externo. Nenhum e-mail real foi enviado.

## 1. Ambiente de teste (descartável)

| Peça | Como rodou |
|---|---|
| API | `node dist/server.js` com `NODE_ENV=test`, porta 3601. Banco SQLite e uploads numa pasta temporária do sistema (fora do repositório); `JWT_SECRET` e senha do administrador gerados na hora; `.env` local ignorado. |
| E-mail | SMTP vazio. Os links de confirmação e redefinição foram lidos da caixa de teste da própria API (`/api/v1/__test__/mail/latest`), que só existe com `NODE_ENV=test` e só aceita domínios `.test`. |
| Integrações externas | DeepL, LibreTranslate, Google, Turnstile, Anthropic e Web Push vazios. Nos navegadores, toda requisição para fora de `localhost` foi bloqueada (inclusive os blocos do mapa). |
| Web | Build de produção (`vite build`) servido por `vite preview` na porta 4601, com `/api` encaminhado para a API (mesmo domínio, como no proxy recomendado). |
| Clientes simulados | `TRUST_PROXY=1` e um `X-Forwarded-For` diferente por pessoa simulada, para os limites por IP valerem como em produção. |
| App | Flutter no emulador, API em `10.0.2.2`. O teste de integração do app sobe uma segunda API descartável (porta 3334) e apaga a pasta no fim. |
| Banco de desenvolvimento | `backend/argos.sqlite` não foi usado. O teste de migração trabalhou numa cópia e conferiu que o original continuou com o mesmo hash (M5). |

## 2. Resultado por tipo de teste

| Tipo | O que foi verificado | Resultado |
|---|---|---|
| Unitário e integração (API) | `npx vitest run`: regras, permissões, autenticação, privacidade, moderação, migrações, backup e jornadas | **120/120** |
| Ponta a ponta (web) | `npx playwright test`: cadastro → confirmação → login, publicação com e sem foto, reivindicação, devolução, privacidade, moderação, rascunho, reflow, tela que não carrega; desktop e 360 px | **25/25** |
| Acessibilidade automatizada | axe-core (WCAG 2.1 A/AA + boas práticas, bloqueia moderado ou pior) em 18 telas, tema claro e escuro (dentro da suíte E2E) | **sem violações** |
| Widget (app) | `flutter test` | **36/36** (+1 ignorado: o teste HTTP, que roda à parte) |
| Integração HTTP (app) | `node tool/run_live_api_test.mjs`: cadastro, foto, publicação, busca, reivindicação, devolução e sessão restaurada contra API real descartável | **1/1** |
| Integração no aparelho (app) | `node tool/run_live_api_test.mjs --device emulator-5554`: sessão persistida, busca, reivindicação privada, devolução, rascunho e publicação com validação, no emulador com teclado real | **1/1** |
| Fumaça | saúde da API, esquema atual, index da web, integrações desligadas, busca e proxy web → API (S1–S6) | **6/6** |
| Funcional (API) | as jornadas do produto pela API (F1–F21) | **21/21** |
| Validação e valor-limite | tamanhos mínimos e máximos, datas impossíveis/futuras, telefone em campo público, paginação, JSON malformado, corpo de 1 MB, coordenada incompleta (V1–V11) | **11/11** |
| Segurança (API) | cabeçalhos, JWT adulterado/`alg=none`/vencido, IDOR, rotas administrativas, atribuição em massa, injeção SQL/FTS, CSRF, CORS, cookie, upload malicioso e poliglota, travessia de diretório, força bruta, NAT, enumeração de contas, refresh rotativo, bloqueio imediato, caixa de teste restrita (X1–X30) | **30/30** |
| Segurança (configuração do proxy) | a CSP recomendada em `docs/operacao.md` aplicada ao app: login, publicar com foto e prévia, mural, grade e mapa sem nenhuma violação (X31) | **1/1** |
| Funcional, segurança, compatibilidade e usabilidade na interface | campanha nos três navegadores (detalhe na seção 3) | ver seção 3 |
| Desempenho, carga e estresse | seção 5 | sem erro até 200 simultâneos |
| Recuperação | backup online com a API rodando, verificação, backup adulterado recusado, restauração, API sobe sobre a cópia restaurada (R1–R6) | **6/6** |
| Configuração | produção com configuração fraca não inicia, mensagem sem segredos, nenhum banco criado, caixa de teste recusada fora de teste (K1–K4) | **4/4** |
| Atualização (migrações) | banco legado sobe até a versão 4 com cópia de segurança automática, sem perder registros e sem reaplicar (M1–M5) | **5/5** |
| Regressão | as correções de comportamento 1, 2, 4 e 5 (seção 4) têm teste que **falha com a correção revertida**; as demais são de texto, layout ou documentação e foram conferidas por captura, traduções e X31 | ok |

## 3. Campanha na interface (três navegadores)

Roteiro automatizado no build de produção, com capturas de tela, cobrindo visitante, cadastro no celular, publicação com
foto, reivindicação com provas privadas, devolução, notificações, administração, XSS, redirecionamento aberto,
teclado, zoom, reflow, tema escuro, idioma do navegador, sessão expirada e falta de conexão.

| Grupo | Chromium | Firefox | WebKit |
|---|---|---|---|
| Funcional: mural e grade do visitante, detalhe sem dados privados, cadastro no celular, link de confirmação, publicar com foto, reivindicar com provas (celular), devolução, notificação lida, painéis da administração (U1–U3, U5–U10, U13) | 10/10 | 10/10 | 10/10 |
| Segurança: XSS no mural, grade, detalhe e balão do mapa; prova privada invisível para terceiros; `next` malicioso no login (U4, U11, U12) | 3/3 | 3/3 | 3/3 |
| Compatibilidade: celular sem rolagem lateral em 7 telas, idioma do navegador, tema escuro do sistema, console sem exceções (C1–C3, C9) | 4/4 | 4/4 | 4/4 |
| Usabilidade e acessibilidade: login só com teclado e foco visível, erro de validação com foco e anúncio, sessão expirada explicada, zoom 200%, reflow em 320 px em 9 telas, sem conexão com "Tentar novamente" (A1–A6); fonte padrão de 32 px (A4b, só Firefox) | 6/6 | 7/7 | 6/6 |
| **Total** | **23/23** | **24/24** | **23/23** |

Resultado final, depois das correções das seções 4 e 6. As primeiras rodadas tiveram falhas; todas foram
investigadas uma a uma: as do produto viraram correções (seção 4) e as do roteiro estão na seção 6.

## 4. Defeitos encontrados e corrigidos

| # | Defeito (como apareceu) | Gravidade | Correção | Teste que protege |
|---|---|---|---|---|
| 1 | **Rajada de logins travava a API.** Com 8 logins simultâneos, a busca pública caía de ~1.240 para ~18 req/s e o p95 subia para ~1,06 s: o `bcryptjs` é JavaScript puro e ocupava a thread do Node. | Alta (disponibilidade) | Hash e verificação num pool de até 4 workers (`backend/src/utils/password.ts`), mesmo formato de hash. Com a mesma rajada: busca ~1.140 req/s, p95 ~15 ms; login de ~4,7 para ~17,5/s. | `user-journeys.test.ts` › "senhas fora da thread principal" (com os workers desligados falha: `expected 2 to be greater than 3`) |
| 2 | **Tela que não carregava deixava o app em branco.** As telas são baixadas sob demanda; se o arquivo não chega (sem conexão ao abrir uma tela nova, ou versão nova publicada com aba antiga aberta), a página inteira sumia — reproduzido no Chromium e no Firefox. | Alta (usabilidade e resiliência; acontece em todo deploy) | `frontend/src/components/PageErrorBoundary.tsx` em volta das telas: "Não foi possível abrir esta tela", orientação e "Recarregar a página"; o menu continua funcionando. Sem recarga automática (evita laço sem conexão). Textos em en/es. | `journeys.spec.ts` › "Tela que não carrega" (2 testes; sem a correção falham com `element(s) not found`) |
| 3 | **Texto ampliado gerava rolagem lateral.** Com a fonte padrão do navegador em 32 px (texto 200%), os pontos de quebra em `px` não reagiam e a página rolava para o lado. | Média (WCAG 1.4.4) | Pontos de quebra em `em` (`frontend/src/styles.css`), mesmo resultado no tamanho padrão. | campanha A4b (Firefox): 0 px nas 6 telas |
| 4 | **E-mail ou nome longo quebrava o layout em 320 px** (perfil rolava 311 px para o lado). | Média (WCAG 1.4.10) | `overflow-wrap: anywhere` em fatos do perfil, tabelas, selo do usuário e cabeçalho dos posts. | `journeys.spec.ts` › "Reflow em 320 px" (sem a regra: 311 px) |
| 5 | **Formulário do app mantinha mensagens de erro já corrigidas** até o próximo envio (achado no emulador: "Selecione a categoria." com a categoria escolhida). | Média (usabilidade) | Depois do primeiro envio com erro, os campos revalidam ao mudar (`item_form_screen.dart`). | `test/item_form_validation_test.dart` (sem a correção falha: mensagem ainda na tela) e o teste no emulador agora confere que os erros somem |
| 6 | **Cabeçalho do post no mural** juntava apelido e data ("@nomehoje"). | Baixa (clareza) | Apelido e data em linhas separadas (`styles.css`). | captura de tela da campanha |
| 7 | **Painel do dono no detalhe se chamava "Reivindicar item"**, embora a ação ali seja registrar a devolução. | Baixa (clareza) | Título "Registrar devolução" para quem pode devolver (`ItemDetailPage.tsx`, en/es). | i18n 742/742 + campanha U9 |
| 8 | **Cabeçalhos de segurança da web dependem do proxy e o guia não os listava** (o servidor estático não envia CSP, HSTS etc.; X9). | Média (implantação) | `docs/operacao.md`: bloco nginx com `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, HSTS, `Permissions-Policy` e CSP; a CSP foi validada com o app (X31). | X31 |

Também conferido e **sem defeito**: provas de reivindicação, e-mails privados, tokens e senhas não aparecem para
visitantes, terceiros, URLs persistentes nem respostas de erro (X2, X3, X6, X7, X25, U6, U11); o token do link de
confirmação sai da barra de endereço (U6); fotos são servidas sem EXIF e recodificadas (X1, X21).

## 5. Desempenho (indicativo: uma máquina, API e cliente no mesmo computador)

| Cenário | Simultâneos | Vazão | p50 | p95 | p99 | Sucesso |
|---|---|---|---|---|---|---|
| Busca pública, linha de base | 1 | — | 1,2 ms | 2,2 ms | 6,6 ms | 100% |
| Busca pública (20 por página) | 10 | 1.243 req/s | 7,4 ms | 12,4 ms | 18,9 ms | 100% |
| Busca pública | 50 | 1.243 req/s | 36,7 ms | 53,7 ms | 61,4 ms | 100% |
| Busca pública | 100 | 1.225 req/s | 78,1 ms | 98,9 ms | 113,6 ms | 100% |
| Busca por texto (FTS) | 20 | 1.348 req/s | 13,8 ms | 19,6 ms | 31,4 ms | 100% |
| Busca com filtros combinados | 20 | 1.704 req/s | 11,2 ms | 15,9 ms | 19,2 ms | 100% |
| Detalhe do caso | 20 | 3.395 req/s | 5,5 ms | 7,6 ms | 15,9 ms | 100% |
| Mapa (todos os casos marcados) | 20 | 2.435 req/s | 6,7 ms | 23,0 ms | 27,1 ms | 100% |
| Estresse: busca pública | 200 | 1.289 req/s | 153 ms | 173 ms | 184 ms | 100% |
| Estresse: busca pública | 400 | 1.297 req/s | 303 ms | 333 ms | 703 ms | 99,8% (21 requisições sem resposta: erro de conexão no cliente, nenhum 5xx) |
| Login (bcrypt custo 12), antes da correção 1 | 8 | 4,7/s | 1,68 s | 1,81 s | — | 100% |
| Login, depois da correção 1 | 8 | 17,5/s | — | — | — | 100% |
| Escrita de pistas (10 contas) | 10 | 300 aceitas, demais 429 | — | 5,1 ms | — | limite por conta funcionando como projetado |

Memória da API: ~359 MB no pico da carga e ~149 MB depois de ociosa (sem sinal de vazamento). A vazão para em ~1.250
req/s porque SQLite e Node rodam numa thread; isso cabe com folga num campus, mas não substitui medir no servidor real.

## 6. Falhas do próprio roteiro de teste (não eram defeitos do ARGOS)

Registradas para transparência; cada uma foi investigada antes de ser descartada.

| Sintoma | Causa real | Ajuste no roteiro |
|---|---|---|
| X15 marcou falha | categoria com mais de 80 caracteres recebe 422, que é a resposta correta | expectativa corrigida (aceita 422/200, nunca 500 nem efeito no banco) |
| Firefox: A4/A4b sem achar "E-mail" | contextos de zoom criados sem idioma; o Firefox abria em inglês ("Email") | idioma pt-BR nesses contextos |
| WebKit: U7 "não é um select" e falhas em cascata (U8–U11) | logo após o login a URL muda antes de a tela seguinte terminar de carregar (transição do React); o rótulo "Tipo" casava com "Tipo de acesso" do login ainda visível | o login do roteiro espera o formulário de login sair da tela |
| WebKit: A1 e A2 | Tabs enviados antes de a tela de login montar | espera o campo de e-mail; o A1 agora também falha se o foco não chegar ao e-mail ou se faltar contorno de foco (antes só anotava) |
| Firefox: C9 "error loading dynamically imported module" | o roteiro navegava enquanto o painel ainda carregava; o erro é do documento sendo descartado e a pessoa não o vê (sondagem: esperando o carregamento, zero erros) | o A1 espera o painel carregar antes de seguir |
| WebKit: C9 "… due to access control checks" | o WebKit registra como erro de página a requisição à própria API cancelada quando o roteiro troca de página; com a navegação esperando a rede, zero ocorrências | só esse aviso, para `localhost/api` da mesma origem, é separado e contado no resultado; qualquer outro erro continua reprovando |
| Chromium: A3 reprovou uma vez, sem texto | o aviso era lido no mesmo instante do clique, antes de aparecer (nas demais rodadas e navegadores passou) | espera o aviso por até 10 s e, se não vier, reprova mostrando o que estava na tela |
| C9 nas primeiras rodadas | o build da web foi refeito com a campanha rodando (arquivos trocados no meio) | campanhas refeitas só depois do build final |
| App no emulador: toque "fora do botão" e botão não encontrado | toque logo após rolar (sem quadro novo) e teclado real do aparelho cobrindo o fim do formulário | `reveal()` rola e espera o quadro; o teste fecha o teclado antes de tocar em "Revisar e publicar" |
| Flutter: "Unable to determine engine version" | disputa de escrita do `engine.realm` no Windows (inclusive na chamada do Gradle) | repetir a execução |

## 7. Não testado ou dependente do ambiente real

- Domínio real com HTTPS, cookie `Secure`, proxy nginx com os cabeçalhos documentados e `TRUST_PROXY` do proxy real
  (aqui só a CSP foi validada no navegador).
- Entrega real de e-mail (SPF/DKIM), login Google, Turnstile e tradução DeepL: integrações desligadas por regra.
- iPhone/iOS, aparelhos Android físicos e de entrada, redes lentas (só "sem conexão" foi simulado).
- Leitores de tela operados por pessoas (NVDA, TalkBack, VoiceOver): foram verificados axe, teclado, foco e rótulos.
- Carga no servidor de produção e mais de uma instância (SQLite pressupõe instância única).
- Teste com usuários reais e teste de intrusão por terceiros.

Observação de interface sem correção: no app, o botão flutuante "Publicar" pode cobrir parte do botão do cartão no
mural, conforme a rolagem (visto no emulador; a pessoa rola e o botão fica livre). Mudar a navegação do app é decisão
de produto, por isso não foi alterado.

## 8. Como repetir

```bash
cd backend && npm run typecheck && npx vitest run
cd frontend && npm run build && npm run i18n:check && npx playwright test
cd apps/flutter && flutter analyze && flutter test
cd apps/flutter && node tool/run_live_api_test.mjs                          # app × API real descartável
cd apps/flutter && node tool/run_live_api_test.mjs --device emulator-5554   # no emulador
```

As suítes acima usam banco e uploads descartáveis. Atenção: `npx playwright test` refaz `frontend/dist`; não rode junto
com outra verificação que esteja servindo esse diretório. Os roteiros da campanha (API, interface nos três
navegadores, desempenho, recuperação, configuração e migração) foram executados a partir de uma pasta temporária da
sessão e **não estão no repositório**; podem ser versionados se a equipe quiser repeti-los.
