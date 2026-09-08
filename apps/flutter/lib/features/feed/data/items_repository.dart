import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http_parser/http_parser.dart';

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

  Future<String> uploadImage({
    required List<int> bytes,
    required String filename,
    required String mimeType,
  }) async {
    final response = await _api.dio.post<Map<String, dynamic>>(
      '/uploads',
      data: FormData.fromMap({
        'file': MultipartFile.fromBytes(
          bytes,
          filename: filename,
          contentType: _mediaType(mimeType),
        ),
      }),
    );

    final url = response.data?['url']?.toString();
    if (url == null || url.isEmpty) {
      throw StateError('Resposta de upload inválida.');
    }
    return url;
  }

  Future<int> create(CreateItemPayload payload) async {
    final response = await _api.dio.post<Map<String, dynamic>>(
      '/items',
      data: payload.toJson(),
      options: Options(contentType: Headers.jsonContentType),
    );

    return _intValue(response.data?['id']);
  }

  String assetUrl(String? url) => _api.assetUrl(url);
}

class CreateItemPayload {
  const CreateItemPayload({
    required this.type,
    required this.title,
    required this.description,
    required this.category,
    required this.location,
    required this.campusBlock,
    required this.approximatePlace,
    required this.eventDate,
    required this.contactPreference,
    required this.imageUrl,
  });

  final String type;
  final String title;
  final String description;
  final String category;
  final String location;
  final String campusBlock;
  final String approximatePlace;
  final String eventDate;
  final String contactPreference;
  final String imageUrl;

  Map<String, dynamic> toJson() {
    return {
      'type': type,
      'title': title,
      'description': description,
      'category': category,
      'location': location,
      'campusBlock': campusBlock,
      'approximatePlace': approximatePlace,
      'eventDate': eventDate,
      'contactPreference': contactPreference,
      'imageUrl': imageUrl,
    };
  }
}

int _intValue(Object? value) {
  if (value is int) return value;
  return int.tryParse(value?.toString() ?? '') ?? 0;
}

MediaType _mediaType(String value) {
  return switch (value) {
    'image/png' => MediaType('image', 'png'),
    'image/webp' => MediaType('image', 'webp'),
    _ => MediaType('image', 'jpeg'),
  };
}
