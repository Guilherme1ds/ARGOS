# ARGOS mobile

Flutter + Riverpod + Dio + GoRouter. Usa a API Express do mesmo monorepo.

## Executar

Inicie o backend conforme o README principal. Em `apps/flutter`:

```powershell
flutter pub get
flutter run --dart-define-from-file=config/development.example.json
```

Sem `--dart-define`, o app usa automaticamente `10.0.2.2` no emulador Android (endereço do computador visto pelo emulador) e `localhost` nas outras plataformas. O comando de exemplo também configura `10.0.2.2`. Em aparelho físico, informe um IP acessível do computador com `--dart-define=ARGOS_API_URL=http://<IP-DO-COMPUTADOR>:3333/api --dart-define=ARGOS_API_PUBLIC_URL=http://<IP-DO-COMPUTADOR>:3333` e confira firewall/porta 3333. Inicie o frontend na porta 5173 para abrir os links compartilháveis.

| Variável de compilação | Uso |
| --- | --- |
| ARGOS_API_URL | API incluindo /api/v1 ou /api |
| ARGOS_API_PUBLIC_URL | Origem das imagens /uploads/ |
| ARGOS_WEB_URL | Origem dos links compartilhados |

Crie arquivos locais separados para homologação/produção. Release exige HTTPS e configuração válida. Não coloque segredos em dart-define: eles podem ser extraídos do aplicativo. HTTP é habilitado explicitamente somente no manifest de debug.

## Funcionalidades e recuperação

- Busca com filtros, paginação, respostas obsoletas descartadas e abas com estado preservado.
- Detalhes por ID, pistas públicas, reivindicação/informação privada e devolução autorizada pelo servidor.
- Meus itens: publicações, solicitações enviadas e acompanhamentos. Notificações internas mostram os 50 registros mais recentes, contador e links disponíveis.
- Perfil: edição de nome, nome público, setor, bio e tema. Idioma disponível: português brasileiro.
- Refresh token em armazenamento seguro nativo; access token em memória. No Flutter web, mantém-se o cookie httpOnly, sem guardar credenciais em localStorage.
- Rascunhos nativos separados por usuário/item, com expiração de sete dias. Texto em armazenamento seguro e fotos no diretório privado do aplicativo. Logout remove rascunhos. Salvamento após alteração, ao suspender o app e antes de enviar.
- Câmera/galeria: JPEG, PNG e WebP até 5 MB. Recuperação via retrieveLostData no Android. A API valida e recodifica as imagens para remover metadados.
- Criação com Idempotency-Key persistida: repetir uma resposta incerta não cria outro item. Durante a incerteza, os campos ficam bloqueados para repetir o pedido original ou conferir Meus itens.
- Upload concluído é reutilizado após falha na criação. O backend limpa uploads não vinculados a itens/perfis após oito dias, a cada hora, em lotes de 50.
- Sem fila de reivindicação/devolução offline. Atualizações que falham preservam conteúdo já carregado.
- Fonte Inter incluída nos assets; licença em assets/fonts/OFL.txt.

## Testes

```powershell
flutter analyze
flutter test
```

A suíte padrão testa sessão, concorrência, rascunhos, busca, formulários e layout com respostas controladas. `live_api_test.dart` é ignorado por padrão porque cria dados em uma API real.

Para testar HTTP e emulador, inicie um backend **descartável**, em outro terminal a partir de `backend`:

```powershell
$testDir = Join-Path ([System.IO.Path]::GetTempPath()) ('argos-mobile-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDir
$env:NODE_ENV = 'test'
$env:PORT = '3334'
$env:DATABASE_URL = Join-Path $testDir 'argos.sqlite'
$env:UPLOAD_DIR = Join-Path $testDir 'uploads'
$env:JWT_SECRET = [guid]::NewGuid().ToString('N')
$env:ADMIN_PASSWORD = [guid]::NewGuid().ToString('N')
$env:API_PUBLIC_URL = 'http://localhost:3334'
$env:SMTP_HOST = ''
node --import tsx src/server.ts
```

Em `apps/flutter`:

```powershell
flutter test --dart-define=ARGOS_RUN_LIVE_TESTS=true --dart-define=ARGOS_TEST_API=http://localhost:3334/api/v1
flutter test integration_test/mobile_journey_test.dart -d emulator-5554 --dart-define=ARGOS_TEST_API=http://10.0.2.2:3334/api/v1
```

O segundo comando usa a interface e o armazenamento seguro Android. Substitua o ID conforme `flutter devices`. Nunca aponte esses testes para produção ou banco de desenvolvimento. Encerre o servidor ao terminar. Limites de requisição permanecem ativos; repetir rapidamente pode exigir aguardar a janela de um minuto.

Na raiz, valide o backend:

```powershell
npm run typecheck --prefix backend
npm test --prefix backend
npm run build --prefix backend
```

## Android e distribuição

Debug usa `br.com.argos.argos_mobile.debug`, separado do release. O armazenamento seguro usa a linha 10.x com versão resolvida no lockfile. A versão 11 exige SDK 37 e não foi adotada nesta implementação.

```powershell
flutter build apk --debug --dart-define-from-file=config/development.example.json
flutter build apk --release --dart-define-from-file=config/production.local.json
```

Para assinar, crie `android/key.properties` localmente:

```properties
storeFile=C:/keys/argos-upload.jks
storePassword=PREENCHER_LOCALMENTE
keyAlias=upload
keyPassword=PREENCHER_LOCALMENTE
```

Sem esse arquivo, release não usa a chave de debug: a tarefa Gradle pode gerar somente saída não assinada para verificação, imprópria para distribuição. Chaves e configurações locais são ignoradas pelo Git. Não há publicação automática.

## Limites

Painel administrativo completo, mapa, push, chat em tempo real e recuperação de senha não fazem parte desta entrega. Entradas administrativas provisórias foram removidas; a administração web permanece disponível. `/dashboard` direciona para Meus itens e `/settings` para perfil.

Rascunhos persistentes são nativos; Flutter web não persiste formulário. Notificações históricas sem action_url permanecem legíveis, sem link inventado.

Validação iOS precisa de macOS/Xcode. Câmera/galeria em aparelho físico, permissões negadas, encerramento forçado pelo sistema e leitura completa com TalkBack/VoiceOver exigem homologação específica. Testes automatizados de layout não substituem essas verificações.
