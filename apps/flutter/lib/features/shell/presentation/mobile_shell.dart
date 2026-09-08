import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme/argos_tokens.dart';
import '../../auth/application/auth_controller.dart';

class MobileShell extends ConsumerWidget {
  const MobileShell({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = context.argosColors;
    final auth = ref.watch(authControllerProvider);
    final path = GoRouterState.of(context).uri.path;
    final profilePath = auth.isAuthenticated ? '/profile' : '/login';
    final destinations = <_Destination>[
      const _Destination(
        '/',
        'Início',
        Icons.home_outlined,
        Icons.home_rounded,
      ),
      const _Destination(
        '/items',
        'Buscar',
        Icons.search_rounded,
        Icons.search_rounded,
      ),
      const _Destination(
        '/items/new',
        'Publicar',
        Icons.add_circle_outline_rounded,
        Icons.add_circle_rounded,
      ),
      const _Destination(
        '/my-items',
        'Meus',
        Icons.assignment_outlined,
        Icons.assignment_rounded,
      ),
      _Destination(
        profilePath,
        auth.isAuthenticated ? 'Perfil' : 'Entrar',
        Icons.person_outline_rounded,
        Icons.person_rounded,
      ),
    ];

    return Scaffold(
      backgroundColor: colors.surface,
      body: SafeArea(bottom: false, child: child),
      bottomNavigationBar: DecoratedBox(
        decoration: BoxDecoration(
          color: colors.surface,
          border: Border(top: BorderSide(color: colors.line)),
        ),
        child: NavigationBar(
          selectedIndex: _selectedIndex(path),
          labelBehavior: NavigationDestinationLabelBehavior.onlyShowSelected,
          onDestinationSelected: (index) =>
              context.go(destinations[index].path),
          destinations: [
            for (final destination in destinations)
              NavigationDestination(
                icon: Icon(destination.icon),
                selectedIcon: Icon(destination.selectedIcon),
                label: destination.label,
              ),
          ],
        ),
      ),
    );
  }

  int _selectedIndex(String path) {
    if (path == '/') return 0;
    if (path.startsWith('/items/new')) return 2;
    if (path.startsWith('/items')) return 1;
    if (path.startsWith('/my-items')) return 3;
    if (path.startsWith('/profile') || path.startsWith('/login')) return 4;
    return 0;
  }
}

class _Destination {
  const _Destination(this.path, this.label, this.icon, this.selectedIcon);

  final String path;
  final String label;
  final IconData icon;
  final IconData selectedIcon;
}
