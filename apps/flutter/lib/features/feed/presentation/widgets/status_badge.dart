import 'package:flutter/material.dart';

import '../../../../app/theme/argos_tokens.dart';
import '../../domain/item.dart';

class StatusBadge extends StatelessWidget {
  const StatusBadge({required this.status, super.key});

  final ItemStatus status;

  @override
  Widget build(BuildContext context) {
    final pair = _colors(status);
    return Container(
      constraints: const BoxConstraints(minHeight: 28),
      padding: const EdgeInsets.symmetric(horizontal: 9.9, vertical: 4.5),
      decoration: BoxDecoration(
        color: pair.background,
        borderRadius: BorderRadius.circular(ArgosRadius.pill),
      ),
      child: Text(
        statusLabel(status),
        style: Theme.of(context).textTheme.labelMedium?.copyWith(
          color: pair.foreground,
          fontSize: 12,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

({Color background, Color foreground}) _colors(ItemStatus status) {
  return switch (status) {
    ItemStatus.found || ItemStatus.returned => (
      background: const Color(0xFFDCFCE7),
      foreground: const Color(0xFF166534),
    ),
    ItemStatus.lost || ItemStatus.claimed => (
      background: const Color(0xFFFEF3C7),
      foreground: const Color(0xFF92400E),
    ),
  };
}
