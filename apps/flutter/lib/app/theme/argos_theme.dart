import 'package:flutter/material.dart';

import 'argos_tokens.dart';

abstract final class ArgosTheme {
  static ThemeData light() => _theme(ArgosColorTokens.light, Brightness.light);

  static ThemeData dark() => _theme(ArgosColorTokens.dark, Brightness.dark);

  static ThemeData _theme(ArgosColorTokens colors, Brightness brightness) {
    final baseTextTheme =
        (brightness == Brightness.dark
                ? ThemeData.dark().textTheme
                : ThemeData.light().textTheme)
            .apply(fontFamily: 'Inter');

    final textTheme = baseTextTheme
        .apply(bodyColor: colors.text, displayColor: colors.text)
        .copyWith(
          headlineLarge: baseTextTheme.headlineLarge?.copyWith(
            color: colors.text,
            fontSize: 34,
            fontWeight: FontWeight.w800,
            height: 1.05,
            letterSpacing: 0,
          ),
          headlineMedium: baseTextTheme.headlineMedium?.copyWith(
            color: colors.text,
            fontSize: 28,
            fontWeight: FontWeight.w800,
            height: 1.12,
            letterSpacing: 0,
          ),
          titleLarge: baseTextTheme.titleLarge?.copyWith(
            color: colors.text,
            fontSize: 20,
            fontWeight: FontWeight.w800,
            height: 1.16,
            letterSpacing: 0,
          ),
          titleMedium: baseTextTheme.titleMedium?.copyWith(
            color: colors.text,
            fontSize: 17.6,
            fontWeight: FontWeight.w800,
            height: 1.25,
            letterSpacing: 0,
          ),
          titleSmall: baseTextTheme.titleSmall?.copyWith(
            color: colors.text,
            fontSize: 14,
            fontWeight: FontWeight.w800,
            height: 1.25,
            letterSpacing: 0,
          ),
          bodyLarge: baseTextTheme.bodyLarge?.copyWith(
            color: colors.text,
            fontSize: 16,
            height: 1.45,
            letterSpacing: 0,
          ),
          bodyMedium: baseTextTheme.bodyMedium?.copyWith(
            color: colors.text,
            fontSize: 14,
            height: 1.38,
            letterSpacing: 0,
          ),
          bodySmall: baseTextTheme.bodySmall?.copyWith(
            color: colors.muted,
            fontSize: 12.5,
            height: 1.35,
            letterSpacing: 0,
          ),
          labelLarge: baseTextTheme.labelLarge?.copyWith(
            color: colors.text,
            fontSize: 14,
            fontWeight: FontWeight.w800,
            letterSpacing: 0,
          ),
          labelMedium: baseTextTheme.labelMedium?.copyWith(
            color: colors.muted,
            fontSize: 12.5,
            fontWeight: FontWeight.w800,
            letterSpacing: 0,
          ),
        );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: ColorScheme(
        brightness: brightness,
        primary: colors.primary,
        onPrimary: Colors.white,
        secondary: colors.accent,
        onSecondary: Colors.white,
        error: colors.danger,
        onError: Colors.white,
        surface: colors.surface,
        onSurface: colors.text,
      ),
      scaffoldBackgroundColor: colors.surface,
      textTheme: textTheme,
      extensions: <ThemeExtension<dynamic>>[colors],
      dividerTheme: DividerThemeData(color: colors.line, thickness: 1),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: colors.inputBg,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 14.4,
          vertical: 12.8,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(ArgosRadius.md),
          borderSide: BorderSide(color: colors.line),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(ArgosRadius.md),
          borderSide: BorderSide(color: colors.line),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(ArgosRadius.md),
          borderSide: BorderSide(color: colors.primary),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(48),
          backgroundColor: colors.primary,
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(ArgosRadius.md),
          ),
          textStyle: textTheme.labelLarge?.copyWith(
            fontWeight: FontWeight.w900,
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(48),
          foregroundColor: colors.text,
          side: BorderSide(color: colors.line),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(ArgosRadius.md),
          ),
          textStyle: textTheme.labelMedium?.copyWith(color: colors.text),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: colors.sidebar,
        contentTextStyle: textTheme.bodyMedium?.copyWith(
          color: Colors.white,
          fontWeight: FontWeight.w700,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(ArgosRadius.md),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        height: 72,
        elevation: 0,
        backgroundColor: colors.surface,
        indicatorColor: colors.surfaceSoft,
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return textTheme.labelMedium?.copyWith(
            color: selected ? colors.primary : colors.muted,
            fontSize: 11.5,
            fontWeight: selected ? FontWeight.w900 : FontWeight.w700,
          );
        }),
        iconTheme: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return IconThemeData(
            color: selected ? colors.primary : colors.text,
            size: 24.8,
          );
        }),
      ),
    );
  }
}
