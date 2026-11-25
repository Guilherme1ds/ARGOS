# ARGOS — Auditoria completa, testes e correções (25/11/2026)

Branch `gusargos`, depois de sincronizar os 10 commits do Guilherme (23 e 25/11: organizações e espaços, custódia, chat, moderação automática, observabilidade, retenção e migrações). As alterações desta auditoria **não foram commitadas**.

## 1. Resumo geral

O ARGOS está funcional e estável nas três frentes: API (Express + SQLite), web (React + Vite) e app (Flutter). Todas as suítes automatizadas passam. A varredura de telas não encontrou quebra de layout nem erro de servidor, e as sondas de segurança não encontraram acesso indevido, injeção ou vazamento de dados.

A auditoria encontrou **6 problemas corrigíveis no código, todos corrigidos e verificados**:
- 4 de severidade média: falso positivo na moderação que podia silenciar a conta, menu do celular empurrando o conteúdo, pino do mapa fora da tela e mapa sem a posição real.
- 2 de severidade baixa: limite de sessão anônima em rede compartilhada e botão de menu sobre a marca em 320 px.

Ficaram pendências que dependem de decisão, credencial ou serviço externo (seção 6). O principal bloqueio para produção continua o mesmo do relatório 07: revogar a chave DeepL que ficou no histórico do Git e homologar no domínio real com HTTPS.

## 2. Estrutura e tecnologias (levantamento)

| Parte | Tecnologias | Observações |
|---|---|---|
| API (`backend/`) | Node 24, Express, TypeScript, better-sqlite3 (WAL + FTS5), Zod, JWT HS256 + refresh rotativo em cookie httpOnly, bcrypt em pool de workers, Helmet | 18 grupos de rotas em `/api` e `/api/v1`, 38 tabelas, 55 chaves estrangeiras, 8 migrações versionadas com backup automático antes de migrar |
| Web (`frontend/`) | React, Vite 8, TypeScript, React Router, Leaflet/OpenStreetMap, i18n próprio (pt-BR, en-US, es-ES) | 24 rotas; páginas carregadas sob demanda |
| App (`apps/flutter/`) | Flutter, Riverpod, Dio, GoRouter, flutter_secure_storage, image_picker | Sessão, mural, busca com facetas, publicação, reivindicação, notificações e chat. **Não tem mapa nem geolocalização** |
| Operação | GitHub Actions (backend, web, Flutter, imagem Docker), Dockerfile, OpenAPI (`docs/openapi/argos.v1.yaml`) com teste de contrato | Integrações opcionais: SMTP, Google, Turnstile, DeepL/LibreTranslate, Anthropic (sugestão por foto), Web Push |

Não encontrei código abandonado relevante nem duplicação que justifique refatoração. As regras de permissão ficam centralizadas em `shared/policies/` e os testes cobrem cada sprint.

## 3. Problemas encontrados, por gravidade

### Crítico
| # | Problema | Situação |
|---|---|---|
| C1 | A chave DeepL versionada em `backend/.env.example` (commit `5ea4299`) continua no histórico do Git. | **Pendente (externo).** É preciso revogá-la no painel da DeepL, se ainda não foi feito. O arquivo atual só tem valores de exemplo, e um teste impede que um segredo volte a ser versionado. |

### Alto
Nenhum problema de severidade alta encontrado no código.

### Médio
| # | Problema | Situação |
|---|---|---|
| M1 | **Moderação punia digitação apressada.** "Beleza.me avisa quando chegar", "Ok.me chama amanhã" e "Sim.com certeza é o meu" eram bloqueadas como link **e contavam como infração**. Com 5 em 24 h (`CHAT_MUTE_STRIKES`), a conta ficava 24 h sem conversar nem publicar pistas. | **Corrigido** |
| M2 | **Menu no celular e no tablet (≤ 980 px):** em toda página interna, o menu completo (9 a 15 links, cerca de 580 px) ficava acima do conteúdo, e o título da página só aparecia depois de rolar. | **Corrigido** |
| M3 | **Mapa do formulário:** "Usar minha localização" marcava o ponto, mas o mapa não ia até ele, e o pino ficava fora da tela (no centro padrão, em São Paulo). O mesmo acontecia ao editar um caso ou restaurar um rascunho. | **Corrigido** |
| M4 | **Mapa sem a posição real:** a página Mapa sempre abria no centro padrão, sem mostrar onde a pessoa está. | **Corrigido** |
| M5 | O app Flutter não tem mapa nem localização. O recurso existe só na web. | **Pendente (decisão de produto)** |

### Baixo
| # | Problema | Situação |
|---|---|---|
| B1 | A web consulta a sessão (`POST /auth/refresh`) a cada página aberta. Visitantes **anônimos** eram contados por IP: atrás do mesmo NAT (campus), mais de 30 páginas por minuto davam 429, e cada página gravava uma linha no banco. | **Corrigido** |
| B2 | Em 320 px, o novo botão de menu encostava no subtítulo da marca. Achado durante a correção de M2. | **Corrigido** |
| B3 | Visitante anônimo: o console do navegador mostra "401" da consulta de sessão em toda página. Não afeta o uso. | **Não corrigido.** Eliminar o aviso exige mudar o contrato da API (web, app e OpenAPI). Não compensa o risco. |
| B4 | 22 chaves estrangeiras sem índice, como `item_matches.matched_item_id` (consultado no detalhe do caso) e `comments.user_id` / `audit_logs.actor_id` (exclusão de conta e retenção). | **Pendente.** É irrelevante no volume atual. Recomendo uma migração 9 com os índices, combinada com o Guilherme, porque a numeração das migrações é compartilhada. |
| B5 | Cada renovação de sessão grava uma linha em `audit_logs`, e com o padrão `AUDIT_LOG_RETENTION_DAYS=0` nada é apagado. A auditoria cresce continuamente. | **Pendente (decisão de retenção)** |
| B6 | No chat, uma mensagem removida pela moderação continua visível na conversa já aberta até recarregar, porque a consulta periódica só busca mensagens novas. | **Pendente (baixo impacto)** |

### Ambiente (não é defeito do ARGOS)
- **Os serviços de localização do Windows estão desligados neste PC** (valor `Deny` no nível da máquina). Por isso o navegador não consegue a posição real. Para ligar: Configurações → Privacidade e segurança → Localização. Pode exigir administrador.
- **Emulador Android 17 (preview):** com a tela apagada, os testes de integração e o `flutter run` instalam o app mas não conseguem se conectar a ele. No log, um serviço UWB/NFC da imagem reinicia a cada 5 s, o que é ruído da imagem. Acordar a tela resolve: com ela acordada, o teste no aparelho passou.
- O Docker não está instalado nesta máquina, então o teste da imagem de produção roda só no CI.

## 4. Problemas corrigidos (arquivos e o que mudou)

| Problema | Arquivos | Correção |
|---|---|---|
| M1 | `backend/src/shared/policies/moderation.ts` | Os links continuam sempre bloqueados, mas agora há dois casos. **Link claro** (http/www, caminho como `wa.me/…`, `.com.br`, nome com dígito ou hífen, endereço no fim da frase) continua contando infração. **Palavra + `.com`/`.me` seguida de mais texto** também não é enviada, mas **não conta infração**, e a resposta explica: "coloque um espaço depois do ponto". |
| M1 | `backend/test/sprint-features.test.ts` | Regressão: frases ambíguas não silenciam a conta, links claros continuam contando, e "Beleza. Me avisa…" é enviada. |
| M1 | `frontend/src/i18n/server-messages.ts`, `en.ts`, `es.ts` | Tradução da nova mensagem. |
| M2, B2 | `frontend/src/components/Layout.tsx`, `frontend/src/styles.css` | Botão "Menu" no topo, só até 980 px: recolhido por padrão, fecha ao navegar e com Esc (o foco volta ao botão), mostra o total de notificações e mensagens não lidas, e tem `aria-expanded`/`aria-controls`. Até 360 px fica só o ícone, e a palavra continua no nome acessível. O desktop e a barra inferior do mural não mudaram. |
| M3, M4 | `frontend/src/components/MapView.tsx`, `frontend/src/pages/MapPage.tsx`, `frontend/src/pages/ItemFormPage.tsx`, `frontend/src/utils/useCurrentPosition.ts` (novo) | Ponto azul com raio de precisão e botão "Minha localização". O mapa abre na posição real (página Mapa e caso novo) e vai até o ponto marcado quando ele está fora da tela. Também há aviso quando o navegador nega a permissão. |
| B1 | `backend/src/modules/auth/auth.routes.ts` | Consulta de sessão **sem cookie** responde 401 na hora, antes do limite e sem tocar no banco. Quem tem sessão continua limitado por sessão, como antes. |
| B1 | `backend/test/integration.test.ts` | Novo teste: 35 consultas anônimas no mesmo IP recebem 401 e nenhum 429, e uma sessão real no mesmo IP continua renovando. **Antes da correção, o teste falhava com 429.** |
| Pedido do usuário | `frontend/src/pages/LoginPage.tsx`, `apps/flutter/lib/features/auth/presentation/login_screen.dart`, `styles.css` | Botões "Usuário" e "Administrador" com as contas de teste no login. Só aparecem no `npm run dev` e no app em modo debug. Confirmei que o build de produção não contém as senhas. |

## 5. Testes realizados

| # | Teste | Resultado |
|---|---|---|
| 1 | Typecheck do backend (`tsc --noEmit`) | ✅ Aprovado (antes e depois) |
| 2 | Suíte do backend (Vitest, banco descartável) | ✅ 153/153 antes; **154/154 depois** (1 teste novo e asserções novas na moderação) |
| 3 | Build do backend (`tsc`) | ✅ Aprovado |
| 4 | Typecheck da web (`tsc -b`) e i18n | ✅ Aprovado; 1171/1171 textos traduzidos em en-US e es-ES |
| 5 | Build de produção da web | ✅ Aprovado; 0 credenciais de teste no pacote |
| 6 | E2E da web (Playwright: desktop + celular 360 px, acessibilidade nos temas claro e escuro, API descartável) | ✅ 28/28 antes e **28/28 depois** das correções |
| 7 | `flutter analyze` | ✅ Nenhum problema |
| 8 | Testes de widget do Flutter | ✅ 42 aprovados, 1 ignorado por padrão (o teste ao vivo roda no item 9) |
| 9 | Flutter × API real (HTTP: cadastro, foto, publicação, busca, reivindicação, devolução, sessão) | ✅ Aprovado |
| 10 | Teste de integração do app no emulador Android (UI real) | ✅ Aprovado. As 4 primeiras tentativas falharam por ambiente: trava do `engine.realm` e tela do emulador apagada. |
| 11 | `npm audit` (produção e todas as dependências) no backend e na web | ✅ 0 vulnerabilidades |
| 12 | Varredura de segredos nos arquivos versionados | ✅ Nenhum segredo; `.env.example` só com marcadores (garantido por teste) |
| 13 | Sonda da API: autorização por papel, recursos de terceiros, injeção na busca (SQL/FTS), validação, upload malicioso, sessão | ✅ 94/94 como esperado. As 5 verificações de conversa ficaram de fora por falta de conversa na carga inicial; o item 14 as cobre. |
| 14 | Cenário funcional entre papéis: busca com sinônimos, chat, não lidas e notificações, moderação, reivindicação, custódia completa | ✅ **42/42** |
| 15 | Varredura de todas as telas (7 papéis × até 3 tamanhos: 1366, 820 e 390 px) | ✅ 353 páginas sem rolagem lateral, elemento vazando, tela vazia ou erro 5xx. Achados: B1 e B3; um erro isolado vinha do recarregamento a quente durante a edição e não se repetiu (149 páginas reavaliadas). |
| 16 | Banco (somente leitura) no banco de desenvolvimento e no da auditoria | ✅ `integrity_check` ok, 0 violações de chave estrangeira, 0 e-mails duplicados, 0 itens sem dono, índice de busca sincronizado, migrações 1–8 aplicadas |
| 17 | Menu recolhível em 320, 390 e 820 px e no desktop | ✅ Sem sobreposição nem rolagem lateral; Esc e navegação fecham; desktop inalterado |
| 18 | Mapa com localização simulada (página Mapa, formulário, "Usar minha localização") | ✅ Centraliza na posição; o pino fica visível |
| — | Imagem Docker de produção | ⏭️ Não realizado: Docker não instalado (o CI cobre) |
| — | Integrações reais (SMTP, Google, Turnstile, DeepL, Anthropic, Web Push) | ⏭️ Não realizado com credenciais reais. Cobertas por testes automatizados com serviços simulados (aprovados). |
| — | iOS, aparelho Android físico, domínio HTTPS real, teste de carga | ⏭️ Não realizado (sem recurso nesta máquina) |

## 6. Funcionalidades verificadas

| Funcionalidade | Estado | Como foi verificada |
|---|---|---|
| Cadastro com confirmação de e-mail, login, logout, sessão persistente, recuperação de senha | ✅ | E2E, backend, Flutter |
| Renovação de sessão com rotação e detecção de reuso | ✅ | Backend; observada na prática (cookie reaproveitado foi recusado) |
| Publicação de item (com e sem foto, validações, data futura, coordenadas, imagem externa recusada) | ✅ | E2E, sonda da API |
| Consulta pública: texto, sinônimos ("celular" acha "smartphone"), filtros, facetas, paginação | ✅ | Cenário funcional, backend, Flutter |
| Mapa de casos e mapa do formulário com localização real | ✅ | Teste com localização simulada |
| Detalhe do caso, pistas, acompanhar, compartilhar | ✅ | E2E |
| Denúncia, fila da moderação, ocultação automática por várias denúncias | ✅ | E2E, backend |
| Reivindicação privada, recusa, desistência, devolução, desfazer devolução | ✅ | E2E, backend, cenário funcional, app no emulador |
| Notificações e contadores | ✅ | Cenário funcional |
| Chat: abrir e reaproveitar conversa, enviar, não lidas, encerrar e reabrir, denunciar, regras automáticas, fila da moderação | ✅ | Cenário funcional (42/42), backend, widget Flutter |
| Custódia: receber, guardar, transferir, entregar, destinação, reabrir com motivo, cadeia de hash, painel do gestor, escopo por espaço | ✅ | Cenário funcional, backend, E2E institucional |
| Organizações, espaços e convites de gestor (uso único, expiração, e-mail exato) | ✅ | E2E institucional, backend |
| Administração: usuários, papéis, solicitações de acesso, restrição de publicação, CSV com fórmulas neutralizadas | ✅ | E2E, backend |
| Observabilidade (painel do administrador, `/metrics` com token, alertas) | ✅ | Backend; tela na varredura |
| Privacidade: resumo, exportação e exclusão de conta; retenção automática | ✅ | E2E, backend |
| Perfil e configurações (tema, densidade, contraste, idioma) | ✅ | E2E, varredura de telas |
| Idiomas pt-BR, en-US e es-ES | ✅ | Checagem de i18n |
| Contas de teste no login (somente desenvolvimento) | ✅ | Teste na tela; build de produção sem as senhas |
| Mapa no app Flutter | ❌ Não existe | — |

## 7. Pendências

1. **Revogar a chave DeepL antiga** no painel da DeepL (C1). É uma ação externa; não consigo verificar se já foi feita.
2. **Decidir sobre mapa e localização no app Flutter** (M5). É uma funcionalidade nova: pacotes de mapa e GPS, permissões do Android e iOS, telas.
3. **Índices das 22 chaves estrangeiras** (B4): migração 9, combinada com o Guilherme.
4. **Retenção da auditoria** (B5): definir `AUDIT_LOG_RETENTION_DAYS`, ou deixar de auditar cada renovação de sessão.
5. Ainda dependem de recurso externo: homologação no domínio HTTPS real (`docs/operacao.md` §7–8), envio real de e-mail com SPF/DKIM, teste em aparelho Android físico e iOS, teste da imagem Docker e teste de carga.
6. Ruído "401" no console para visitante anônimo (B3) e mensagem removida visível até recarregar (B6): baixo impacto, registrados para uma próxima rodada.

## 8. Segurança

| Verificação | Resultado |
|---|---|
| Autenticação e sessão | JWT HS256 de vida curta; refresh em cookie httpOnly com rotação, detecção de reuso (revoga a família) e checagem de origem. Token forjado, refresh sem cookie e refresh de outra origem são recusados. |
| Autorização | 94/94 verificações. Anônimo recebe 401 nas rotas privadas. Cidadão não alcança administração, auditoria, moderação, custódia nem observabilidade. Suporte não muda papéis. Gestor de espaço não altera a organização nem consulta espaço alheio. |
| Acesso a dados de terceiros | Editar, apagar ou devolver item alheio, ver reivindicações alheias, ler ou enviar em conversa alheia (responde 404 para não revelar que existe) e ver custódia alheia: tudo recusado. |
| Injeção | Busca com `' OR 1=1 --`, `DROP TABLE`, sintaxe FTS (`"`, `*`, `NEAR(`), `%`, `_`, byte nulo e texto de 500 caracteres: nenhum erro 500 e nenhum vazamento. As consultas usam parâmetros. |
| XSS | React escapa o conteúdo; o balão do mapa escapa cada campo; não há `dangerouslySetInnerHTML`. Upload de SVG e HTML disfarçado de PNG é recusado; `/uploads` responde com `nosniff` e CSP `sandbox`. |
| Uploads | Arquivo inexistente responde 404 e `..%2f` não escapa da pasta; imagens são recodificadas (remove metadados) e há limite de corpo (12 MB recusado). |
| Segredos | Nenhum segredo nos arquivos versionados; `.env`, bancos e backups estão no `.gitignore`. Pendente: a chave DeepL no histórico (C1). |
| CORS | Em produção, só as origens configuradas; em desenvolvimento, qualquer origem (intencional, só nesse modo). |
| Dependências | `npm audit`: 0 vulnerabilidades no backend e na web. |
| Convites e métricas | Convite com token aleatório de 256 bits, guardado só como hash, enviado no fragmento da URL (fora dos logs), de uso único e com validade. `/metrics` exige token comparado em tempo constante. |
| Logs | O log estruturado grava o caminho sem a query string (sem texto digitado nem tokens). |

Depois das correções: nenhuma vulnerabilidade conhecida no código. Continuam pendentes a revogação da chave DeepL antiga e a homologação no domínio real.

## 9. Avaliação final

A aplicação está **funcional e bem protegida para uso local e em homologação**. Isto foi demonstrado nesta auditoria por 154 testes de backend, 28 E2E web, 42 testes de widget e 2 testes ao vivo do app, 94 sondas de segurança, 42 verificações funcionais entre papéis e 353 telas varridas em três tamanhos. Nenhum desses números foi estimado: todos vêm de execução nesta máquina.

As correções feitas atacam problemas que o usuário sentiria de verdade: ser silenciado por digitar rápido, ter que rolar o menu em toda página no celular, o pino do mapa sumir e o mapa não mostrar onde a pessoa está.

**Ainda não declaro que está pronta para produção.** Faltam a revogação da chave DeepL antiga e a homologação no domínio HTTPS real, com e-mail real e aparelho físico. Essas etapas dependem de acesso externo e não puderam ser testadas aqui.
