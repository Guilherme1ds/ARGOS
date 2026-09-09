import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../auth/application/auth_controller.dart';
import '../../items/presentation/account_screens.dart';

class MobileShell extends ConsumerWidget {
  const MobileShell({required this.shell, super.key});
  final StatefulNavigationShell shell;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    final count = ref.watch(unreadProvider).value ?? 0;
    return Scaffold(
      appBar: AppBar(
        title: const Text('ARGOS'),
        actions: [
          if (auth.user != null)
            IconButton(
              tooltip: 'Notificações: $count não lidas',
              icon: Badge(
                isLabelVisible: count > 0,
                label: Text('$count'),
                child: const Icon(Icons.notifications_outlined),
              ),
              onPressed: () async {
                await context.push('/notifications');
                ref.invalidate(unreadProvider);
              },
            ),
          IconButton(
            tooltip: 'Privacidade',
            onPressed: () => context.push('/privacy'),
            icon: const Icon(Icons.privacy_tip_outlined),
          ),
        ],
      ),
      body: SafeArea(child: shell),
      floatingActionButton:
          auth.user == null || auth.user!.permissions.contains('items:create')
          ? FloatingActionButton.extended(
              onPressed: () => context.push(
                auth.user == null ? '/login?next=/items/new' : '/items/new',
              ),
              icon: const Icon(Icons.add),
              label: const Text('Publicar'),
            )
          : null,
      bottomNavigationBar: NavigationBar(
        selectedIndex: shell.currentIndex,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        onDestinationSelected: (index) {
          if (auth.user == null && index >= 2) {
            context.push(
              '/login?next=${index == 2 ? '/my-items' : '/profile'}',
            );
            return;
          }
          shell.goBranch(index);
        },
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            label: 'Início',
          ),
          NavigationDestination(icon: Icon(Icons.search), label: 'Buscar'),
          NavigationDestination(
            icon: Icon(Icons.assignment_outlined),
            label: 'Meus itens',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            label: 'Perfil',
          ),
        ],
      ),
    );
  }
}
