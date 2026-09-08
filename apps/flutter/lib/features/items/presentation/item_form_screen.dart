import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../../app/theme/argos_tokens.dart';
import '../../../core/network/api_client.dart';
import '../../../core/utils/public_text_safety.dart';
import '../../auth/application/auth_controller.dart';
import '../../feed/application/feed_controller.dart';
import '../../feed/data/items_repository.dart';

const _categories = [
  'Documentos',
  'Chaves',
  'Eletrônicos',
  'Bolsas e mochilas',
  'Vestuário',
  'Materiais escolares',
  'Outros',
];

class ItemFormScreen extends ConsumerStatefulWidget {
  const ItemFormScreen({super.key});

  @override
  ConsumerState<ItemFormScreen> createState() => _ItemFormScreenState();
}

class _ItemFormScreenState extends ConsumerState<ItemFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _titleController = TextEditingController();
  final _descriptionController = TextEditingController();
  final _locationController = TextEditingController();
  final _campusBlockController = TextEditingController();
  final _approximatePlaceController = TextEditingController();
  final _picker = ImagePicker();

  var _type = 'lost';
  var _category = '';
  var _contactPreference = 'in_app';
  var _eventDate = _localIsoDate();
  var _submitting = false;
  var _message = '';
  XFile? _image;
  Uint8List? _imageBytes;
  String? _imageMimeType;

  @override
  void dispose() {
    _titleController.dispose();
    _descriptionController.dispose();
    _locationController.dispose();
    _campusBlockController.dispose();
    _approximatePlaceController.dispose();
    super.dispose();
  }

  Future<void> _pickImage() async {
    FocusScope.of(context).unfocus();
    try {
      final image = await _picker.pickImage(
        source: ImageSource.gallery,
        maxWidth: 1800,
        imageQuality: 88,
      );
      if (image == null) return;

      final bytes = await image.readAsBytes();
      if (bytes.length > 5 * 1024 * 1024) {
        setState(() {
          _message = 'A foto deve ter no máximo 5 MB.';
        });
        return;
      }

      final mimeType = _detectMimeType(image.name, image.mimeType);
      if (mimeType == null) {
        setState(() {
          _message = 'Use uma imagem JPEG, PNG ou WebP.';
        });
        return;
      }

      setState(() {
        _image = image;
        _imageBytes = bytes;
        _imageMimeType = mimeType;
        _message = '';
      });
    } catch (error) {
      setState(() => _message = 'Não foi possível selecionar a foto.');
    }
  }

  void _removeImage() {
    setState(() {
      _image = null;
      _imageBytes = null;
      _imageMimeType = null;
      _message = '';
    });
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    if (_submitting) return;

    final user = ref.read(authControllerProvider).user;
    if (user == null) {
      context.go('/login?next=/items/new');
      return;
    }

    if (!user.permissions.contains('items:create')) {
      setState(() => _message = 'Sem permissão para publicar itens.');
      return;
    }

    if (!_formKey.currentState!.validate()) {
      setState(() => _message = 'Revise os campos destacados.');
      return;
    }

    setState(() {
      _message = '';
      _submitting = true;
    });

    try {
      final repository = ref.read(itemsRepositoryProvider);
      var imageUrl = '';
      final bytes = _imageBytes;
      final image = _image;
      final mimeType = _imageMimeType;
      if (bytes != null && image != null && mimeType != null) {
        imageUrl = await repository.uploadImage(
          bytes: bytes,
          filename: image.name,
          mimeType: mimeType,
        );
      }

      await repository.create(
        CreateItemPayload(
          type: _type,
          title: _titleController.text.trim(),
          description: _descriptionController.text.trim(),
          category: _category,
          location: _locationController.text.trim(),
          campusBlock: _campusBlockController.text.trim(),
          approximatePlace: _approximatePlaceController.text.trim(),
          eventDate: _eventDate,
          contactPreference: _contactPreference,
          imageUrl: imageUrl,
        ),
      );

      ref.invalidate(feedControllerProvider);
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(const SnackBar(content: Text('Item publicado.')));
      context.go('/');
    } catch (error) {
      setState(() => _message = apiErrorMessage(error));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _pickDate() async {
    FocusScope.of(context).unfocus();
    final current = _parseDate(_eventDate) ?? DateTime.now();
    final today = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: current.isAfter(today) ? today : current,
      firstDate: DateTime(today.year - 10),
      lastDate: today,
      locale: const Locale('pt', 'BR'),
    );

    if (picked == null) return;
    setState(() => _eventDate = _formatIsoDate(picked));
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.argosColors;
    final textTheme = Theme.of(context).textTheme;

    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [colors.bodyStart, colors.bg, colors.bodyEnd],
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 20, 16, 104),
            children: [
              Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 640),
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: colors.panelBg,
                      border: Border.all(color: colors.line.withAlpha(217)),
                      borderRadius: BorderRadius.circular(ArgosRadius.md),
                      boxShadow: [
                        BoxShadow(
                          color: colors.shadow,
                          blurRadius: 45,
                          offset: const Offset(0, 18),
                        ),
                      ],
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(ArgosSpacing.xl),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text('Publicar item', style: textTheme.titleLarge),
                          const SizedBox(height: ArgosSpacing.lg),
                          DropdownButtonFormField<String>(
                            initialValue: _type,
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
                            onChanged: (value) {
                              if (value != null) setState(() => _type = value);
                            },
                          ),
                          const SizedBox(height: ArgosSpacing.md),
                          TextFormField(
                            controller: _titleController,
                            textInputAction: TextInputAction.next,
                            decoration: const InputDecoration(
                              labelText: 'Título',
                            ),
                            validator: (value) {
                              final text = value?.trim() ?? '';
                              if (text.length < 3) {
                                return 'Informe um título com pelo menos 3 caracteres.';
                              }
                              if (text.length > 120) {
                                return 'Use no máximo 120 caracteres.';
                              }
                              return _publicTextError(text);
                            },
                          ),
                          const SizedBox(height: ArgosSpacing.md),
                          DropdownButtonFormField<String>(
                            initialValue: _category.isEmpty ? null : _category,
                            decoration: const InputDecoration(
                              labelText: 'Categoria',
                            ),
                            hint: const Text('Selecione'),
                            items: [
                              for (final category in _categories)
                                DropdownMenuItem(
                                  value: category,
                                  child: Text(category),
                                ),
                            ],
                            onChanged: (value) {
                              setState(() => _category = value ?? '');
                            },
                            validator: (value) =>
                                (value == null || value.isEmpty)
                                ? 'Informe uma categoria.'
                                : null,
                          ),
                          const SizedBox(height: ArgosSpacing.md),
                          TextFormField(
                            controller: _locationController,
                            textInputAction: TextInputAction.next,
                            decoration: const InputDecoration(
                              labelText: 'Campus ou local',
                            ),
                            validator: (value) {
                              final text = value?.trim() ?? '';
                              if (text.length < 2) return 'Informe o local.';
                              if (text.length > 120) {
                                return 'Use no máximo 120 caracteres.';
                              }
                              return _publicTextError(text);
                            },
                          ),
                          const SizedBox(height: ArgosSpacing.md),
                          TextFormField(
                            controller: _campusBlockController,
                            textInputAction: TextInputAction.next,
                            decoration: const InputDecoration(
                              labelText: 'Bloco, sala ou setor',
                            ),
                            validator: (value) {
                              final text = value?.trim() ?? '';
                              if (text.length > 60) {
                                return 'Use no máximo 60 caracteres.';
                              }
                              return _publicTextError(text);
                            },
                          ),
                          const SizedBox(height: ArgosSpacing.md),
                          TextFormField(
                            controller: _approximatePlaceController,
                            textInputAction: TextInputAction.next,
                            decoration: const InputDecoration(
                              labelText: 'Ponto aproximado',
                            ),
                            validator: (value) {
                              final text = value?.trim() ?? '';
                              if (text.length > 160) {
                                return 'Use no máximo 160 caracteres.';
                              }
                              return _publicTextError(text);
                            },
                          ),
                          const SizedBox(height: ArgosSpacing.md),
                          InkWell(
                            onTap: _pickDate,
                            borderRadius: BorderRadius.circular(ArgosRadius.md),
                            child: InputDecorator(
                              decoration: const InputDecoration(
                                labelText: 'Data do ocorrido',
                                suffixIcon: Icon(
                                  Icons.calendar_today_outlined,
                                  size: 20,
                                ),
                              ),
                              child: Text(_displayDate(_eventDate)),
                            ),
                          ),
                          const SizedBox(height: ArgosSpacing.md),
                          DropdownButtonFormField<String>(
                            initialValue: _contactPreference,
                            decoration: const InputDecoration(
                              labelText: 'Preferência de contato',
                            ),
                            items: const [
                              DropdownMenuItem(
                                value: 'in_app',
                                child: Text('Contato pelo app'),
                              ),
                              DropdownMenuItem(
                                value: 'email',
                                child: Text('E-mail autorizado'),
                              ),
                            ],
                            onChanged: (value) {
                              if (value != null) {
                                setState(() => _contactPreference = value);
                              }
                            },
                          ),
                          const SizedBox(height: ArgosSpacing.md),
                          _ImagePickerField(
                            image: _image,
                            imageBytes: _imageBytes,
                            onPick: _pickImage,
                            onRemove: _removeImage,
                          ),
                          const SizedBox(height: ArgosSpacing.md),
                          _PrivacyNote(),
                          const SizedBox(height: ArgosSpacing.md),
                          TextFormField(
                            controller: _descriptionController,
                            minLines: 6,
                            maxLines: 10,
                            textInputAction: TextInputAction.newline,
                            decoration: const InputDecoration(
                              labelText: 'Descrição detalhada',
                            ),
                            validator: (value) {
                              final text = value?.trim() ?? '';
                              if (text.length < 10) {
                                return 'A descrição precisa ter pelo menos 10 caracteres.';
                              }
                              if (text.length > 2000) {
                                return 'Use no máximo 2000 caracteres.';
                              }
                              return _publicTextError(text);
                            },
                          ),
                          if (_message.isNotEmpty) ...[
                            const SizedBox(height: ArgosSpacing.md),
                            _ErrorMessage(message: _message),
                          ],
                          const SizedBox(height: ArgosSpacing.lg),
                          FilledButton.icon(
                            onPressed: _submitting ? null : _submit,
                            icon: _submitting
                                ? const SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(
                                      color: Colors.white,
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(Icons.add_circle_outline_rounded),
                            label: const Text('Publicar item'),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ImagePickerField extends StatelessWidget {
  const _ImagePickerField({
    required this.image,
    required this.imageBytes,
    required this.onPick,
    required this.onRemove,
  });

  final XFile? image;
  final Uint8List? imageBytes;
  final VoidCallback onPick;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final colors = context.argosColors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Foto do item',
          style: Theme.of(context).textTheme.labelMedium?.copyWith(
            color: colors.muted,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: ArgosSpacing.xs),
        if (imageBytes == null)
          OutlinedButton.icon(
            onPressed: onPick,
            icon: const Icon(Icons.photo_camera_back_outlined),
            label: const Text('Selecionar foto'),
          )
        else ...[
          ClipRRect(
            borderRadius: BorderRadius.circular(ArgosRadius.md),
            child: AspectRatio(
              aspectRatio: 16 / 10,
              child: Image.memory(imageBytes!, fit: BoxFit.cover),
            ),
          ),
          const SizedBox(height: ArgosSpacing.sm),
          Row(
            children: [
              Expanded(
                child: Text(
                  image?.name ?? 'Foto selecionada',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(
                    context,
                  ).textTheme.bodySmall?.copyWith(color: colors.muted),
                ),
              ),
              IconButton(
                onPressed: onPick,
                icon: const Icon(Icons.sync_rounded),
                tooltip: 'Trocar foto',
              ),
              IconButton(
                onPressed: onRemove,
                icon: const Icon(Icons.close_rounded),
                tooltip: 'Remover foto',
              ),
            ],
          ),
        ],
      ],
    );
  }
}

class _PrivacyNote extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final colors = context.argosColors;
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border(left: BorderSide(color: colors.warning, width: 3)),
      ),
      child: Padding(
        padding: const EdgeInsets.only(left: 10.4),
        child: Text(
          'Não inclua telefone, e-mail, documento completo ou provas sensíveis em campos públicos ou fotos.',
          style: Theme.of(context).textTheme.bodyMedium,
        ),
      ),
    );
  }
}

class _ErrorMessage extends StatelessWidget {
  const _ErrorMessage({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: const Color(0xFFFEE2E2),
        borderRadius: BorderRadius.circular(ArgosRadius.md),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14.4, vertical: 12),
        child: Text(
          message,
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
            color: const Color(0xFF991B1B),
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
    );
  }
}

String? _publicTextError(String value) {
  final message = validatePublicTextSafety(value);
  return message.isEmpty ? null : message;
}

String? _detectMimeType(String name, String? provided) {
  if (provided == 'image/jpeg' ||
      provided == 'image/png' ||
      provided == 'image/webp') {
    return provided;
  }

  final lower = name.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return null;
}

DateTime? _parseDate(String value) {
  return DateTime.tryParse('${value}T00:00:00');
}

String _displayDate(String value) {
  final date = _parseDate(value);
  if (date == null) return value;
  final day = date.day.toString().padLeft(2, '0');
  final month = date.month.toString().padLeft(2, '0');
  return '$day/$month/${date.year}';
}

String _localIsoDate([DateTime? date]) {
  return _formatIsoDate(date ?? DateTime.now());
}

String _formatIsoDate(DateTime date) {
  final month = date.month.toString().padLeft(2, '0');
  final day = date.day.toString().padLeft(2, '0');
  return '${date.year}-$month-$day';
}
