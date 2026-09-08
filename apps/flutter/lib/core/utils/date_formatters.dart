import 'package:intl/intl.dart';

DateTime? parseArgosDate(String value) {
  final normalized = RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(value)
      ? '${value}T00:00:00'
      : value.contains('T')
      ? value
      : '${value.replaceAll(' ', 'T')}Z';
  return DateTime.tryParse(normalized);
}

String relativeDate(String value) {
  final date = parseArgosDate(value);
  if (date == null) return value;

  final diffDays = DateTime.now().difference(date).inDays.clamp(0, 99999);
  if (diffDays < 1) return 'hoje';
  if (diffDays < 7) return '$diffDays d';
  if (diffDays < 30) return '${diffDays ~/ 7} sem';
  return DateFormat('d MMMM', 'pt_BR').format(date);
}

String fullDate(String value) {
  final date = parseArgosDate(value);
  if (date == null) return value;
  return DateFormat('d MMMM y', 'pt_BR').format(date);
}
