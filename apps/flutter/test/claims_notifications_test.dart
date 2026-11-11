import 'package:argos_mobile/app/theme/argos_theme.dart';
import 'package:argos_mobile/core/network/api_client.dart';
import 'package:argos_mobile/features/auth/application/auth_controller.dart';
import 'package:argos_mobile/features/auth/domain/app_user.dart';
import 'package:argos_mobile/features/auth/presentation/login_screen.dart';
import 'package:argos_mobile/features/items/presentation/account_screens.dart';
import 'package:argos_mobile/features/items/presentation/item_detail_screen.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'support/fake_api.dart';

// Jornadas de fechamento (11/2026): cancelar a própria solicitação, recusar uma
// solicitação recebida, remover a própria pista, notificação lida ao abrir,
// solicitação de acesso sem senha e conta inativa explicada.

class _SignedIn extends AuthController {
  @override
  AuthState build() => const AuthState(
    checkingSession: false,
    user: AppUser(
      id: 1,
      name: 'Ana',
      email: 'ana@example.test',
      role: 'citizen',
      permissions: ['chat:send', 'items:create', 'claims:create'],
    ),
  );
}

typedef _Respond = ResponseBody Function(RequestOptions request);

({ApiClient client, FakeAdapter adapter}) _client(_Respond respond) {
  final dio = Dio(BaseOptions(baseUrl: 'https://test/api/v1'));
  final adapter = FakeAdapter((request) {
    // O detalhe atualiza o mural depois das ações: busca vazia basta.
    if (request.path == '/items/search') {
      return jsonResponse({
        'data': [],
        'meta': {'total': 0},
      });
    }
    if (request.path == '/items/following') {
      return jsonResponse({
        'data': [],
        'meta': {'total': 0},
      });
    }
    return respond(request);
  });
  dio.httpClientAdapter = adapter;
  return (client: ApiClient(dio: dio, store: MemoryStore()), adapter: adapter);
}

Future<void> _pumpDetail(WidgetTester tester, ApiClient client) async {
  tester.view.physicalSize = const Size(390, 1400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(client),
        authControllerProvider.overrideWith(_SignedIn.new),
      ],
      child: MaterialApp(
        theme: ArgosTheme.light(),
        home: const ItemDetailScreen(id: 1),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

ResponseBody _comments([List<Map<String, dynamic>> rows = const []]) =>
    jsonResponse({
      'data': rows,
      'meta': {'total': rows.length},
    });

void main() {
  testWidgets('quem enviou cancela a própria solicitação, com confirmação', (
    tester,
  ) async {
    var claimOpen = true;
    final api = _client((request) {
      if (request.path == '/items/1/claim' && request.method == 'DELETE') {
        claimOpen = false;
        return jsonResponse({'message': 'Reivindicação cancelada.'});
      }
      if (request.path.endsWith('/comments')) return _comments();
      return jsonResponse({
        'item': itemJson(1),
        'capabilities': {'claim': true},
        'history': [],
        'following': false,
        'myClaim': claimOpen ? {'id': 5, 'status': 'pending'} : null,
      });
    });
    addTearDown(api.client.dispose);
    await _pumpDetail(tester, api.client);

    await tester.tap(find.text('Cancelar minha solicitação'));
    await tester.pumpAndSettle();
    // Fechar a confirmação sem cancelar não envia nada.
    await tester.tap(find.text('Manter'));
    await tester.pumpAndSettle();
    expect(
      api.adapter.requests.where((request) => request.method == 'DELETE'),
      isEmpty,
    );

    await tester.tap(find.text('Cancelar minha solicitação'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Cancelar solicitação'));
    await tester.pumpAndSettle();

    final deletes = api.adapter.requests.where(
      (request) => request.method == 'DELETE',
    );
    expect(deletes.map((request) => request.path), ['/items/1/claim']);
    expect(find.text('Solicitação cancelada.'), findsOneWidget);
    // Sem solicitação aberta, o formulário de reivindicação volta a aparecer.
    expect(find.text('Cancelar minha solicitação'), findsNothing);
    expect(find.text('Reivindicar item'), findsOneWidget);
  });

  testWidgets('responsável recusa uma solicitação recebida', (tester) async {
    var status = 'pending';
    final api = _client((request) {
      if (request.path == '/items/1/claims/7/reject') {
        status = 'rejected';
        return jsonResponse({'message': 'Reivindicação recusada.'});
      }
      if (request.path == '/items/1/claims') {
        return jsonResponse({
          'data': [
            {
              'id': 7,
              'claimant_name': 'Bruno',
              'message': 'Acho que a mochila é minha.',
              'proof_details': 'Chaveiro azul no zíper.',
              'status': status,
            },
          ],
        });
      }
      if (request.path.endsWith('/comments')) return _comments();
      return jsonResponse({
        'item': {...itemJson(1), 'status': 'claimed'},
        'capabilities': {'readClaims': true, 'return': true, 'edit': true},
        'history': [],
        'following': false,
        'myClaim': null,
      });
    });
    addTearDown(api.client.dispose);
    await _pumpDetail(tester, api.client);

    await tester.tap(find.text('Solicitações recebidas — privadas'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Chaveiro azul'), findsOneWidget);
    await tester.tap(find.widgetWithText(TextButton, 'Recusar'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Recusar'));
    await tester.pumpAndSettle();

    expect(
      api.adapter.requests
          .where((request) => request.method == 'PATCH')
          .map((request) => request.path),
      ['/items/1/claims/7/reject'],
    );
    expect(
      find.text('Solicitação recusada. A pessoa será avisada.'),
      findsOneWidget,
    );
    expect(find.textContaining('Não aceita'), findsOneWidget);
    expect(find.widgetWithText(TextButton, 'Recusar'), findsNothing);
  });

  testWidgets('autor remove a própria pista pública; a de outra pessoa não', (
    tester,
  ) async {
    final api = _client((request) {
      if (request.path == '/items/1/comments/9' && request.method == 'DELETE') {
        return jsonResponse({'message': 'Pista removida.'});
      }
      if (request.path.endsWith('/comments')) {
        return _comments([
          {
            'id': 9,
            'item_id': 1,
            'user_id': 1,
            'author_name': 'Ana',
            'body': 'Telefone 1234 errado, quero apagar',
            'created_at': '2026-11-01 10:00:00',
          },
          {
            'id': 10,
            'item_id': 1,
            'user_id': 2,
            'author_name': 'Bruno',
            'body': 'Vi parecida na biblioteca.',
            'created_at': '2026-11-01 11:00:00',
          },
        ]);
      }
      return jsonResponse({
        'item': itemJson(1),
        'capabilities': {},
        'history': [],
        'myClaim': null,
      });
    });
    addTearDown(api.client.dispose);
    await _pumpDetail(tester, api.client);

    expect(find.byTooltip('Remover pista'), findsOneWidget);
    await tester.ensureVisible(find.byTooltip('Remover pista'));
    await tester.tap(find.byTooltip('Remover pista'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Remover'));
    await tester.pumpAndSettle();

    expect(
      api.adapter.requests
          .where((request) => request.method == 'DELETE')
          .map((request) => request.path),
      ['/items/1/comments/9'],
    );
    expect(find.textContaining('quero apagar'), findsNothing);
    expect(find.textContaining('Vi parecida'), findsOneWidget);
    expect(find.text('Pista removida.'), findsOneWidget);
  });

  testWidgets('abrir uma notificação a marca como lida', (tester) async {
    final read = <int>{};
    final api = _client((request) {
      final match = RegExp(
        r'^/notifications/(\d+)/read$',
      ).firstMatch(request.path);
      if (match != null) {
        read.add(int.parse(match.group(1)!));
        return jsonResponse({'message': 'Notificação marcada como lida.'});
      }
      if (request.path == '/notifications/unread-count') {
        return jsonResponse({'total': 2 - read.length});
      }
      if (request.path == '/notifications') {
        return jsonResponse({
          'data': [
            {
              'id': 3,
              'title': 'Nova reivindicação',
              'body': 'O item "Mochila" recebeu uma reivindicação.',
              'action_url': '/items/1',
              'read_at': read.contains(3) ? '2026-11-11 10:00:00' : null,
            },
            {
              'id': 4,
              'title': 'Aviso antigo',
              'body': 'Sem link.',
              'action_url': null,
              'read_at': read.contains(4) ? '2026-11-11 10:00:00' : null,
            },
          ],
        });
      }
      return jsonResponse({}, status: 404);
    });
    addTearDown(api.client.dispose);
    final router = GoRouter(
      routes: [
        GoRoute(path: '/', builder: (_, _) => const NotificationsScreen()),
        GoRoute(
          path: '/items/:id',
          builder: (_, state) =>
              Scaffold(body: Text('Caso ${state.pathParameters['id']}')),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(api.client),
          authControllerProvider.overrideWith(_SignedIn.new),
        ],
        child: MaterialApp.router(
          theme: ArgosTheme.light(),
          routerConfig: router,
        ),
      ),
    );
    await tester.pumpAndSettle();
    final semantics = tester.ensureSemantics();
    expect(find.bySemanticsLabel(RegExp('^Não lida')), findsNWidgets(2));
    semantics.dispose();

    // Sem link: tocar só marca como lida.
    await tester.tap(find.text('Aviso antigo'));
    await tester.pumpAndSettle();
    expect(read, {4});

    await tester.tap(find.text('Nova reivindicação'));
    await tester.pumpAndSettle();
    expect(read, {3, 4});
    expect(find.text('Caso 1'), findsOneWidget);
  });

  group('tela de entrada', () {
    Future<void> pumpLogin(WidgetTester tester, ApiClient client) async {
      tester.view.physicalSize = const Size(390, 1200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [apiClientProvider.overrideWithValue(client)],
          child: MaterialApp(
            theme: ArgosTheme.light(),
            home: const LoginScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    Finder field(String hint) => find.widgetWithText(TextFormField, hint);

    testWidgets(
      'solicitação de acesso não pede senha e explica o próximo passo',
      (tester) async {
        const answer =
            'Solicitação enviada. Se a administração aprovar, você recebe uma senha temporária por um canal institucional ou pode criar a sua em “Esqueci minha senha” com este e-mail.';
        final api = _client(
          (request) => request.path == '/auth/register'
              ? jsonResponse({'id': 1, 'message': answer}, status: 202)
              : jsonResponse({}, status: 404),
        );
        addTearDown(api.client.dispose);
        await pumpLogin(tester, api.client);

        await tester.tap(find.text('Acesso'));
        await tester.pumpAndSettle();
        expect(field('Senha'), findsNothing);
        expect(find.textContaining('canal institucional'), findsOneWidget);
        await tester.enterText(field('Nome'), 'Carla Lima');
        await tester.enterText(field('E-mail'), 'carla@example.test');
        await tester.enterText(
          field('Justificativa de acesso'),
          'Equipe da portaria do bloco B.',
        );
        await tester.ensureVisible(find.text('Enviar'));
        await tester.tap(find.text('Enviar'));
        await tester.pumpAndSettle();

        final request = api.adapter.requests.single;
        expect(request.path, '/auth/register');
        expect(request.data, {
          'name': 'Carla Lima',
          'email': 'carla@example.test',
          'requestAccess': true,
          'reason': 'Equipe da portaria do bloco B.',
        });
        expect(find.text(answer), findsOneWidget);
      },
    );

    testWidgets('conta bloqueada recebe a explicação do servidor', (
      tester,
    ) async {
      const blocked =
          'Sua conta está bloqueada ou aguardando aprovação. Fale com a administração do ARGOS.';
      final api = _client(
        (request) => jsonResponse({
          'message': blocked,
          'details': {'code': 'account_inactive'},
        }, status: 403),
      );
      addTearDown(api.client.dispose);
      await pumpLogin(tester, api.client);

      await tester.enterText(field('E-mail'), 'bloqueada@example.test');
      await tester.enterText(field('Senha'), 'Senha-Forte-1');
      await tester.tap(find.widgetWithText(FilledButton, 'Entrar'));
      await tester.pumpAndSettle();
      expect(find.text(blocked), findsOneWidget);
    });
  });
}
