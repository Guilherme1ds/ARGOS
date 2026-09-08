import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../domain/app_user.dart';

final authControllerProvider = NotifierProvider<AuthController, AuthState>(
  AuthController.new,
);

class AuthState {
  const AuthState({required this.checkingSession, this.user});

  const AuthState.initial() : this(checkingSession: true);

  final bool checkingSession;
  final AppUser? user;

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
    unawaited(checkSession());
    return const AuthState.initial();
  }

  Future<void> checkSession() async {
    try {
      final response = await _api.dio.post<Map<String, dynamic>>(
        '/auth/refresh',
      );
      _applySession(response.data);
    } catch (_) {
      _api.clearSession();
      state = const AuthState(checkingSession: false);
    }
  }

  Future<void> login(String email, String password) async {
    final response = await _api.dio.post<Map<String, dynamic>>(
      '/auth/login',
      data: {'email': email, 'password': password},
    );
    _applySession(response.data);
  }

  Future<void> register({
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
        'privacyTermsVersion': privacyTermsVersion,
      },
    );
    _applySession(response.data);
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
      await _api.dio.post<void>('/auth/logout');
    } finally {
      _api.clearSession();
      state = const AuthState(checkingSession: false);
    }
  }

  void _applySession(Map<String, dynamic>? data) {
    final token = data?['token'] as String?;
    final userJson = data?['user'];
    _api.setAccessToken(token);
    state = AuthState(
      checkingSession: false,
      user: userJson is Map<String, dynamic>
          ? AppUser.fromJson(userJson)
          : null,
    );
  }
}
