# ARGOS — Análise de melhorias e prompt de execução

Data: 2026-09-28

## Prompt

> Você é o engenheiro responsável pelo ARGOS (backend Express/TypeScript + SQLite, web React/Vite, app Flutter).
> Antes de mudar qualquer coisa, rode a linha de base (`npm run typecheck --prefix backend`, `npm test --prefix backend`,
> `npm run build --prefix frontend`) e só aceite o trabalho se ela continuar verde no final.
>
> Procure, nesta ordem de prioridade:
> 1. **Bugs de correção**: validações que aceitam dados impossíveis, fluxos que perdem o contexto do usuário,
>    datas exibidas cruas ou no fuso errado, respostas antigas sobrescrevendo novas.
> 2. **Segurança e robustez**: algoritmo de JWT não fixado, cabeçalhos de entrada sem limite, desligamento
>    abrupto do processo, tabelas que crescem sem limpeza.
> 3. **Desempenho**: consultas frequentes sem índice, bundle único sem divisão por rota, imagens grandes.
> 4. **UX**: notificações sem “marcar como lida” individual, falta de página 404, textos sem acentuação.
> 5. **Manutenção**: helpers duplicados entre páginas/módulos, artefatos de build e de ferramentas versionados,
>    dependências de build em `dependencies`.
>
> Regras: mudanças pequenas e verificáveis, no estilo do código vizinho (pt-BR nas mensagens, comentários curtos);
> cada correção de backend relevante ganha teste de integração; não altere contratos públicos da API de forma
> incompatível (o app Flutter consome a mesma API); não mexa no app Flutter sem necessidade.

## Diagnóstico e ações

| # | Área | Problema encontrado | Ação |
|---|------|---------------------|------|
| 1 | Backend | `dateSchema` aceitava `2026-02-31` (o `Date` do JS "rola" para março). | Validação por ida e volta da data; teste. |
| 2 | Backend | `jwt.verify` sem `algorithms` fixado. | Assina e verifica somente com `HS256`. |
| 3 | Backend | `x-request-id` do cliente era refletido sem limite de tamanho/charset (injeção em logs). | Aceita só `[\w.:-]{1,128}`; senão gera UUID; teste. |
| 4 | Backend | Sem desligamento gracioso: SIGTERM encerrava com requisições em curso e WAL aberto. | `server.close()` + `db.close()` em SIGTERM/SIGINT. |
| 5 | Backend | Faltavam índices para `favorites.item_id`, `item_history.item_id`, `claims.claimant_id`, `uploads(user_id, url)`. | Índices criados na migração. |
| 6 | Backend | `refresh_tokens` expirados/revogados nunca eram apagados. | Limpeza periódica junto da limpeza de uploads. |
| 7 | Backend | Não havia como marcar **uma** notificação como lida; ordenação sem desempate. | `PATCH /notifications/:id/read`; `ORDER BY created_at DESC, id DESC`; teste. |
| 8 | Backend | `morgan` poluía a saída dos testes. | Desativado com `NODE_ENV=test`. |
| 9 | Backend | Nome no cadastro não era aparado (`"   "` passava). | `trim()` no schema. |
| 10 | Backend | `publicNickname` duplicado em `auth` e `items`. | Função única reutilizada. |
| 11 | Web | `ProtectedRoute` mandava para `/login` sem `next`, perdendo o destino. | Redireciona com `?next=`. |
| 12 | Web | Datas de notificações, auditoria e histórico exibidas cruas (`2026-09-28 16:14:00`, em UTC). | `utils/dates.ts` compartilhado; helpers duplicados removidos das páginas. |
| 13 | Web | Histórico do item mostrava códigos (`item.created`). | Rótulos legíveis. |
| 14 | Web | Clicar numa notificação não a marcava como lida; sem contador no menu. | Marca ao abrir; badge de não lidas no menu. |
| 15 | Web | Bundle único de ~322 kB; logo PNG de 598 kB (875×792) exibida a 56 px. | `React.lazy` por rota; logo reduzida; favicon. |
| 16 | Web | Sem rota 404. | Página "não encontrada". |
| 17 | Web | Busca pública podia exibir resposta antiga ao filtrar rápido. | Descarta respostas fora de ordem. |
| 18 | Web | Textos sem acento em mensagens (`comunicacao`, `Notificacoes`). | Corrigidos. |
| 19 | Repo | `frontend/tsconfig.tsbuildinfo` e `.codex-run/` (logs e prints) versionados; `@vitejs/plugin-react` em `dependencies`. | Removidos do índice + `.gitignore`; plugin movido para `devDependencies`. |

## Rodada 2 — funcionalidades para uso completo

| # | Lacuna encontrada | Entrega |
|---|-------------------|---------|
| 20 | Dono não podia recusar reivindicação; quem enviou não podia cancelar; o caso ficava "em análise" para sempre. | `PATCH /items/:id/claims/:claimId/reject`, `DELETE /items/:id/claim` (status `withdrawn`), caso reaberto automaticamente. |
| 21 | Detalhe do caso ignorava `myClaim` (mostrava o formulário de novo e o envio dava 409). | Estado "enviada/em análise" com botão de cancelar. |
| 22 | Sem seguir/denunciar na página do caso; pista não podia ser removida. | Botões no detalhe; `DELETE /items/:id/comments/:commentId`. |
| 23 | Denúncia avisava só o autor do caso. | Moderadores notificados; seção "Denúncias recentes" no admin. |
| 24 | Web não usava `/items/following` nem `/items/my-claims`. | Abas "Acompanhando" e "Minhas reivindicações" em Meus itens. |
| 25 | Sem troca de senha, recuperação de senha, exportação ou exclusão de conta. | Endpoints e telas (Configurações, "Esqueci minha senha", `/reset-password`). |
| 26 | Preferências "E-mail" e "Resumo diário" não tinham efeito. | E-mail imediato para eventos importantes; resumo diário no ciclo de manutenção. |
| 27 | Busca pública parava em 48 resultados. | "Carregar mais" com total real. |
| 28 | Limites de requisição autenticados eram por IP (campus com NAT dividiria a cota). | Limite por conta quando há login. |

## Fora do escopo desta rodada

Itens do `MASTER_REFACTORING_PLAN.md` que exigem decisão de produto ou infraestrutura: Postgres/armazenamento
de objetos, multi-tenant, chat moderado, MFA/verificação de e-mail obrigatória, CI/CD e observabilidade.
Também ficam para depois: testes automatizados do frontend web e a divisão de `items.routes.ts` em serviços.
