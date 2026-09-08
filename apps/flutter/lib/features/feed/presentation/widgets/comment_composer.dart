import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/argos_tokens.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/utils/public_text_safety.dart';
import '../../../auth/application/auth_controller.dart';
import '../../application/feed_controller.dart';
import '../../domain/item.dart';

class CommentComposer extends ConsumerStatefulWidget {
  const CommentComposer({
    required this.item,
    required this.onMessage,
    this.compact = false,
    super.key,
  });

  final Item item;
  final bool compact;
  final ValueChanged<String> onMessage;

  @override
  ConsumerState<CommentComposer> createState() => _CommentComposerState();
}

class _CommentComposerState extends ConsumerState<CommentComposer> {
  final _controller = TextEditingController();
  var _submitting = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final user = ref.read(authControllerProvider).user;
    final body = _controller.text.trim();
    if (user == null) {
      widget.onMessage('Entre para enviar informação.');
      return;
    }
    if (body.isEmpty || _submitting) return;

    final safetyMessage = validatePublicTextSafety(body);
    if (safetyMessage.isNotEmpty) {
      widget.onMessage(safetyMessage);
      return;
    }

    setState(() => _submitting = true);
    try {
      await ref
          .read(feedControllerProvider.notifier)
          .addComment(widget.item, body);
      _controller.clear();
      widget.onMessage('Pista publicada.');
    } catch (error) {
      widget.onMessage(apiErrorMessage(error));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.argosColors;
    final auth = ref.watch(authControllerProvider);
    final enabled = auth.user != null && !_submitting;

    return Container(
      decoration: widget.compact
          ? null
          : BoxDecoration(
              border: Border(top: BorderSide(color: colors.line)),
            ),
      padding: EdgeInsets.only(top: widget.compact ? 1.6 : 11.2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: TextField(
              controller: _controller,
              enabled: enabled,
              minLines: 1,
              maxLines: 3,
              textInputAction: TextInputAction.send,
              onSubmitted: (_) => _submit(),
              decoration: InputDecoration.collapsed(
                hintText: auth.user != null
                    ? 'Adicionar pista ou pergunta pública...'
                    : 'Entrar para enviar informação',
                hintStyle: Theme.of(
                  context,
                ).textTheme.bodyMedium?.copyWith(color: colors.muted),
              ),
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ),
          const SizedBox(width: ArgosSpacing.sm),
          TextButton(
            onPressed: enabled ? _submit : null,
            style: TextButton.styleFrom(
              minimumSize: const Size(64, 48),
              foregroundColor: colors.primary,
              textStyle: Theme.of(
                context,
              ).textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w800),
            ),
            child: _submitting
                ? SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: colors.primary,
                    ),
                  )
                : const Text('Enviar'),
          ),
        ],
      ),
    );
  }
}
