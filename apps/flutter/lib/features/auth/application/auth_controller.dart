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
  static const privacyTermsVersion = '2026-08-18';

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
      if (ref.mounted && epoch == _api.epoch)
        state = state.copyWith(checkingSession: false);
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

  Future<void> register({
    required String name,
    required String email,
    required String password,
    required bool privacyTermsAccepted,
  }) => _api.authenticate('/auth/register', {
    'name': name,
    'email': email,
    'password': password,
    'privacyTermsAccepted': privacyTermsAccepted,
    'privacyTermsVersion': privacyTermsVersion,
  });

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

  Future<String> requestAccess({
    required String name,
    required String email,
    required String password,
    required String reason,
  }) async {
    final response = await _api.dio.post<Map<String, dynamic>>(
      '/auth/register',
      data: {
        'name': name,
        'email': email,
        'password': password,
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
