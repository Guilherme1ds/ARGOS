import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'router.dart';
import '../features/auth/application/auth_controller.dart';
import 'theme/argos_theme.dart';

class ArgosApp extends ConsumerWidget {
  const ArgosApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(argosRouterProvider);

    return MaterialApp.router(
      title: 'ARGOS',
      debugShowCheckedModeBanner: false,
      theme: ArgosTheme.light(),
      darkTheme: ArgosTheme.dark(),
      themeMode: switch (ref.watch(authControllerProvider).user?.theme) {
        'light' => ThemeMode.light,
        'dark' => ThemeMode.dark,
        _ => ThemeMode.system,
      },
      routerConfig: router,
      locale: const Locale('pt', 'BR'),
      supportedLocales: const [Locale('pt', 'BR')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
    );
  }
}
