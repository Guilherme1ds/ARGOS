# Implementação mobile ARGOS

## Entregue

- Busca com texto, local, categoria, tipo, situação, período, foto e ordenação. Paginação, debounce e descarte de respostas antigas.
- Detalhes reais por ID, ampliação de foto, comentários paginados, denúncia e acompanhamento.
- Solicitação privada com mensagem/provas, acompanhamento de solicitações enviadas e devolução vinculada à solicitação escolhida.
- Meus itens, notificações internas e privacidade conectados à API; perfil editável e tema persistido.
- Sessão nativa em armazenamento seguro, rotação de refresh única, proteção contra resposta tardia após logout e separação dos dados por conta.
- Publicação e edição com rascunho por usuário/item, expiração, câmera/galeria, recuperação Android, progresso e reutilização de upload.
- Criação idempotente: reenvio do mesmo pedido retorna o mesmo ID. Resultado incerto preserva a operação original para conferência/repetição.
- Feed com construção sob demanda e correções para texto ampliado; fonte Inter incorporada nos assets.
- Configuração Android de internet, debug separado do release e assinatura local sem fallback para chave debug. Descrições de câmera/galeria e configuração de Keychain preparadas para iOS.

## Principais arquivos

| Área | Arquivos |
| --- | --- |
| Sessão e erros | `apps/flutter/lib/core/network/api_client.dart`, `session_store.dart`, `features/auth/application/auth_controller.dart` |
| Navegação | `apps/flutter/lib/app/router.dart`, `features/shell/presentation/mobile_shell.dart` |
| Busca e detalhes | `apps/flutter/lib/features/items/presentation/items_screen.dart`, `item_detail_screen.dart` |
| Conta | `apps/flutter/lib/features/items/presentation/account_screens.dart`, `features/auth/presentation/profile_screen.dart` |
| Formulário e rascunho | `apps/flutter/lib/features/items/presentation/item_form_screen.dart`, `features/items/data/draft_store.dart` |
| Feed | `apps/flutter/lib/features/feed/application/feed_controller.dart`, `features/feed/presentation/home_feed_screen.dart` e widgets |
| Backend | `backend/src/modules/items/items.routes.ts`, `modules/auth/auth.routes.ts`, `utils/orphan-uploads.ts`, `utils/audit.ts`, `db/database.ts` |
| Contratos | `docs/openapi/argos.v1.yaml` |
| Execução | `apps/flutter/README.md`, `apps/flutter/config/development.example.json` |

Os caminhos abreviados na tabela continuam a partir de `apps/flutter/lib` ou `backend/src`, conforme a área.

## Compatibilidade do backend

Novas consultas autenticadas: `GET /items/following` e `GET /items/my-claims`, com paginação e escopo por usuário. O detalhe acrescenta capacidades calculadas, acompanhamento e resumo da solicitação da própria conta. Dados privados não são acrescentados à busca pública.

`POST /items` aceita `Idempotency-Key` opcional, preservando clientes anteriores. Comentários aceitam paginação quando `page` é informado; a consulta legada sem esse parâmetro continua funcionando. Logout também revoga o sucessor de um refresh que tenha sido rotacionado durante a saída.

A tabela `mobile_operations` é criada pela migração existente. Não houve alteração de dados no banco de desenvolvimento: as integrações executadas usaram bancos temporários. Não foi realizado deploy ou publicação em loja.

## Validação executada

- `flutter analyze`: sem apontamentos.
- `flutter test --dart-define=ARGOS_RUN_LIVE_TESTS=true`: 23 testes aprovados, incluindo a integração HTTP com API isolada.
- Integração Android no emulador `Pixel_9_Pro_XL`: sessão restaurada em cliente novo, busca, reivindicação pela interface, conferência de devolução na API e recuperação/publicação de rascunho pela interface.
- Backend: build/typecheck e 16 testes aprovados. Cobrem permissões, privacidade, reivindicação/devolução, idempotência, isolamento de acompanhamentos, limpeza de imagens órfãs e revogação após rotação.
- Frontend React: build aprovado após instalação das dependências do lockfile.
- OpenAPI: YAML válido e 115 referências locais resolvidas.
- Android release: compilação aprovada; manifesto com internet e backup desativado. O APK está sem assinatura, confirmado pelo `apksigner`, e foi gerado apenas para verificar compilação, sem configuração de produção.
- Android debug: APK normal do aplicativo gerado com `config/development.example.json`, após o teste no emulador. Usa a API de desenvolvimento do computador em `10.0.2.2:3333`.
- Layout automatizado: 320 × 640 e 640 × 320, texto a 200%, teclado simulado; feed com 200 itens e verificação de montagem sob demanda.

## Homologação ainda necessária

iOS não foi compilado nem executado neste ambiente Windows. Permissões recusadas, câmera/galeria em aparelho físico, encerramento forçado pelo Android durante o seletor de fotos e navegação completa por TalkBack/VoiceOver ainda precisam de validação específica. A recuperação do seletor está implementada, mas esse evento do sistema não foi reproduzido.

Ainda é necessário fornecer endpoints reais HTTPS e credenciais locais de assinatura para uma distribuição de produção. A configuração de release não usa chave debug. A validação técnica não equivale a uma publicação pronta em loja.

Mapa, push, chat em tempo real, recuperação de senha e painel administrativo nativo completo ficaram fora do escopo, conforme a priorização do prompt. As antigas entradas provisórias foram retiradas; administração web preservada. Notificações internas continuam limitadas às 50 mais recentes pelo contrato existente.

Nenhum conjunto de testes garante ausência absoluta de erros; os resultados acima descrevem os cenários efetivamente exercitados.
