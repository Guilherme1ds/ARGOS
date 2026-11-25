import 'package:argos_mobile/app/theme/argos_theme.dart';
import 'package:argos_mobile/core/network/api_client.dart';
import 'package:argos_mobile/features/auth/application/auth_controller.dart';
import 'package:argos_mobile/features/auth/domain/app_user.dart';
import 'package:argos_mobile/features/chat/presentation/chat_screens.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'support/fake_api.dart';

// Sprint 6: conversa privada por caso, com regras automáticas de moderação no servidor.

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

Map<String, dynamic> _conversation({String status = 'open'}) => {
  'id': 3,
  'status': status,
  'closedByMe': false,
  'role': 'participant',
  'item': {
    'id': 9,
    'title': 'Guarda-chuva azul',
    'type': 'found',
    'status': 'found',
  },
  'counterpart': {'nickname': 'quem.achou'},
  'lastReadId': 0,
  'unread': 0,
  'lastMessage': null,
};

Map<String, dynamic> _message(
  int id,
  String body, {
  bool mine = false,
  String? safety,
}) => {
  'id': id,
  'conversation_id': 3,
  'mine': mine,
  'body': body,
  'removed': false,
  'safetyNotice': safety,
  'created_at': '2026-11-17 14:00:00',
};

Future<FakeAdapter> _pumpChat(
  WidgetTester tester,
  ResponseBody Function(RequestOptions) respond,
) async {
  tester.view.physicalSize = const Size(390, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final dio = Dio(BaseOptions(baseUrl: 'https://test/api/v1'));
  final adapter = FakeAdapter(respond);
  dio.httpClientAdapter = adapter;
  final client = ApiClient(dio: dio, store: MemoryStore());
  addTearDown(client.dispose);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(client),
        authControllerProvider.overrideWith(_SignedIn.new),
      ],
      child: MaterialApp(
        theme: ArgosTheme.light(),
        home: const ChatScreen(conversationId: 3),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return adapter;
}

void main() {
  testWidgets(
    'mostra a conversa, envia mensagem e explica o bloqueio sem perder o texto',
    (tester) async {
      final adapter = await _pumpChat(tester, (request) {
        if (request.path == '/conversations/3/messages' &&
            request.method == 'GET') {
          return jsonResponse({
            'conversation': _conversation(),
            'data': request.queryParameters['after'] == null
                ? [_message(1, 'Achei perto da biblioteca.', safety: null)]
                : [],
          });
        }
        if (request.path == '/conversations/3/messages' &&
            request.method == 'POST') {
          final body = (request.data as Map)['body'] as String;
          if (body.contains('https://')) {
            return jsonResponse({
              'message':
                  'Links externos não são permitidos aqui. Descreva a informação em texto.',
              'details': {'code': 'content_blocked', 'rule': 'external_link'},
            }, status: 422);
          }
          return jsonResponse({
            'message': _message(2, body, mine: true),
          }, status: 201);
        }
        return jsonResponse({}, status: 404);
      });

      expect(find.text('Guarda-chuva azul'), findsOneWidget);
      expect(find.text('Achei perto da biblioteca.'), findsOneWidget);
      expect(
        find.textContaining('Conversa privada e moderada'),
        findsOneWidget,
      );

      await tester.enterText(
        find.byType(TextField),
        'É meu, tem uma fita no cabo.',
      );
      await tester.tap(find.byTooltip('Enviar'));
      await tester.pumpAndSettle();
      expect(find.text('É meu, tem uma fita no cabo.'), findsOneWidget);
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        isEmpty,
      );

      await tester.enterText(
        find.byType(TextField),
        'Foto em https://exemplo.com/a',
      );
      await tester.tap(find.byTooltip('Enviar'));
      await tester.pumpAndSettle();
      expect(
        find.text(
          'Links externos não são permitidos aqui. Descreva a informação em texto.',
        ),
        findsOneWidget,
      );
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        'Foto em https://exemplo.com/a',
      );
      expect(
        adapter.requests
            .where((request) => request.method == 'POST')
            .map((request) => request.path),
        ['/conversations/3/messages', '/conversations/3/messages'],
      );
    },
  );

  testWidgets(
    'mensagem que chegou um instante antes do envio aparece na consulta seguinte, em ordem',
    (tester) async {
      final adapter = await _pumpChat(tester, (request) {
        if (request.path == '/conversations/3/messages' &&
            request.method == 'GET') {
          final after = request.queryParameters['after']?.toString();
          return jsonResponse({
            'conversation': _conversation(),
            'data': switch (after) {
              null => [_message(1, 'Achei perto da biblioteca.')],
              // Mensagem 2 foi gravada logo antes da enviada (3): só uma consulta a partir de 1 a encontra.
              '1' => [
                _message(2, 'Tem uma fita no cabo?'),
                _message(3, 'É meu, é azul.', mine: true),
              ],
              _ => <Map<String, dynamic>>[],
            },
          });
        }
        if (request.path == '/conversations/3/messages' &&
            request.method == 'POST') {
          return jsonResponse({
            'message': _message(3, 'É meu, é azul.', mine: true),
          }, status: 201);
        }
        return jsonResponse({}, status: 404);
      });

      await tester.enterText(find.byType(TextField), 'É meu, é azul.');
      await tester.tap(find.byTooltip('Enviar'));
      await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds: 6));
      await tester.pumpAndSettle();

      final polls = adapter.requests
          .where(
            (request) =>
                request.method == 'GET' &&
                request.path == '/conversations/3/messages',
          )
          .map((request) => request.queryParameters['after']?.toString())
          .toList();
      expect(polls, [null, '1']);
      expect(find.text('Tem uma fita no cabo?'), findsOneWidget);
      expect(find.text('É meu, é azul.'), findsOneWidget);
      expect(
        tester.getTopLeft(find.text('Tem uma fita no cabo?')).dy,
        lessThan(tester.getTopLeft(find.text('É meu, é azul.')).dy),
      );
    },
  );

  testWidgets('aviso de segurança, denúncia e conversa encerrada', (
    tester,
  ) async {
    final adapter = await _pumpChat(tester, (request) {
      if (request.path == '/conversations/3/messages') {
        return jsonResponse({
          'conversation': _conversation(status: 'closed'),
          'data': request.queryParameters['after'] == null
              ? [
                  _message(
                    1,
                    'Mande um pix de 20 reais.',
                    safety: 'payment_request',
                  ),
                ]
              : [],
        });
      }
      if (request.path == '/conversations/3/messages/1/report') {
        return jsonResponse({
          'message': 'Denúncia enviada para a moderação.',
        }, status: 201);
      }
      return jsonResponse({}, status: 404);
    });

    expect(
      find.textContaining('O ARGOS não cobra pela devolução'),
      findsOneWidget,
    );
    expect(find.text('A outra pessoa encerrou esta conversa.'), findsOneWidget);
    expect(find.byType(TextField), findsNothing);

    await tester.tap(find.byTooltip('Denunciar mensagem'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Denunciar'));
    await tester.pumpAndSettle();
    expect(
      adapter.requests.any(
        (request) => request.path == '/conversations/3/messages/1/report',
      ),
      isTrue,
    );
    expect(find.text('Denúncia enviada para a moderação.'), findsOneWidget);
  });
}
