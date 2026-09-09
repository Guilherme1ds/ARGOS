import 'dart:async';
import 'package:argos_mobile/core/network/api_client.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'support/fake_api.dart';

void main() {
  test('restores and rotates a stored native session', () async {
    final store = MemoryStore('argos_refresh=old');
    final dio = Dio(BaseOptions(baseUrl: 'https://test/api'));
    dio.httpClientAdapter = FakeAdapter((request) {
      expect(request.headers['Cookie'], 'argos_refresh=old');
      return jsonResponse(
        sessionBody('new'),
        cookie: 'argos_refresh=rotated; HttpOnly',
      );
    });
    final client = ApiClient(dio: dio, store: store);
    await client.restore();
    await client.refreshSession();
    expect(store.cookie, 'argos_refresh=rotated');
    client.dispose();
  });

  test('concurrent 401 requests share one refresh and both finish', () async {
    final gate = Completer<ResponseBody>();
    var refreshes = 0;
    final dio = Dio(BaseOptions(baseUrl: 'https://test/api'));
    dio.httpClientAdapter = FakeAdapter((request) {
      if (request.path == '/auth/refresh') {
        refreshes++;
        return gate.future;
      }
      if (request.headers['Authorization'] == 'Bearer new') {
        return jsonResponse({'ok': true});
      }
      return jsonResponse({}, status: 401);
    });
    final client = ApiClient(dio: dio, store: MemoryStore('argos_refresh=old'));
    await client.restore();
    final requests = Future.wait([dio.get('/private'), dio.get('/private')]);
    await Future<void>.delayed(const Duration(milliseconds: 30));
    expect(refreshes, 1);
    gate.complete(
      jsonResponse(sessionBody('new'), cookie: 'argos_refresh=new; HttpOnly'),
    );
    final results = await requests.timeout(const Duration(seconds: 2));
    expect(results.every((result) => result.statusCode == 200), true);
    client.dispose();
  });

  test('failed replay completes with an error instead of hanging', () async {
    final dio = Dio(BaseOptions(baseUrl: 'https://test/api'));
    dio.httpClientAdapter = FakeAdapter(
      (request) => request.path == '/auth/refresh'
          ? jsonResponse(sessionBody('new'), cookie: 'argos_refresh=new')
          : jsonResponse(
              {},
              status: request.extra['retry'] == true ? 503 : 401,
            ),
    );
    final client = ApiClient(dio: dio, store: MemoryStore('argos_refresh=old'));
    await client.restore();
    await expectLater(
      dio.get('/private').timeout(const Duration(seconds: 2)),
      throwsA(
        isA<DioException>().having(
          (error) => error.response?.statusCode,
          'status',
          503,
        ),
      ),
    );
    client.dispose();
  });

  test('rejected refresh clears persisted session and notifies auth', () async {
    final store = MemoryStore('argos_refresh=old');
    final dio = Dio(BaseOptions(baseUrl: 'https://test/api'));
    dio.httpClientAdapter = FakeAdapter((_) => jsonResponse({}, status: 401));
    final client = ApiClient(dio: dio, store: store);
    final changes = <Object?>[];
    final listener = client.sessions.listen(changes.add);
    await client.restore();
    await expectLater(client.refreshSession(), throwsA(isA<DioException>()));
    expect(store.cookie, isNull);
    expect(changes, [null]);
    await listener.cancel();
    client.dispose();
  });

  test(
    'network failure preserves refresh credential for another attempt',
    () async {
      final store = MemoryStore('argos_refresh=old');
      final dio = Dio(BaseOptions(baseUrl: 'https://test/api'));
      dio.httpClientAdapter = FakeAdapter(
        (request) => throw DioException(
          requestOptions: request,
          type: DioExceptionType.connectionError,
        ),
      );
      final client = ApiClient(dio: dio, store: store);
      await client.restore();
      await expectLater(client.refreshSession(), throwsA(isA<DioException>()));
      expect(store.cookie, 'argos_refresh=old');
      client.dispose();
    },
  );

  test('late refresh cannot restore a logged out session', () async {
    final gate = Completer<ResponseBody>();
    final started = Completer<void>();
    final store = MemoryStore('argos_refresh=old');
    final dio = Dio(BaseOptions(baseUrl: 'https://test/api'));
    dio.httpClientAdapter = FakeAdapter((request) {
      if (request.path == '/auth/refresh') {
        started.complete();
        return gate.future;
      }
      return jsonResponse({});
    });
    final client = ApiClient(dio: dio, store: store);
    await client.restore();
    final pending = expectLater(
      client.refreshSession(),
      throwsA(isA<DioException>()),
    );
    await started.future;
    await client.logout();
    gate.complete(
      jsonResponse(sessionBody('late'), cookie: 'argos_refresh=late'),
    );
    await pending;
    expect(store.cookie, isNull);
    client.dispose();
  });

  test('offline logout still deletes native credentials', () async {
    final store = MemoryStore('argos_refresh=old');
    final dio = Dio(BaseOptions(baseUrl: 'https://test/api'));
    dio.httpClientAdapter = FakeAdapter(
      (request) => throw DioException(
        requestOptions: request,
        type: DioExceptionType.connectionError,
      ),
    );
    final client = ApiClient(dio: dio, store: store);
    await client.restore();
    await client.logout();
    expect(store.cookie, isNull);
    client.dispose();
  });

  test('user-facing communication errors do not expose API URLs', () {
    final error = DioException(
      requestOptions: RequestOptions(path: '/private'),
      type: DioExceptionType.connectionError,
    );
    expect(apiErrorMessage(error), isNot(contains('localhost')));
    expect(apiErrorMessage(error), contains('conexão'));
  });
}
