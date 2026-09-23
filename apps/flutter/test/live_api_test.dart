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
      for (final entry in [(owner, 'owner'), (claimant, 'claimant')]) {
        await entry.$1.authenticate('/auth/register', {
          'name': 'Mobile ${entry.$2}',
          'email': '${entry.$2}.$stamp@example.test',
          'password': 'Only-For-Disposable-Test1',
          'privacyTermsAccepted': true,
        });
      }
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
      await otherItems.addComment(
        id,
        'Foi encontrada perto da entrada principal?',
      );
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
      await ownItems.returnItem(id, claims['data'][0]['id'] as int);
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
