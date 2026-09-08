const publicTextSafetyMessage =
    'Não publique e-mail, telefone, documento completo ou provas sensíveis em campos públicos. Use o fluxo privado de reivindicação.';

final _emailPattern = RegExp(
  r'[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}',
  caseSensitive: false,
);
final _phonePattern = RegExp(
  r'(?:\+?55[\s.-]?)?(?:\(?\d{2}\)?[\s.-]?)?\d{4,5}[\s.-]?\d{4}',
);
final _cpfPattern = RegExp(r'\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b');
final _documentLikePattern = RegExp(r'\d[\d\s.-]{9,}\d');

String validatePublicTextSafety(String value) {
  if (value.isEmpty) return '';
  final unsafe =
      _emailPattern.hasMatch(value) ||
      _phonePattern.hasMatch(value) ||
      _cpfPattern.hasMatch(value) ||
      _documentLikePattern
          .allMatches(value)
          .any(
            (match) =>
                match.group(0)!.replaceAll(RegExp(r'\D'), '').length >= 11,
          );
  return unsafe ? publicTextSafetyMessage : '';
}
