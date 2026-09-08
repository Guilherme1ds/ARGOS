import 'package:argos_mobile/app/theme/argos_theme.dart';
import 'package:argos_mobile/app/theme/argos_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('tema ARGOS preserva os tokens principais da web', () {
    final theme = ArgosTheme.light();
    final colors = theme.extension<ArgosColorTokens>()!;

    expect(colors.primary, const Color(0xFF005CA9));
    expect(colors.surface, const Color(0xFFFFFFFF));
    expect(colors.line, const Color(0xFFDBE4EA));
  });
}
