import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/feed/presentation/home_feed_screen.dart';
import '../features/shell/presentation/mobile_shell.dart';
import '../features/shell/presentation/placeholder_screen.dart';

final argosRouterProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/',
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
            path: '/items/new',
            name: 'item-create',
            builder: (context, state) => const PlaceholderScreen(
              icon: Icons.add_circle_outline_rounded,
              title: 'Publicar item',
              description:
                  'Wizard de cadastro com foto, local, data e revisão.',
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
            path: '/profile',
            name: 'profile',
            builder: (context, state) => const PlaceholderScreen(
              icon: Icons.person_outline_rounded,
              title: 'Perfil',
              description:
                  'Dados mínimos de confiança e preferências públicas.',
            ),
          ),
        ],
      ),
      GoRoute(
        path: '/login',
        name: 'login',
        builder: (context, state) => const PlaceholderScreen(
          icon: Icons.person_outline_rounded,
          title: 'Entrar',
          description:
              'Login, cadastro e solicitação de acesso entram na próxima iteração.',
        ),
      ),
    ],
  );
});
