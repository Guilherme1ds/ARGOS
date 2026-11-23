import 'package:argos_mobile/app/theme/argos_theme.dart';
import 'package:argos_mobile/core/network/api_client.dart';
import 'package:argos_mobile/features/items/presentation/items_screen.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'support/fake_api.dart';

// Sprint 7 no app: relevância (sem ordenação forçada), facetas com contagem e sinônimos.
void main() {
  testWidgets(
    'facetas mostram contagens, aplicam o filtro e a busca explica os sinônimos',
    (tester) async {
      final dio = Dio(BaseOptions(baseUrl: 'https://test/api/v1'));
      final adapter = FakeAdapter((request) {
        if (request.path == '/spaces') {
          return jsonResponse({
            'data': [
              {
                'id': 4,
                'name': 'Biblioteca',
                'organizationName': 'Campus Centro',
              },
            ],
          });
        }
        return jsonResponse({
          'data': [itemJson(1)],
          'meta': {
            'total': 1,
            'synonyms': (request.queryParameters['q'] ?? '') == 'celular'
                ? ['smartphone', 'telefone']
                : [],
            'facets': {
              'type': [
                {'value': 'found', 'label': 'found', 'count': 1},
                {'value': 'lost', 'label': 'lost', 'count': 3},
              ],
              'status': [],
              'category': [
                {'value': 'outros', 'label': 'Outros', 'count': 4},
              ],
              'space': [
                {
                  'value': '4',
                  'label': 'Biblioteca · Campus Centro',
                  'count': 2,
                },
              ],
              'hasImage': [],
            },
          },
        });
      });
      dio.httpClientAdapter = adapter;
      final client = ApiClient(dio: dio, store: MemoryStore());
      addTearDown(client.dispose);
      tester.view.physicalSize = const Size(390, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [apiClientProvider.overrideWithValue(client)],
          child: MaterialApp(
            theme: ArgosTheme.light(),
            home: const Scaffold(body: ItemsScreen()),
          ),
        ),
      );
      await tester.pumpAndSettle();

      final first = adapter.requests.firstWhere(
        (request) => request.path == '/items/search',
      );
      expect(first.queryParameters.containsKey('sort'), isFalse);
      expect(first.queryParameters['facets'], 'true');
      expect(find.text('Encontrado (1)'), findsOneWidget);
      expect(find.text('Perdido (3)'), findsOneWidget);
      // A faixa de facetas rola na horizontal; o espaço fica depois de tipo e categoria.
      await tester.dragUntilVisible(
        find.text('Biblioteca · Campus Centro (2)'),
        find.byWidgetPredicate(
          (widget) =>
              widget is ListView && widget.scrollDirection == Axis.horizontal,
        ),
        const Offset(-150, 0),
      );
      expect(find.text('Biblioteca · Campus Centro (2)'), findsOneWidget);
      await tester.dragUntilVisible(
        find.text('Perdido (3)'),
        find.byWidgetPredicate(
          (widget) =>
              widget is ListView && widget.scrollDirection == Axis.horizontal,
        ),
        const Offset(150, 0),
      );

      await tester.tap(find.text('Perdido (3)'));
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      expect(adapter.requests.last.queryParameters['type'], 'lost');

      await tester.enterText(find.byType(TextField).first, 'celular');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      expect(adapter.requests.last.queryParameters['q'], 'celular');
      expect(
        find.text('Também buscamos por: smartphone, telefone.'),
        findsOneWidget,
      );
    },
  );
}
