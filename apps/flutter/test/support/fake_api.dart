import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:argos_mobile/core/network/session_store.dart';

class MemoryStore implements SessionStore {
  MemoryStore([this.cookie]);
  String? cookie;
  @override
  Future<String?> read() async => cookie;
  @override
  Future<void> write(String? value) async {
    cookie = value;
  }
}

class FakeAdapter implements HttpClientAdapter {
  FakeAdapter(this.respond);
  final FutureOr<ResponseBody> Function(RequestOptions) respond;
  final List<RequestOptions> requests = [];
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? stream,
    Future<void>? cancel,
  ) async {
    requests.add(options);
    return respond(options);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody jsonResponse(Object body, {int status = 200, String? cookie}) =>
    ResponseBody.fromString(
      jsonEncode(body),
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
        if (cookie != null) 'set-cookie': [cookie],
      },
    );
Map<String, dynamic> sessionBody(String token) => {
  'token': token,
  'user': {
    'id': 1,
    'name': 'Ana',
    'email': 'ana@example.test',
    'role': 'citizen',
    'permissions': ['items:create', 'claims:create', 'chat:send'],
  },
};
Map<String, dynamic> itemJson(int id) => {
  'id': id,
  'type': 'found',
  'status': 'found',
  'approval_status': 'approved',
  'title': 'Mochila $id',
  'description': 'Mochila encontrada no corredor da escola.',
  'category': 'Outros',
  'location': 'Campus',
  'event_date': '2026-09-01',
  'created_at': '2026-09-01T12:00:00Z',
  'latest_comments': [],
};
