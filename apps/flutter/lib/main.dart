import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/argos_app.dart';
import 'core/network/api_client.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    ArgosApiConfig.validate();
  } catch (_) {
    runApp(
      const MaterialApp(
        home: Scaffold(
          body: SafeArea(
            child: Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  'Esta versão do ARGOS não está configurada corretamente. Solicite uma versão atualizada à equipe responsável.',
                ),
              ),
            ),
          ),
        ),
      ),
    );
    return;
  }
  runApp(const ProviderScope(child: ArgosApp()));
}
