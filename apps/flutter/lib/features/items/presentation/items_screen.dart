import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/network/api_client.dart';
import '../../feed/data/items_repository.dart';
import '../../feed/domain/item.dart';
import '../../feed/presentation/widgets/status_badge.dart';

const itemCategories = [
  'Documentos',
  'Chaves',
  'Eletrônicos',
  'Bolsas e mochilas',
  'Vestuário',
  'Materiais escolares',
  'Outros',
];

class ItemsScreen extends ConsumerStatefulWidget {
  const ItemsScreen({super.key});
  @override
  ConsumerState<ItemsScreen> createState() => _ItemsScreenState();
}

class _ItemsScreenState extends ConsumerState<ItemsScreen> {
  final _text = TextEditingController();
  final _location = TextEditingController();
  final _scroll = ScrollController();
  final _filters = <String, dynamic>{};
  List<Item> _items = [];
  Timer? _debounce;
  CancelToken? _cancel;
  int _generation = 0, _page = 0;
  bool _loading = false, _more = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    Future.microtask(() => _load(reset: true));
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _cancel?.cancel();
    _text.dispose();
    _location.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _changed() {
    _debounce?.cancel();
    _cancel?.cancel();
    _generation++;
    setState(() {
      _loading = true;
      _error = null;
    });
    _debounce = Timer(
      const Duration(milliseconds: 350),
      () => _load(reset: true),
    );
  }

  Future<void> _load({bool reset = false}) async {
    if (!reset && (_loading || !_more)) return;
    _cancel?.cancel();
    _cancel = CancelToken();
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = reset ? 1 : _page + 1;
      final result = await ref
          .read(itemsRepositoryProvider)
          .search(
            page: page,
            limit: 20,
            filters: {
              ..._filters,
              'q': _text.text.trim(),
              'location': _location.text.trim(),
            },
            cancelToken: _cancel,
          );
      if (!mounted || generation != _generation) return;
      setState(() {
        final entries = <int, Item>{
          if (!reset)
            for (final item in _items) item.id: item,
        };
        for (final item in result.items) {
          entries[item.id] = item;
        }
        _items = entries.values.toList();
        _page = page;
        _more = result.items.isNotEmpty && page * 20 < result.total;
      });
      if (reset && _scroll.hasClients) _scroll.jumpTo(0);
    } catch (error) {
      if (mounted &&
          generation == _generation &&
          !(error is DioException && CancelToken.isCancel(error))) {
        setState(() => _error = apiErrorMessage(error));
      }
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  Widget _select(String key, String label, Map<String, String> options) =>
      DropdownButtonFormField<String>(
        key: ValueKey('$key-${_filters[key]}'),
        isExpanded: true,
        initialValue: _filters[key]?.toString() ?? '',
        decoration: InputDecoration(labelText: label),
        items: [
          const DropdownMenuItem(value: '', child: Text('Todos')),
          ...options.entries.map(
            (entry) =>
                DropdownMenuItem(value: entry.key, child: Text(entry.value)),
          ),
        ],
        onChanged: (value) {
          setState(() {
            if (value == null || value.isEmpty) {
              _filters.remove(key);
            } else {
              _filters[key] = value;
            }
          });
          _changed();
        },
      );

  Future<void> _dates() async {
    final range = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2000),
      lastDate: DateTime.now(),
    );
    if (!mounted || range == null) return;
    setState(() {
      _filters['from'] = range.start.toIso8601String().substring(0, 10);
      _filters['to'] = range.end.toIso8601String().substring(0, 10);
    });
    _changed();
  }

  @override
  Widget build(BuildContext context) => Column(
    children: [
      Padding(
        padding: const EdgeInsets.all(16),
        child: TextField(
          controller: _text,
          maxLength: 120,
          decoration: const InputDecoration(
            labelText: 'Buscar item',
            prefixIcon: Icon(Icons.search),
            counterText: '',
          ),
          onChanged: (_) => _changed(),
        ),
      ),
      Flexible(
        flex: 0,
        child: ExpansionTile(
          title: const Text('Filtros e ordenação'),
          children: [
            ConstrainedBox(
              constraints: BoxConstraints(
                maxHeight: MediaQuery.sizeOf(context).height * 0.25,
              ),
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    _select('type', 'Tipo', {
                      'lost': 'Perdido',
                      'found': 'Encontrado',
                    }),
                    _select('category', 'Categoria', {
                      for (final category in itemCategories) category: category,
                    }),
                    _select('status', 'Situação', {
                      'lost': 'Perdido',
                      'found': 'Encontrado',
                      'claimed': 'Em análise',
                      'returned': 'Devolvido',
                    }),
                    _select('sort', 'Ordenação', {
                      'newest': 'Mais recentes',
                      'oldest': 'Mais antigos',
                      'event_date_desc': 'Ocorrido mais recente',
                      'event_date_asc': 'Ocorrido mais antigo',
                    }),
                    _select('hasImage', 'Foto', {
                      'true': 'Com foto',
                      'false': 'Sem foto',
                    }),
                    TextField(
                      controller: _location,
                      maxLength: 120,
                      decoration: const InputDecoration(labelText: 'Local'),
                      onChanged: (_) => _changed(),
                    ),
                    TextButton(
                      onPressed: _dates,
                      child: Text(
                        _filters.containsKey('from')
                            ? '${_filters['from']} até ${_filters['to']}'
                            : 'Selecionar período',
                      ),
                    ),
                    TextButton(
                      onPressed: () {
                        _text.clear();
                        _location.clear();
                        setState(_filters.clear);
                        _changed();
                      },
                      child: const Text('Limpar filtros'),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
      if (_loading) const LinearProgressIndicator(),
      if (_error != null)
        RetryNotice(message: _error!, onRetry: () => _load(reset: true)),
      Expanded(
        child: RefreshIndicator(
          onRefresh: () => _load(reset: true),
          child: ListView.builder(
            key: const PageStorageKey('search-results'),
            controller: _scroll,
            physics: const AlwaysScrollableScrollPhysics(),
            itemCount: _items.length + 1,
            itemBuilder: (context, index) {
              if (index < _items.length) return ItemTile(item: _items[index]);
              if (_items.isEmpty && !_loading && _error == null) {
                return const Padding(
                  padding: EdgeInsets.all(24),
                  child: Text(
                    'Nenhum item encontrado. Experimente outros filtros.',
                  ),
                );
              }
              return _more
                  ? TextButton(
                      onPressed: _loading ? null : () => _load(),
                      child: const Text('Carregar mais'),
                    )
                  : const Padding(
                      padding: EdgeInsets.all(24),
                      child: Center(child: Text('Fim dos resultados.')),
                    );
            },
          ),
        ),
      ),
    ],
  );
}

class ItemTile extends ConsumerWidget {
  const ItemTile({required this.item, super.key});
  final Item item;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final image = ref.watch(itemsRepositoryProvider).assetUrl(item.imageUrl);
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: InkWell(
        onTap: () => context.push('/items/${item.id}'),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (image.isNotEmpty)
                SizedBox(
                  height: 100,
                  width: double.infinity,
                  child: Image.network(
                    image,
                    fit: BoxFit.contain,
                    errorBuilder: (_, _, _) =>
                        const Icon(Icons.image_not_supported_outlined),
                  ),
                ),
              Text(item.title, style: Theme.of(context).textTheme.titleMedium),
              Text('${item.category} • ${item.location}'),
              const SizedBox(height: 8),
              StatusBadge(status: item.status),
              if (item.approvalStatus != ApprovalStatus.approved)
                Text(
                  item.approvalStatus == ApprovalStatus.pending
                      ? 'Aguardando moderação'
                      : 'Publicação não aprovada',
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class RetryNotice extends StatelessWidget {
  const RetryNotice({required this.message, required this.onRetry, super.key});
  final String message;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(12),
    child: Wrap(
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Text(message),
        TextButton(onPressed: onRetry, child: const Text('Tentar novamente')),
      ],
    ),
  );
}
