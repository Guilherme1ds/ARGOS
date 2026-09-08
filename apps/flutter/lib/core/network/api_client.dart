import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final apiClientProvider = Provider<ApiClient>((ref) => ApiClient());

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
}

class ApiClient {
  ApiClient({Dio? dio}) : dio = dio ?? Dio(_baseOptions()) {
    this.dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          final token = _accessToken;
          if (token != null) options.headers['Authorization'] = 'Bearer $token';
          final refreshCookie = _refreshCookie;
          if (refreshCookie != null) options.headers['Cookie'] = refreshCookie;
          handler.next(options);
        },
        onResponse: (response, handler) {
          _storeRefreshCookie(response.headers);
          handler.next(response);
        },
        onError: (error, handler) async {
          _storeRefreshCookie(error.response?.headers);
          final status = error.response?.statusCode;
          final alreadyRetried = error.requestOptions.extra['retry'] == true;
          if (status == 401 &&
              !alreadyRetried &&
              !_isAuthEndpoint(error.requestOptions.path)) {
            final token = await refreshAccessToken();
            if (token != null) {
              final retryOptions = error.requestOptions;
              retryOptions.extra['retry'] = true;
              retryOptions.headers['Authorization'] = 'Bearer $token';
              handler.resolve(await this.dio.fetch<dynamic>(retryOptions));
              return;
            }
          }

          if (status == 401) setAccessToken(null);
          handler.next(error);
        },
      ),
    );
  }

  final Dio dio;
  String? _accessToken;
  String? _refreshCookie;
  Future<String?>? _refreshPromise;

  static BaseOptions _baseOptions() {
    return BaseOptions(
      baseUrl: ArgosApiConfig.apiBaseUrl,
      connectTimeout: const Duration(seconds: 12),
      receiveTimeout: const Duration(seconds: 20),
      headers: const {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    );
  }

  void setAccessToken(String? token) {
    _accessToken = token;
  }

  void clearSession() {
    _accessToken = null;
    _refreshCookie = null;
  }

  Future<String?> refreshAccessToken() {
    _refreshPromise ??= dio
        .post<Map<String, dynamic>>('/auth/refresh')
        .then((response) {
          final token = response.data?['token'] as String?;
          setAccessToken(token);
          return token;
        })
        .catchError((Object _) {
          setAccessToken(null);
          return null;
        })
        .whenComplete(() => _refreshPromise = null);

    return _refreshPromise!;
  }

  String assetUrl(String? url) {
    if (url == null || url.isEmpty) return '';

    final parsed = Uri.tryParse(url);
    final publicBase = Uri.tryParse(ArgosApiConfig.publicBaseUrl);
    if (parsed != null && parsed.hasScheme) {
      if (publicBase == null) return '';
      final sameOrigin =
          parsed.scheme == publicBase.scheme &&
          parsed.host == publicBase.host &&
          parsed.port == publicBase.port;
      return sameOrigin && parsed.path.startsWith('/uploads/')
          ? parsed.toString()
          : '';
    }

    final safeUpload = RegExp(r'^/uploads/[\w.-]+$').hasMatch(url);
    if (!safeUpload) return '';
    return '${ArgosApiConfig.publicBaseUrl.replaceFirst(RegExp(r'/$'), '')}$url';
  }

  void _storeRefreshCookie(Headers? headers) {
    if (headers == null) return;

    final cookies = headers.map['set-cookie'] ?? headers.map['Set-Cookie'];
    if (cookies == null || cookies.isEmpty) return;

    for (final cookie in cookies) {
      final firstPart = cookie.split(';').first.trim();
      if (!firstPart.startsWith('argos_refresh=')) continue;
      final isExpired =
          cookie.toLowerCase().contains('max-age=0') ||
          firstPart == 'argos_refresh=';
      _refreshCookie = isExpired ? null : firstPart;
    }
  }
}

bool _isAuthEndpoint(String path) {
  return path.endsWith('/auth/login') ||
      path.endsWith('/auth/register') ||
      path.endsWith('/auth/refresh') ||
      path.endsWith('/auth/logout');
}

String apiErrorMessage(Object error) {
  if (error is DioException) {
    final data = error.response?.data;
    if (data is Map<String, dynamic>) {
      final validation = _validationMessage(data['errors']);
      if (validation != null && validation.isNotEmpty) return validation;

      final message = data['message'];
      if (message is String && message.isNotEmpty) return message;
    }

    final apiHint = ArgosApiConfig.apiBaseUrl.contains('localhost')
        ? 'o backend está rodando em http://localhost:3333.'
        : 'a API está disponível em ${ArgosApiConfig.apiBaseUrl}.';
    return 'Erro de comunicação. Verifique se $apiHint';
  }

  return 'Erro inesperado.';
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
