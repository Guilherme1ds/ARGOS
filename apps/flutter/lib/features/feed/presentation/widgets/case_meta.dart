import 'package:flutter/material.dart';

import '../../../../app/theme/argos_tokens.dart';
import '../../../../core/utils/date_formatters.dart';
import '../../domain/item.dart';

class CaseMeta extends StatelessWidget {
  const CaseMeta({required this.item, super.key});

  final Item item;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 7.2,
      runSpacing: 7.2,
      children: [
        _MetaChip(icon: Icons.place_outlined, label: item.location),
        _MetaChip(
          icon: Icons.calendar_today_outlined,
          label: fullDate(item.effectiveDate),
        ),
        _MetaChip(icon: Icons.sell_outlined, label: item.category),
      ],
    );
  }
}

class _MetaChip extends StatelessWidget {
  const _MetaChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = context.argosColors;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9.3, vertical: 5.8),
      decoration: BoxDecoration(
        color: colors.surfaceSoft,
        borderRadius: BorderRadius.circular(ArgosRadius.pill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 15, color: colors.muted),
          const SizedBox(width: 5.6),
          Flexible(
            child: Text(
              label,
              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                color: colors.muted,
                fontSize: 12.5,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
