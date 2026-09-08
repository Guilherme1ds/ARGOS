import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../domain/feed_comment.dart';
import '../domain/item.dart';

final itemsRepositoryProvider = Provider<ItemsRepository>((ref) {
  return ItemsRepository(ref.watch(apiClientProvider));
});

class PaginatedItems {
  const PaginatedItems({required this.items, required this.total});

  final List<Item> items;
  final int total;
}

class ItemsRepository {
  const ItemsRepository(this._api);

  final ApiClient _api;

  Future<PaginatedItems> search({required int page, required int limit}) async {
    final response = await _api.dio.get<Map<String, dynamic>>(
      '/items/search',
      queryParameters: {'page': page, 'limit': limit, 'sort': 'newest'},
    );

    final body = response.data ?? const <String, dynamic>{};
    final data = body['data'];
    final meta = body['meta'];
    final items = data is List
        ? data
              .whereType<Map<String, dynamic>>()
              .map(Item.fromJson)
              .toList(growable: false)
        : const <Item>[];

    return PaginatedItems(
      items: items,
      total: meta is Map<String, dynamic>
          ? _intValue(meta['total'])
          : items.length,
    );
  }

  Future<void> follow(int itemId) {
    return _api.dio.post<void>('/items/$itemId/follow');
  }

  Future<void> unfollow(int itemId) {
    return _api.dio.delete<void>('/items/$itemId/follow');
  }

  Future<void> report(int itemId) {
    return _api.dio.post<void>(
      '/items/$itemId/report',
      data: {'reason': 'Conteúdo suspeito ou inadequado.'},
    );
  }

  Future<FeedComment> addComment(int itemId, String body) async {
    final response = await _api.dio.post<Map<String, dynamic>>(
      '/items/$itemId/comments',
      data: {'body': body},
      options: Options(contentType: Headers.jsonContentType),
    );

    final comment = response.data?['comment'];
    if (comment is Map<String, dynamic>) return FeedComment.fromJson(comment);
    throw StateError('Resposta de comentário inválida.');
  }

  String assetUrl(String? url) => _api.assetUrl(url);
}

int _intValue(Object? value) {
  if (value is int) return value;
  return int.tryParse(value?.toString() ?? '') ?? 0;
}
