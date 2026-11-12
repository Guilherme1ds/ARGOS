import 'package:argos_mobile/app/theme/argos_theme.dart';
import 'package:argos_mobile/core/network/api_client.dart';
import 'package:argos_mobile/features/auth/application/auth_controller.dart';
import 'package:argos_mobile/features/auth/domain/app_user.dart';
import 'package:argos_mobile/features/items/presentation/item_form_screen.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'support/fake_api.dart';

// Achado do teste no emulador (12/11/2026): depois de um envio com erro, as mensagens
// continuavam na tela mesmo com o campo já corrigido, até o próximo envio.

class _SignedIn extends AuthController {
  @override
  AuthState build() => const AuthState(
    checkingSession: false,
    user: AppUser(
      id: 1,
      name: 'Ana',
      email: 'ana@example.test',
      role: 'citizen',
      permissions: ['items:create'],
    ),
  );
}

void main() {
  testWidgets('erros do formulário somem quando cada campo é corrigido', (
    tester,
  ) async {
    FlutterSecureStorage.setMockInitialValues({});
    tester.view.physicalSize = const Size(390, 2600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final dio = Dio(BaseOptions(baseUrl: 'https://test/api/v1'));
    final requests = <String>[];
    dio.httpClientAdapter = FakeAdapter((request) {
      requests.add('${request.method} ${request.path}');
      return jsonResponse({}, status: 500);
    });
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(
            ApiClient(dio: dio, store: MemoryStore()),
          ),
          authControllerProvider.overrideWith(_SignedIn.new),
        ],
        child: MaterialApp(
          theme: ArgosTheme.light(),
          home: const Scaffold(body: ItemFormScreen()),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Revisar e publicar'));
    await tester.pumpAndSettle();
    expect(find.text('Selecione a categoria.'), findsOneWidget);
    expect(find.text('Informe pelo menos 3 caracteres.'), findsOneWidget);
    expect(find.text('Informe pelo menos 2 caracteres.'), findsOneWidget);
    expect(find.text('Informe pelo menos 10 caracteres.'), findsOneWidget);

    // Corrigir um campo tira só a mensagem dele; os outros continuam apontados.
    await tester.enterText(find.byType(TextFormField).at(1), 'Campus');
    await tester.pumpAndSettle();
    expect(find.text('Informe pelo menos 2 caracteres.'), findsNothing);
    expect(find.text('Informe pelo menos 3 caracteres.'), findsOneWidget);
    expect(find.text('Selecione a categoria.'), findsOneWidget);

    await tester.tap(find.byType(DropdownButtonFormField<String>).at(1));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Chaves').last);
    await tester.pumpAndSettle();
    expect(find.text('Selecione a categoria.'), findsNothing);

    // Voltar a deixar o campo inválido mostra a mensagem de novo.
    await tester.enterText(find.byType(TextFormField).at(1), 'C');
    await tester.pumpAndSettle();
    expect(find.text('Informe pelo menos 2 caracteres.'), findsOneWidget);

    // Nada foi enviado: o formulário continua inválido (título e descrição).
    expect(requests.where((line) => line.startsWith('POST')), isEmpty);
    expect(find.text('Revisar publicação'), findsNothing);
    // iOS: no Android a tela consulta o image_picker (foto perdida), canal que não existe no teste.
  }, variant: TargetPlatformVariant.only(TargetPlatform.iOS));
}
