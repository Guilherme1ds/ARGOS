import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/network/api_client.dart';
import '../../auth/application/auth_controller.dart';
import '../../feed/data/items_repository.dart';
import '../../feed/domain/item.dart';
import 'items_screen.dart';
import 'item_detail_screen.dart';

class MyItemsScreen extends StatelessWidget {
  const MyItemsScreen({super.key});
  @override
  Widget build(BuildContext context) => DefaultTabController(
    length: 3,
    child: Column(
      children: [
        const TabBar(
          isScrollable: true,
          tabs: [
            Tab(text: 'Publicações'),
            Tab(text: 'Solicitações enviadas'),
            Tab(text: 'Acompanhando'),
          ],
        ),
        const Expanded(
          child: TabBarView(
            children: [
              AccountCollection(path: '/items'),
              AccountCollection(path: '/items/my-claims'),
              AccountCollection(path: '/items/following'),
            ],
          ),
        ),
      ],
    ),
  );
}

class AccountCollection extends ConsumerStatefulWidget {
  const AccountCollection({required this.path, super.key});
  final String path;
  @override
  ConsumerState<AccountCollection> createState() => _AccountCollectionState();
}

class _AccountCollectionState extends ConsumerState<AccountCollection> {
  List<Map<String, dynamic>> _rows = [];
  int _page = 0, _generation = 0;
  bool _busy = false, _more = true;
  String? _error;
  @override
  void initState() {
    super.initState();
    Future.microtask(() => _load(reset: true));
  }

  Future<void> _load({bool reset = false}) async {
    if (_busy && !reset) return;
    final generation = ++_generation;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final page = reset ? 1 : _page + 1;
      final body = await ref
          .read(itemsRepositoryProvider)
          .collection(widget.path, page: page);
      if (!mounted || generation != _generation) return;
      setState(() {
        final rows = (body['data'] as List).cast<Map<String, dynamic>>();
        final unique = <int, Map<String, dynamic>>{
          if (!reset)
            for (final row in _rows) row['id'] as int: row,
        };
        for (final row in rows) {
          unique[row['id'] as int] = row;
        }
        _rows = unique.values.toList();
        _page = page;
        _more =
            body['meta'] is Map &&
            rows.isNotEmpty &&
            page * 20 < (body['meta']['total'] as int);
      });
    } catch (error) {
      if (mounted && generation == _generation) {
        setState(() => _error = apiErrorMessage(error));
      }
    } finally {
      if (mounted && generation == _generation) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Column(
    children: [
      if (_busy) const LinearProgressIndicator(),
      if (_error != null)
        RetryNotice(
          message: _error!,
          onRetry: () => _load(reset: _page == 0),
        ),
      Expanded(
        child: RefreshIndicator(
          onRefresh: () => _load(reset: true),
          child: ListView.builder(
            physics: const AlwaysScrollableScrollPhysics(),
            itemCount: _rows.length + 1,
            itemBuilder: (context, index) {
              if (index == _rows.length) {
                if (_rows.isEmpty && !_busy && _error == null) {
                  return const Padding(
                    padding: EdgeInsets.all(24),
                    child: Text('Nenhum registro aqui ainda.'),
                  );
                }
                return _more
                    ? TextButton(
                        onPressed: _busy ? null : _load,
                        child: const Text('Carregar mais'),
                      )
                    : const SizedBox(height: 24);
              }
              final row = _rows[index];
              if (widget.path == '/items/my-claims') {
                return ListTile(
                  title: Text(row['item_title']?.toString() ?? 'Solicitação'),
                  subtitle: Text(claimStatus(row['status'])),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () async {
                    await context.push('/items/${row['item_id']}');
                    if (mounted) _load(reset: true);
                  },
                );
              }
              return ItemTile(item: Item.fromJson(row));
            },
          ),
        ),
      ),
    ],
  );
}

final unreadProvider = FutureProvider.autoDispose<int>((ref) async {
  final user = ref.watch(
    authControllerProvider.select((auth) => auth.user?.id),
  );
  if (user == null) return 0;
  final response = await ref
      .watch(apiClientProvider)
      .dio
      .get<Map<String, dynamic>>('/notifications/unread-count');
  return response.data?['total'] as int? ?? 0;
});
final _notificationsProvider =
    FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
      ref.watch(authControllerProvider.select((auth) => auth.user?.id));
      return ((await ref
                  .watch(itemsRepositoryProvider)
                  .collection('/notifications'))['data']
              as List)
          .cast<Map<String, dynamic>>();
    });

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});
  @override
  ConsumerState<NotificationsScreen> createState() =>
      _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  bool _busy = false;
  final _marked = <int>{};

  /// Abrir a notificação marca como lida (o contador do menu diminui); falha não bloqueia a navegação.
  void _markRead(Map<String, dynamic> row) {
    final id = row['id'];
    if (row['read_at'] != null || id is! int || !_marked.add(id)) return;
    setState(() {});
    ref
        .read(apiClientProvider)
        .dio
        .patch<void>('/notifications/$id/read')
        .then(
          (_) {
            if (!mounted) return;
            ref.invalidate(unreadProvider);
            ref.invalidate(_notificationsProvider);
          },
          onError: (Object _) {
            if (mounted) setState(() => _marked.remove(id));
          },
        );
  }

  Future<void> _refresh() async {
    ref.invalidate(unreadProvider);
    ref.invalidate(_notificationsProvider);
    try {
      await ref.read(_notificationsProvider.future);
    } catch (_) {
      /* rendered below */
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Notificações')),
    body: Column(
      children: [
        TextButton(
          onPressed: _busy
              ? null
              : () async {
                  setState(() => _busy = true);
                  try {
                    await ref
                        .read(apiClientProvider)
                        .dio
                        .post<void>('/notifications/read-all');
                    if (mounted) await _refresh();
                  } catch (error) {
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text(apiErrorMessage(error))),
                      );
                    }
                  } finally {
                    if (mounted) setState(() => _busy = false);
                  }
                },
          child: const Text('Marcar todas como lidas'),
        ),
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 16),
          child: Text('Exibindo as 50 notificações mais recentes.'),
        ),
        Expanded(
          child: ref
              .watch(_notificationsProvider)
              .when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (error, _) => RetryNotice(
                  message: apiErrorMessage(error),
                  onRetry: _refresh,
                ),
                data: (rows) => RefreshIndicator(
                  onRefresh: _refresh,
                  child: ListView.builder(
                    physics: const AlwaysScrollableScrollPhysics(),
                    itemCount: rows.isEmpty ? 1 : rows.length,
                    itemBuilder: (context, index) {
                      if (rows.isEmpty) {
                        return const Padding(
                          padding: EdgeInsets.all(24),
                          child: Text(
                            'Nenhuma notificação por enquanto. Você é avisado aqui sobre reivindicações, pistas e casos acompanhados.',
                          ),
                        );
                      }
                      final row = rows[index];
                      final target = row['action_url']?.toString() ?? '';
                      final valid = RegExp(
                        r'^/items/[1-9][0-9]*$',
                      ).hasMatch(target);
                      final unread =
                          row['read_at'] == null &&
                          !_marked.contains(row['id']);
                      return ListTile(
                        leading: Icon(
                          unread
                              ? Icons.mark_email_unread_outlined
                              : Icons.drafts_outlined,
                          semanticLabel: unread ? 'Não lida' : 'Lida',
                        ),
                        title: Text(row['title'].toString()),
                        subtitle: Text(row['body'].toString()),
                        trailing: valid
                            ? const Icon(Icons.chevron_right)
                            : null,
                        onTap: valid || unread
                            ? () {
                                _markRead(row);
                                if (valid) context.push(target);
                              }
                            : null,
                      );
                    },
                  ),
                ),
              ),
        ),
      ],
    ),
  );
}

final _privacyProvider = FutureProvider.autoDispose<Map<String, dynamic>>((
  ref,
) async {
  ref.watch(authControllerProvider.select((auth) => auth.user?.id));
  return (await ref
              .watch(apiClientProvider)
              .dio
              .get<Map<String, dynamic>>('/privacy/summary'))
          .data!['data']
      as Map<String, dynamic>;
});

class PrivacyScreen extends ConsumerWidget {
  const PrivacyScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
    appBar: AppBar(
      title: const Text('Privacidade'),
      leading: IconButton(
        tooltip: 'Voltar',
        icon: const Icon(Icons.arrow_back),
        onPressed: () => context.canPop() ? context.pop() : context.go('/'),
      ),
    ),
    body: ref
        .watch(_privacyProvider)
        .when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => RetryNotice(
            message: apiErrorMessage(error),
            onRetry: () => ref.invalidate(_privacyProvider),
          ),
          data: (body) {
            // Texto, versão e prazos vêm do servidor (fonte única com a web).
            final status = body['consentStatus'] as Map<String, dynamic>?;
            final retention = (body['retention'] as List? ?? const [])
                .cast<Map<String, dynamic>>();
            final headline = Theme.of(context).textTheme.titleMedium;
            return ListView(
              padding: const EdgeInsets.all(24),
              children: [
                Text(
                  'ARGOS • Termos ${body['termsVersion']}',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                if (status != null) ...[
                  const SizedBox(height: 12),
                  _ConsentStatusCard(
                    status: status,
                    termsVersion: body['termsVersion'].toString(),
                  ),
                ],
                const SizedBox(height: 16),
                Text(body['publicDataPolicy'].toString()),
                const SizedBox(height: 16),
                Text('Finalidades', style: headline),
                for (final purpose in body['purposes'] as List)
                  ListTile(title: Text(purpose.toString())),
                if (body['externalProcessors'] != null) ...[
                  Text('Serviços externos', style: headline),
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Text(body['externalProcessors'].toString()),
                  ),
                ],
                Text('Seus direitos', style: headline),
                for (final right in body['userRights'] as List)
                  ListTile(title: Text(right.toString())),
                // Exportação e exclusão de conta existem só na web: o app diz onde fazer.
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Exportar ou excluir a conta', style: headline),
                        const SizedBox(height: 8),
                        const Text(
                          'Estas ações ficam na versão web. Entre com a mesma conta no navegador e abra Configurações > Privacidade e conta:',
                        ),
                        const SizedBox(height: 4),
                        SelectableText('${ArgosApiConfig.webBaseUrl}/settings'),
                      ],
                    ),
                  ),
                ),
                if (retention.isNotEmpty) ...[
                  Text('Por quanto tempo guardamos', style: headline),
                  for (final rule in retention)
                    ListTile(
                      title: Text(rule['data'].toString()),
                      subtitle: Text(
                        rule['days'] != null
                            ? '${rule['days']} dias'
                            : (rule['note'] ?? '').toString(),
                      ),
                    ),
                ],
                for (final consent in body['consents'] as List)
                  Text(
                    '${consent['granted'] == 0 ? 'Revogação' : 'Consentimento'} ${consent['terms_version']} • ${consent['created_at']}',
                  ),
                const SizedBox(height: 12),
                const Text(
                  'Este resumo não substitui o aviso de privacidade oficial da instituição.',
                ),
              ],
            );
          },
        ),
  );
}

class _ConsentStatusCard extends ConsumerStatefulWidget {
  const _ConsentStatusCard({required this.status, required this.termsVersion});
  final Map<String, dynamic> status;
  final String termsVersion;
  @override
  ConsumerState<_ConsentStatusCard> createState() => _ConsentStatusCardState();
}

class _ConsentStatusCardState extends ConsumerState<_ConsentStatusCard> {
  var _busy = false;
  String? _error;

  Future<void> _accept() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(apiClientProvider)
          .dio
          .post<Map<String, dynamic>>(
            '/privacy/consents',
            data: {'accepted': true, 'termsVersion': widget.termsVersion},
          );
      ref.invalidate(_privacyProvider);
    } catch (error) {
      if (mounted) setState(() => _error = apiErrorMessage(error));
      ref.invalidate(_privacyProvider);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final upToDate = widget.status['upToDate'] == true;
    return Semantics(
      liveRegion: true,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                upToDate
                    ? 'Você aceitou a versão vigente.'
                    : 'O resumo foi atualizado desde o seu último aceite. Leia o texto e confirme, ou exclua a conta na web.',
              ),
              if (!upToDate) ...[
                const SizedBox(height: 12),
                FilledButton(
                  onPressed: _busy ? null : _accept,
                  child: Text(
                    _busy ? 'Aguarde...' : 'Aceitar a versão vigente',
                  ),
                ),
              ],
              if (_error != null) ...[
                const SizedBox(height: 8),
                Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
