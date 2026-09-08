import 'package:flutter/material.dart';

import '../../../../app/theme/argos_tokens.dart';

enum MessageTone { success, error }

class MessageBanner extends StatelessWidget {
  const MessageBanner({required this.message, required this.tone, super.key});

  final String message;
  final MessageTone tone;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final background = tone == MessageTone.error
        ? const Color(0xFFFEE2E2)
        : const Color(0xFFE8F6EE);
    final foreground = tone == MessageTone.error
        ? const Color(0xFF991B1B)
        : const Color(0xFF166534);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14.4, vertical: 12),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(ArgosRadius.md),
      ),
      child: Text(
        message,
        style: textTheme.bodyMedium?.copyWith(
          color: foreground,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}
