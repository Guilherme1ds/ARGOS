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
- Detalhes por ID, pistas públicas, reivindicação/informação privada e devolução autorizada pelo servidor. Quem enviou uma solicitação pode cancelá-la (com confirmação); o responsável pelo caso pode recusar uma solicitação recebida (a pessoa é avisada). O autor remove a própria pista pública (ex.: publicou um dado pessoal por engano).
- Meus itens: publicações, solicitações enviadas e acompanhamentos. Notificações internas mostram os 50 registros mais recentes, contador e links disponíveis; abrir uma notificação a marca como lida e atualiza o contador.
- Contato: todo contato acontece pelo ARGOS (solicitação privada e notificações); o formulário não oferece mais a opção "E-mail autorizado", que não tinha efeito.
- Privacidade: texto, versão, retenção e aceite vêm da API; exportação e exclusão de conta ficam na web, e a tela mostra o endereço (`ARGOS_WEB_URL/settings`).
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

A suíte padrão testa sessão, concorrência, rascunhos, busca, formulários, layout e os fluxos de autenticação (cadastro com confirmação pendente, reenvio, login não confirmado, recuperação de senha) com respostas controladas. `live_api_test.dart` é ignorado por padrão porque cria dados em uma API real.

Teste HTTP contra uma API **descartável** (sobe a API com banco/uploads temporários, `.env` ignorado, integrações desligadas e a caixa de e-mails de teste; remove a pasta ao final):

```powershell
node tool/run_live_api_test.mjs
```

Para o teste de interface no Android, suba uma API descartável manualmente, em outro terminal a partir de `backend` (o cadastro exige confirmar o e-mail; a caixa de teste só funciona com `NODE_ENV=test`, conexões locais e destinatários `.test`):

```powershell
$testDir = Join-Path ([System.IO.Path]::GetTempPath()) ('argos-mobile-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDir
New-Item -ItemType File -Path (Join-Path $testDir 'empty.env')
$env:NODE_ENV = 'test'
$env:PORT = '3334'
$env:DOTENV_CONFIG_PATH = Join-Path $testDir 'empty.env'
$env:DATABASE_URL = Join-Path $testDir 'argos.sqlite'
$env:UPLOAD_DIR = Join-Path $testDir 'uploads'
$env:JWT_SECRET = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$env:ADMIN_PASSWORD = [guid]::NewGuid().ToString('N')
$env:API_PUBLIC_URL = 'http://localhost:3334'
$env:ENABLE_TEST_MAIL_SINK = 'true'
$env:SMTP_HOST = ''
node --import tsx src/server.ts
```

Em `apps/flutter`:

```powershell
flutter test integration_test/mobile_journey_test.dart -d emulator-5554 --dart-define=ARGOS_TEST_API=http://10.0.2.2:3334/api/v1
```

### Autenticação no app

- Cadastro por senha não abre sessão: o app mostra que o link de confirmação foi enviado e oferece "Reenviar e-mail de confirmação" (também quando o login é recusado por e-mail não confirmado).
- "Esqueci minha senha" pede o link pela API; a nova senha é criada na página web aberta pelo link do e-mail (o app não recebe nem guarda o token). Depois, a pessoa entra no app normalmente.
- Login com Google não existe no app (exige OAuth nativo por plataforma). Contas criadas com Google na web definem uma senha por "Esqueci minha senha".
- Com CAPTCHA (Turnstile) ligado no servidor, cadastro e recuperação pelo app recebem 422: o app não renderiza o desafio.
- "Acesso" (solicitação institucional) não pede senha: se a administração aprovar, a pessoa recebe uma senha temporária por canal institucional ou cria a sua por "Esqueci minha senha".
- Conta bloqueada ou pendente vê a explicação do servidor (`account_inactive`), não uma mensagem genérica de permissão.

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

Painel administrativo, mapa, push, chat em tempo real, login com Google, exportação e exclusão de conta não fazem parte do app (ficam na web). A recuperação de senha é pedida no app e concluída na página web do link. `/dashboard` direciona para Meus itens e `/settings` para perfil.

Rascunhos persistentes são nativos; Flutter web não persiste formulário. Notificações históricas sem action_url permanecem legíveis, sem link inventado.

Validação iOS precisa de macOS/Xcode. Câmera/galeria em aparelho físico, permissões negadas, encerramento forçado pelo sistema e leitura completa com TalkBack/VoiceOver exigem homologação específica. Testes automatizados de layout não substituem essas verificações.
