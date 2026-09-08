import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme/argos_tokens.dart';
import '../../../core/network/api_client.dart';
import '../application/auth_controller.dart';
import '../domain/app_user.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    final colors = context.argosColors;
    final user = auth.user;

    if (auth.checkingSession) {
      return Center(child: CircularProgressIndicator(color: colors.primary));
    }

    if (user == null) {
      return Center(
        child: FilledButton.icon(
          onPressed: () => context.go('/login?next=/profile'),
          icon: const Icon(Icons.person_outline_rounded),
          label: const Text('Entrar'),
        ),
      );
    }

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
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 20, 16, 96),
          children: [
            ConstrainedBox(
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
                  padding: const EdgeInsets.all(ArgosSpacing.xxl),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          _ProfileAvatar(user: user),
                          const SizedBox(width: ArgosSpacing.md),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  user.name,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: Theme.of(context)
                                      .textTheme
                                      .headlineMedium
                                      ?.copyWith(fontSize: 25.6),
                                ),
                                const SizedBox(height: ArgosSpacing.xs),
                                Text(
                                  '@${user.nickname ?? 'usuario.${user.id}'}',
                                  style: Theme.of(context).textTheme.labelMedium
                                      ?.copyWith(color: colors.muted),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: ArgosSpacing.xxl),
                      _ProfileInfoRow(
                        icon: Icons.mail_outline_rounded,
                        label: 'E-mail',
                        value: user.email,
                      ),
                      _ProfileInfoRow(
                        icon: Icons.verified_user_outlined,
                        label: 'Perfil',
                        value: user.role,
                      ),
                      _ProfileInfoRow(
                        icon: Icons.lock_outline_rounded,
                        label: 'Permissões',
                        value: '${user.permissions.length}',
                      ),
                      const SizedBox(height: ArgosSpacing.xxl),
                      FilledButton.icon(
                        onPressed: () => context.go('/items/new'),
                        icon: const Icon(Icons.add_circle_outline_rounded),
                        label: const Text('Publicar item'),
                      ),
                      const SizedBox(height: ArgosSpacing.sm),
                      OutlinedButton.icon(
                        onPressed: () async {
                          await ref
                              .read(authControllerProvider.notifier)
                              .logout();
                          if (context.mounted) context.go('/items');
                        },
                        icon: const Icon(Icons.logout_rounded),
                        label: const Text('Sair'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ProfileAvatar extends StatelessWidget {
  const _ProfileAvatar({required this.user});

  final AppUser user;

  @override
  Widget build(BuildContext context) {
    final colors = context.argosColors;
    final imageUrl = _assetUrl(user.avatarUrl);

    return Container(
      width: 64,
      height: 64,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFFF7A18), Color(0xFFD62976), Color(0xFF4F5BD5)],
        ),
        border: Border.all(color: colors.surface, width: 2),
        boxShadow: [BoxShadow(color: colors.line, spreadRadius: 1)],
      ),
      child: imageUrl.isNotEmpty
          ? Image.network(imageUrl, fit: BoxFit.cover)
          : Center(
              child: Text(
                _initials(user.nickname ?? user.name),
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  color: Colors.white,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
    );
  }
}

class _ProfileInfoRow extends StatelessWidget {
  const _ProfileInfoRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final colors = context.argosColors;
    return Padding(
      padding: const EdgeInsets.only(bottom: ArgosSpacing.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: colors.muted, size: 20),
          const SizedBox(width: ArgosSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: Theme.of(
                    context,
                  ).textTheme.labelMedium?.copyWith(color: colors.muted),
                ),
                const SizedBox(height: ArgosSpacing.xxs),
                Text(value, style: Theme.of(context).textTheme.bodyMedium),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

String _initials(String value) {
  final words = value
      .split(RegExp(r'\s+'))
      .where((word) => word.isNotEmpty)
      .take(2)
      .toList(growable: false);
  if (words.isEmpty) return 'A';
  return words.map((word) => word[0].toUpperCase()).join();
}

String _assetUrl(String? url) {
  if (url == null || url.isEmpty) return '';

  final parsed = Uri.tryParse(url);
  final publicBase = Uri.tryParse(ArgosApiConfig.publicBaseUrl);
  if (parsed != null && parsed.hasScheme) {
    if (publicBase == null) return '';
    final sameOrigin =
        parsed.scheme == publicBase.scheme &&
        parsed.host == publicBase.host &&
        parsed.port == publicBase.port;
    return sameOrigin && parsed.path.startsWith('/uploads/')
        ? parsed.toString()
        : '';
  }

  final safeUpload = RegExp(r'^/uploads/[\w.-]+$').hasMatch(url);
  if (!safeUpload) return '';
  return '${ArgosApiConfig.publicBaseUrl.replaceFirst(RegExp(r'/$'), '')}$url';
}
