import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/foundation.dart';

import '../../../core/network/api_client.dart';
import '../domain/app_user.dart';
import '../../items/data/draft_store.dart';

final authControllerProvider = NotifierProvider<AuthController, AuthState>(
  AuthController.new,
);

class AuthState {
  const AuthState({
    required this.checkingSession,
    this.user,
    this.sessionError,
  });

  const AuthState.initial() : this(checkingSession: true);

  final bool checkingSession;
  final AppUser? user;
  final String? sessionError;

  bool get isAuthenticated => user != null;

  AuthState copyWith({
    bool? checkingSession,
    AppUser? user,
    bool clearUser = false,
  }) {
    return AuthState(
      checkingSession: checkingSession ?? this.checkingSession,
      user: clearUser ? null : user ?? this.user,
    );
  }
}

class AuthController extends Notifier<AuthState> {
  late final ApiClient _api;

  @override
  AuthState build() {
    _api = ref.watch(apiClientProvider);
    final subscription = _api.sessions.listen((user) {
      if (!ref.mounted) return;
      state = AuthState(
        checkingSession: false,
        user: user == null ? null : AppUser.fromJson(user),
      );
    });
    ref.onDispose(subscription.cancel);
    Future.microtask(checkSession);
    return const AuthState.initial();
  }

  Future<void> checkSession() async {
    final epoch = _api.epoch;
    try {
      await _api.restore();
      if (!ref.mounted || epoch != _api.epoch) return;
      await _api.refreshSession();
      if (ref.mounted && epoch == _api.epoch) {
        state = state.copyWith(checkingSession: false);
      }
    } catch (error) {
      if (ref.mounted && epoch == _api.epoch) {
        state = AuthState(
          checkingSession: false,
          sessionError: apiErrorMessage(error),
        );
      }
    }
  }

  Future<void> login(String email, String password) =>
      _api.authenticate('/auth/login', {'email': email, 'password': password});

  /// Cadastro por senha: a API cria a conta sem sessão e envia um link de
  /// confirmação. A versão do resumo de privacidade aceita é a vigente no
  /// servidor (o app não envia uma versão própria).
  Future<String> register({
    required String name,
    required String email,
    required String password,
    required bool privacyTermsAccepted,
  }) async {
    final response = await _api.dio.post<Map<String, dynamic>>(
      '/auth/register',
      data: {
        'name': name,
        'email': email,
        'password': password,
        'privacyTermsAccepted': privacyTermsAccepted,
      },
    );
    return response.data?['message']?.toString() ??
        'Conta criada. Enviamos um link de confirmação para o seu e-mail; confirme para entrar.';
  }

  /// Reenvia o link de confirmação (a API limita a 1 por minuto por conta).
  Future<String> resendVerification(String email) async {
    final response = await _api.dio.post<Map<String, dynamic>>(
      '/auth/resend-verification',
      data: {'email': email},
    );
    return response.data?['message']?.toString() ??
        'Se houver uma conta aguardando confirmação, enviaremos um novo link.';
  }

  /// Pede o link de redefinição. A nova senha é criada na página web aberta
  /// pelo link do e-mail; o app não recebe nem guarda o token.
  Future<String> requestPasswordReset(String email) async {
    final response = await _api.dio.post<Map<String, dynamic>>(
      '/auth/forgot-password',
      data: {'email': email},
    );
    return response.data?['message']?.toString() ??
        'Se o e-mail estiver cadastrado, enviaremos um link para redefinir a senha.';
  }

  Future<void> updateProfile(Map<String, dynamic> fields) async {
    final response = await _api.dio.patch<Map<String, dynamic>>(
      '/auth/me',
      data: fields,
    );
    if (ref.mounted && response.data?['user'] is Map<String, dynamic>) {
      state = AuthState(
        checkingSession: false,
        user: AppUser.fromJson(response.data!['user']),
      );
    }
  }

  /// Solicitação de acesso institucional: não define senha. Se aprovada, a
  /// administração entrega uma senha temporária ou a pessoa cria a sua por
  /// "Esqueci minha senha".
  Future<String> requestAccess({
    required String name,
    required String email,
    required String reason,
  }) async {
    final response = await _api.dio.post<Map<String, dynamic>>(
      '/auth/register',
      data: {
        'name': name,
        'email': email,
        'requestAccess': true,
        'reason': reason,
      },
    );
    return response.data?['message']?.toString() ??
        'Solicitação enviada para aprovação.';
  }

  Future<void> logout() async {
    try {
      await _api.logout();
    } finally {
      if (!kIsWeb) await DraftStore.clearAll();
    }
  }
}
