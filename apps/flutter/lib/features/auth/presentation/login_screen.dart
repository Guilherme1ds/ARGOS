import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme/argos_tokens.dart';
import '../../../core/network/api_client.dart';
import '../application/auth_controller.dart';

enum _AuthMode { login, register, access }

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _reasonController = TextEditingController();
  var _mode = _AuthMode.login;
  var _privacyTermsAccepted = false;
  var _submitting = false;
  var _message = '';
  var _messageTone = _AuthMessageTone.success;
  var _obscurePassword = true;

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    if (!_formKey.currentState!.validate() || _submitting) return;

    setState(() {
      _message = '';
      _messageTone = _AuthMessageTone.success;
      _submitting = true;
    });

    try {
      final auth = ref.read(authControllerProvider.notifier);
      switch (_mode) {
        case _AuthMode.login:
          await auth.login(
            _emailController.text.trim(),
            _passwordController.text,
          );
          _goAfterAuth();
        case _AuthMode.register:
          await auth.register(
            name: _nameController.text.trim(),
            email: _emailController.text.trim(),
            password: _passwordController.text,
            privacyTermsAccepted: _privacyTermsAccepted,
          );
          _goAfterAuth();
        case _AuthMode.access:
          final message = await auth.requestAccess(
            name: _nameController.text.trim(),
            email: _emailController.text.trim(),
            password: _passwordController.text,
            reason: _reasonController.text.trim(),
          );
          setState(() {
            _message = message;
            _messageTone = _AuthMessageTone.success;
          });
      }
    } catch (error) {
      setState(() {
        _message = apiErrorMessage(error);
        _messageTone = _AuthMessageTone.error;
      });
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  void _goAfterAuth() {
    if (!mounted) return;
    context.go(
      _safeNext(GoRouterState.of(context).uri.queryParameters['next']),
    );
  }

  void _setMode(_AuthMode mode) {
    setState(() {
      _mode = mode;
      _message = '';
      _messageTone = _AuthMessageTone.success;
    });
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.argosColors;
    final textTheme = Theme.of(context).textTheme;
    final title = switch (_mode) {
      _AuthMode.login => 'Entrar',
      _AuthMode.register => 'Criar conta',
      _AuthMode.access => 'Solicitar acesso',
    };

    return Scaffold(
      backgroundColor: colors.bg,
      body: DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [colors.bodyStart, colors.bg, colors.bodyEnd],
          ),
        ),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(ArgosSpacing.lg),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 448),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    DecoratedBox(
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
                        child: AutofillGroup(
                          child: Form(
                            key: _formKey,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Text(
                                  title,
                                  style: textTheme.headlineMedium?.copyWith(
                                    fontSize: 25.6,
                                  ),
                                ),
                                const SizedBox(height: 13.6),
                                if (_mode != _AuthMode.login) ...[
                                  TextFormField(
                                    controller: _nameController,
                                    textInputAction: TextInputAction.next,
                                    autofillHints: const [AutofillHints.name],
                                    decoration: const InputDecoration(
                                      hintText: 'Nome',
                                    ),
                                    validator: (value) {
                                      final name = value?.trim() ?? '';
                                      if (name.length < 3) {
                                        return 'Nome: mínimo de 3 caracteres.';
                                      }
                                      return null;
                                    },
                                  ),
                                  const SizedBox(height: 13.6),
                                ],
                                TextFormField(
                                  controller: _emailController,
                                  keyboardType: TextInputType.emailAddress,
                                  textInputAction: TextInputAction.next,
                                  autofillHints: const [AutofillHints.email],
                                  decoration: const InputDecoration(
                                    hintText: 'E-mail',
                                  ),
                                  validator: (value) {
                                    final email = value?.trim() ?? '';
                                    final valid = RegExp(
                                      r'^[^@\s]+@[^@\s]+\.[^@\s]+$',
                                    ).hasMatch(email);
                                    return valid ? null : 'Informe um e-mail.';
                                  },
                                ),
                                const SizedBox(height: 13.6),
                                TextFormField(
                                  controller: _passwordController,
                                  obscureText: _obscurePassword,
                                  textInputAction: _mode == _AuthMode.login
                                      ? TextInputAction.done
                                      : TextInputAction.next,
                                  autofillHints: const [AutofillHints.password],
                                  onFieldSubmitted: (_) {
                                    if (_mode == _AuthMode.login) _submit();
                                  },
                                  decoration: InputDecoration(
                                    hintText: 'Senha',
                                    suffixIcon: IconButton(
                                      onPressed: () => setState(
                                        () => _obscurePassword =
                                            !_obscurePassword,
                                      ),
                                      icon: Icon(
                                        _obscurePassword
                                            ? Icons.visibility_outlined
                                            : Icons.visibility_off_outlined,
                                      ),
                                      tooltip: _obscurePassword
                                          ? 'Mostrar senha'
                                          : 'Ocultar senha',
                                    ),
                                  ),
                                  validator: (value) {
                                    final password = value ?? '';
                                    if (_mode == _AuthMode.login) {
                                      return password.isEmpty
                                          ? 'Informe a senha.'
                                          : null;
                                    }
                                    return password.length < 8
                                        ? 'Senha: mínimo de 8 caracteres.'
                                        : null;
                                  },
                                ),
                                if (_mode == _AuthMode.access) ...[
                                  const SizedBox(height: 13.6),
                                  TextFormField(
                                    controller: _reasonController,
                                    minLines: 4,
                                    maxLines: 6,
                                    textInputAction: TextInputAction.newline,
                                    decoration: const InputDecoration(
                                      hintText: 'Justificativa de acesso',
                                    ),
                                  ),
                                ],
                                if (_mode == _AuthMode.register) ...[
                                  const SizedBox(height: 13.6),
                                  _PrivacyCheckRow(
                                    value: _privacyTermsAccepted,
                                    onChanged: (value) => setState(
                                      () => _privacyTermsAccepted = value,
                                    ),
                                  ),
                                ],
                                const SizedBox(height: 13.6),
                                FilledButton(
                                  onPressed: _submitting ? null : _submit,
                                  child: _submitting
                                      ? const SizedBox(
                                          width: 18,
                                          height: 18,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 2,
                                            color: Colors.white,
                                          ),
                                        )
                                      : Text(
                                          _mode == _AuthMode.login
                                              ? 'Entrar'
                                              : 'Enviar',
                                        ),
                                ),
                                if (_message.isNotEmpty) ...[
                                  const SizedBox(height: 13.6),
                                  _AuthMessage(
                                    message: _message,
                                    tone: _messageTone,
                                  ),
                                ],
                                const SizedBox(height: 13.6),
                                _AuthSegmentedControl(
                                  mode: _mode,
                                  onChanged: _setMode,
                                ),
                                const SizedBox(height: ArgosSpacing.sm),
                                Align(
                                  alignment: Alignment.centerLeft,
                                  child: TextButton(
                                    onPressed: () => context.go('/privacy'),
                                    style: TextButton.styleFrom(
                                      padding: EdgeInsets.zero,
                                      minimumSize: const Size(48, 40),
                                      foregroundColor: colors.muted,
                                      textStyle: textTheme.bodySmall,
                                    ),
                                    child: const Text('Resumo de privacidade'),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                    if (kDebugMode && _mode == _AuthMode.login) ...[
                      const SizedBox(height: ArgosSpacing.md),
                      _TestCredentials(
                        onAdminTap: () =>
                            _fillCredentials('admin@argos.local', 'Admin@123'),
                        onUserTap: () => _fillCredentials(
                          'usuario.teste@argos.local',
                          'Usuario@123',
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  void _fillCredentials(String email, String password) {
    setState(() {
      _emailController.text = email;
      _passwordController.text = password;
      _message = '';
    });
  }
}

class _PrivacyCheckRow extends StatelessWidget {
  const _PrivacyCheckRow({required this.value, required this.onChanged});

  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final colors = context.argosColors;
    return FormField<bool>(
      initialValue: value,
      validator: (_) =>
          value ? null : 'Privacidade: aceite os termos para criar a conta.',
      builder: (field) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            InkWell(
              borderRadius: BorderRadius.circular(ArgosRadius.md),
              onTap: () {
                final next = !value;
                onChanged(next);
                field.didChange(next);
              },
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      width: 24,
                      height: 24,
                      child: Checkbox(
                        value: value,
                        onChanged: (next) {
                          onChanged(next ?? false);
                          field.didChange(next ?? false);
                        },
                        activeColor: colors.primary,
                        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                    ),
                    const SizedBox(width: 10.4),
                    Expanded(
                      child: Text(
                        'Li e aceito o resumo de privacidade vigente.',
                        style: Theme.of(context).textTheme.labelMedium
                            ?.copyWith(
                              color: colors.muted,
                              fontWeight: FontWeight.w700,
                            ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            if (field.errorText != null) ...[
              const SizedBox(height: ArgosSpacing.xs),
              Text(
                field.errorText!,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: colors.danger,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ],
        );
      },
    );
  }
}

class _AuthSegmentedControl extends StatelessWidget {
  const _AuthSegmentedControl({required this.mode, required this.onChanged});

  final _AuthMode mode;
  final ValueChanged<_AuthMode> onChanged;

  @override
  Widget build(BuildContext context) {
    final colors = context.argosColors;
    return ClipRRect(
      borderRadius: BorderRadius.circular(ArgosRadius.md),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: colors.surfaceSoft,
          border: Border.all(color: colors.line),
          borderRadius: BorderRadius.circular(ArgosRadius.md),
        ),
        child: Row(
          children: [
            _SegmentButton(
              label: 'Login',
              selected: mode == _AuthMode.login,
              onTap: () => onChanged(_AuthMode.login),
            ),
            _SegmentButton(
              label: 'Cadastro',
              selected: mode == _AuthMode.register,
              onTap: () => onChanged(_AuthMode.register),
            ),
            _SegmentButton(
              label: 'Acesso',
              selected: mode == _AuthMode.access,
              onTap: () => onChanged(_AuthMode.access),
            ),
          ],
        ),
      ),
    );
  }
}

class _SegmentButton extends StatelessWidget {
  const _SegmentButton({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.argosColors;
    return Expanded(
      child: Material(
        color: selected ? colors.surface : Colors.transparent,
        child: InkWell(
          onTap: onTap,
          child: SizedBox(
            height: 48,
            child: Center(
              child: Text(
                label,
                style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: selected ? colors.primary : colors.muted,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

enum _AuthMessageTone { success, error }

class _AuthMessage extends StatelessWidget {
  const _AuthMessage({required this.message, required this.tone});

  final String message;
  final _AuthMessageTone tone;

  @override
  Widget build(BuildContext context) {
    final background = tone == _AuthMessageTone.error
        ? const Color(0xFFFEE2E2)
        : const Color(0xFFE8F6EE);
    final foreground = tone == _AuthMessageTone.error
        ? const Color(0xFF991B1B)
        : const Color(0xFF166534);

    return DecoratedBox(
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(ArgosRadius.md),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14.4, vertical: 12),
        child: Text(
          message,
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
            color: foreground,
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
    );
  }
}

class _TestCredentials extends StatelessWidget {
  const _TestCredentials({required this.onAdminTap, required this.onUserTap});

  final VoidCallback onAdminTap;
  final VoidCallback onUserTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.argosColors;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surfaceSoft,
        border: Border.all(color: colors.line),
        borderRadius: BorderRadius.circular(ArgosRadius.md),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14.4, vertical: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Contas para teste (ambiente de desenvolvimento)',
              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                color: colors.text,
                fontSize: 13.1,
              ),
            ),
            const SizedBox(height: ArgosSpacing.xs),
            _CredentialLine(
              text: 'Administrador: admin@argos.local · Admin@123',
              onTap: onAdminTap,
            ),
            _CredentialLine(
              text: 'Usuário: usuario.teste@argos.local · Usuario@123',
              onTap: onUserTap,
            ),
          ],
        ),
      ),
    );
  }
}

class _CredentialLine extends StatelessWidget {
  const _CredentialLine({required this.text, required this.onTap});

  final String text;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.argosColors;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(ArgosRadius.xs),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Text(
          text,
          style: Theme.of(
            context,
          ).textTheme.bodySmall?.copyWith(color: colors.muted, fontSize: 12.5),
        ),
      ),
    );
  }
}

String _safeNext(String? next) {
  if (next != null && next.startsWith('/') && !next.startsWith('//')) {
    return next;
  }
  return '/dashboard';
}
