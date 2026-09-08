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

class CaseDetailDialog extends ConsumerWidget {
  const CaseDetailDialog({
    required this.item,
    required this.onMessage,
    super.key,
  });

  final Item item;
  final ValueChanged<String> onMessage;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = context.argosColors;
    final textTheme = Theme.of(context).textTheme;
    final auth = ref.watch(authControllerProvider);
    final avatarUrl = ref
        .watch(itemsRepositoryProvider)
        .assetUrl(item.ownerAvatarUrl);

    return Dialog.fullscreen(
      backgroundColor: colors.surface,
      child: Column(
        children: [
          Stack(
            children: [
              CaseMedia(item: item, modal: true, onTap: () {}),
              Positioned(
                top: 6,
                right: 6,
                child: IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close_rounded, size: 32),
                  color: Colors.white,
                  tooltip: 'Fechar',
                ),
              ),
            ],
          ),
          Expanded(
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: colors.surface,
                border: Border(top: BorderSide(color: colors.line)),
              ),
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                children: [
                  Row(
                    children: [
                      ArgosAvatar(
                        label: item.authorHandle,
                        imageUrl: avatarUrl,
                        size: 37.6,
                      ),
                      const SizedBox(width: 10.4),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '@${item.authorHandle}',
                              style: textTheme.titleSmall,
                            ),
                            Text(
                              'Perfil do publicador',
                              style: textTheme.bodySmall?.copyWith(
                                color: colors.muted,
                              ),
                            ),
                          ],
                        ),
                      ),
                      StatusBadge(status: item.status),
                    ],
                  ),
                  const SizedBox(height: ArgosSpacing.xl),
                  Text(item.title, style: textTheme.titleLarge),
                  const SizedBox(height: ArgosSpacing.sm),
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
                  const SizedBox(height: ArgosSpacing.md),
                  DecoratedBox(
                    decoration: BoxDecoration(
                      color: colors.surfaceSoft,
                      border: Border.all(color: colors.line),
                      borderRadius: BorderRadius.circular(ArgosRadius.md),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(ArgosSpacing.md),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(
                            Icons.info_outline_rounded,
                            color: colors.muted,
                            size: 18,
                          ),
                          const SizedBox(width: 8.8),
                          Expanded(
                            child: Text(
                              'Provas de posse ficam no fluxo privado de reivindicação. Use pistas públicas apenas para perguntas e informações gerais.',
                              style: textTheme.bodyMedium?.copyWith(
                                color: colors.muted,
                                fontSize: 13.5,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: ArgosSpacing.xl),
                  Text('Pistas públicas', style: textTheme.titleSmall),
                  const SizedBox(height: ArgosSpacing.md),
                  if (item.latestComments.isEmpty)
                    Text(
                      'Nenhuma pista pública por enquanto.',
                      style: textTheme.bodyMedium?.copyWith(
                        color: colors.muted,
                      ),
                    )
                  else
                    for (final comment in item.latestComments)
                      Padding(
                        padding: const EdgeInsets.only(bottom: ArgosSpacing.md),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            ArgosAvatar(
                              label: comment.handle,
                              imageUrl: ref
                                  .watch(itemsRepositoryProvider)
                                  .assetUrl(comment.authorAvatarUrl),
                              size: 28,
                            ),
                            const SizedBox(width: 10.4),
                            Expanded(
                              child: Text.rich(
                                TextSpan(
                                  children: [
                                    TextSpan(
                                      text: '@${comment.handle} ',
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w800,
                                      ),
                                    ),
                                    TextSpan(text: comment.body),
                                    TextSpan(
                                      text:
                                          '\n${relativeDate(comment.createdAt)}',
                                      style: textTheme.bodySmall?.copyWith(
                                        color: colors.muted,
                                      ),
                                    ),
                                  ],
                                ),
                                style: textTheme.bodyMedium,
                              ),
                            ),
                          ],
                        ),
                      ),
                ],
              ),
            ),
          ),
          DecoratedBox(
            decoration: BoxDecoration(
              color: colors.surface,
              border: Border(top: BorderSide(color: colors.line)),
            ),
            child: SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    _CaseActions(item: item, onMessage: onMessage),
                    const SizedBox(height: ArgosSpacing.md),
                    CommentComposer(item: item, onMessage: onMessage),
                  ],
                ),
              ),
            ),
          ),
        ],
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
    Navigator.of(context).pop();
    if (item.status == ItemStatus.returned || authenticated) {
      context.go('/items/${item.id}');
    } else {
      context.go('/login?next=/items/${item.id}');
    }
  }
}

class _CaseActions extends ConsumerWidget {
  const _CaseActions({required this.item, required this.onMessage});

  final Item item;
  final ValueChanged<String> onMessage;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(feedControllerProvider).value;
    final auth = ref.watch(authControllerProvider);
    final followed = state?.followedIds.contains(item.id) ?? false;
    final reporting = state?.reportingIds.contains(item.id) ?? false;

    return GridView.count(
      shrinkWrap: true,
      crossAxisCount: 2,
      mainAxisSpacing: 6.4,
      crossAxisSpacing: 6.4,
      childAspectRatio: 3.3,
      physics: const NeverScrollableScrollPhysics(),
      children: [
        _CaseActionButton(
          active: followed,
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
          onTap: () {},
        ),
        _CaseActionButton(
          icon: Icons.content_copy_rounded,
          label: 'Copiar link',
          onTap: () async {
            await Clipboard.setData(
              ClipboardData(
                text: '${ArgosApiConfig.webBaseUrl}/items/${item.id}',
              ),
            );
            onMessage('Link do caso copiado.');
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
            if (confirmed != true) return;
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
