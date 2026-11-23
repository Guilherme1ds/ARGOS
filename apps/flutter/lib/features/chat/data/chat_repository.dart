import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/utils/date_formatters.dart';
import '../../auth/application/auth_controller.dart';

final chatRepositoryProvider = Provider<ChatRepository>(
  (ref) => ChatRepository(ref.watch(apiClientProvider)),
);

/// Total de mensagens não lidas (ícone de mensagens na barra superior).
final chatUnreadProvider = FutureProvider.autoDispose<int>((ref) async {
  final user = ref.watch(
    authControllerProvider.select((auth) => auth.user?.id),
  );
  if (user == null) return 0;
  return ref.watch(chatRepositoryProvider).unreadCount();
});

class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.mine,
    required this.body,
    required this.removed,
    required this.createdAt,
    this.safetyNotice,
  });

  factory ChatMessage.fromJson(Map<String, dynamic> json) => ChatMessage(
    id: json['id'] as int,
    mine: json['mine'] == true,
    body: json['body']?.toString() ?? '',
    removed: json['removed'] == true,
    safetyNotice: json['safetyNotice']?.toString(),
    // O servidor grava em UTC sem fuso ('2026-11-17 14:00:00'); parseArgosDate trata como UTC.
    createdAt:
        (parseArgosDate(json['created_at']?.toString() ?? '') ?? DateTime.now())
            .toLocal(),
  );

  final int id;
  final bool mine;
  final String body;
  final bool removed;
  final String? safetyNotice;
  final DateTime createdAt;
}

class Conversation {
  const Conversation({
    required this.id,
    required this.open,
    required this.closedByMe,
    required this.isOwner,
    required this.itemId,
    required this.itemTitle,
    required this.counterpart,
    required this.unread,
    this.lastMessage,
  });

  factory Conversation.fromJson(Map<String, dynamic> json) {
    final item = json['item'] as Map<String, dynamic>? ?? const {};
    final counterpart =
        json['counterpart'] as Map<String, dynamic>? ?? const {};
    final last = json['lastMessage'];
    return Conversation(
      id: json['id'] as int,
      open: json['status'] != 'closed',
      closedByMe: json['closedByMe'] == true,
      isOwner: json['role'] == 'owner',
      itemId: item['id'] as int? ?? 0,
      itemTitle: item['title']?.toString() ?? '',
      counterpart: counterpart['nickname']?.toString() ?? '',
      unread: json['unread'] as int? ?? 0,
      lastMessage: last is Map<String, dynamic>
          ? ChatMessage.fromJson(last)
          : null,
    );
  }

  final int id;
  final bool open;
  final bool closedByMe;
  final bool isOwner;
  final int itemId;
  final String itemTitle;
  final String counterpart;
  final int unread;
  final ChatMessage? lastMessage;
}

/// Conversa privada por caso (quem publicou x interessado), com regras automáticas de moderação no servidor.
class ChatRepository {
  const ChatRepository(this._api);

  final ApiClient _api;

  Future<List<Conversation>> conversations() async {
    final response = await _api.dio.get<Map<String, dynamic>>('/conversations');
    return ((response.data?['data'] as List?) ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(Conversation.fromJson)
        .toList(growable: false);
  }

  Future<int> unreadCount() async {
    final response = await _api.dio.get<Map<String, dynamic>>(
      '/conversations/unread-count',
    );
    return response.data?['total'] as int? ?? 0;
  }

  /// Abre (ou reaproveita) a conversa com quem publicou o caso e devolve o id.
  Future<int> start(int itemId) async {
    final response = await _api.dio.post<Map<String, dynamic>>(
      '/conversations',
      data: {'itemId': itemId},
    );
    return response.data?['id'] as int;
  }

  /// Mensagens da conversa; com [after], só as novas (consulta periódica).
  Future<({Conversation conversation, List<ChatMessage> messages})> messages(
    int conversationId, {
    int? after,
  }) async {
    final response = await _api.dio.get<Map<String, dynamic>>(
      '/conversations/$conversationId/messages',
      queryParameters: {'after': ?after},
    );
    final body = response.data ?? const <String, dynamic>{};
    return (
      conversation: Conversation.fromJson(
        body['conversation'] as Map<String, dynamic>,
      ),
      messages: ((body['data'] as List?) ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(ChatMessage.fromJson)
          .toList(growable: false),
    );
  }

  Future<ChatMessage> send(int conversationId, String body) async {
    final response = await _api.dio.post<Map<String, dynamic>>(
      '/conversations/$conversationId/messages',
      data: {'body': body},
    );
    return ChatMessage.fromJson(
      response.data?['message'] as Map<String, dynamic>,
    );
  }

  Future<void> report(int conversationId, int messageId) => _api.dio.post<void>(
    '/conversations/$conversationId/messages/$messageId/report',
  );

  Future<void> setOpen(int conversationId, bool open) => _api.dio.patch<void>(
    '/conversations/$conversationId',
    data: {'status': open ? 'open' : 'closed'},
  );
}
