import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/theme/argos_tokens.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/utils/date_formatters.dart';
import '../../../auth/application/auth_controller.dart';
import '../../application/feed_controller.dart';
import '../../data/items_repository.dart';
import '../../domain/item.dart';
import 'argos_avatar.dart';
import 'case_media.dart';
import 'case_meta.dart';
import 'comment_composer.dart';
import 'status_badge.dart';

class CasePostCard extends ConsumerWidget {
  const CasePostCard({required this.item, required this.onMessage, super.key});

  final Item item;
  final ValueChanged<String> onMessage;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = context.argosColors;
    final textTheme = Theme.of(context).textTheme;
    final auth = ref.watch(authControllerProvider);
    final state = ref.watch(feedControllerProvider).value;
    final avatarUrl = ref
        .watch(itemsRepositoryProvider)
        .assetUrl(item.ownerAvatarUrl);
    final comments = item.latestComments;
    final visibleComments = comments.length <= 2
        ? comments
        : comments.sublist(comments.length - 2);

    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surface,
        border: Border(bottom: BorderSide(color: colors.line)),
      ),
      child: Padding(
        padding: const EdgeInsets.only(bottom: 20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      ArgosAvatar(
                        label: item.authorHandle,
                        imageUrl: avatarUrl,
                        size: 40,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: InkWell(
                          onTap: () => _openDetails(context),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '@${item.authorHandle}',
                                style: textTheme.titleSmall,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                              Text(
                                relativeDate(item.effectiveDate),
                                style: textTheme.bodySmall,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  StatusBadge(status: item.status),
                ],
              ),
            ),
            const SizedBox(height: ArgosSpacing.md),
            CaseMedia(item: item, onTap: () => _openDetails(context)),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 11.2),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const SizedBox(height: ArgosSpacing.md),
                  Text(item.title, style: textTheme.titleMedium),
                  const SizedBox(height: 4),
                  Text(item.description, style: textTheme.bodyMedium),
                  const SizedBox(height: ArgosSpacing.md),
                  CaseMeta(item: item),
                  const SizedBox(height: ArgosSpacing.md),
                  FilledButton.icon(
                    onPressed: () =>
                        _goToPrimaryAction(context, auth.isAuthenticated),
                    icon: const Icon(Icons.verified_user_outlined, size: 18),
                    label: Text(_actionLabel(auth.isAuthenticated)),
                  ),
                  const SizedBox(height: ArgosSpacing.sm),
                  _CaseActions(
                    item: item,
                    followed: state?.followedIds.contains(item.id) ?? false,
                    reporting: state?.reportingIds.contains(item.id) ?? false,
                    onViewDetails: () => _openDetails(context),
                    onMessage: onMessage,
                  ),
                  const SizedBox(height: ArgosSpacing.md),
                  _PrivacyNote(),
                  if (item.commentsCount > comments.length) ...[
                    const SizedBox(height: ArgosSpacing.sm),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: TextButton(
                        onPressed: () => _openDetails(context),
                        style: TextButton.styleFrom(
                          foregroundColor: colors.muted,
                          padding: EdgeInsets.zero,
                          minimumSize: const Size(48, 40),
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          textStyle: textTheme.labelMedium?.copyWith(
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        child: Text(
                          'Ver todas as ${item.commentsCount} pistas',
                        ),
                      ),
                    ),
                  ],
                  for (final comment in visibleComments) ...[
                    const SizedBox(height: ArgosSpacing.xs),
                    Text.rich(
                      TextSpan(
                        children: [
                          TextSpan(
                            text: '@${comment.handle} ',
                            style: const TextStyle(fontWeight: FontWeight.w800),
                          ),
                          TextSpan(text: comment.body),
                        ],
                      ),
                      style: textTheme.bodyMedium,
                    ),
                  ],
                  const SizedBox(height: ArgosSpacing.sm),
                  CommentComposer(
                    item: item,
                    compact: true,
                    onMessage: onMessage,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _actionLabel(bool authenticated) {
    if (item.status == ItemStatus.returned) return 'Caso resolvido';
    if (!authenticated) {
      return item.type == ItemType.found
          ? 'Entrar para reivindicar'
          : 'Entrar para enviar informação';
    }
    return item.type == ItemType.found
        ? 'Reivindicar item'
        : 'Tenho informação';
  }

  void _goToPrimaryAction(BuildContext context, bool authenticated) {
    if (item.status == ItemStatus.returned || authenticated) {
      context.push('/items/${item.id}');
    } else {
      context.go('/login?next=/items/${item.id}');
    }
  }

  void _openDetails(BuildContext context) {
    context.push('/items/${item.id}');
  }
}

class _CaseActions extends ConsumerWidget {
  const _CaseActions({
    required this.item,
    required this.followed,
    required this.reporting,
    required this.onViewDetails,
    required this.onMessage,
  });

  final Item item;
  final bool followed;
  final bool reporting;
  final VoidCallback onViewDetails;
  final ValueChanged<String> onMessage;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);

    return GridView.count(
      shrinkWrap: true,
      crossAxisCount: MediaQuery.textScalerOf(context).scale(1) > 1.4 ? 1 : 2,
      mainAxisSpacing: 6.4,
      crossAxisSpacing: 6.4,
      mainAxisExtent: MediaQuery.textScalerOf(context).scale(1) > 1.4 ? 80 : 56,
      physics: const NeverScrollableScrollPhysics(),
      children: [
        _CaseActionButton(
          active: followed,
          busy:
              ref
                  .watch(feedControllerProvider)
                  .value
                  ?.followingIds
                  .contains(item.id) ??
              false,
          icon: followed
              ? Icons.check_circle_outline_rounded
              : Icons.bookmark_border_rounded,
          label: followed ? 'Acompanhando' : 'Acompanhar caso',
          onTap: () async {
            if (!auth.isAuthenticated) {
              onMessage('Entre para acompanhar este caso.');
              return;
            }
            try {
              onMessage(
                await ref
                    .read(feedControllerProvider.notifier)
                    .toggleFollow(item),
              );
            } catch (error) {
              onMessage(apiErrorMessage(error));
            }
          },
        ),
        _CaseActionButton(
          icon: Icons.mode_comment_outlined,
          label: 'Pistas',
          onTap: onViewDetails,
        ),
        _CaseActionButton(
          icon: Icons.content_copy_rounded,
          label: 'Copiar link',
          onTap: () async {
            try {
              await Clipboard.setData(
                ClipboardData(
                  text: '${ArgosApiConfig.webBaseUrl}/items/${item.id}',
                ),
              );
              onMessage('Link do caso copiado.');
            } catch (_) {
              onMessage('Não foi possível copiar o link.');
            }
          },
        ),
        _CaseActionButton(
          muted: true,
          busy: reporting,
          icon: Icons.flag_outlined,
          label: 'Denunciar',
          onTap: () async {
            if (!auth.isAuthenticated) {
              onMessage('Entre para sinalizar um caso suspeito.');
              return;
            }
            final confirmed = await showDialog<bool>(
              context: context,
              builder: (context) => AlertDialog(
                title: const Text('Sinalizar caso?'),
                content: const Text(
                  'Este caso será enviado para análise da moderação.',
                ),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.of(context).pop(false),
                    child: const Text('Cancelar'),
                  ),
                  FilledButton(
                    onPressed: () => Navigator.of(context).pop(true),
                    child: const Text('Sinalizar'),
                  ),
                ],
              ),
            );
            if (!context.mounted || confirmed != true) return;
            try {
              onMessage(
                await ref.read(feedControllerProvider.notifier).report(item),
              );
            } catch (error) {
              onMessage(apiErrorMessage(error));
            }
          },
        ),
      ],
    );
  }
}

class _CaseActionButton extends StatelessWidget {
  const _CaseActionButton({
    required this.icon,
    required this.label,
    required this.onTap,
    this.active = false,
    this.muted = false,
    this.busy = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool active;
  final bool muted;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final colors = context.argosColors;
    final foreground = active
        ? colors.primary
        : muted
        ? colors.muted
        : colors.text;
    return Material(
      color: active ? colors.surfaceSoft : colors.surface,
      shape: RoundedRectangleBorder(
        side: BorderSide(color: colors.line),
        borderRadius: BorderRadius.circular(ArgosRadius.md),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(ArgosRadius.md),
        onTap: busy ? null : onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (busy)
                SizedBox(
                  width: 19,
                  height: 19,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: foreground,
                  ),
                )
              else
                Icon(icon, color: foreground, size: 19),
              const SizedBox(width: 5.6),
              Flexible(
                child: Text(
                  label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.labelMedium?.copyWith(
                    color: foreground,
                    fontSize: 13.1,
                    height: 1.15,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PrivacyNote extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final colors = context.argosColors;
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border(left: BorderSide(color: colors.warning, width: 3)),
      ),
      child: Padding(
        padding: const EdgeInsets.only(left: 10.4),
        child: Text(
          'Não envie documento completo, telefone ou provas sensíveis nas pistas públicas.',
          style: Theme.of(context).textTheme.bodyMedium,
        ),
      ),
    );
  }
}
