import 'package:argos_mobile/app/router.dart';
import 'package:argos_mobile/app/theme/argos_theme.dart';
import 'package:argos_mobile/core/network/api_client.dart';
import 'package:argos_mobile/features/auth/application/auth_controller.dart';
import 'package:argos_mobile/features/auth/presentation/login_screen.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'support/fake_api.dart';

const _verificationMessage =
    'Conta criada. Enviamos um link de confirmação para o seu e-mail; confirme para entrar.';
const _unverifiedMessage =
    'Confirme seu e-mail para continuar. Enviamos um link de confirmação para o endereço cadastrado.';

({ApiClient client, FakeAdapter adapter}) _client(
  ResponseBody Function(RequestOptions request) respond,
) {
  final dio = Dio(BaseOptions(baseUrl: 'https://test/api/v1'));
  final adapter = FakeAdapter(respond);
  dio.httpClientAdapter = adapter;
  return (client: ApiClient(dio: dio, store: MemoryStore()), adapter: adapter);
}

Future<ProviderContainer> _pumpLogin(
  WidgetTester tester,
  ApiClient client, {
  Size size = const Size(390, 844),
  double textScale = 1,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final container = ProviderContainer(
    overrides: [apiClientProvider.overrideWithValue(client)],
  );
  addTearDown(container.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        theme: ArgosTheme.light(),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: TextScaler.linear(textScale)),
          child: child!,
        ),
        home: const LoginScreen(),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return container;
}

Finder _field(String hint) => find.widgetWithText(TextFormField, hint);

void main() {
  testWidgets(
    'cadastro não abre sessão: mostra confirmação pendente e reenvia o link',
    (tester) async {
      final api = _client((request) {
        if (request.path == '/auth/register') {
          return jsonResponse({
            'verificationRequired': true,
            'message': _verificationMessage,
          }, status: 201);
        }
        if (request.path == '/auth/resend-verification') {
          return jsonResponse({
            'message':
                'Se houver uma conta aguardando confirmação, enviaremos um novo link.',
          }, status: 202);
        }
        return jsonResponse({}, status: 404);
      });
      addTearDown(api.client.dispose);
      final container = await _pumpLogin(tester, api.client);

      await tester.tap(find.text('Cadastro'));
      await tester.pumpAndSettle();
      await tester.enterText(_field('Nome'), 'Ana Souza');
      await tester.enterText(_field('E-mail'), 'ana@example.test');
      await tester.enterText(_field('Senha'), 'Senha-Forte-1');
      await tester.ensureVisible(find.byType(Checkbox));
      await tester.pumpAndSettle();
      await tester.tap(find.byType(Checkbox));
      await tester.pumpAndSettle();
      expect(tester.widget<Checkbox>(find.byType(Checkbox)).value, isTrue);
      await tester.ensureVisible(find.text('Enviar'));
      await tester.tap(find.text('Enviar'));
      await tester.pumpAndSettle();

      expect(find.text(_verificationMessage), findsOneWidget);
      expect(container.read(authControllerProvider).user, isNull);
      final register = api.adapter.requests.firstWhere(
        (request) => request.path == '/auth/register',
      );
      // A versão do aviso é a do servidor; o app não envia uma versão fixa.
      expect(
        (register.data as Map).containsKey('privacyTermsVersion'),
        isFalse,
      );

      final resend = find.text('Reenviar e-mail de confirmação');
      await tester.ensureVisible(resend);
      await tester.tap(resend);
      await tester.pumpAndSettle();
      final request = api.adapter.requests.last;
      expect(request.path, '/auth/resend-verification');
      expect(request.data, {'email': 'ana@example.test'});
      expect(find.textContaining('aguardando confirmação'), findsOneWidget);
    },
  );

  testWidgets(
    'login de conta não confirmada mostra a explicação do servidor e o reenvio',
    (tester) async {
      final api = _client(
        (request) => request.path == '/auth/login'
            ? jsonResponse({
                'message': _unverifiedMessage,
                'details': {'code': 'email_unverified'},
              }, status: 403)
            : jsonResponse({}, status: 404),
      );
      addTearDown(api.client.dispose);
      final container = await _pumpLogin(tester, api.client);

      await tester.enterText(_field('E-mail'), 'ana@example.test');
      await tester.enterText(_field('Senha'), 'Senha-Forte-1');
      await tester.tap(find.widgetWithText(FilledButton, 'Entrar'));
      await tester.pumpAndSettle();

      expect(find.text(_unverifiedMessage), findsOneWidget);
      expect(find.text('Reenviar e-mail de confirmação'), findsOneWidget);
      expect(container.read(authControllerProvider).user, isNull);
    },
  );

  testWidgets(
    'recuperação de senha pede o link pela API e explica a etapa na web',
    (tester) async {
      final api = _client(
        (request) => request.path == '/auth/forgot-password'
            ? jsonResponse({
                'message':
                    'Se o e-mail estiver cadastrado, enviaremos um link para redefinir a senha.',
              }, status: 202)
            : jsonResponse({}, status: 404),
      );
      addTearDown(api.client.dispose);
      await _pumpLogin(tester, api.client);

      expect(find.textContaining('Criou a conta com o Google'), findsOneWidget);
      await tester.tap(find.text('Esqueci minha senha'));
      await tester.pumpAndSettle();
      expect(find.text('Recuperar senha'), findsOneWidget);
      expect(_field('Senha'), findsNothing);

      await tester.tap(find.text('Enviar link'));
      await tester.pumpAndSettle();
      expect(find.text('Informe um e-mail.'), findsOneWidget);
      expect(api.adapter.requests, isEmpty);

      await tester.enterText(_field('E-mail'), 'ana@example.test');
      await tester.tap(find.text('Enviar link'));
      await tester.pumpAndSettle();
      expect(api.adapter.requests.single.path, '/auth/forgot-password');
      expect(api.adapter.requests.single.data, {'email': 'ana@example.test'});
      expect(
        find.textContaining('Abra o link do e-mail no navegador'),
        findsOneWidget,
      );

      await tester.tap(find.text('Voltar ao login'));
      await tester.pumpAndSettle();
      expect(_field('Senha'), findsOneWidget);
    },
  );

  for (final size in [const Size(320, 640), const Size(640, 320)]) {
    testWidgets('telas de login e recuperação cabem em $size com fonte 200%', (
      tester,
    ) async {
      final api = _client((_) => jsonResponse({}, status: 404));
      addTearDown(api.client.dispose);
      await _pumpLogin(tester, api.client, size: size, textScale: 2);
      expect(tester.takeException(), isNull);
      await tester.ensureVisible(find.text('Esqueci minha senha'));
      await tester.tap(find.text('Esqueci minha senha'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  }

  test('rotas de autenticação nunca são destino de redirecionamento', () {
    for (final target in [
      '/forgot-password',
      '/verify-email',
      '/reset-password',
    ]) {
      expect(safeNext(target), '/');
    }
  });

  test(
    'mensagens explicadas pelo servidor têm prioridade sobre o texto genérico',
    () {
      DioException error(int status, Map<String, dynamic> body) => DioException(
        requestOptions: RequestOptions(path: '/items'),
        response: Response(
          requestOptions: RequestOptions(path: '/items'),
          statusCode: status,
          data: body,
        ),
      );
      final restricted = error(403, {
        'message':
            'Sua conta está com restrição de publicação aplicada manualmente pela moderação.',
        'details': {'code': 'publishing_restricted'},
      });
      expect(apiErrorCode(restricted), 'publishing_restricted');
      expect(apiErrorMessage(restricted), contains('restrição de publicação'));
      expect(
        apiErrorMessage(
          error(403, {'message': 'Acesso negado para esta acao.'}),
        ),
        'Sua conta não tem permissão para esta ação.',
      );
    },
  );
}
