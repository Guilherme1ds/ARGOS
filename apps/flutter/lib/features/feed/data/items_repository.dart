import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http_parser/http_parser.dart';

import '../../../core/network/api_client.dart';
import '../domain/feed_comment.dart';
import '../domain/item.dart';

final itemsRepositoryProvider = Provider<ItemsRepository>((ref) {
  return ItemsRepository(ref.watch(apiClientProvider));
});

/// Espaços institucionais ativos (filtro da busca e seletor da publicação).
final publicSpacesProvider = FutureProvider.autoDispose<List<PublicSpace>>(
  (ref) => ref.watch(itemsRepositoryProvider).spaces(),
);

class PublicSpace {
  const PublicSpace({
    required this.id,
    required this.name,
    required this.organizationName,
  });

  final int id;
  final String name;
  final String organizationName;
}

/// Uma opção de faceta: valor do filtro, rótulo e quantos resultados existem com ela.
class FacetValue {
  const FacetValue({
    required this.value,
    required this.label,
    required this.count,
  });

  final String value;
  final String label;
  final int count;
}

class PaginatedItems {
  const PaginatedItems({
    required this.items,
    required this.total,
    this.facets = const {},
    this.synonyms = const [],
  });

  final List<Item> items;
  final int total;

  /// Contagens por dimensão (type, status, category, space, hasImage), quando pedidas.
  final Map<String, List<FacetValue>> facets;

  /// Termos equivalentes acrescentados pelo dicionário de sinônimos.
  final List<String> synonyms;
}

class ItemsRepository {
  const ItemsRepository(this._api);

  final ApiClient _api;

  Future<PaginatedItems> search({
    required int page,
    required int limit,
    Map<String, dynamic> filters = const {},
    bool facets = false,
    CancelToken? cancelToken,
  }) async {
    // Sem `sort`, o servidor ordena por relevância quando há texto e pelos mais recentes quando não há.
    final response = await _api.dio.get<Map<String, dynamic>>(
      '/items/search',
      queryParameters: {
        'page': page,
        'limit': limit,
        if (facets) 'facets': 'true',
        for (final entry in filters.entries)
          if (entry.value != null && entry.value.toString().isNotEmpty)
            entry.key: entry.value,
      },
      cancelToken: cancelToken,
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

    final rawFacets = meta is Map<String, dynamic> ? meta['facets'] : null;
    final rawSynonyms = meta is Map<String, dynamic> ? meta['synonyms'] : null;
    return PaginatedItems(
      items: items,
      total: meta is Map<String, dynamic>
          ? _intValue(meta['total'])
          : items.length,
      facets: rawFacets is Map<String, dynamic>
          ? {
              for (final entry in rawFacets.entries)
                if (entry.value is List)
                  entry.key: (entry.value as List)
                      .whereType<Map<String, dynamic>>()
                      .map(
                        (row) => FacetValue(
                          value: row['value']?.toString() ?? '',
                          label: row['label']?.toString() ?? '',
                          count: _intValue(row['count']),
                        ),
                      )
                      .toList(growable: false),
            }
          : const {},
      synonyms: rawSynonyms is List
          ? rawSynonyms.map((term) => term.toString()).toList(growable: false)
          : const [],
    );
  }

  Future<List<PublicSpace>> spaces() async {
    final response = await _api.dio.get<Map<String, dynamic>>('/spaces');
    return ((response.data?['data'] as List?) ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(
          (row) => PublicSpace(
            id: _intValue(row['id']),
            name: row['name']?.toString() ?? '',
            organizationName: row['organizationName']?.toString() ?? '',
          ),
        )
        .toList(growable: false);
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
    void Function(int, int)? onProgress,
  }) async {
    final response = await _api.dio.post<Map<String, dynamic>>(
      '/uploads',
      onSendProgress: onProgress,
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

  Future<int> create(CreateItemPayload payload, {String? operationKey}) async {
    final response = await _api.dio.post<Map<String, dynamic>>(
      '/items',
      data: payload.toJson(),
      options: Options(
        contentType: Headers.jsonContentType,
        headers: operationKey == null
            ? null
            : {'Idempotency-Key': operationKey},
      ),
    );

    final id = _intValue(response.data?['id']);
    if (id <= 0) throw const FormatException('Identificador de item inválido.');
    return id;
  }

  Future<Map<String, dynamic>> detail(int id) async =>
      (await _api.dio.get<Map<String, dynamic>>('/items/$id')).data!;

  Future<Map<String, dynamic>> collection(
    String path, {
    int page = 1,
    int limit = 20,
  }) async => (await _api.dio.get<Map<String, dynamic>>(
    path,
    queryParameters: {'page': page, 'limit': limit},
  )).data!;

  Future<Set<int>> followedIds() async {
    final ids = <int>{};
    var page = 1;
    while (true) {
      final body = await collection(
        '/items/following',
        page: page++,
        limit: 50,
      );
      final rows = (body['data'] as List).cast<Map<String, dynamic>>();
      ids.addAll(rows.map((row) => _intValue(row['id'])));
      if (rows.isEmpty ||
          ids.length >= _intValue((body['meta'] as Map)['total'])) {
        return ids;
      }
    }
  }

  Future<void> claim(int id, String message, String proof) =>
      _api.dio.post<void>(
        '/items/$id/claim',
        data: {'message': message, 'proofDetails': proof},
      );

  /// Quem enviou cancela a própria solicitação aberta.
  Future<void> withdrawClaim(int id) =>
      _api.dio.delete<void>('/items/$id/claim');

  /// O responsável pelo caso recusa uma solicitação (a pessoa é avisada).
  Future<void> rejectClaim(int id, int claimId) =>
      _api.dio.patch<void>('/items/$id/claims/$claimId/reject');

  /// Autor (ou moderação) remove uma pista pública.
  Future<void> deleteComment(int id, int commentId) =>
      _api.dio.delete<void>('/items/$id/comments/$commentId');

  /// Denúncia para a moderação; devolve a explicação do servidor
  /// (nova denúncia ou denúncia já existente desta conta).
  Future<String?> reportWithReason(int id, String reason) async {
    final response = await _api.dio.post<Map<String, dynamic>>(
      '/items/$id/report',
      data: {'reason': reason},
    );
    return response.data?['message']?.toString();
  }

  Future<void> returnItem(int id, int? claimId) =>
      _api.dio.patch<void>('/items/$id/return', data: {'claimId': ?claimId});
  Future<void> update(int id, Map<String, dynamic> data) =>
      _api.dio.patch<void>('/items/$id', data: data);
  Future<void> delete(int id) => _api.dio.delete<void>('/items/$id');

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
    this.spaceId,
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

  /// Espaço institucional onde o item está ou será entregue (opcional).
  final int? spaceId;

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
      'spaceId': ?spaceId,
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
