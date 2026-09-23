import 'dart:async';
import 'dart:math';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import '../../../core/network/api_client.dart';
import '../../../core/utils/public_text_safety.dart';
import '../../auth/application/auth_controller.dart';
import '../../feed/application/feed_controller.dart';
import '../../feed/data/items_repository.dart';
import '../data/draft_store.dart';
import 'items_screen.dart';
import 'item_detail_screen.dart';

class ItemFormScreen extends ConsumerStatefulWidget {
  const ItemFormScreen({this.itemId, super.key});
  final int? itemId;
  @override
  ConsumerState<ItemFormScreen> createState() => _ItemFormScreenState();
}

class _ItemFormScreenState extends ConsumerState<ItemFormScreen>
    with WidgetsBindingObserver {
  final _form = GlobalKey<FormState>();
  final _drafts = DraftStore();
  final _picker = ImagePicker();
  final _controllers = {
    for (final key in [
      'title',
      'description',
      'location',
      'campusBlock',
      'approximatePlace',
    ])
      key: TextEditingController(),
  };
  final _fields = <String, dynamic>{
    'type': 'lost',
    'category': '',
    'contactPreference': 'in_app',
    'eventDate': DateTime.now().toIso8601String().substring(0, 10),
  };
  final _fieldKeys = {
    for (final key in [
      'title',
      'category',
      'location',
      'campusBlock',
      'approximatePlace',
      'description',
    ])
      key: GlobalKey<FormFieldState<String>>(),
  };
  final _focusNodes = {
    for (final key in [
      'title',
      'category',
      'location',
      'campusBlock',
      'approximatePlace',
      'description',
    ])
      key: FocusNode(),
  };
  Timer? _saveTimer;
  Uint8List? _bytes;
  String? _mime, _error;
  String _imageUrl = '', _filename = '', _operationKey = '';
  late final int _userId;
  late final int _epoch;
  bool _loading = true,
      _busy = false,
      _dirty = false,
      _uncertain = false,
      _leaving = false;
  double? _progress;
  bool get _active => mounted && ref.read(apiClientProvider).epoch == _epoch;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _userId = ref.read(authControllerProvider).user!.id;
    _epoch = ref.read(apiClientProvider).epoch;
    for (final controller in _controllers.values) {
      controller.addListener(_changed);
    }
    Future.microtask(_restore);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _saveTimer?.cancel();
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    for (final node in _focusNodes.values) {
      node.dispose();
    }
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.inactive && !_loading && _dirty) {
      _saveSafely();
    }
  }

  Future<void> _restore() async {
    try {
      if (widget.itemId != null) {
        final body = await ref
            .read(itemsRepositoryProvider)
            .detail(widget.itemId!);
        if (!_active) return;
        if (body['capabilities']['edit'] != true) {
          throw StateError('Sem permissão para editar.');
        }
        final item = body['item'] as Map<String, dynamic>;
        _fields.addAll({
          'type': item['type'],
          'category': item['category'],
          'contactPreference': item['contact_preference'] ?? 'in_app',
          'eventDate': item['event_date'],
        });
        for (final key in _controllers.keys) {
          final jsonKey =
              {
                'campusBlock': 'campus_block',
                'approximatePlace': 'approximate_place',
              }[key] ??
              key;
          _controllers[key]!.text = item[jsonKey]?.toString() ?? '';
        }
        _imageUrl = item['image_url']?.toString() ?? '';
      }
      if (!kIsWeb) {
        final draft = await _drafts.read(_userId, widget.itemId);
        if (!_active) return;
        if (draft != null) {
          _fields.addAll((draft['fields'] as Map).cast<String, dynamic>());
          for (final key in _controllers.keys) {
            _controllers[key]!.text = _fields.remove(key)?.toString() ?? '';
          }
          _imageUrl = draft['imageUrl']?.toString() ?? '';
          _filename = draft['filename']?.toString() ?? '';
          _mime = draft['mime'] as String?;
          _operationKey = draft['operationKey']?.toString() ?? '';
          _uncertain = draft['uncertain'] == true;
          _bytes = draft['hasLocalImage'] == true
              ? await _drafts.readImage(_userId, widget.itemId)
              : null;
          if (!_active) return;
          _dirty = true;
          _error = 'Rascunho recuperado. Revise antes de enviar.';
          if (draft['hasLocalImage'] == true &&
              _bytes == null &&
              _imageUrl.isEmpty) {
            _error = 'Rascunho recuperado. Selecione a foto novamente.';
          }
        }
        if (defaultTargetPlatform == TargetPlatform.android) {
          final lost = await _picker.retrieveLostData();
          if (!_active) return;
          if (lost.files?.isNotEmpty == true) {
            await _acceptImage(lost.files!.first);
          } else if (lost.exception != null) {
            _error = 'A foto não foi recuperada. Selecione novamente.';
          }
        }
      }
    } catch (error) {
      if (_active) _error = apiErrorMessage(error);
    } finally {
      if (_active) setState(() => _loading = false);
    }
  }

  Map<String, dynamic> _snapshot() => {
    ..._fields,
    for (final entry in _controllers.entries)
      entry.key: entry.value.text.trim(),
    'imageUrl': _imageUrl,
  };
  Future<void> _save() async {
    if (kIsWeb || !_active) return;
    await _drafts.write(_userId, widget.itemId, {
      'fields': _snapshot(),
      'imageUrl': _imageUrl,
      'filename': _filename,
      'mime': _mime,
      'operationKey': _operationKey,
      'uncertain': _uncertain,
      'hasLocalImage': _bytes != null,
    });
  }

  Future<void> _saveSafely() async {
    try {
      await _save();
    } catch (_) {
      if (_active) {
        setState(
          () => _error =
              'Não foi possível salvar o rascunho neste aparelho. Mantenha esta tela aberta.',
        );
      }
    }
  }

  void _changed() {
    if (_loading || _busy || _uncertain) return;
    _dirty = true;
    _saveTimer?.cancel();
    _saveTimer = Timer(const Duration(milliseconds: 350), _saveSafely);
  }

  void _set(String key, Object value) {
    setState(() => _fields[key] = value);
    _changed();
  }

  Future<void> _acceptImage(XFile image) async {
    final bytes = await image.readAsBytes();
    if (!_active) return;
    if (bytes.length > 5 * 1024 * 1024) {
      throw const FormatException('Foto muito grande.');
    }
    String? mime;
    if (bytes.length >= 3 &&
        bytes[0] == 255 &&
        bytes[1] == 216 &&
        bytes[2] == 255) {
      mime = 'image/jpeg';
    }
    if (bytes.length >= 8 &&
        listEquals(bytes.sublist(0, 8), [137, 80, 78, 71, 13, 10, 26, 10])) {
      mime = 'image/png';
    }
    if (bytes.length >= 12 &&
        String.fromCharCodes(bytes.sublist(0, 4)) == 'RIFF' &&
        String.fromCharCodes(bytes.sublist(8, 12)) == 'WEBP') {
      mime = 'image/webp';
    }
    if (mime == null) {
      throw const FormatException('Formato de foto não suportado.');
    }
    if (!kIsWeb) await _drafts.writeImage(_userId, widget.itemId, bytes);
    if (!_active) return;
    setState(() {
      _bytes = bytes;
      _filename = image.name;
      _mime = mime;
      _imageUrl = '';
      _error = null;
      _dirty = true;
    });
    await _save();
  }

  Future<void> _pick(ImageSource source) async {
    if (_busy || _uncertain) return;
    setState(() => _busy = true);
    try {
      await _save();
      final image = await _picker.pickImage(
        source: source,
        maxWidth: 1800,
        imageQuality: 88,
      );
      if (image != null && _active) await _acceptImage(image);
    } on PlatformException {
      if (_active) {
        setState(
          () => _error =
              'Acesso à foto indisponível. Verifique a permissão de câmera ou fotos nos ajustes do aparelho.',
        );
      }
    } on FormatException catch (error) {
      if (_active) {
        setState(
          () => _error = '${error.message} Use JPEG, PNG ou WebP de até 5 MB.',
        );
      }
    } catch (_) {
      if (_active) {
        setState(
          () => _error = 'Não foi possível selecionar a foto. Tente novamente.',
        );
      }
    } finally {
      if (_active) setState(() => _busy = false);
    }
  }

  Future<void> _submit() async {
    if (_busy) return;
    if (!_form.currentState!.validate()) {
      for (final entry in _fieldKeys.entries) {
        if (entry.value.currentState?.hasError == true) {
          _focusNodes[entry.key]!.requestFocus();
          final target = entry.value.currentContext;
          if (target != null) {
            await Scrollable.ensureVisible(
              target,
              duration: const Duration(milliseconds: 250),
            );
          }
          break;
        }
      }
      return;
    }
    FocusScope.of(context).unfocus();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        scrollable: true,
        title: const Text('Revisar publicação'),
        content: Text(
          '${_controllers['title']!.text}\n${_fields['category']} • ${_controllers['location']!.text}\n${_fields['eventDate']}\n\nA descrição e a foto ficarão públicas. Revise para não expor dados pessoais.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Revisar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Confirmar'),
          ),
        ],
      ),
    );
    if (!_active || confirmed != true) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    _saveTimer?.cancel();
    final repository = ref.read(itemsRepositoryProvider);
    var submitted = false;
    try {
      if (_bytes != null && _imageUrl.isEmpty) {
        _imageUrl = await repository.uploadImage(
          bytes: _bytes!,
          filename: _filename,
          mimeType: _mime!,
          onProgress: (sent, total) {
            if (_active) {
              setState(() => _progress = total > 0 ? sent / total : null);
            }
          },
        );
        if (!_active) return;
        await _save();
      }
      if (_operationKey.isEmpty) {
        _operationKey = List.generate(
          24,
          (_) => Random.secure().nextInt(256).toRadixString(16).padLeft(2, '0'),
        ).join();
      }
      _uncertain = true;
      await _save(); // Persist exactly what will be sent before the request starts.
      final fields = _snapshot();
      submitted = true;
      int id;
      if (widget.itemId != null) {
        await repository.update(widget.itemId!, fields);
        id = widget.itemId!;
      } else {
        id = await repository.create(
          CreateItemPayload(
            type: fields['type'],
            title: fields['title'],
            description: fields['description'],
            category: fields['category'],
            location: fields['location'],
            campusBlock: fields['campusBlock'],
            approximatePlace: fields['approximatePlace'],
            eventDate: fields['eventDate'],
            contactPreference: fields['contactPreference'],
            imageUrl: _imageUrl,
          ),
          operationKey: _operationKey,
        );
      }
      if (!_active) return;
      _dirty = false;
      _uncertain = false;
      if (!kIsWeb) await _drafts.clear(_userId, widget.itemId);
      if (!mounted || !_active) return;
      ref.invalidate(feedControllerProvider);
      ref.invalidate(itemDetailProvider(id));
      setState(() => _leaving = true);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Item salvo.')));
      context.go('/items/$id');
    } catch (error) {
      if (!_active) return;
      final code = error is DioException ? error.response?.statusCode : null;
      if (!submitted ||
          (code != null && code >= 400 && code < 500 && code != 409)) {
        _uncertain = false;
        _operationKey = '';
      }
      setState(() => _error = apiErrorMessage(error));
      await _saveSafely();
    } finally {
      if (_active) {
        setState(() {
          _busy = false;
          _progress = null;
        });
      }
    }
  }

  Future<void> _leave() async {
    if (_busy) return;
    if (_dirty) {
      final choice = await showDialog<String>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Sair da publicação?'),
          content: const Text(
            'Você pode guardar o preenchimento para continuar depois ou descartá-lo.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Continuar'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(context, 'discard'),
              child: const Text('Descartar'),
            ),
            if (!kIsWeb)
              FilledButton(
                onPressed: () => Navigator.pop(context, 'save'),
                child: const Text('Guardar e sair'),
              ),
          ],
        ),
      );
      if (!_active || choice == null) return;
      try {
        _saveTimer?.cancel();
        if (choice == 'discard' && !kIsWeb) {
          await _drafts.clear(_userId, widget.itemId);
        } else {
          await _save();
        }
      } catch (_) {
        if (_active) {
          setState(() => _error = 'Não foi possível guardar o rascunho.');
        }
        return;
      }
    }
    if (!_active) return;
    setState(() => _leaving = true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        if (context.canPop()) {
          context.pop();
        } else {
          context.go('/items');
        }
      }
    });
  }

  Widget _text(String key, String label, int min, int max, {int lines = 1}) =>
      TextFormField(
        key: _fieldKeys[key],
        focusNode: _focusNodes[key],
        controller: _controllers[key],
        maxLength: max,
        minLines: lines,
        maxLines: lines + 2,
        decoration: InputDecoration(labelText: label),
        textInputAction: lines == 1
            ? TextInputAction.next
            : TextInputAction.newline,
        validator: (value) {
          final text = value?.trim() ?? '';
          if (text.length < min) return 'Informe pelo menos $min caracteres.';
          final safety = validatePublicTextSafety(text);
          return safety.isEmpty ? null : safety;
        },
      );

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: _leaving,
    onPopInvokedWithResult: (didPop, _) {
      if (!didPop) _leave();
    },
    child: SafeArea(
      child: Column(
        children: [
          ListTile(
            leading: IconButton(
              tooltip: 'Voltar',
              onPressed: _busy ? null : _leave,
              icon: const Icon(Icons.arrow_back),
            ),
            title: Text(
              widget.itemId == null ? 'Publicar item' : 'Editar item',
            ),
          ),
          if (_loading)
            const Expanded(child: Center(child: CircularProgressIndicator()))
          else
            Expanded(
              child: Form(
                key: _form,
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
                  children: [
                    if (_error != null)
                      Padding(
                        padding: const EdgeInsets.all(12),
                        child: Text(_error!),
                      ),
                    if (_uncertain)
                      const Text(
                        'O envio pode ter sido concluído. Confira Meus itens ou repita esta mesma operação. Os dados ficam bloqueados para evitar duplicidade.',
                      ),
                    if (_uncertain)
                      TextButton(
                        onPressed: _busy
                            ? null
                            : () => context.push('/my-items'),
                        child: const Text('Conferir Meus itens'),
                      ),
                    AbsorbPointer(
                      absorbing: _busy || _uncertain,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          DropdownButtonFormField<String>(
                            initialValue: _fields['type'],
                            isExpanded: true,
                            decoration: const InputDecoration(
                              labelText: 'Tipo',
                            ),
                            items: const [
                              DropdownMenuItem(
                                value: 'lost',
                                child: Text('Perdido'),
                              ),
                              DropdownMenuItem(
                                value: 'found',
                                child: Text('Encontrado'),
                              ),
                            ],
                            onChanged: widget.itemId != null
                                ? null
                                : (value) {
                                    if (value != null) _set('type', value);
                                  },
                          ),
                          _text('title', 'Título', 3, 120),
                          DropdownButtonFormField<String>(
                            key: _fieldKeys['category'],
                            focusNode: _focusNodes['category'],
                            initialValue: _fields['category'] == ''
                                ? null
                                : _fields['category'],
                            isExpanded: true,
                            decoration: const InputDecoration(
                              labelText: 'Categoria',
                            ),
                            items: [
                              for (final category in {
                                ...itemCategories,
                                if (_fields['category'] != '')
                                  _fields['category'] as String,
                              })
                                DropdownMenuItem(
                                  value: category,
                                  child: Text(category),
                                ),
                            ],
                            onChanged: (value) {
                              if (value != null) _set('category', value);
                            },
                            validator: (value) => value == null || value.isEmpty
                                ? 'Selecione a categoria.'
                                : null,
                          ),
                          _text('location', 'Campus ou local', 2, 120),
                          _text('campusBlock', 'Bloco, sala ou setor', 0, 60),
                          _text('approximatePlace', 'Ponto aproximado', 0, 160),
                          OutlinedButton.icon(
                            icon: const Icon(Icons.calendar_today),
                            label: Text('Data: ${_fields['eventDate']}'),
                            onPressed: () async {
                              final today = DateTime.now();
                              final current =
                                  DateTime.tryParse(_fields['eventDate']) ??
                                  today;
                              final date = await showDatePicker(
                                context: context,
                                initialDate: current.isAfter(today)
                                    ? today
                                    : current,
                                firstDate: DateTime(2000),
                                lastDate: today,
                              );
                              if (_active && date != null) {
                                _set(
                                  'eventDate',
                                  date.toIso8601String().substring(0, 10),
                                );
                              }
                            },
                          ),
                          DropdownButtonFormField<String>(
                            initialValue: _fields['contactPreference'],
                            isExpanded: true,
                            decoration: const InputDecoration(
                              labelText: 'Contato',
                            ),
                            items: const [
                              DropdownMenuItem(
                                value: 'in_app',
                                child: Text('Pelo ARGOS'),
                              ),
                              DropdownMenuItem(
                                value: 'email',
                                child: Text('E-mail autorizado'),
                              ),
                            ],
                            onChanged: (value) {
                              if (value != null) {
                                _set('contactPreference', value);
                              }
                            },
                          ),
                          const SizedBox(height: 16),
                          if (_bytes != null)
                            SizedBox(
                              height: 180,
                              child: Image.memory(
                                _bytes!,
                                fit: BoxFit.contain,
                                errorBuilder: (_, _, _) => const Text(
                                  'Foto inválida. Selecione outra.',
                                ),
                              ),
                            )
                          else if (_imageUrl.isNotEmpty)
                            SizedBox(
                              height: 180,
                              child: Image.network(
                                ref
                                    .read(itemsRepositoryProvider)
                                    .assetUrl(_imageUrl),
                                fit: BoxFit.contain,
                                errorBuilder: (_, _, _) =>
                                    const Text('Foto indisponível.'),
                              ),
                            ),
                          Wrap(
                            spacing: 8,
                            children: [
                              OutlinedButton.icon(
                                onPressed: () => _pick(ImageSource.gallery),
                                icon: const Icon(Icons.photo_library_outlined),
                                label: const Text('Galeria'),
                              ),
                              OutlinedButton.icon(
                                onPressed: () => _pick(ImageSource.camera),
                                icon: const Icon(Icons.photo_camera_outlined),
                                label: const Text('Câmera'),
                              ),
                              if (_bytes != null || _imageUrl.isNotEmpty)
                                TextButton(
                                  onPressed: () {
                                    setState(() {
                                      _bytes = null;
                                      _imageUrl = '';
                                      _mime = null;
                                    });
                                    _changed();
                                  },
                                  child: const Text('Remover foto'),
                                ),
                            ],
                          ),
                          const Text(
                            'JPEG, PNG ou WebP de até 5 MB. Não inclua documentos, telefones ou dados pessoais na foto ou descrição pública.',
                          ),
                          _text(
                            'description',
                            'Descrição detalhada',
                            10,
                            2000,
                            lines: 4,
                          ),
                        ],
                      ),
                    ),
                    if (_busy) LinearProgressIndicator(value: _progress),
                    FilledButton(
                      onPressed: _busy ? null : _submit,
                      child: Text(
                        _busy
                            ? 'Salvando…'
                            : _uncertain
                            ? 'Repetir a mesma operação'
                            : widget.itemId == null
                            ? 'Revisar e publicar'
                            : 'Revisar e salvar',
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    ),
  );
}
