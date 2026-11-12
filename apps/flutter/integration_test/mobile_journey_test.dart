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

// Rola até o widget e espera o quadro seguinte: no aparelho, tocar logo após `ensureVisible`
// usa a posição anterior à rolagem e o toque pode cair fora do botão.
Future<void> reveal(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
}

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
    // Cadastro por senha exige confirmar o e-mail: o link vem da caixa de teste da API descartável.
    final sink = Dio(BaseOptions(baseUrl: base));
    for (final entry in [(owner, 'publicador'), (claimant, 'solicitante')]) {
      final email = '${entry.$2}.$stamp@example.test';
      await entry.$1.dio.post<void>(
        '/auth/register',
        data: {
          'name': 'Teste ${entry.$2}',
          'email': email,
          'password': 'Only-For-Disposable-Test1',
          'privacyTermsAccepted': true,
        },
      );
      final token = (await sink.get<Map<String, dynamic>>(
        '/__test__/mail/latest',
        queryParameters: {'to': email, 'kind': 'verification'},
      )).data!['token'];
      await entry.$1.dio.post<void>(
        '/auth/verify-email',
        data: {'token': token},
      );
      await entry.$1.authenticate('/auth/login', {
        'email': email,
        'password': 'Only-For-Disposable-Test1',
      });
    }
    sink.close();
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
    await reveal(tester, find.text('Reivindicar item').first);
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
    await reveal(tester, find.text('Confirmar'));
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
    // Avisos (SnackBar) de telas anteriores ficam no ScaffoldMessenger raiz e cobrem o rodapé do formulário.
    ScaffoldMessenger.of(
      tester.element(find.text('Revisar e publicar')),
    ).clearSnackBars();
    await tester.pumpAndSettle();
    await reveal(tester, find.text('Revisar e publicar'));
    await tester.tap(find.text('Revisar e publicar'));
    await tester.pumpAndSettle();
    expect(find.text('Selecione a categoria.'), findsOneWidget);
    await reveal(tester, find.byType(DropdownButtonFormField<String>).at(1));
    await tester.tap(find.byType(DropdownButtonFormField<String>).at(1));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Chaves').last);
    await tester.pumpAndSettle();
    expect(find.text('Selecione a categoria.'), findsNothing);
    await reveal(tester, find.byType(TextFormField).at(1));
    await tester.enterText(find.byType(TextFormField).at(1), 'Campus');
    await reveal(tester, find.byType(TextFormField).at(4));
    await tester.enterText(
      find.byType(TextFormField).at(4),
      'Chave perdida no corredor da escola.',
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('Informe pelo menos'), findsNothing);
    // Como uma pessoa faria: fecha o teclado do aparelho antes de ir ao botão no fim do
    // formulário (com o teclado aberto, o campo focado volta à vista e o botão fica sob ele).
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pumpAndSettle();
    await reveal(tester, find.text('Revisar e publicar'));
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
