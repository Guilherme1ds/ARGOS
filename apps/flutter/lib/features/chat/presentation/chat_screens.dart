import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_client.dart';
import 'package:intl/intl.dart';
import '../../items/presentation/items_screen.dart';
import '../data/chat_repository.dart';

final _conversationsProvider = FutureProvider.autoDispose<List<Conversation>>(
  (ref) => ref.watch(chatRepositoryProvider).conversations(),
);

const _safetyText = {
  'contact_info':
      'Cuidado ao compartilhar contato pessoal. Prefira combinar a entrega pelo ARGOS e em local público ou no espaço institucional.',
  'payment_request':
      'Atenção: pedido de pagamento. O ARGOS não cobra pela devolução. Esta mensagem foi enviada para revisão da moderação.',
};

class ConversationsScreen extends ConsumerWidget {
  const ConversationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    Future<void> refresh() async {
      ref.invalidate(_conversationsProvider);
      ref.invalidate(chatUnreadProvider);
      try {
        await ref.read(_conversationsProvider.future);
      } catch (_) {
        /* exibido abaixo */
      }
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Mensagens')),
      body: ref
          .watch(_conversationsProvider)
          .when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (error, _) =>
                RetryNotice(message: apiErrorMessage(error), onRetry: refresh),
            data: (rows) => RefreshIndicator(
              onRefresh: refresh,
              child: ListView.separated(
                physics: const AlwaysScrollableScrollPhysics(),
                itemCount: rows.isEmpty ? 1 : rows.length,
                separatorBuilder: (_, _) => const Divider(height: 1),
                itemBuilder: (context, index) {
                  if (rows.isEmpty) {
                    return const Padding(
                      padding: EdgeInsets.all(24),
                      child: Text(
                        'Nenhuma conversa ainda. Abra um caso e toque em "Mensagem privada" para falar com quem publicou.',
                      ),
                    );
                  }
                  final row = rows[index];
                  final preview = row.lastMessage == null
                      ? (row.isOwner ? 'Você publicou' : 'Você escreveu')
                      : '${row.lastMessage!.mine ? 'Você: ' : ''}${row.lastMessage!.body}';
                  return ListTile(
                    leading: CircleAvatar(
                      child: Text(
                        row.counterpart.isEmpty
                            ? 'A'
                            : row.counterpart.substring(0, 1).toUpperCase(),
                      ),
                    ),
                    title: Text(
                      row.itemTitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: Text(
                      '@${row.counterpart} · $preview',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    trailing: row.unread > 0
                        ? Semantics(
                            label: '${row.unread} não lidas',
                            child: Badge(label: Text('${row.unread}')),
                          )
                        : (!row.open
                              ? const Icon(
                                  Icons.lock_outline,
                                  semanticLabel: 'Encerrada',
                                )
                              : null),
                    onTap: () async {
                      await context.push('/messages/${row.id}');
                      ref.invalidate(_conversationsProvider);
                      ref.invalidate(chatUnreadProvider);
                    },
                  );
                },
              ),
            ),
          ),
    );
  }
}

class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({required this.conversationId, super.key});

  final int conversationId;

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  static const _pollInterval = Duration(seconds: 5);
  final _draft = TextEditingController();
  final _scroll = ScrollController();
  final _messages = <ChatMessage>[];

  /// Última mensagem recebida pela consulta. Só avança com o que a consulta trouxe (nunca pela mensagem
  /// enviada): a mensagem que a outra pessoa mandou um instante antes do envio ainda chega na próxima consulta.
  int? _cursor;
  Conversation? _conversation;
  Timer? _timer;
  String? _error;
  bool _loading = true, _sending = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(() => _poll(initial: true));
    _timer = Timer.periodic(_pollInterval, (_) => _poll());
  }

  @override
  void dispose() {
    _timer?.cancel();
    _draft.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _poll({bool initial = false}) async {
    try {
      final after = initial ? null : _cursor;
      final result = await ref
          .read(chatRepositoryProvider)
          .messages(widget.conversationId, after: after);
      if (!mounted) return;
      final known = _messages.map((message) => message.id).toSet();
      setState(() {
        _conversation = result.conversation;
        if (initial) _messages.clear();
        _messages.addAll(
          result.messages.where(
            (message) => !known.contains(message.id) || initial,
          ),
        );
        // A consulta pode trazer uma mensagem anterior à que acabou de ser enviada: mantém a ordem de envio.
        _messages.sort((a, b) => a.id.compareTo(b.id));
        for (final message in result.messages) {
          if (_cursor == null || message.id > _cursor!) _cursor = message.id;
        }
        _loading = false;
        if (initial) _error = null;
      });
      if (result.messages.isNotEmpty) {
        ref.invalidate(chatUnreadProvider);
        _scrollToEnd();
      }
    } catch (error) {
      if (mounted && initial) {
        setState(() {
          _error = apiErrorMessage(error);
          _loading = false;
        });
      }
    }
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.jumpTo(_scroll.position.maxScrollExtent);
    });
  }

  /// Mensagem do servidor (regras de moderação explicam o bloqueio); sem ela, a mensagem genérica.
  String _errorText(Object error) {
    final code = apiErrorCode(error);
    if (code == 'content_blocked' ||
        code == 'chat_muted' ||
        code == 'conversation_closed') {
      final data = error is DioException ? error.response?.data : null;
      if (data is Map && data['message'] is String) {
        return data['message'] as String;
      }
    }
    return apiErrorMessage(error);
  }

  Future<void> _send() async {
    final body = _draft.text.trim();
    if (body.isEmpty || _sending) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      final message = await ref
          .read(chatRepositoryProvider)
          .send(widget.conversationId, body);
      if (!mounted) return;
      setState(() {
        if (!_messages.any((entry) => entry.id == message.id)) {
          _messages.add(message);
        }
        _draft.clear();
      });
      _scrollToEnd();
    } catch (error) {
      // O texto bloqueado fica no campo para a pessoa reescrever.
      if (mounted) setState(() => _error = _errorText(error));
      if (apiErrorCode(error) == 'conversation_closed') {
        await _poll(initial: true);
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _report(ChatMessage message) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Denunciar mensagem?'),
        content: const Text('A mensagem vai para a fila da moderação.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Denunciar'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await ref
          .read(chatRepositoryProvider)
          .report(widget.conversationId, message.id);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Denúncia enviada para a moderação.')),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(apiErrorMessage(error))));
      }
    }
  }

  Future<void> _toggle() async {
    final conversation = _conversation;
    if (conversation == null) return;
    try {
      await ref
          .read(chatRepositoryProvider)
          .setOpen(widget.conversationId, !conversation.open);
      await _poll(initial: true);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(apiErrorMessage(error))));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final conversation = _conversation;
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: Text(
          conversation?.itemTitle ?? 'Conversa',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        actions: [
          if (conversation != null)
            IconButton(
              tooltip: 'Abrir caso',
              icon: const Icon(Icons.open_in_new),
              onPressed: () => context.push('/items/${conversation.itemId}'),
            ),
          if (conversation != null &&
              (conversation.open || conversation.closedByMe))
            TextButton(
              onPressed: _toggle,
              child: Text(conversation.open ? 'Encerrar' : 'Reabrir'),
            ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            Container(
              width: double.infinity,
              color: scheme.surfaceContainerHighest,
              padding: const EdgeInsets.all(12),
              child: const Text(
                'Conversa privada e moderada. Nunca envie documentos ou pagamentos; combine a entrega em local público ou no espaço institucional. Links e ofensas são bloqueados.',
              ),
            ),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _messages.isEmpty
                  ? const Center(
                      child: Padding(
                        padding: EdgeInsets.all(24),
                        child: Text(
                          'Nenhuma mensagem ainda. Comece descrevendo o item sem expor dados pessoais.',
                        ),
                      ),
                    )
                  : ListView.builder(
                      controller: _scroll,
                      padding: const EdgeInsets.all(12),
                      itemCount: _messages.length,
                      itemBuilder: (context, index) {
                        final message = _messages[index];
                        final background = message.mine
                            ? scheme.primaryContainer
                            : scheme.surfaceContainerHigh;
                        return Align(
                          alignment: message.mine
                              ? Alignment.centerRight
                              : Alignment.centerLeft,
                          child: GestureDetector(
                            onLongPress: message.mine || message.removed
                                ? null
                                : () => _report(message),
                            child: Container(
                              constraints: const BoxConstraints(maxWidth: 320),
                              margin: const EdgeInsets.symmetric(vertical: 4),
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(
                                color: background,
                                borderRadius: BorderRadius.circular(14),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    message.body,
                                    style: message.removed
                                        ? const TextStyle(
                                            fontStyle: FontStyle.italic,
                                          )
                                        : null,
                                  ),
                                  if (message.safetyNotice != null &&
                                      _safetyText[message.safetyNotice] != null)
                                    Padding(
                                      padding: const EdgeInsets.only(top: 6),
                                      child: Text(
                                        _safetyText[message.safetyNotice]!,
                                        style: Theme.of(
                                          context,
                                        ).textTheme.bodySmall,
                                      ),
                                    ),
                                  const SizedBox(height: 4),
                                  Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Text(
                                        DateFormat(
                                          'dd/MM HH:mm',
                                        ).format(message.createdAt),
                                        style: Theme.of(
                                          context,
                                        ).textTheme.labelSmall,
                                      ),
                                      if (!message.mine && !message.removed)
                                        IconButton(
                                          tooltip: 'Denunciar mensagem',
                                          visualDensity: VisualDensity.compact,
                                          iconSize: 16,
                                          icon: const Icon(Icons.flag_outlined),
                                          onPressed: () => _report(message),
                                        ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          ),
                        );
                      },
                    ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Text(_error!, style: TextStyle(color: scheme.error)),
              ),
            if (conversation != null && !conversation.open)
              Padding(
                padding: const EdgeInsets.all(12),
                child: Text(
                  conversation.closedByMe
                      ? 'Você encerrou esta conversa. Reabra para continuar.'
                      : 'A outra pessoa encerrou esta conversa.',
                ),
              )
            else
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _draft,
                        maxLength: 1000,
                        minLines: 1,
                        maxLines: 4,
                        textInputAction: TextInputAction.send,
                        onSubmitted: (_) => _send(),
                        decoration: const InputDecoration(
                          labelText: 'Escreva uma mensagem',
                          counterText: '',
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    IconButton.filled(
                      tooltip: 'Enviar',
                      onPressed: _sending ? null : _send,
                      icon: const Icon(Icons.send),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
