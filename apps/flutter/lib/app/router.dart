import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/application/auth_controller.dart';
import '../features/auth/presentation/login_screen.dart';
import '../features/auth/presentation/profile_screen.dart';
import '../features/feed/presentation/home_feed_screen.dart';
import '../features/items/presentation/item_form_screen.dart';
import '../features/shell/presentation/mobile_shell.dart';
import '../features/shell/presentation/placeholder_screen.dart';

final _routerRefreshProvider = Provider<Listenable>((ref) {
  final notifier = ValueNotifier<int>(0);
  ref
    ..listen<AuthState>(authControllerProvider, (_, _) => notifier.value++)
    ..onDispose(notifier.dispose);
  return notifier;
});

final argosRouterProvider = Provider<GoRouter>((ref) {
  final refreshListenable = ref.watch(_routerRefreshProvider);

  return GoRouter(
    initialLocation: '/',
    refreshListenable: refreshListenable,
    redirect: (context, state) {
      final auth = ref.read(authControllerProvider);
      if (auth.checkingSession) return null;

      final path = state.uri.path;
      final isLogin = path == '/login';
      final requiresAuth = _requiresAuth(path);
      final requiresAdmin = path.startsWith('/admin');
      final isAuthenticated = auth.isAuthenticated;
      final isAdmin =
          auth.user?.permissions.contains('platform:admin') ?? false;

      if (!isAuthenticated && requiresAuth) {
        final next = Uri.encodeComponent(state.uri.toString());
        return '/login?next=$next';
      }

      if (isAuthenticated && isLogin) {
        return _safeNext(state.uri.queryParameters['next']) ?? '/dashboard';
      }

      if (isAuthenticated && requiresAdmin && !isAdmin) return '/';

      return null;
    },
    routes: [
      ShellRoute(
        builder: (context, state, child) => MobileShell(child: child),
        routes: [
          GoRoute(
            path: '/',
            name: 'home',
            builder: (context, state) => const HomeFeedScreen(),
          ),
          GoRoute(
            path: '/items',
            name: 'items',
            builder: (context, state) => const PlaceholderScreen(
              icon: Icons.search_rounded,
              title: 'Consulta pública',
              description:
                  'Busca com filtros, lista e mapa será migrada na próxima tela.',
            ),
            routes: [
              GoRoute(
                path: 'new',
                name: 'item-create',
                builder: (context, state) => const ItemFormScreen(),
              ),
              GoRoute(
                path: ':id',
                name: 'item-detail',
                builder: (context, state) => PlaceholderScreen(
                  icon: Icons.shield_outlined,
                  title: 'Detalhes do item',
                  description: 'Caso #${state.pathParameters['id']}',
                ),
              ),
            ],
          ),
          GoRoute(
            path: '/dashboard',
            name: 'dashboard',
            builder: (context, state) => const PlaceholderScreen(
              icon: Icons.dashboard_outlined,
              title: 'Painel de operação',
              description:
                  'Indicadores, volumes e movimentações recentes dos casos.',
            ),
          ),
          GoRoute(
            path: '/my-items',
            name: 'my-items',
            builder: (context, state) => const PlaceholderScreen(
              icon: Icons.assignment_outlined,
              title: 'Meus itens',
              description:
                  'Publicações, reivindicações recebidas e devoluções.',
            ),
          ),
          GoRoute(
            path: '/notifications',
            name: 'notifications',
            builder: (context, state) => const PlaceholderScreen(
              icon: Icons.notifications_none_rounded,
              title: 'Notificações',
              description: 'Pistas, reivindicações e atualizações importantes.',
            ),
          ),
          GoRoute(
            path: '/profile',
            name: 'profile',
            builder: (context, state) => const ProfileScreen(),
          ),
          GoRoute(
            path: '/settings',
            name: 'settings',
            builder: (context, state) => const PlaceholderScreen(
              icon: Icons.settings_outlined,
              title: 'Configurações',
              description:
                  'Idioma, tema, acessibilidade e notificações do ARGOS.',
            ),
          ),
          GoRoute(
            path: '/admin',
            name: 'admin',
            builder: (context, state) => const PlaceholderScreen(
              icon: Icons.admin_panel_settings_outlined,
              title: 'Moderação e gestão',
              description:
                  'Casos, usuários, solicitações de acesso e auditoria.',
            ),
          ),
        ],
      ),
      GoRoute(
        path: '/login',
        name: 'login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/privacy',
        name: 'privacy',
        builder: (context, state) => const PlaceholderScreen(
          icon: Icons.privacy_tip_outlined,
          title: 'Resumo de privacidade',
          description:
              'Como o ARGOS protege dados pessoais e informações sensíveis.',
        ),
      ),
    ],
  );
});

bool _requiresAuth(String path) {
  return path == '/dashboard' ||
      path == '/items/new' ||
      path == '/my-items' ||
      path == '/notifications' ||
      path == '/profile' ||
      path == '/settings' ||
      path.startsWith('/admin');
}

String? _safeNext(String? next) {
  if (next != null && next.startsWith('/') && !next.startsWith('//')) {
    return next;
  }
  return null;
}
