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
      final token = response.data?['token'] as String?;
      final userJson = response.data?['user'];
      _api.setAccessToken(token);
      state = AuthState(
        checkingSession: false,
        user: userJson is Map<String, dynamic>
            ? AppUser.fromJson(userJson)
            : null,
      );
    } catch (_) {
      _api.setAccessToken(null);
      state = const AuthState(checkingSession: false);
    }
  }

  Future<void> login(String email, String password) async {
    final response = await _api.dio.post<Map<String, dynamic>>(
      '/auth/login',
      data: {'email': email, 'password': password},
    );
    final token = response.data?['token'] as String?;
    final userJson = response.data?['user'];
    _api.setAccessToken(token);
    state = AuthState(
      checkingSession: false,
      user: userJson is Map<String, dynamic>
          ? AppUser.fromJson(userJson)
          : null,
    );
  }

  Future<void> logout() async {
    try {
      await _api.dio.post<void>('/auth/logout');
    } finally {
      _api.setAccessToken(null);
      state = const AuthState(checkingSession: false);
    }
  }
}
