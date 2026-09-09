import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'session_store.dart';
import 'browser_config.dart'
    if (dart.library.js_interop) 'browser_config_web.dart';

final apiClientProvider = Provider<ApiClient>((ref) {
  final client = ApiClient();
  ref.onDispose(client.dispose);
  return client;
});

abstract final class ArgosApiConfig {
  static const apiBaseUrl = String.fromEnvironment(
    'ARGOS_API_URL',
    defaultValue: 'http://localhost:3333/api',
  );
  static const publicBaseUrl = String.fromEnvironment(
    'ARGOS_API_PUBLIC_URL',
    defaultValue: 'http://localhost:3333',
  );
  static const webBaseUrl = String.fromEnvironment(
    'ARGOS_WEB_URL',
    defaultValue: 'http://localhost:5173',
  );
  static void validate({bool production = kReleaseMode}) {
    for (final value in [apiBaseUrl, publicBaseUrl, webBaseUrl]) {
      final uri = Uri.tryParse(value);
      if (uri == null ||
          !uri.hasAuthority ||
          !['http', 'https'].contains(uri.scheme) ||
          uri.userInfo.isNotEmpty ||
          (production && (uri.scheme != 'https' || uri.host == 'localhost'))) {
        throw StateError('Configuração de ambiente inválida.');
      }
    }
  }
}

class ApiClient {
  ApiClient({Dio? dio, SessionStore? store})
    : dio =
          dio ??
          Dio(
            BaseOptions(
              baseUrl: ArgosApiConfig.apiBaseUrl,
              connectTimeout: const Duration(seconds: 12),
              sendTimeout: const Duration(seconds: 30),
              receiveTimeout: const Duration(seconds: 20),
              headers: {'Accept': 'application/json'},
            ),
          ),
      store = store ?? SecureSessionStore() {
    configureBrowser(this.dio);
    this.dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          if (options.extra['detached'] != true) {
            options.extra.putIfAbsent('epoch', () => _epoch);
            if (options.extra['epoch'] != _epoch) {
              handler.reject(_cancel(options));
              return;
            }
            if (_accessToken != null) {
              options.headers['Authorization'] = 'Bearer $_accessToken';
            }
            // Only send the refresh cookie to its intended authentication endpoints.
            if (!kIsWeb &&
                _refreshCookie != null &&
                _isAuthEndpoint(options.path)) {
              options.headers['Cookie'] = _refreshCookie;
            }
          }
          handler.next(options);
        },
        onResponse: (response, handler) {
          if (response.requestOptions.extra['detached'] != true &&
              response.requestOptions.extra['epoch'] != _epoch) {
            handler.reject(_cancel(response.requestOptions));
            return;
          }
          handler.next(response);
        },
        onError: (error, handler) async {
          final request = error.requestOptions;
          if (request.extra['detached'] == true) {
            handler.next(error);
            return;
          }
          if (request.extra['epoch'] != _epoch) {
            handler.reject(_cancel(request));
            return;
          }
          if (error.response?.statusCode != 401 ||
              _isAuthEndpoint(request.path)) {
            handler.next(error);
            return;
          }
          try {
            if (request.extra['retry'] != true &&
                (_refreshCookie != null || kIsWeb)) {
              // Another request may already have completed the refresh.
              if (request.headers['Authorization'] == 'Bearer $_accessToken' ||
                  _accessToken == null) {
                await refreshSession();
              }
              if (_accessToken != null && request.extra['epoch'] == _epoch) {
                request.extra['retry'] = true;
                request.headers['Authorization'] = 'Bearer $_accessToken';
                if (request.data is FormData) {
                  request.data = (request.data as FormData).clone();
                }
                handler.resolve(await this.dio.fetch<dynamic>(request));
                return;
              }
            }
            if (request.extra['epoch'] == _epoch) await clearSession();
            handler.next(error);
          } on DioException catch (failure) {
            handler.reject(failure);
          } catch (failure) {
            handler.reject(
              DioException(requestOptions: request, error: failure),
            );
          }
        },
      ),
    );
  }

  final Dio dio;
  final SessionStore store;
  final _sessions = StreamController<Map<String, dynamic>?>.broadcast(
    sync: true,
  );
  Stream<Map<String, dynamic>?> get sessions => _sessions.stream;
  String? _accessToken;
  String? _refreshCookie;
  int _epoch = 0;
  int get epoch => _epoch;
  Future<Map<String, dynamic>?>? _refreshPromise;

  Future<void> restore() async {
    final epoch = _epoch;
    final cookie = await store.read();
    if (epoch == _epoch) _refreshCookie = cookie;
  }

  Future<void> clearSession() async {
    _epoch++;
    _accessToken = null;
    _refreshCookie = null;
    _refreshPromise = null;
    _sessions.add(null);
    await store.write(null);
  }

  Future<void> authenticate(String path, Map<String, dynamic> data) async {
    await clearSession();
    final epoch = _epoch;
    final response = await dio.post<Map<String, dynamic>>(
      path,
      data: data,
      options: Options(extra: {'epoch': epoch}),
    );
    await _commit(response, epoch);
  }

  Future<Map<String, dynamic>?> refreshSession() {
    if (_refreshPromise != null) return _refreshPromise!;
    if (_refreshCookie == null && !kIsWeb) return Future.value(null);
    final epoch = _epoch;
    final pending = () async {
      try {
        final response = await dio.post<Map<String, dynamic>>(
          '/auth/refresh',
          options: Options(extra: {'epoch': epoch}),
        );
        await _commit(response, epoch);
        return response.data;
      } on DioException catch (error) {
        if (epoch == _epoch &&
            [401, 403].contains(error.response?.statusCode)) {
          await clearSession();
        }
        rethrow;
      } finally {
        if (epoch == _epoch) _refreshPromise = null;
      }
    }();
    _refreshPromise = pending;
    return pending;
  }

  Future<void> _commit(
    Response<Map<String, dynamic>> response,
    int epoch,
  ) async {
    if (epoch != _epoch) throw _cancel(response.requestOptions);
    final data = response.data;
    if (data?['token'] is! String ||
        (data!['token'] as String).isEmpty ||
        data['user'] is! Map<String, dynamic>) {
      throw const FormatException('Sessão inválida.');
    }
    if (!kIsWeb) {
      final cookies = response.headers['set-cookie'] ?? [];
      final cookie = cookies
          .map((value) => value.split(';').first.trim())
          .where(
            (value) => value.startsWith('argos_refresh=') && value.length > 14,
          )
          .firstOrNull;
      if (cookie == null) {
        throw const FormatException('Credencial de renovação ausente.');
      }
      await store.write(cookie);
      if (epoch != _epoch) throw _cancel(response.requestOptions);
      _refreshCookie = cookie;
    }
    _accessToken = data['token'] as String;
    _sessions.add(data['user'] as Map<String, dynamic>);
  }

  Future<void> logout() async {
    final cookie = _refreshCookie;
    await clearSession();
    try {
      await dio.post<void>(
        '/auth/logout',
        options: Options(
          extra: {'detached': true},
          headers: !kIsWeb && cookie != null ? {'Cookie': cookie} : null,
        ),
      );
    } on DioException {
      // Local logout is authoritative even when the server cannot be reached.
    }
  }

  String assetUrl(String? url) {
    if (url == null || url.isEmpty) return '';
    final parsed = Uri.tryParse(url);
    final base = Uri.parse(ArgosApiConfig.publicBaseUrl);
    if (parsed == null) return '';
    if (parsed.hasScheme) {
      return parsed.origin == base.origin &&
              RegExp(r'^/uploads/[\w.-]+$').hasMatch(parsed.path)
          ? url
          : '';
    }
    return RegExp(r'^/uploads/[\w.-]+$').hasMatch(url)
        ? '${base.origin}$url'
        : '';
  }

  void dispose() {
    _epoch++;
    dio.close(force: true);
    _sessions.close();
  }
}

DioException _cancel(RequestOptions options) => DioException(
  requestOptions: options,
  type: DioExceptionType.cancel,
  message: 'Operação de uma sessão anterior cancelada.',
);
bool _isAuthEndpoint(String path) => [
  'login',
  'register',
  'refresh',
  'logout',
].any((name) => path.endsWith('/auth/$name'));

String apiErrorMessage(Object error) {
  if (error is DioException) {
    final code = error.response?.statusCode;
    if (code == 401 && error.requestOptions.path.endsWith('/auth/login')) {
      return 'E-mail ou senha incorretos.';
    }
    if (code == 401) {
      return 'Sua sessão expirou. Entre novamente para continuar.';
    }
    if (code == 403) return 'Sua conta não tem permissão para esta ação.';
    if (code == 404) return 'Este conteúdo não está mais disponível.';
    if (code == 413) {
      return 'A foto é muito grande. Selecione uma imagem menor.';
    }
    if (code == 429) {
      return 'Muitas tentativas. Aguarde um pouco antes de tentar novamente.';
    }
    if (code != null && code >= 500) {
      return 'O serviço está indisponível. Tente novamente em alguns instantes.';
    }
    if ([400, 409, 422].contains(code)) {
      final data = error.response?.data;
      if (data is Map<String, dynamic>) {
        return _validationMessage(data['errors']) ??
            data['message']?.toString() ??
            'Revise os dados informados.';
      }
    }
    return switch (error.type) {
      DioExceptionType.cancel => 'Operação cancelada.',
      DioExceptionType.connectionTimeout ||
      DioExceptionType.sendTimeout ||
      DioExceptionType.receiveTimeout =>
        'A resposta demorou mais que o esperado. Verifique o resultado antes de enviar novamente.',
      _ =>
        'Não foi possível conectar. Verifique sua conexão e tente novamente.',
    };
  }
  return 'Não foi possível concluir a operação. Tente novamente.';
}

String? _validationMessage(Object? errors) {
  if (errors is! Map<String, dynamic>) return null;
  final fieldErrors = errors['fieldErrors'];
  if (fieldErrors is Map<String, dynamic>) {
    for (final entry in fieldErrors.entries) {
      final messages = entry.value;
      if (messages is List && messages.isNotEmpty) {
        return '${_fieldLabels[entry.key] ?? entry.key}: ${messages.first}';
      }
    }
  }

  final formErrors = errors['formErrors'];
  if (formErrors is List && formErrors.isNotEmpty) {
    return formErrors.first.toString();
  }
  return null;
}

const _fieldLabels = <String, String>{
  'name': 'Nome',
  'nickname': 'Nickname',
  'email': 'E-mail',
  'password': 'Senha',
  'type': 'Tipo',
  'title': 'Título',
  'description': 'Descrição',
  'category': 'Categoria',
  'location': 'Local',
  'campusBlock': 'Bloco do campus',
  'approximatePlace': 'Ponto aproximado',
  'eventDate': 'Data',
  'imageUrl': 'Imagem',
  'contactPreference': 'Preferência de contato',
  'message': 'Mensagem',
  'proofDetails': 'Provas',
  'privacyTermsAccepted': 'Privacidade',
  'avatarUrl': 'Foto',
  'phone': 'Telefone',
  'department': 'Setor ou turma',
  'bio': 'Bio',
  'preferredContact': 'Contato preferido',
  'language': 'Idioma',
  'theme': 'Tema',
  'timezone': 'Fuso horário',
  'dateFormat': 'Formato de data',
  'compactMode': 'Modo compacto',
  'highContrast': 'Alto contraste',
  'notificationPreferences': 'Notificações',
};
