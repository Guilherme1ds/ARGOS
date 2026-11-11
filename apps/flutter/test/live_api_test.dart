import 'dart:convert';
import 'dart:io';
import 'package:argos_mobile/core/network/api_client.dart';
import 'package:argos_mobile/features/feed/data/items_repository.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'support/fake_api.dart' show MemoryStore;

void main() {
  test(
    'live HTTP: register, photo, publish, search, claim, return and restore session',
    () async {
      // Only run against the disposable server described in README.md.
      HttpOverrides.global = null;
      const base = String.fromEnvironment(
        'ARGOS_TEST_API',
        defaultValue: 'http://localhost:3334/api/v1',
      );
      final ownerStore = MemoryStore();
      final owner = ApiClient(
        dio: Dio(BaseOptions(baseUrl: base)),
        store: ownerStore,
      );
      final claimant = ApiClient(
        dio: Dio(BaseOptions(baseUrl: base)),
        store: MemoryStore(),
      );
      addTearDown(owner.dispose);
      addTearDown(claimant.dispose);
      final stamp = DateTime.now().microsecondsSinceEpoch
          .toString()
          .split('')
          .map((digit) => String.fromCharCode(97 + int.parse(digit)))
          .join();
      // Caixa de teste da API descartável (só NODE_ENV=test + ENABLE_TEST_MAIL_SINK, loopback e e-mails .test).
      final sink = Dio(BaseOptions(baseUrl: base));
      addTearDown(sink.close);
      Future<String> mailToken(String email, String kind) async =>
          (await sink.get<Map<String, dynamic>>(
                '/__test__/mail/latest',
                queryParameters: {'to': email, 'kind': kind},
              )).data!['token']
              as String;
      const password = 'Only-For-Disposable-Test1';
      for (final entry in [(owner, 'owner'), (claimant, 'claimant')]) {
        final email = '${entry.$2}.$stamp@example.test';
        final created = await entry.$1.dio.post<Map<String, dynamic>>(
          '/auth/register',
          data: {
            'name': 'Mobile ${entry.$2}',
            'email': email,
            'password': password,
            'privacyTermsAccepted': true,
          },
        );
        expect(created.statusCode, 201);
        expect(created.data?['verificationRequired'], isTrue);
        // Sem confirmar o e-mail, a senha correta não abre sessão.
        await expectLater(
          entry.$1.authenticate('/auth/login', {
            'email': email,
            'password': password,
          }),
          throwsA(
            isA<DioException>().having(
              (error) => apiErrorCode(error),
              'code',
              'email_unverified',
            ),
          ),
        );
        await entry.$1.dio.post<void>(
          '/auth/verify-email',
          data: {'token': await mailToken(email, 'verification')},
        );
        await entry.$1.authenticate('/auth/login', {
          'email': email,
          'password': password,
        });
      }
      // Recuperação de senha pelo app: a API aceita e envia o link (concluído na web).
      final forgot = await claimant.dio.post<Map<String, dynamic>>(
        '/auth/forgot-password',
        data: {'email': 'claimant.$stamp@example.test'},
      );
      expect(forgot.statusCode, 202);
      expect(
        await mailToken('claimant.$stamp@example.test', 'reset'),
        isNotEmpty,
      );
      // Solicitação de acesso institucional: sem senha, com a explicação do próximo passo.
      final access = await claimant.dio.post<Map<String, dynamic>>(
        '/auth/register',
        data: {
          'name': 'Pedido $stamp',
          'email': 'access.$stamp@example.test',
          'requestAccess': true,
          'reason': 'Equipe do campus',
        },
      );
      expect(access.statusCode, 202);
      expect(access.data?['message'], contains('Esqueci minha senha'));
      final ownItems = ItemsRepository(owner),
          otherItems = ItemsRepository(claimant);
      final image = await ownItems.uploadImage(
        bytes: base64Decode(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQSJgAAAG0ARHcak2KAAAAAElFTkSuQmCC',
        ),
        filename: 'test.png',
        mimeType: 'image/png',
      );
      final payload = CreateItemPayload(
        type: 'found',
        title: 'Chave de integração $stamp',
        description: 'Chave encontrada no corredor para teste de integração.',
        category: 'Chaves',
        location: 'Campus',
        campusBlock: 'A',
        approximatePlace: 'Corredor',
        eventDate: DateTime.now().toIso8601String().substring(0, 10),
        contactPreference: 'in_app',
        imageUrl: image,
      );
      final id = await ownItems.create(
        payload,
        operationKey: 'live-operation-$stamp',
      );
      expect(
        await ownItems.create(payload, operationKey: 'live-operation-$stamp'),
        id,
      );
      final search = await otherItems.search(
        page: 1,
        limit: 20,
        filters: {'q': stamp},
      );
      expect(search.items.map((item) => item.id), contains(id));
      await otherItems.follow(id);
      expect(await otherItems.followedIds(), contains(id));
      final clue = await otherItems.addComment(
        id,
        'Foi encontrada perto da entrada principal?',
      );
      // Quem publicou a pista consegue removê-la (ex.: dado pessoal por engano).
      await otherItems.deleteComment(id, clue.id);
      final clues = await otherItems.collection('/items/$id/comments');
      expect(clues['data'], isEmpty);
      await otherItems.addComment(id, 'Vi uma parecida na secretaria.');

      // Enviar, cancelar e enviar de novo; o responsável recusa e a pessoa reenvia.
      await otherItems.claim(
        id,
        'Acredito que esta chave seja minha.',
        'Possui uma marca específica na parte interna.',
      );
      await otherItems.withdrawClaim(id);
      expect((await otherItems.detail(id))['myClaim'], isNull);
      await otherItems.claim(
        id,
        'Acredito que esta chave seja minha.',
        'Possui uma marca específica na parte interna.',
      );
      final pending = await ownItems.collection('/items/$id/claims');
      final pendingClaim = (pending['data'] as List).firstWhere(
        (row) => row['status'] == 'pending',
      );
      await ownItems.rejectClaim(id, pendingClaim['id'] as int);
      expect((await otherItems.detail(id))['myClaim'], isNull);
      await otherItems.claim(
        id,
        'Acredito que esta chave seja minha.',
        'Possui uma marca específica na parte interna.',
      );
      await expectLater(
        otherItems.claim(
          id,
          'Acredito que esta chave seja minha.',
          'Possui uma marca específica na parte interna.',
        ),
        throwsA(
          isA<DioException>().having(
            (error) => error.response?.statusCode,
            'conflict',
            409,
          ),
        ),
      );
      final claims = await ownItems.collection('/items/$id/claims');
      final openClaim = (claims['data'] as List).firstWhere(
        (row) => row['status'] == 'pending',
      );
      await ownItems.returnItem(id, openClaim['id'] as int);
      expect((await otherItems.detail(id))['item']['status'], 'returned');
      expect((await ownItems.detail(id))['capabilities']['delete'], isFalse);
      Matcher status(int code) => throwsA(
        isA<DioException>().having(
          (error) => error.response?.statusCode,
          'status',
          code,
        ),
      );
      await expectLater(ownItems.delete(id), status(409));

      final removable = await ownItems.create(
        CreateItemPayload(
          type: 'lost',
          title: 'Caderno de integração $stamp',
          description: 'Caderno perdido criado para validar a exclusão.',
          category: 'Materiais escolares',
          location: 'Campus',
          campusBlock: '',
          approximatePlace: '',
          eventDate: DateTime.now().toIso8601String().substring(0, 10),
          contactPreference: 'in_app',
          imageUrl: '',
        ),
      );
      expect(
        (await ownItems.detail(removable))['capabilities']['delete'],
        isTrue,
      );
      await expectLater(otherItems.delete(removable), status(403));
      await ownItems.delete(removable);
      await expectLater(otherItems.detail(removable), status(404));

      final next = ApiClient(
        dio: Dio(BaseOptions(baseUrl: base)),
        store: ownerStore,
      );
      addTearDown(next.dispose);
      await next.restore();
      await next.refreshSession();
      expect(
        (await next.dio.get<Map<String, dynamic>>('/auth/me')).data?['user'],
        isA<Map>(),
      );
      await next.logout();
      expect(ownerStore.cookie, isNull);
    },
    skip: !const bool.fromEnvironment('ARGOS_RUN_LIVE_TESTS'),
    timeout: const Timeout(Duration(seconds: 60)),
  );
}
