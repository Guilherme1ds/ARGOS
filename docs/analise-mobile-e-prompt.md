# ARGOS mobile: análise e prompt de implementação

Data: 09/09/2026.

## Escopo e resultado

Análise do aplicativo Flutter em `apps/flutter`, com conferência das rotas relevantes do backend Express em `backend/src/modules`. O frontend React é referência para a futura implementação; esta análise não é uma auditoria da responsividade do site.

O mobile possui uma base organizada com Riverpod, Dio, GoRouter, tema próprio, feed paginado, autenticação, comentários e publicação com foto. Entretanto, ainda não oferece uma jornada completa de achados e perdidos. A prioridade é concluir busca → detalhes → reivindicação → acompanhamento → devolução, além de corrigir a recuperação de erros.

Validação executada: `flutter analyze` sem problemas; `flutter test` aprovado, com apenas um teste de tokens de cor. Não foram executados testes em emulador/aparelho, build release ou integração com API ativa. As observações de layout e concorrência abaixo são riscos identificados no código, não falhas reproduzidas visualmente. Não é possível garantir ausência absoluta de erros.

## Achados priorizados

| Prioridade | Evidência no projeto | Efeito para o usuário e ação necessária |
| --- | --- | --- |
| P0 | `lib/app/router.dart`: busca, detalhes, Meus itens, notificações, configurações, painel, administração e privacidade usam `PlaceholderScreen`. | Jornadas interrompidas. Implementar as telas essenciais; remover da navegação funcionalidades secundárias que ainda não sejam entregues. |
| P0 | `case_detail_dialog.dart`: “Reivindicar item” e “Tenho informação” encaminham para os detalhes provisórios. “Pistas” tem `onTap: () {}`. | Ações aparentam existir, mas não resolvem a necessidade. Conectar a fluxos reais, com retorno e confirmação. |
| P0 | `api_client.dart`: access token e cookie de refresh ficam apenas em memória. `AuthController.checkSession` tenta refresh no início. | Ao encerrar o processo, a credencial de renovação não é restaurada. Implementar persistência segura da sessão nativa e recuperação no início. |
| P0 | O interceptor limpa apenas o token após 401; não comunica a expiração ao `AuthController`. O retry com `dio.fetch` não tem tratamento local de falha. | Risco de a interface continuar autenticada e de a repetição falhar sem concluir corretamente o interceptor. Unificar invalidação de sessão e tratar todas as saídas do retry. |
| P0 | `item_form_screen.dart` e `login_screen.dart`: existem `setState` depois de `await` sem verificar `mounted`. `comment_composer.dart` limpa o controller após uma operação assíncrona. | Sair da tela durante uma requisição ou seleção de imagem pode acessar estado já descartado. Revisar ciclo de vida, cancelamentos e callbacks. |
| P0 | `api_client.dart` usa URLs padrão com `localhost`; o manifest Android principal não declara INTERNET, enquanto o de debug declara. | A configuração padrão não identifica o servidor do computador em um celular. Configurar ambientes e conferir a permissão no manifest final mesclado do release; não presumir que o comportamento de debug prova funcionamento de produção. |
| P1 | `feed_controller.dart`: `loadMore` e rollback de follow/report reutilizam snapshots antigos; refresh reinicializa `followedIds`. | Operações sobrepostas podem apagar mudanças recentes; acompanhamentos não são reidratados do servidor. Corrigir concorrência e sincronização por usuário/item. |
| P1 | `home_feed_screen.dart`: os posts são construídos em uma `Column` dentro de uma `ListView`. | A lista acumula widgets conforme mais páginas chegam. Usar construção sob demanda e medir rolagem com volume representativo. |
| P1 | `CaseDetailDialog` recebe um `Item` fixo; os comentários exibidos vêm de `item.latestComments`. | O comentário recém-enviado pode não aparecer no diálogo aberto, mesmo com atualização do feed. Observar o item por ID e carregar comentários completos/paginados. |
| P1 | No formulário, upload e criação são operações separadas; não há rascunho, progresso ou retenção da URL enviada após falha na criação. | O usuário pode perder preenchimento ou repetir uploads. Preservar rascunho, oferecer progresso e retomada; definir tratamento de upload órfão e envio de resultado incerto. |
| P1 | `apiErrorMessage` orienta verificar backend/API e informa URL técnica. | Mensagem pouco útil ao usuário comum. Diferenciar falta de rede, timeout, sessão expirada, permissão, conflito, validação e indisponibilidade, com ação de recuperação. |
| P1 | O diálogo mantém imagem quadrada fora da área rolável, com ações inferiores fixas. | Risco de falta de espaço em paisagem, teclado aberto e fontes grandes. Tornar detalhes adaptáveis e testar os tamanhos propostos abaixo. |
| P1 | `profile_screen.dart` é somente leitura; logout não captura erro na interface; avatar não tem `errorBuilder`. | Completar edição e oferecer fallback de imagem. A saída local deve terminar com feedback coerente mesmo se a revogação remota falhar. |
| P1 | Apenas `test/widget_test.dart`, verificando cores. | Não há evidência automatizada de funcionamento de autenticação, criação, reivindicação, navegação e recuperação de erros. Criar testes comportamentais desses fluxos. |
| P2 | `android/app/build.gradle.kts` assina release com chave de debug; README Flutter ainda é o padrão inicial. | Preparar assinatura de distribuição e documentação reproduzível; não colocar chaves ou segredos no repositório. |

Os caminhos `lib/...` da tabela são relativos a `apps/flutter`.

## Melhorias de produto

- Busca com texto, filtros, ordenação, limpeza de filtros e preservação da posição ao voltar dos detalhes.
- Detalhes completos com situação atual e ação adequada ao tipo de caso, usuário e permissões.
- Reivindicação privada com provas, confirmação de envio e acompanhamento; orientar claramente que pistas públicas não são o lugar para documentos e dados pessoais.
- Meus itens com publicações, situação da moderação, reivindicações e devoluções permitidas pelo backend.
- Notificações internas com contador e acesso ao caso correspondente. Push é evolução posterior, dependente de infraestrutura própria.
- Formulário com rascunho, revisão antes de publicar, câmera/galeria, tratamento de permissão negada e estados de upload.
- Perfil editável, preferências que realmente persistem, privacidade acessível antes do aceite e recuperação de senha com backend completo, caso seja incluída na entrega.
- Rótulos claros nas abas, botões acessíveis, suporte a fontes grandes, TalkBack/VoiceOver, temas claro/escuro e confirmação ao descartar preenchimento.

Não priorizar mapa, chat, animações elaboradas ou push antes de concluir os fluxos essenciais. São ampliações de produto, não correções automáticas dos problemas encontrados.

Referências técnicas oficiais: [rede e permissão Android](https://docs.flutter.dev/data-and-backend/networking), [assinatura e distribuição Android](https://docs.flutter.dev/deployment/android), [image_picker e recuperação após destruição da Activity](https://pub.dev/packages/image_picker). A documentação do image_picker prevê `retrieveLostData` para recuperação no Android; o formulário atual não implementa esse fluxo.

## Prompt pronto para enviar à IA

Copie o bloco abaixo e forneça à IA acesso ao repositório ARGOS.

```text
Atue como engenheiro Flutter sênior com experiência em backend, UX mobile e testes. Implemente as melhorias no aplicativo ARGOS deste repositório. Não entregue apenas sugestões: altere os arquivos, valide o resultado e documente o que foi e o que não foi testado.

CONTEXTO
O mobile fica em apps/flutter e utiliza Flutter, Riverpod, Dio e GoRouter. O backend Express/TypeScript fica em backend e o frontend React em frontend. Preserve a identidade visual ARGOS, os componentes úteis e as regras de negócio existentes. Leia as instruções locais e docs/analise-mobile-e-prompt.md. Revalide os achados antes de editar, pois o código pode ter mudado.

OBJETIVO
Entregar uma jornada funcional: consultar itens → filtrar → abrir detalhes → autenticar quando necessário → publicar ou reivindicar → acompanhar → concluir devolução quando autorizado. Nenhuma ação essencial pode terminar em placeholder, callback vazio ou sucesso simulado.

MÉTODO E CONTRATOS
1. Inspecione o código, os DTOs, permissões, schemas Zod, estados de item e docs/openapi/argos.v1.yaml. Use as rotas implementadas como evidência e corrija divergências da documentação.
2. Faça um plano curto por prioridade e execute-o. Reutilize a organização por features; evite reescrita total e atualizações indiscriminadas de dependências.
3. Confira prefixos e payloads reais. Já existem rotas de busca, detalhes, comentários, criação, edição, follow/unfollow, denúncia, claims, devolução, perfil, notificações e privacidade. Não invente endpoints sem implementá-los.
4. Quando faltar contrato necessário, faça a menor extensão compatível no backend, com validação, autorização, testes e atualização do OpenAPI. Preserve o funcionamento web. Nunca exponha provas privadas em DTO público.

ETAPA 1 — ESTABILIDADE E SESSÃO
- Centralize os ambientes de desenvolvimento, homologação e produção. Documente configuração em emulador e aparelho físico usando ARGOS_API_URL, ARGOS_API_PUBLIC_URL e ARGOS_WEB_URL. Exija configuração válida e HTTPS em produção. Confira INTERNET no manifest Android mesclado de release.
- Implemente armazenamento seguro da credencial de renovação no mobile nativo, restauração inicial, rotação, expiração e limpeza no logout. Não persista senha nem credencial em texto puro. Preserve o modelo seguro de cookies do cliente web.
- Unifique estado de sessão entre ApiClient, AuthController e roteador. Use apenas um refresh concorrente; limite a repetição, capture falhas e finalize sempre o handler. Diferencie falha transitória de rede de refresh rejeitado. Um refresh tardio não pode restaurar sessão após logout ou troca de conta.
- Bloqueie conteúdo privado durante verificação inicial sem bloquear consulta pública desnecessariamente. Preserve destino interno válido após login, rejeite destinos externos/loops e ofereça página amigável para rota inválida ou item não encontrado.
- Revise setState, context, controllers e providers usados após await. Evite callbacks em telas descartadas. Trate saída durante upload, login e comentário.
- Limpe ou invalide dados privados ao trocar de usuário. Um usuário nunca deve herdar acompanhamentos, rascunhos privados ou notificações de outro.

ETAPA 2 — JORNADAS ESSENCIAIS
- Substitua placeholders de busca, detalhes, Meus itens, notificações e privacidade por telas conectadas à API.
- Busca: texto com debounce, cancelamento/descarte de respostas antigas, filtros suportados pelo backend, ordenação, paginação, limpar filtros, vazio contextual e retry. Preserve filtros e rolagem ao voltar.
- Detalhes: carregamento por ID independente do feed, imagem ampliável, campos relevantes, status/moderação conforme permissão, comentários carregados pela API e atualização reativa após mutações. Corrija o botão Pistas.
- Reivindicação: formulário privado de mensagem e provas, validação alinhada ao backend, estado de envio, prevenção de duplicidade e acompanhamento. Impeça operações vedadas pelo estado ou titularidade; o servidor deve validar novamente.
- Meus itens: publicações do usuário, detalhes de moderação, edição autorizada, claims e devolução conforme os contratos reais. Caso falte consulta de reivindicações feitas pelo próprio usuário, implemente a extensão mínima com escopo por usuário.
- Acompanhamentos: carregue o estado persistido no servidor, serialize mutações do mesmo item, faça rollback somente do item afetado e mantenha estado após refresh/reabertura.
- Notificações internas: listagem, contador, marcar todas como lidas conforme API existente, navegação ao item e tratamento de item removido/inacessível. Não simule push.
- Permissões: ações e entradas de navegação devem corresponder às capacidades reais. Não envie o usuário para dashboard provisório após login. Para painel/admin secundários, implemente o que for exposto ou retire a entrada incompleta, documentando o escopo.

ETAPA 3 — PUBLICAÇÃO CONFIÁVEL
- Preserve preenchimento em rascunho por usuário e confirme descarte ao sair. Defina expiração e limpeza de rascunhos e imagens temporárias.
- Ofereça câmera e galeria com permissões estritamente necessárias, cancelamento normal, permissão negada e recuperação via retrieveLostData no Android. Configure descrições iOS quando adicionar câmera.
- Valide tamanho e formatos aceitos pela API, mantenha validação real do arquivo no servidor, trate imagens inválidas e ofereça progresso de upload.
- Capture snapshot dos campos no envio ou bloqueie alterações enquanto envia. Evite combinação de foto antiga com campos alterados durante upload.
- Preserve URL de upload concluído quando falhar a criação; defina limpeza de arquivos órfãos no servidor. Não repita POST automaticamente após timeout de resultado incerto. Se necessário, implemente idempotência no servidor por usuário/operação e teste a repetição.
- Mostre erros junto aos campos, foco no primeiro inválido e confirmação baseada na resposta real, incluindo eventual pendência de moderação. Não aceite ID inválido como sucesso.

ETAPA 4 — UX, PERFORMANCE E RECUPERAÇÃO
- Padronize loading inicial, atualização sem apagar conteúdo útil, estado vazio, erro recuperável e fim da paginação.
- Diferencie conexão indisponível, timeout, 401, 403, 404, conflito, validação, 413, 429 e 5xx. Use mensagens pt-BR com ação útil; não mostre URLs de backend ou stack traces ao usuário.
- Corrija concorrência entre refresh, paginação, comentários e follow. Descarte respostas obsoletas, deduplique itens por ID e evite rollback que substitua o estado inteiro por snapshot antigo.
- Use ListView.builder ou slivers para os posts. Não construa todos os cards em Column. Verifique rolagem com pelo menos 200 itens de teste.
- Refaça a composição dos detalhes para caber com teclado aberto, fontes grandes e paisagem. Use áreas seguras, rolagem adequada, foco previsível e alvos de toque de pelo menos 48 pixels lógicos.
- Ofereça rótulos compreensíveis nas abas e semântica nos ícones. Teste contraste, texto ampliado até 200%, leitor de tela e temas claro/escuro; não comunique status somente por cor.
- Faça perfil editável usando o contrato existente, fallback de avatar e logout com tratamento de falha remota. Faça preferências expostas realmente persistirem; não ofereça idiomas que só traduzem widgets do framework.
- Disponibilize privacidade antes do aceite. Para recuperação de senha, primeiro verifique suporte real. Se implementada, entregue também tokens de uso único com expiração, limites de tentativas e integração de envio; não crie tela sem serviço funcional.
- Preserve dados úteis em falhas de atualização. Não crie fila automática de reivindicações/devoluções offline. Caso implemente cache local, separe dados públicos/privados e limpe dados do usuário no logout.

ETAPA 5 — TESTES E ENTREGA
Crie testes de comportamento, não apenas testes que repetem detalhes internos. Cubra:
- sessão restaurada; expiração; refresh concorrente; falha no retry; logout com rede indisponível; refresh tardio após logout;
- navegação protegida, destino após login, permissões e troca de usuário;
- busca sem resultados, erro, filtros, paginação, deduplicação e respostas fora de ordem;
- publicar com/sem foto, validações, falha no upload/criação, toque duplo, resultado incerto e recuperação de rascunho;
- sair da tela durante operações assíncronas sem exceção por estado descartado;
- comentário refletido nos detalhes abertos, follow concorrente e rollback isolado;
- reivindicação privada, tentativa não autorizada, transições de status e devolução;
- telefone estreito de 320/360 pixels lógicos, paisagem, teclado aberto, fonte a 200%, imagem quebrada e leitor de tela.

Execute flutter analyze, flutter test e testes de integração disponíveis. Valide o build Android e o manifest final. Se alterar backend, execute os checks correspondentes e testes de autorização/contrato. iOS deve ser validado em ambiente macOS apropriado; não declare essa etapa aprovada sem executá-la.

Prepare configuração de assinatura release sem usar chave de debug como distribuição e sem versionar segredos. Não publique o app. Atualize apps/flutter/README.md com configuração, execução, testes e limites conhecidos.

CRITÉRIOS DE ACEITE
- A jornada essencial funciona com a API real e sem telas provisórias.
- Ação indisponível tem explicação clara; ação bem-sucedida reflete estado persistido.
- Falhas previstas oferecem recuperação sem apagar preenchimento e sem mensagens técnicas.
- Sessão e dados privados permanecem coerentes após expiração, logout e troca de conta.
- Testes relevantes passam e não há overflow nos cenários efetivamente validados.
- Nenhuma prova privada ou credencial aparece em UI pública, cache público ou logs.

Na entrega, liste arquivos alterados, funcionalidades concluídas, comandos e resultados reais, cenários manuais executados e limitações. Não afirme “zero erros”. Se houver bloqueio de ambiente, identifique-o precisamente e conclua o trabalho independente dele. Não trate funcionalidades essenciais pendentes como entrega completa.
```
