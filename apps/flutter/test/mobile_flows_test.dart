import 'dart:async';
import 'package:intl/date_symbol_data_local.dart';
import 'package:argos_mobile/app/router.dart';
import 'package:argos_mobile/app/theme/argos_theme.dart';
import 'package:argos_mobile/core/network/api_client.dart';
import 'package:argos_mobile/features/auth/application/auth_controller.dart';
import 'package:argos_mobile/features/auth/domain/app_user.dart';
import 'package:argos_mobile/features/feed/application/feed_controller.dart';
import 'package:argos_mobile/features/feed/data/items_repository.dart';
import 'package:argos_mobile/features/feed/domain/item.dart';
import 'package:argos_mobile/features/items/presentation/items_screen.dart';
import 'package:argos_mobile/features/items/presentation/item_detail_screen.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'support/fake_api.dart';
import 'package:argos_mobile/features/feed/presentation/home_feed_screen.dart';
import 'package:argos_mobile/features/feed/presentation/widgets/case_post_card.dart';

class TestAuth extends AuthController {
  @override
  AuthState build() => const AuthState(
    checkingSession: false,
    user: AppUser(
      id: 1,
      name: 'Ana',
      email: 'ana@example.test',
      role: 'citizen',
      permissions: ['chat:send', 'items:create'],
    ),
  );
}

class ControlledRepository extends ItemsRepository {
  ControlledRepository(super.api);
  Completer<PaginatedItems>? pageTwo;
  Completer<void>? failingFollow;
  int follows = 0;
  @override
  Future<PaginatedItems> search({
    required int page,
    required int limit,
    Map<String, dynamic> filters = const {},
    CancelToken? cancelToken,
  }) async {
    if (page == 2 && pageTwo != null) return pageTwo!.future;
    return PaginatedItems(
      items: [Item.fromJson(itemJson(1)), Item.fromJson(itemJson(2))],
      total: 20,
    );
  }

  @override
  Future<Set<int>> followedIds() async => {};
  @override
  Future<void> follow(int itemId) async {
    follows++;
    if (itemId == 1 && failingFollow != null) await failingFollow!.future;
  }
}

class LargeFeed extends FeedController {
  @override
  Future<FeedState> build() async => FeedState(
    items: List.generate(200, (index) => Item.fromJson(itemJson(index + 1))),
    page: 1,
    hasMore: false,
  );
}

void main() {
  setUpAll(() => initializeDateFormatting('pt_BR'));
  test('redirect only accepts known internal destinations', () {
    expect(safeNext('/items/12'), '/items/12');
    for (final target in [
      'https://example.test',
      '//example.test',
      '/login',
      '/admin',
      '/\\evil',
      '/items/0',
    ]) {
      expect(safeNext(target), '/');
    }
    expect(requiresAuth('/items/new'), true);
    expect(requiresAuth('/items/12'), false);
  });

  test(
    'pagination preserves mutations and deduplicates overlapping item IDs',
    () async {
      final client = ApiClient(store: MemoryStore());
      final repository = ControlledRepository(client)..pageTwo = Completer();
      final container = ProviderContainer(
        overrides: [
          apiClientProvider.overrideWithValue(client),
          authControllerProvider.overrideWith(TestAuth.new),
          itemsRepositoryProvider.overrideWithValue(repository),
        ],
      );
      addTearDown(() {
        container.dispose();
        client.dispose();
      });
      await container.read(feedControllerProvider.future);
      final controller = container.read(feedControllerProvider.notifier);
      final more = controller.loadMore();
      await controller.toggleFollow(Item.fromJson(itemJson(2)));
      repository.pageTwo!.complete(
        PaginatedItems(
          items: [Item.fromJson(itemJson(2)), Item.fromJson(itemJson(3))],
          total: 20,
        ),
      );
      await more;
      final state = container.read(feedControllerProvider).value!;
      expect(state.followedIds, {2});
      expect(state.items.map((item) => item.id), [1, 2, 3]);
    },
  );

  test(
    'follow rollback affects only failed item and ignores a double tap',
    () async {
      final client = ApiClient(store: MemoryStore());
      final repository = ControlledRepository(client)
        ..failingFollow = Completer();
      final container = ProviderContainer(
        overrides: [
          apiClientProvider.overrideWithValue(client),
          authControllerProvider.overrideWith(TestAuth.new),
          itemsRepositoryProvider.overrideWithValue(repository),
        ],
      );
      addTearDown(() {
        container.dispose();
        client.dispose();
      });
      await container.read(feedControllerProvider.future);
      final controller = container.read(feedControllerProvider.notifier);
      final first = expectLater(
        controller.toggleFollow(Item.fromJson(itemJson(1))),
        throwsA(isA<StateError>()),
      );
      await controller.toggleFollow(Item.fromJson(itemJson(1)));
      await controller.toggleFollow(Item.fromJson(itemJson(2)));
      repository.failingFollow!.completeError(StateError('offline'));
      await first;
      expect(repository.follows, 2);
      expect(container.read(feedControllerProvider).value!.followedIds, {2});
    },
  );

  test('refresh discards stale pagination', () async {
    final client = ApiClient(store: MemoryStore());
    final repository = ControlledRepository(client)..pageTwo = Completer();
    final container = ProviderContainer(
      overrides: [
        apiClientProvider.overrideWithValue(client),
        authControllerProvider.overrideWith(TestAuth.new),
        itemsRepositoryProvider.overrideWithValue(repository),
      ],
    );
    addTearDown(() {
      container.dispose();
      client.dispose();
    });
    await container.read(feedControllerProvider.future);
    final controller = container.read(feedControllerProvider.notifier);
    final more = controller.loadMore();
    await controller.refreshFeed();
    repository.pageTwo!.complete(
      PaginatedItems(items: [Item.fromJson(itemJson(99))], total: 20),
    );
    await more;
    expect(
      container
          .read(feedControllerProvider)
          .value!
          .items
          .map((item) => item.id),
      [1, 2],
    );
  });

  testWidgets('200-item feed builds only visible cards and fits large text', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          feedControllerProvider.overrideWith(LargeFeed.new),
          authControllerProvider.overrideWith(TestAuth.new),
        ],
        child: MaterialApp(
          theme: ArgosTheme.light(),
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(2)),
            child: child!,
          ),
          home: const Scaffold(body: HomeFeedScreen()),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byType(CasePostCard).evaluate().length, lessThan(10));
    await tester.drag(find.byType(ListView).first, const Offset(0, -1800));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'search debounces input, renders empty result and retries failures',
    (tester) async {
      var fail = false;
      final dio = Dio();
      final adapter = FakeAdapter(
        (_) => fail
            ? jsonResponse({}, status: 503)
            : jsonResponse({
                'data': [],
                'meta': {'total': 0},
              }),
      );
      dio.httpClientAdapter = adapter;
      final client = ApiClient(dio: dio, store: MemoryStore());
      addTearDown(client.dispose);
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
      expect(find.textContaining('Nenhum item encontrado'), findsOneWidget);
      await tester.enterText(find.byType(TextField).first, 'mo');
      await tester.pump(const Duration(milliseconds: 100));
      await tester.enterText(find.byType(TextField).first, 'mochila');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      expect(adapter.requests.last.queryParameters['q'], 'mochila');
      expect(adapter.requests.length, 2);
      fail = true;
      await tester.enterText(find.byType(TextField).first, 'chave');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      expect(find.textContaining('serviço está indisponível'), findsOneWidget);
      fail = false;
      await tester.tap(find.text('Tentar novamente'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Nenhum item encontrado'), findsOneWidget);
    },
  );

  testWidgets(
    'private action validates and preserves fields on server failure',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ActionForm(
              title: 'Reivindicar',
              fields: const [
                ActionField('proof', 'Provas', min: 10, max: 1000),
              ],
              submit: (_) async => throw StateError('offline'),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Confirmar'));
      await tester.pump();
      expect(find.textContaining('pelo menos 10'), findsOneWidget);
      await tester.enterText(
        find.byType(TextFormField),
        'Detalhes privados suficientes',
      );
      await tester.tap(find.text('Confirmar'));
      await tester.pumpAndSettle();
      expect(find.text('Detalhes privados suficientes'), findsOneWidget);
      expect(find.textContaining('Não foi possível concluir'), findsOneWidget);
    },
  );

  testWidgets('disposing a pending action does not access disposed state', (
    tester,
  ) async {
    final gate = Completer<void>();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ActionForm(
            title: 'Pista',
            fields: const [ActionField('body', 'Texto')],
            submit: (_) => gate.future,
          ),
        ),
      ),
    );
    await tester.tap(find.text('Confirmar'));
    await tester.pump();
    await tester.pumpWidget(const SizedBox());
    gate.complete();
    await tester.pump();
    expect(tester.takeException(), isNull);
  });

  for (final size in [const Size(320, 640), const Size(640, 320)]) {
    testWidgets('details fit $size with 200% text and keyboard inset', (
      tester,
    ) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final dio = Dio();
      dio.httpClientAdapter = FakeAdapter(
        (request) => request.path.endsWith('/comments')
            ? jsonResponse({
                'data': [],
                'meta': {'total': 0},
              })
            : jsonResponse({
                'item': itemJson(1),
                'capabilities': {},
                'history': [],
                'myClaim': null,
              }),
      );
      final client = ApiClient(dio: dio, store: MemoryStore());
      addTearDown(client.dispose);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            apiClientProvider.overrideWithValue(client),
            authControllerProvider.overrideWith(TestAuth.new),
          ],
          child: MaterialApp(
            theme: ArgosTheme.light(),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(
                textScaler: const TextScaler.linear(2),
                viewInsets: const EdgeInsets.only(bottom: 120),
              ),
              child: child!,
            ),
            home: const ItemDetailScreen(id: 1),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.drag(find.byType(ListView).first, const Offset(0, -1500));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  }
}
