import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../data/items_repository.dart';
import '../domain/feed_comment.dart';
import '../domain/item.dart';

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
    this.errorMessage = '',
  });

  final List<Item> items;
  final int page;
  final bool hasMore;
  final bool loadingMore;
  final Set<int> followedIds;
  final Set<int> reportingIds;
  final String errorMessage;

  FeedState copyWith({
    List<Item>? items,
    int? page,
    bool? hasMore,
    bool? loadingMore,
    Set<int>? followedIds,
    Set<int>? reportingIds,
    String? errorMessage,
  }) {
    return FeedState(
      items: items ?? this.items,
      page: page ?? this.page,
      hasMore: hasMore ?? this.hasMore,
      loadingMore: loadingMore ?? this.loadingMore,
      followedIds: followedIds ?? this.followedIds,
      reportingIds: reportingIds ?? this.reportingIds,
      errorMessage: errorMessage ?? this.errorMessage,
    );
  }
}

class FeedController extends AsyncNotifier<FeedState> {
  static const pageSize = 6;

  ItemsRepository get _repository => ref.read(itemsRepositoryProvider);

  @override
  Future<FeedState> build() => _loadFirstPage();

  Future<FeedState> _loadFirstPage() async {
    final page = await _repository.search(page: 1, limit: pageSize);
    return FeedState(
      items: page.items,
      page: 1,
      hasMore: pageSize < page.total,
    );
  }

  Future<void> refreshFeed() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_loadFirstPage);
  }

  Future<void> loadMore() async {
    final current = state.value;
    if (current == null || current.loadingMore || !current.hasMore) return;

    state = AsyncData(current.copyWith(loadingMore: true, errorMessage: ''));
    try {
      final nextPage = current.page + 1;
      final page = await _repository.search(page: nextPage, limit: pageSize);
      state = AsyncData(
        current.copyWith(
          items: [...current.items, ...page.items],
          page: nextPage,
          hasMore: nextPage * pageSize < page.total,
          loadingMore: false,
        ),
      );
    } catch (error) {
      state = AsyncData(
        current.copyWith(
          loadingMore: false,
          errorMessage: apiErrorMessage(error),
        ),
      );
    }
  }

  Future<String> toggleFollow(Item item) async {
    final current = state.value;
    if (current == null) return '';

    final nextFollowed = !current.followedIds.contains(item.id);
    final optimistic = Set<int>.of(current.followedIds);
    nextFollowed ? optimistic.add(item.id) : optimistic.remove(item.id);
    state = AsyncData(
      current.copyWith(followedIds: optimistic, errorMessage: ''),
    );

    try {
      if (nextFollowed) {
        await _repository.follow(item.id);
        return 'Caso adicionado aos acompanhamentos.';
      }
      await _repository.unfollow(item.id);
      return 'Caso removido dos acompanhamentos.';
    } catch (error) {
      state = AsyncData(current.copyWith(errorMessage: apiErrorMessage(error)));
      rethrow;
    }
  }

  Future<String> report(Item item) async {
    final current = state.value;
    if (current == null) return '';

    final reporting = Set<int>.of(current.reportingIds)..add(item.id);
    state = AsyncData(
      current.copyWith(reportingIds: reporting, errorMessage: ''),
    );

    try {
      await _repository.report(item.id);
      return 'Sinalização enviada para análise.';
    } catch (error) {
      state = AsyncData(current.copyWith(errorMessage: apiErrorMessage(error)));
      rethrow;
    } finally {
      final latest = state.value;
      if (latest != null) {
        state = AsyncData(
          latest.copyWith(
            reportingIds: Set<int>.of(latest.reportingIds)..remove(item.id),
          ),
        );
      }
    }
  }

  Future<FeedComment> addComment(Item item, String body) async {
    final comment = await _repository.addComment(item.id, body);
    final current = state.value;
    if (current == null) return comment;

    final nextItems = current.items
        .map((entry) {
          if (entry.id != item.id) return entry;
          return entry.copyWith(
            commentsCount: entry.commentsCount + 1,
            latestComments: [...entry.latestComments, comment],
          );
        })
        .toList(growable: false);

    state = AsyncData(current.copyWith(items: nextItems, errorMessage: ''));
    return comment;
  }
}
