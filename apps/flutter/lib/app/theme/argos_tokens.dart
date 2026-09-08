import 'package:flutter/material.dart';

@immutable
class ArgosColorTokens extends ThemeExtension<ArgosColorTokens> {
  const ArgosColorTokens({
    required this.bg,
    required this.surface,
    required this.surfaceSoft,
    required this.line,
    required this.text,
    required this.muted,
    required this.primary,
    required this.primaryDark,
    required this.accent,
    required this.danger,
    required this.warning,
    required this.sidebar,
    required this.sidebarText,
    required this.sidebarMuted,
    required this.bodyStart,
    required this.bodyEnd,
    required this.panelBg,
    required this.pillBg,
    required this.inputBg,
    required this.shadow,
  });

  final Color bg;
  final Color surface;
  final Color surfaceSoft;
  final Color line;
  final Color text;
  final Color muted;
  final Color primary;
  final Color primaryDark;
  final Color accent;
  final Color danger;
  final Color warning;
  final Color sidebar;
  final Color sidebarText;
  final Color sidebarMuted;
  final Color bodyStart;
  final Color bodyEnd;
  final Color panelBg;
  final Color pillBg;
  final Color inputBg;
  final Color shadow;

  static const light = ArgosColorTokens(
    bg: Color(0xFFF3F6F8),
    surface: Color(0xFFFFFFFF),
    surfaceSoft: Color(0xFFEEF3F7),
    line: Color(0xFFDBE4EA),
    text: Color(0xFF172033),
    muted: Color(0xFF637083),
    primary: Color(0xFF005CA9),
    primaryDark: Color(0xFF00427A),
    accent: Color(0xFF16A34A),
    danger: Color(0xFFDC2626),
    warning: Color(0xFFD97706),
    sidebar: Color(0xFF0F1F33),
    sidebarText: Color(0xFFE8F1F8),
    sidebarMuted: Color(0xFFA9BDD1),
    bodyStart: Color(0xFFF7FAFC),
    bodyEnd: Color(0xFFEDF4F2),
    panelBg: Color(0xE6FFFFFF),
    pillBg: Color(0xC7FFFFFF),
    inputBg: Color(0xFFFFFFFF),
    shadow: Color(0x1A172033),
  );

  static const dark = ArgosColorTokens(
    bg: Color(0xFF0B1020),
    surface: Color(0xFF141C2F),
    surfaceSoft: Color(0xFF1E293F),
    line: Color(0xFF334155),
    text: Color(0xFFE5EDF6),
    muted: Color(0xFFA9B8CA),
    primary: Color(0xFF5FB3FF),
    primaryDark: Color(0xFF338BDB),
    accent: Color(0xFF34D399),
    danger: Color(0xFFF87171),
    warning: Color(0xFFFBBF24),
    sidebar: Color(0xFF07111F),
    sidebarText: Color(0xFFE6F1FB),
    sidebarMuted: Color(0xFF91A3B7),
    bodyStart: Color(0xFF111827),
    bodyEnd: Color(0xFF0F172A),
    panelBg: Color(0xF0141C2F),
    pillBg: Color(0xDB141C2F),
    inputBg: Color(0xFF0F172A),
    shadow: Color(0x52000000),
  );

  @override
  ArgosColorTokens copyWith({
    Color? bg,
    Color? surface,
    Color? surfaceSoft,
    Color? line,
    Color? text,
    Color? muted,
    Color? primary,
    Color? primaryDark,
    Color? accent,
    Color? danger,
    Color? warning,
    Color? sidebar,
    Color? sidebarText,
    Color? sidebarMuted,
    Color? bodyStart,
    Color? bodyEnd,
    Color? panelBg,
    Color? pillBg,
    Color? inputBg,
    Color? shadow,
  }) {
    return ArgosColorTokens(
      bg: bg ?? this.bg,
      surface: surface ?? this.surface,
      surfaceSoft: surfaceSoft ?? this.surfaceSoft,
      line: line ?? this.line,
      text: text ?? this.text,
      muted: muted ?? this.muted,
      primary: primary ?? this.primary,
      primaryDark: primaryDark ?? this.primaryDark,
      accent: accent ?? this.accent,
      danger: danger ?? this.danger,
      warning: warning ?? this.warning,
      sidebar: sidebar ?? this.sidebar,
      sidebarText: sidebarText ?? this.sidebarText,
      sidebarMuted: sidebarMuted ?? this.sidebarMuted,
      bodyStart: bodyStart ?? this.bodyStart,
      bodyEnd: bodyEnd ?? this.bodyEnd,
      panelBg: panelBg ?? this.panelBg,
      pillBg: pillBg ?? this.pillBg,
      inputBg: inputBg ?? this.inputBg,
      shadow: shadow ?? this.shadow,
    );
  }

  @override
  ArgosColorTokens lerp(ThemeExtension<ArgosColorTokens>? other, double t) {
    if (other is! ArgosColorTokens) return this;
    return ArgosColorTokens(
      bg: Color.lerp(bg, other.bg, t)!,
      surface: Color.lerp(surface, other.surface, t)!,
      surfaceSoft: Color.lerp(surfaceSoft, other.surfaceSoft, t)!,
      line: Color.lerp(line, other.line, t)!,
      text: Color.lerp(text, other.text, t)!,
      muted: Color.lerp(muted, other.muted, t)!,
      primary: Color.lerp(primary, other.primary, t)!,
      primaryDark: Color.lerp(primaryDark, other.primaryDark, t)!,
      accent: Color.lerp(accent, other.accent, t)!,
      danger: Color.lerp(danger, other.danger, t)!,
      warning: Color.lerp(warning, other.warning, t)!,
      sidebar: Color.lerp(sidebar, other.sidebar, t)!,
      sidebarText: Color.lerp(sidebarText, other.sidebarText, t)!,
      sidebarMuted: Color.lerp(sidebarMuted, other.sidebarMuted, t)!,
      bodyStart: Color.lerp(bodyStart, other.bodyStart, t)!,
      bodyEnd: Color.lerp(bodyEnd, other.bodyEnd, t)!,
      panelBg: Color.lerp(panelBg, other.panelBg, t)!,
      pillBg: Color.lerp(pillBg, other.pillBg, t)!,
      inputBg: Color.lerp(inputBg, other.inputBg, t)!,
      shadow: Color.lerp(shadow, other.shadow, t)!,
    );
  }
}

abstract final class ArgosSpacing {
  static const xxs = 4.0;
  static const xs = 6.4;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 20.0;
  static const xxl = 24.0;
  static const xxxl = 32.0;
}

abstract final class ArgosRadius {
  static const xs = 4.0;
  static const md = 8.0;
  static const pill = 999.0;
}

extension ArgosThemeX on BuildContext {
  ArgosColorTokens get argosColors {
    return Theme.of(this).extension<ArgosColorTokens>()!;
  }
}
