import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/network/api_client.dart';
import '../../../core/utils/public_text_safety.dart';
import '../../auth/application/auth_controller.dart';
import '../../feed/application/feed_controller.dart';
import '../../feed/data/items_repository.dart';
import '../../feed/domain/item.dart';
import '../../feed/domain/feed_comment.dart';
import '../../feed/presentation/widgets/status_badge.dart';
import 'items_screen.dart';

final itemDetailProvider = FutureProvider.autoDispose
    .family<Map<String, dynamic>, int>((ref, id) {
      ref.watch(authControllerProvider.select((value) => value.user?.id));
      return ref.watch(itemsRepositoryProvider).detail(id);
    });

class ItemDetailScreen extends ConsumerStatefulWidget {
  const ItemDetailScreen({required this.id, super.key});
  final int id;
  @override
  ConsumerState<ItemDetailScreen> createState() => _ItemDetailScreenState();
}

class _ItemDetailScreenState extends ConsumerState<ItemDetailScreen> {
  bool _busy = false;
  final _commentsKey = GlobalKey();

  void _reload() {
    ref.invalidate(itemDetailProvider(widget.id));
    ref.invalidate(_claimsProvider(widget.id));
    ref.read(feedControllerProvider.notifier).refreshFeed();
  }

  Future<void> _run(Future<void> Function() action, String success) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await action();
      if (!mounted) return;
      _reload();
      _message(success);
    } catch (error) {
      if (mounted) _message(apiErrorMessage(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _message(String text) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

  Future<void> _form({
    required String title,
    required List<ActionField> fields,
    required Future<void> Function(Map<String, String>) submit,
    String? note,
  }) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (_) =>
          ActionForm(title: title, fields: fields, submit: submit, note: note),
    );
    if (!mounted || result != true) return;
    _reload();
    _message('Operação concluída.');
  }

  Future<void> _delete(Item item) async {
    if (_busy) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Excluir item?'),
        content: Text(
          'O caso "${item.title}" e suas pistas e reivindicações serão removidos. Esta ação não pode ser desfeita.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
              foregroundColor: Theme.of(context).colorScheme.onError,
            ),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Excluir'),
          ),
        ],
      ),
    );
    if (!mounted || confirmed != true) return;
    setState(() => _busy = true);
    try {
      await ref.read(itemsRepositoryProvider).delete(item.id);
      if (!mounted) return;
      ref.read(feedControllerProvider.notifier).refreshFeed();
      _message('Item excluído.');
      context.canPop() ? context.pop() : context.go('/items');
    } catch (error) {
      if (mounted) _message(apiErrorMessage(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _return(Item item) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final body = await ref
          .read(itemsRepositoryProvider)
          .collection('/items/${item.id}/claims');
      if (!mounted) return;
      final claims = (body['data'] as List).cast<Map<String, dynamic>>();
      final result = await showDialog<bool>(
        context: context,
        builder: (_) => ReturnDialog(item: item, claims: claims),
      );
      if (mounted && result == true) {
        _reload();
        _message('Devolução registrada.');
      }
    } catch (error) {
      if (mounted) _message(apiErrorMessage(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final detail = ref.watch(itemDetailProvider(widget.id));
    final user = ref.watch(authControllerProvider).user;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Detalhes do item'),
        leading: IconButton(
          tooltip: 'Voltar',
          icon: const Icon(Icons.arrow_back),
          onPressed: () =>
              context.canPop() ? context.pop() : context.go('/items'),
        ),
      ),
      body: detail.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) =>
            RetryNotice(message: apiErrorMessage(error), onRetry: _reload),
        data: (body) {
          final item = Item.fromJson(body['item'] as Map<String, dynamic>);
          final json = body['item'] as Map<String, dynamic>;
          final caps = body['capabilities'] as Map<String, dynamic>? ?? {};
          final repository = ref.read(itemsRepositoryProvider);
          final url = repository.assetUrl(item.imageUrl);
          return RefreshIndicator(
            onRefresh: () async {
              _reload();
              await ref.read(itemDetailProvider(widget.id).future);
            },
            child: ListView(
              padding: const EdgeInsets.all(16),
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                if (url.isNotEmpty)
                  Semantics(
                    label: 'Foto do item. Toque para ampliar.',
                    button: true,
                    child: InkWell(
                      onTap: () => showDialog<void>(
                        context: context,
                        builder: (context) => Dialog.fullscreen(
                          child: Scaffold(
                            appBar: AppBar(title: const Text('Foto do item')),
                            body: Center(
                              child: InteractiveViewer(
                                child: Image.network(
                                  url,
                                  errorBuilder: (_, _, _) =>
                                      const Text('Foto indisponível.'),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                      child: SizedBox(
                        height: 220,
                        child: Image.network(
                          url,
                          fit: BoxFit.contain,
                          errorBuilder: (_, _, _) =>
                              const Icon(Icons.image_not_supported_outlined),
                        ),
                      ),
                    ),
                  ),
                Text(
                  item.title,
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                Wrap(
                  spacing: 12,
                  runSpacing: 8,
                  children: [
                    StatusBadge(status: item.status),
                    Text(
                      item.type == ItemType.found ? 'Encontrado' : 'Perdido',
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Text(item.description),
                Text('${item.category} • ${item.location}'),
                Text('Data do ocorrido: ${item.eventDate}'),
                if (json['campus_block'] != null)
                  Text('Bloco: ${json['campus_block']}'),
                if (json['approximate_place'] != null)
                  Text('Ponto aproximado: ${json['approximate_place']}'),
                if (json['moderation_note'] != null)
                  Text('Moderação: ${json['moderation_note']}'),
                const SizedBox(height: 16),
                if (user == null)
                  FilledButton(
                    onPressed: () =>
                        context.push('/login?next=/items/${item.id}'),
                    child: const Text('Entrar para participar'),
                  ),
                if (body['myClaim'] != null)
                  const Text(
                    'Você já enviou uma solicitação para este item. Acompanhe em Meus itens.',
                  ),
                if (caps['claim'] == true && body['myClaim'] == null)
                  FilledButton(
                    onPressed: _busy
                        ? null
                        : () => _form(
                            title: item.type == ItemType.found
                                ? 'Reivindicar item'
                                : 'Enviar informação privada',
                            note:
                                'Estas informações ficam restritas a você e às pessoas autorizadas a analisar o caso. Não publique documentos nas pistas públicas.',
                            fields: const [
                              ActionField(
                                'message',
                                'Mensagem',
                                min: 10,
                                max: 1000,
                                lines: 3,
                              ),
                              ActionField(
                                'proof',
                                'Detalhes que comprovam a propriedade ou a informação',
                                min: 10,
                                max: 1000,
                                lines: 4,
                              ),
                            ],
                            submit: (values) => repository.claim(
                              item.id,
                              values['message']!,
                              values['proof']!,
                            ),
                          ),
                    child: Text(
                      item.type == ItemType.found
                          ? 'Reivindicar item'
                          : 'Tenho informação',
                    ),
                  ),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    if (user != null)
                      OutlinedButton.icon(
                        onPressed: _busy
                            ? null
                            : () => _run(
                                () => body['following'] == true
                                    ? repository.unfollow(item.id)
                                    : repository.follow(item.id),
                                'Acompanhamento atualizado.',
                              ),
                        icon: Icon(
                          body['following'] == true
                              ? Icons.bookmark
                              : Icons.bookmark_outline,
                        ),
                        label: Text(
                          body['following'] == true
                              ? 'Deixar de acompanhar'
                              : 'Acompanhar',
                        ),
                      ),
                    OutlinedButton(
                      onPressed: () {
                        final target = _commentsKey.currentContext;
                        if (target != null) {
                          Scrollable.ensureVisible(
                            target,
                            duration: const Duration(milliseconds: 250),
                          );
                        }
                      },
                      child: const Text('Pistas públicas'),
                    ),
                    OutlinedButton(
                      onPressed: () async {
                        try {
                          await Clipboard.setData(
                            ClipboardData(
                              text:
                                  '${ArgosApiConfig.webBaseUrl}/items/${item.id}',
                            ),
                          );
                          if (mounted) _message('Link copiado.');
                        } catch (_) {
                          if (mounted) {
                            _message('Não foi possível copiar o link.');
                          }
                        }
                      },
                      child: const Text('Copiar link'),
                    ),
                    if (user != null)
                      OutlinedButton(
                        onPressed: () => _form(
                          title: 'Denunciar caso',
                          fields: const [
                            ActionField(
                              'reason',
                              'Motivo da denúncia',
                              min: 4,
                              max: 500,
                              lines: 3,
                            ),
                          ],
                          submit: (values) async {
                            await ref
                                .read(apiClientProvider)
                                .dio
                                .post<void>(
                                  '/items/${item.id}/report',
                                  data: values,
                                );
                          },
                        ),
                        child: const Text('Denunciar'),
                      ),
                    if (caps['edit'] == true)
                      OutlinedButton(
                        onPressed: () => context.push('/items/${item.id}/edit'),
                        child: const Text('Editar item'),
                      ),
                    if (caps['delete'] == true)
                      OutlinedButton(
                        onPressed: _busy ? null : () => _delete(item),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: Theme.of(context).colorScheme.error,
                        ),
                        child: const Text('Excluir item'),
                      ),
                    if (caps['return'] == true)
                      FilledButton(
                        onPressed: _busy ? null : () => _return(item),
                        child: const Text('Registrar devolução'),
                      ),
                  ],
                ),
                if (_busy) const LinearProgressIndicator(),
                if (caps['readClaims'] == true) PrivateClaims(itemId: item.id),
                const SizedBox(height: 20),
                Text(
                  'Pistas públicas',
                  key: _commentsKey,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const Text(
                  'Não compartilhe telefone, documentos ou provas de propriedade aqui.',
                ),
                if (user?.permissions.contains('chat:send') == true &&
                    item.approvalStatus == ApprovalStatus.approved)
                  OutlinedButton(
                    onPressed: () => _form(
                      title: 'Publicar pista',
                      fields: const [
                        ActionField(
                          'body',
                          'Pista ou pergunta pública',
                          min: 1,
                          max: 500,
                          lines: 4,
                          publicText: true,
                        ),
                      ],
                      submit: (values) async {
                        await repository.addComment(item.id, values['body']!);
                      },
                    ),
                    child: const Text('Adicionar pista'),
                  ),
                CommentsList(key: ValueKey(body), itemId: item.id),
              ],
            ),
          );
        },
      ),
    );
  }
}

class ActionField {
  const ActionField(
    this.key,
    this.label, {
    this.initial = '',
    this.min = 0,
    this.max = 120,
    this.lines = 1,
    this.publicText = false,
  });
  final String key, label, initial;
  final int min, max, lines;
  final bool publicText;
}

class ActionForm extends StatefulWidget {
  const ActionForm({
    required this.title,
    required this.fields,
    required this.submit,
    this.note,
    super.key,
  });
  final String title;
  final String? note;
  final List<ActionField> fields;
  final Future<void> Function(Map<String, String>) submit;
  @override
  State<ActionForm> createState() => _ActionFormState();
}

class _ActionFormState extends State<ActionForm> {
  final _form = GlobalKey<FormState>();
  late final _controllers = {
    for (final field in widget.fields)
      field.key: TextEditingController(text: field.initial),
  };
  bool _busy = false;
  String? _error;
  @override
  void dispose() {
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy || !_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.submit({
        for (final entry in _controllers.entries)
          entry.key: entry.value.text.trim(),
      });
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      if (mounted) setState(() => _error = apiErrorMessage(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !_busy,
    child: AlertDialog(
      title: Text(widget.title),
      scrollable: true,
      content: Form(
        key: _form,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (widget.note != null) Text(widget.note!),
            for (final field in widget.fields)
              TextFormField(
                controller: _controllers[field.key],
                enabled: !_busy,
                decoration: InputDecoration(labelText: field.label),
                minLines: field.lines,
                maxLines: field.lines + 2,
                maxLength: field.max,
                validator: (value) {
                  final text = value?.trim() ?? '';
                  if (text.length < field.min) {
                    return 'Informe pelo menos ${field.min} caracteres.';
                  }
                  if (field.publicText) {
                    final error = validatePublicTextSafety(text);
                    if (error.isNotEmpty) return error;
                  }
                  return null;
                },
              ),
            if (_error != null)
              Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            if (_busy) const LinearProgressIndicator(),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.pop(context),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: _busy ? null : _submit,
          child: const Text('Confirmar'),
        ),
      ],
    ),
  );
}

class CommentsList extends ConsumerStatefulWidget {
  const CommentsList({required this.itemId, super.key});
  final int itemId;
  @override
  ConsumerState<CommentsList> createState() => _CommentsListState();
}

class _CommentsListState extends ConsumerState<CommentsList> {
  List<FeedComment> _rows = [];
  bool _busy = false, _more = true;
  int _page = 0;
  String? _error;
  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final body = await ref
          .read(itemsRepositoryProvider)
          .collection('/items/${widget.itemId}/comments', page: _page + 1);
      if (!mounted) return;
      setState(() {
        _rows = [
          ..._rows,
          ...(body['data'] as List).cast<Map<String, dynamic>>().map(
            FeedComment.fromJson,
          ),
        ];
        _page++;
        _more = _rows.length < (body['meta']['total'] as int);
      });
    } catch (error) {
      if (mounted) setState(() => _error = apiErrorMessage(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      for (final comment in _rows)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Text('@${comment.handle}\n${comment.body}'),
        ),
      if (_rows.isEmpty && !_busy && _error == null)
        const Text('Nenhuma pista publicada.'),
      if (_error != null) RetryNotice(message: _error!, onRetry: _load),
      if (_busy) const LinearProgressIndicator(),
      if (_more && _error == null)
        TextButton(
          onPressed: _busy ? null : _load,
          child: const Text('Carregar pistas'),
        ),
    ],
  );
}

final _claimsProvider = FutureProvider.autoDispose
    .family<List<Map<String, dynamic>>, int>((ref, id) async {
      ref.watch(authControllerProvider.select((auth) => auth.user?.id));
      return ((await ref
                  .watch(itemsRepositoryProvider)
                  .collection('/items/$id/claims'))['data']
              as List)
          .cast<Map<String, dynamic>>();
    });

class PrivateClaims extends ConsumerWidget {
  const PrivateClaims({required this.itemId, super.key});
  final int itemId;
  @override
  Widget build(BuildContext context, WidgetRef ref) => ExpansionTile(
    title: const Text('Solicitações recebidas — privadas'),
    children: [
      ref
          .watch(_claimsProvider(itemId))
          .when(
            loading: () => const LinearProgressIndicator(),
            error: (error, _) => RetryNotice(
              message: apiErrorMessage(error),
              onRetry: () => ref.invalidate(_claimsProvider(itemId)),
            ),
            data: (rows) => Column(
              children: [
                if (rows.isEmpty) const Text('Nenhuma solicitação recebida.'),
                for (final row in rows)
                  ListTile(
                    title: Text(
                      '${row['claimant_name']} • ${claimStatus(row['status'])}',
                    ),
                    subtitle: Text(
                      '${row['message']}\nProvas: ${row['proof_details']}',
                    ),
                  ),
              ],
            ),
          ),
    ],
  );
}

String claimStatus(Object? value) => switch (value) {
  'approved' => 'Aprovada',
  'rejected' => 'Não selecionada',
  _ => 'Em análise',
};

class ReturnDialog extends ConsumerStatefulWidget {
  const ReturnDialog({required this.item, required this.claims, super.key});
  final Item item;
  final List<Map<String, dynamic>> claims;
  @override
  ConsumerState<ReturnDialog> createState() => _ReturnDialogState();
}

class _ReturnDialogState extends ConsumerState<ReturnDialog> {
  int? _claimId;
  bool _busy = false;
  String? _error;
  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !_busy,
    child: AlertDialog(
      scrollable: true,
      title: const Text('Confirmar devolução'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text(
            'Confirme somente após verificar a propriedade e entregar o item. Esta ação encerra o caso.',
          ),
          DropdownButtonFormField<int>(
            isExpanded: true,
            decoration: const InputDecoration(
              labelText: 'Solicitação correspondente',
            ),
            items: [
              for (final claim in widget.claims.where(
                (row) => ['pending', 'approved'].contains(row['status']),
              ))
                DropdownMenuItem(
                  value: claim['id'] as int,
                  child: Text(
                    '#${claim['id']} — ${claim['claimant_name']}',
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
            ],
            onChanged: _busy
                ? null
                : (value) => setState(() => _claimId = value),
          ),
          if (widget.item.type == ItemType.found)
            const Text(
              'Selecione a solicitação do proprietário para continuar.',
            ),
          if (_error != null) Text(_error!),
          if (_busy) const LinearProgressIndicator(),
        ],
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.pop(context),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed:
              _busy || (widget.item.type == ItemType.found && _claimId == null)
              ? null
              : () async {
                  setState(() => _busy = true);
                  try {
                    await ref
                        .read(itemsRepositoryProvider)
                        .returnItem(widget.item.id, _claimId);
                    if (context.mounted) Navigator.pop(context, true);
                  } catch (error) {
                    if (mounted) {
                      setState(() => _error = apiErrorMessage(error));
                    }
                  } finally {
                    if (mounted) setState(() => _busy = false);
                  }
                },
          child: const Text('Confirmar entrega'),
        ),
      ],
    ),
  );
}
