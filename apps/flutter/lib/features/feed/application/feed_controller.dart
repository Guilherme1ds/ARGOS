import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../data/items_repository.dart';
import '../domain/feed_comment.dart';
import '../domain/item.dart';
import '../../auth/application/auth_controller.dart';

final feedControllerProvider = AsyncNotifierProvider<FeedController, FeedState>(
  FeedController.new,
);

class FeedState {
  const FeedState({
    required this.items,
    required this.page,
    required this.hasMore,
    this.loadingMore = false,
    this.followedIds = const <int>{},
    this.reportingIds = const <int>{},
    this.followingIds = const <int>{},
    this.errorMessage = '',
  });

  final List<Item> items;
  final int page;
  final bool hasMore;
  final bool loadingMore;
  final Set<int> followedIds;
  final Set<int> reportingIds;
  final Set<int> followingIds;
  final String errorMessage;

  FeedState copyWith({
    List<Item>? items,
    int? page,
    bool? hasMore,
    bool? loadingMore,
    Set<int>? followedIds,
    Set<int>? reportingIds,
    Set<int>? followingIds,
    String? errorMessage,
  }) {
    return FeedState(
      items: items ?? this.items,
      page: page ?? this.page,
      hasMore: hasMore ?? this.hasMore,
      loadingMore: loadingMore ?? this.loadingMore,
      followedIds: followedIds ?? this.followedIds,
      reportingIds: reportingIds ?? this.reportingIds,
      followingIds: followingIds ?? this.followingIds,
      errorMessage: errorMessage ?? this.errorMessage,
    );
  }
}

class FeedController extends AsyncNotifier<FeedState> {
  static const pageSize = 6;
  int _generation = 0;
  int _followRevision = 0;
  ItemsRepository get _repository => ref.read(itemsRepositoryProvider);

  @override
  Future<FeedState> build() {
    final userId = ref.watch(
      authControllerProvider.select((auth) => auth.user?.id),
    );
    _generation++;
    return _loadFirstPage(userId);
  }

  Future<FeedState> _loadFirstPage(int? userId) async {
    final page = await _repository.search(page: 1, limit: pageSize);
    var followed = <int>{};
    var error = '';
    if (userId != null) {
      try {
        followed = await _repository.followedIds();
      } catch (failure) {
        error = apiErrorMessage(failure);
      }
    }
    return FeedState(
      items: page.items,
      page: 1,
      hasMore: page.items.length < page.total,
      followedIds: followed,
      errorMessage: error,
    );
  }

  Future<void> refreshFeed() async {
    final generation = ++_generation;
    final followRevision = _followRevision;
    final previous = state.value;
    try {
      final next = await _loadFirstPage(
        ref.read(authControllerProvider).user?.id,
      );
      if (!ref.mounted || generation != _generation) return;
      // Preserve in-flight mutations instead of replacing them with a stale fetch.
      final latest = state.value;
      state = AsyncData(
        next.copyWith(
          followedIds:
              followRevision != _followRevision ||
                  latest?.followingIds.isNotEmpty == true
              ? latest?.followedIds
              : null,
          followingIds: latest?.followingIds,
          reportingIds: latest?.reportingIds,
        ),
      );
    } catch (error, stack) {
      if (!ref.mounted || generation != _generation) return;
      state = previous == null
          ? AsyncError(error, stack)
          : AsyncData(
              (state.value ?? previous).copyWith(
                loadingMore: false,
                errorMessage: apiErrorMessage(error),
              ),
            );
    }
  }

  Future<void> loadMore() async {
    final current = state.value;
    if (current == null || current.loadingMore || !current.hasMore) return;
    final generation = _generation;
    state = AsyncData(current.copyWith(loadingMore: true, errorMessage: ''));
    try {
      final page = await _repository.search(
        page: current.page + 1,
        limit: pageSize,
      );
      if (!ref.mounted || generation != _generation) return;
      final latest = state.value!;
      final items = {for (final item in latest.items) item.id: item};
      for (final item in page.items) {
        items.putIfAbsent(item.id, () => item);
      }
      state = AsyncData(
        latest.copyWith(
          items: items.values.toList(),
          page: current.page + 1,
          loadingMore: false,
          hasMore:
              page.items.isNotEmpty &&
              (current.page + 1) * pageSize < page.total,
        ),
      );
    } catch (error) {
      if (!ref.mounted || generation != _generation) return;
      state = AsyncData(
        state.value!.copyWith(
          loadingMore: false,
          errorMessage: apiErrorMessage(error),
        ),
      );
    }
  }

  Future<String> toggleFollow(Item item) async {
    final current = state.value;
    if (current == null || current.followingIds.contains(item.id)) return '';
    final epoch = ref.read(apiClientProvider).epoch;
    _followRevision++;
    final wasFollowed = current.followedIds.contains(item.id);
    final ids = Set<int>.of(current.followedIds);
    wasFollowed ? ids.remove(item.id) : ids.add(item.id);
    state = AsyncData(
      current.copyWith(
        followedIds: ids,
        followingIds: {...current.followingIds, item.id},
      ),
    );
    try {
      if (wasFollowed) {
        await _repository.unfollow(item.id);
      } else {
        await _repository.follow(item.id);
      }
      return wasFollowed
          ? 'Caso removido dos acompanhamentos.'
          : 'Caso adicionado aos acompanhamentos.';
    } catch (error) {
      if (ref.mounted &&
          ref.read(apiClientProvider).epoch == epoch &&
          state.value != null) {
        final latest = state.value!;
        final restored = Set<int>.of(latest.followedIds);
        wasFollowed ? restored.add(item.id) : restored.remove(item.id);
        state = AsyncData(
          latest.copyWith(
            followedIds: restored,
            errorMessage: apiErrorMessage(error),
          ),
        );
      }
      rethrow;
    } finally {
      if (ref.mounted &&
          ref.read(apiClientProvider).epoch == epoch &&
          state.value != null) {
        state = AsyncData(
          state.value!.copyWith(
            followingIds: {...state.value!.followingIds}..remove(item.id),
          ),
        );
      }
    }
  }

  Future<String> report(Item item) async {
    final current = state.value;
    if (current == null || current.reportingIds.contains(item.id)) return '';
    final epoch = ref.read(apiClientProvider).epoch;
    state = AsyncData(
      current.copyWith(reportingIds: {...current.reportingIds, item.id}),
    );
    try {
      await _repository.report(item.id);
      return 'Sinalização enviada para análise.';
    } finally {
      if (ref.mounted &&
          ref.read(apiClientProvider).epoch == epoch &&
          state.value != null) {
        state = AsyncData(
          state.value!.copyWith(
            reportingIds: {...state.value!.reportingIds}..remove(item.id),
          ),
        );
      }
    }
  }

  Future<FeedComment> addComment(Item item, String body) async {
    final comment = await _repository.addComment(item.id, body);
    if (!ref.mounted || state.value == null) return comment;
    final current = state.value!;
    state = AsyncData(
      current.copyWith(
        items: current.items
            .map(
              (entry) => entry.id != item.id
                  ? entry
                  : entry.copyWith(
                      commentsCount: entry.commentsCount + 1,
                      latestComments: [...entry.latestComments, comment],
                    ),
            )
            .toList(),
      ),
    );
    return comment;
  }
}
