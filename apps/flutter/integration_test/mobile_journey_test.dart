import 'package:argos_mobile/app/argos_app.dart';
import 'package:argos_mobile/core/network/api_client.dart';
import 'package:argos_mobile/features/feed/data/items_repository.dart';
import 'package:argos_mobile/features/items/presentation/items_screen.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import '../test/support/fake_api.dart' show MemoryStore;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('Android: persisted session, search, private claim and return', (
    tester,
  ) async {
    const base = String.fromEnvironment(
      'ARGOS_TEST_API',
      defaultValue: 'http://10.0.2.2:3334/api/v1',
    );
    final owner = ApiClient(
      dio: Dio(BaseOptions(baseUrl: base)),
      store: MemoryStore(),
    );
    final claimant = ApiClient(dio: Dio(BaseOptions(baseUrl: base)));
    final stamp = DateTime.now().microsecondsSinceEpoch
        .toString()
        .split('')
        .map((digit) => String.fromCharCode(97 + int.parse(digit)))
        .join();
    for (final entry in [(owner, 'publicador'), (claimant, 'solicitante')]) {
      await entry.$1.authenticate('/auth/register', {
        'name': 'Teste ${entry.$2}',
        'email': '${entry.$2}.$stamp@example.test',
        'password': 'Only-For-Disposable-Test1',
        'privacyTermsAccepted': true,
      });
    }
    final repository = ItemsRepository(owner);
    final title = 'Chave Android $stamp';
    final id = await repository.create(
      CreateItemPayload(
        type: 'found',
        title: title,
        description: 'Chave encontrada na entrada principal da escola.',
        category: 'Chaves',
        location: 'Campus',
        campusBlock: '',
        approximatePlace: '',
        eventDate: DateTime.now().toIso8601String().substring(0, 10),
        contactPreference: 'in_app',
        imageUrl: '',
      ),
    );
    // Boot a fresh client: access token is absent and must be restored through native storage.
    claimant.dispose();
    final restored = ApiClient(dio: Dio(BaseOptions(baseUrl: base)));
    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(restored)],
        child: const ArgosApp(),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Buscar'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, stamp);
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pumpAndSettle();
    expect(find.byType(ItemTile), findsOneWidget);
    await tester.tap(find.text(title));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Reivindicar item').first);
    await tester.tap(find.text('Reivindicar item').first);
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byType(TextFormField).at(0),
      'Esta chave pode ser minha, perdi hoje.',
    );
    await tester.enterText(
      find.byType(TextFormField).at(1),
      'Existe uma marca circular na parte interna.',
    );
    await tester.ensureVisible(find.text('Confirmar'));
    await tester.tap(find.text('Confirmar'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('Você já enviou uma solicitação'),
      findsOneWidget,
    );
    final claims = await repository.collection('/items/$id/claims');
    expect(claims['data'], hasLength(1));
    await repository.returnItem(id, claims['data'][0]['id'] as int);
    expect(
      (await ItemsRepository(restored).detail(id))['item']['status'],
      'returned',
    );
    await tester.tap(find.byTooltip('Voltar'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Publicar'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byType(TextFormField).at(0),
      'Rascunho Android teste',
    );
    await tester.tap(find.byTooltip('Voltar'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Guardar e sair'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Publicar'));
    await tester.pumpAndSettle();
    expect(find.text('Rascunho Android teste'), findsOneWidget);
    await tester.ensureVisible(find.text('Revisar e publicar'));
    await tester.tap(find.text('Revisar e publicar'));
    await tester.pumpAndSettle();
    expect(find.text('Selecione a categoria.'), findsOneWidget);
    await tester.ensureVisible(
      find.byType(DropdownButtonFormField<String>).at(1),
    );
    await tester.tap(find.byType(DropdownButtonFormField<String>).at(1));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Chaves').last);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byType(TextFormField).at(1));
    await tester.enterText(find.byType(TextFormField).at(1), 'Campus');
    await tester.ensureVisible(find.byType(TextFormField).at(4));
    await tester.enterText(
      find.byType(TextFormField).at(4),
      'Chave perdida no corredor da escola.',
    );
    await tester.ensureVisible(find.text('Revisar e publicar'));
    await tester.tap(find.text('Revisar e publicar'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Confirmar'));
    await tester.pumpAndSettle();
    expect(find.text('Item salvo.'), findsOneWidget);
    final own = await ItemsRepository(restored).collection('/items');
    expect(
      (own['data'] as List).where(
        (row) => row['title'] == 'Rascunho Android teste',
      ),
      hasLength(1),
    );
    await tester.pumpWidget(const SizedBox());
    await restored.logout();
    restored.dispose();
    owner.dispose();
    expect(tester.takeException(), isNull);
  });
}
