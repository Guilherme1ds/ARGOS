import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../features/auth/application/auth_controller.dart';
import '../features/auth/presentation/login_screen.dart';
import '../features/auth/presentation/profile_screen.dart';
import '../features/feed/presentation/home_feed_screen.dart';
import '../features/items/presentation/item_form_screen.dart';
import '../features/items/presentation/item_detail_screen.dart';
import '../features/items/presentation/items_screen.dart';
import '../features/items/presentation/account_screens.dart';
import '../features/shell/presentation/mobile_shell.dart';

final argosRouterProvider = Provider<GoRouter>((ref) {
  final notifier = ValueNotifier(0);
  ref.listen(authControllerProvider, (_, _) => notifier.value++);
  final router = GoRouter(
    initialLocation: '/',
    refreshListenable: notifier,
    redirect: (context, route) {
      final auth = ref.read(authControllerProvider);
      final path = route.uri.path;
      if (auth.checkingSession) return null;
      if (!auth.isAuthenticated && requiresAuth(path)) {
        return '/login?next=${Uri.encodeComponent(route.uri.toString())}';
      }
      if (auth.isAuthenticated && path == '/login') {
        return safeNext(route.uri.queryParameters['next']);
      }
      return null;
    },
    errorBuilder: (context, state) => Scaffold(
      appBar: AppBar(title: const Text('Página não encontrada')),
      body: Center(
        child: FilledButton(
          onPressed: () => context.go('/'),
          child: const Text('Voltar ao início'),
        ),
      ),
    ),
    routes: [
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => MobileShell(shell: shell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(path: '/', builder: (_, _) => const HomeFeedScreen()),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(path: '/items', builder: (_, _) => const ItemsScreen()),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/my-items',
                builder: (_, _) => const SessionGate(child: MyItemsScreen()),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/profile',
                builder: (_, _) => const SessionGate(child: ProfileScreen()),
              ),
            ],
          ),
        ],
      ),
      GoRoute(
        path: '/items/new',
        builder: (_, _) =>
            const SessionGate(child: Scaffold(body: ItemFormScreen())),
      ),
      GoRoute(
        path: '/items/:id/edit',
        builder: (_, state) => SessionGate(
          child: Scaffold(
            body: ItemFormScreen(
              itemId: int.tryParse(state.pathParameters['id'] ?? ''),
            ),
          ),
        ),
      ),
      GoRoute(
        path: '/items/:id',
        builder: (_, state) => ItemDetailScreen(
          id: int.tryParse(state.pathParameters['id'] ?? '') ?? 0,
        ),
      ),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/privacy', builder: (_, _) => const PrivacyScreen()),
      GoRoute(
        path: '/notifications',
        builder: (_, _) => const SessionGate(child: NotificationsScreen()),
      ),
      GoRoute(path: '/settings', redirect: (_, _) => '/profile'),
      GoRoute(path: '/dashboard', redirect: (_, _) => '/my-items'),
    ],
  );
  ref.onDispose(() {
    router.dispose();
    notifier.dispose();
  });
  return router;
});

bool requiresAuth(String path) =>
    path == '/items/new' ||
    path.endsWith('/edit') ||
    [
      '/my-items',
      '/profile',
      '/notifications',
      '/settings',
      '/dashboard',
    ].contains(path);
String safeNext(String? next) {
  final uri = Uri.tryParse(next ?? '');
  if (uri == null ||
      uri.hasScheme ||
      uri.hasAuthority ||
      !uri.path.startsWith('/') ||
      uri.path.startsWith('//') ||
      uri.path.contains('\\') ||
      uri.path == '/login') {
    return '/';
  }
  if (!RegExp(
    r'^/(items(?:/[1-9][0-9]*(?:/edit)?|/new)?|my-items|profile|notifications|privacy)?$',
  ).hasMatch(uri.path)) {
    return '/';
  }
  return uri.toString();
}

class SessionGate extends ConsumerWidget {
  const SessionGate({required this.child, super.key});
  final Widget child;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    if (auth.checkingSession) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (auth.user == null) return const SizedBox.shrink();
    return KeyedSubtree(key: ValueKey(auth.user!.id), child: child);
  }
}
