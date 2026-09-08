import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/argos_tokens.dart';
import '../../data/items_repository.dart';
import '../../domain/item.dart';
import 'argos_avatar.dart';

class CaseMedia extends ConsumerWidget {
  const CaseMedia({
    required this.item,
    required this.onTap,
    this.modal = false,
    super.key,
  });

  final Item item;
  final VoidCallback onTap;
  final bool modal;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = context.argosColors;
    final imageUrl = ref.watch(itemsRepositoryProvider).assetUrl(item.imageUrl);
    final background = modal ? Colors.black : colors.surfaceSoft;
    final foreground = modal ? Colors.white : colors.primary;

    return Material(
      color: background,
      child: InkWell(
        onTap: onTap,
        child: AspectRatio(
          aspectRatio: 1,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: background,
              border: modal
                  ? null
                  : Border(
                      top: BorderSide(color: colors.line),
                      bottom: BorderSide(color: colors.line),
                    ),
            ),
            child: imageUrl.isEmpty
                ? Center(
                    child: Text(
                      initials(item.title),
                      style: Theme.of(context).textTheme.headlineLarge
                          ?.copyWith(
                            color: foreground,
                            fontWeight: FontWeight.w900,
                          ),
                    ),
                  )
                : CachedNetworkImage(
                    imageUrl: imageUrl,
                    fit: modal ? BoxFit.contain : BoxFit.cover,
                    placeholder: (context, url) => Center(
                      child: CircularProgressIndicator(color: foreground),
                    ),
                    errorWidget: (context, url, error) => Center(
                      child: Text(
                        initials(item.title),
                        style: Theme.of(context).textTheme.headlineLarge
                            ?.copyWith(
                              color: foreground,
                              fontWeight: FontWeight.w900,
                            ),
                      ),
                    ),
                  ),
          ),
        ),
      ),
    );
  }
}
