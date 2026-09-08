import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme/argos_tokens.dart';

class PlaceholderScreen extends StatelessWidget {
  const PlaceholderScreen({
    required this.icon,
    required this.title,
    required this.description,
    super.key,
  });

  final IconData icon;
  final String title;
  final String description;

  @override
  Widget build(BuildContext context) {
    final colors = context.argosColors;
    final textTheme = Theme.of(context).textTheme;

    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [colors.bodyStart, colors.bg, colors.bodyEnd],
        ),
      ),
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(ArgosSpacing.lg),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 448),
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: colors.panelBg,
                border: Border.all(color: colors.line),
                borderRadius: BorderRadius.circular(ArgosRadius.md),
                boxShadow: [
                  BoxShadow(
                    color: colors.shadow,
                    blurRadius: 45,
                    offset: const Offset(0, 18),
                  ),
                ],
              ),
              child: Padding(
                padding: const EdgeInsets.all(ArgosSpacing.xxl),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Image.asset(
                      'assets/images/argos_icon.png',
                      width: 56,
                      height: 56,
                    ),
                    const SizedBox(height: ArgosSpacing.xl),
                    Icon(icon, color: colors.primary, size: 32),
                    const SizedBox(height: ArgosSpacing.md),
                    Text(title, style: textTheme.headlineMedium),
                    const SizedBox(height: ArgosSpacing.sm),
                    Text(
                      description,
                      style: textTheme.bodyMedium?.copyWith(
                        color: colors.muted,
                      ),
                    ),
                    const SizedBox(height: ArgosSpacing.xxl),
                    FilledButton.icon(
                      onPressed: () => context.go('/'),
                      icon: const Icon(Icons.home_outlined),
                      label: const Text('Voltar ao início'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
