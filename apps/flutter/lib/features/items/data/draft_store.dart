import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path_provider/path_provider.dart';

class DraftStore {
  DraftStore({this.imageDirectory});
  final Future<Directory> Function()? imageDirectory;
  static const _storage = FlutterSecureStorage();
  static Future<void> _pending = Future.value();
  static String _key(int user, int? item) =>
      'argos.draft.$user.${item ?? 'new'}';

  static Future<void> _enqueue(Future<void> Function() action) {
    final operation = _pending.catchError((Object _) {}).then((_) => action());
    _pending = operation;
    return operation;
  }

  Future<Map<String, dynamic>?> read(int user, int? item) async {
    await _pending;
    final text = await _storage.read(key: _key(user, item));
    if (text == null) return null;
    try {
      final data = jsonDecode(text) as Map<String, dynamic>;
      final saved = DateTime.parse(data['savedAt'] as String);
      if (DateTime.now().difference(saved) > const Duration(days: 7)) {
        await clear(user, item);
        return null;
      }
      return data;
    } catch (_) {
      await clear(user, item);
      return null;
    }
  }

  Future<void> write(int user, int? item, Map<String, dynamic> fields) =>
      _enqueue(
        () => _storage.write(
          key: _key(user, item),
          value: jsonEncode({
            ...fields,
            'savedAt': DateTime.now().toIso8601String(),
          }),
        ),
      );

  Future<File> _image(int user, int? item) async {
    final directory = imageDirectory != null
        ? await imageDirectory!()
        : Directory(
            '${(await getApplicationSupportDirectory()).path}/argos_drafts',
          );
    await directory.create(recursive: true);
    return File('${directory.path}/$user-${item ?? 'new'}.image');
  }

  Future<void> writeImage(int user, int? item, Uint8List bytes) =>
      _enqueue(() async {
        await (await _image(user, item)).writeAsBytes(bytes, flush: true);
      });
  Future<Uint8List?> readImage(int user, int? item) async {
    await _pending;
    final image = await _image(user, item);
    return await image.exists() ? image.readAsBytes() : null;
  }

  Future<void> clear(int user, int? item) => _enqueue(() async {
    await _storage.delete(key: _key(user, item));
    final file = await _image(user, item);
    if (await file.exists()) await file.delete();
  });
  static Future<void> clearAll() => _enqueue(() async {
    for (final key in (await _storage.readAll()).keys.where(
      (key) => key.startsWith('argos.draft.'),
    )) {
      await _storage.delete(key: key);
    }
    final directory = Directory(
      '${(await getApplicationSupportDirectory()).path}/argos_drafts',
    );
    if (await directory.exists()) {
      // Only individual files inside this app-owned directory, no recursive removal.
      await for (final file in directory.list(followLinks: false)) {
        if (file is File &&
            RegExp(r'[/\\]\d+-(new|\d+)\.image$').hasMatch(file.path)) {
          await file.delete();
        }
      }
    }
  });
}
