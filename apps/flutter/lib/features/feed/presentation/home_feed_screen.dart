import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme/argos_tokens.dart';
import '../../../core/network/api_client.dart';
import '../application/feed_controller.dart';
import 'widgets/case_post_card.dart';
import 'widgets/message_banner.dart';

class HomeFeedScreen extends ConsumerStatefulWidget {
  const HomeFeedScreen({super.key});

  @override
  ConsumerState<HomeFeedScreen> createState() => _HomeFeedScreenState();
}

class _HomeFeedScreenState extends ConsumerState<HomeFeedScreen> {
  final _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_maybeLoadMore);
  }

  @override
  void dispose() {
    _scrollController
      ..removeListener(_maybeLoadMore)
      ..dispose();
    super.dispose();
  }

  void _maybeLoadMore() {
    if (!_scrollController.hasClients) return;
    final position = _scrollController.position;
    if (position.pixels >= position.maxScrollExtent - 420) {
      ref.read(feedControllerProvider.notifier).loadMore();
    }
  }

  void _showMessage(String message) {
    if (!mounted || message.isEmpty) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final feed = ref.watch(feedControllerProvider);

    return feed.when(
      loading: () => _FeedFrame(
        scrollController: _scrollController,
        onRefresh: () =>
            ref.read(feedControllerProvider.notifier).refreshFeed(),
        children: const [
          _SkeletonPost(),
          SizedBox(height: 22.4),
          _SkeletonPost(),
          SizedBox(height: 22.4),
          _SkeletonPost(),
        ],
      ),
      error: (error, stackTrace) => _FeedFrame(
        scrollController: _scrollController,
        onRefresh: () =>
            ref.read(feedControllerProvider.notifier).refreshFeed(),
        children: [
          MessageBanner(
            message: apiErrorMessage(error),
            tone: MessageTone.error,
          ),
          const SizedBox(height: ArgosSpacing.md),
          _FeedEmptyState(
            title: 'Não foi possível carregar o mural',
            description: 'Verifique a conexão com a API e tente novamente.',
            actionLabel: 'Tentar de novo',
            onAction: () =>
                ref.read(feedControllerProvider.notifier).refreshFeed(),
          ),
        ],
      ),
      data: (state) {
        return _FeedFrame(
          scrollController: _scrollController,
          onRefresh: () =>
              ref.read(feedControllerProvider.notifier).refreshFeed(),
          children: [
            if (state.errorMessage.isNotEmpty) ...[
              MessageBanner(
                message: state.errorMessage,
                tone: MessageTone.error,
              ),
              const SizedBox(height: ArgosSpacing.md),
            ],
            if (state.items.isEmpty)
              _FeedEmptyState(
                title: 'Nenhum caso publicado ainda',
                description:
                    'Quando itens forem publicados, eles aparecem aqui em formato de mural.',
                actionLabel: 'Publicar item',
                onAction: () => context.go('/items/new'),
              )
            else
              for (var index = 0; index < state.items.length; index++) ...[
                CasePostCard(item: state.items[index], onMessage: _showMessage),
                if (index < state.items.length - 1)
                  const SizedBox(height: 22.4),
              ],
            const SizedBox(height: ArgosSpacing.md),
            SizedBox(
              height: 48,
              child: Center(
                child: state.loadingMore
                    ? CircularProgressIndicator(
                        color: context.argosColors.primary,
                      )
                    : !state.hasMore && state.items.isNotEmpty
                    ? Text(
                        'Você chegou ao fim.',
                        style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          color: context.argosColors.muted,
                        ),
                      )
                    : const SizedBox.shrink(),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _FeedFrame extends StatelessWidget {
  const _FeedFrame({
    required this.children,
    required this.scrollController,
    required this.onRefresh,
  });

  final List<Widget> children;
  final ScrollController scrollController;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      color: context.argosColors.primary,
      onRefresh: onRefresh,
      child: ListView(
        controller: scrollController,
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(0, 12.8, 0, 32),
        children: [
          Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 470.4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: children,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _FeedEmptyState extends StatelessWidget {
  const _FeedEmptyState({
    required this.title,
    required this.description,
    required this.actionLabel,
    required this.onAction,
  });

  final String title;
  final String description;
  final String actionLabel;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    final colors = context.argosColors;
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: ArgosSpacing.lg),
      padding: const EdgeInsets.all(ArgosSpacing.xxl),
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
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: ArgosSpacing.sm),
          Text(
            description,
            style: Theme.of(
              context,
            ).textTheme.bodyMedium?.copyWith(color: colors.muted),
          ),
          const SizedBox(height: ArgosSpacing.lg),
          FilledButton(onPressed: onAction, child: Text(actionLabel)),
        ],
      ),
    );
  }
}

class _SkeletonPost extends StatelessWidget {
  const _SkeletonPost();

  @override
  Widget build(BuildContext context) {
    final colors = context.argosColors;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surface,
        border: Border(bottom: BorderSide(color: colors.line)),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(11.2, 0, 11.2, 20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                _SkeletonBox(width: 37.6, height: 37.6, radius: 999),
                const SizedBox(width: 7.2),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _SkeletonBox(width: 160, height: 14, radius: 8),
                      SizedBox(height: 5),
                      _SkeletonBox(width: 52, height: 12, radius: 8),
                    ],
                  ),
                ),
                const _SkeletonBox(width: 88, height: 28, radius: 999),
              ],
            ),
            const SizedBox(height: ArgosSpacing.md),
            const AspectRatio(aspectRatio: 1, child: _SkeletonBox(radius: 4)),
            const SizedBox(height: ArgosSpacing.md),
            const _SkeletonBox(height: 18, radius: 8),
            const SizedBox(height: ArgosSpacing.sm),
            const _SkeletonBox(height: 52, radius: 8),
            const SizedBox(height: ArgosSpacing.md),
            const _SkeletonBox(height: 48, radius: 8),
          ],
        ),
      ),
    );
  }
}

class _SkeletonBox extends StatelessWidget {
  const _SkeletonBox({this.width, this.height, this.radius = 8});

  final double? width;
  final double? height;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final colors = context.argosColors;
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: colors.surfaceSoft,
        borderRadius: BorderRadius.circular(radius),
      ),
    );
  }
}
