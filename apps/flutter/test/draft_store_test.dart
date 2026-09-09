import 'dart:io';
import 'dart:typed_data';
import 'package:argos_mobile/features/items/data/draft_store.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Directory directory;
  late DraftStore drafts;
  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    directory = await Directory.systemTemp.createTemp('argos-draft-test-');
    drafts = DraftStore(imageDirectory: () async => directory);
  });
  tearDown(() async {
    for (final file in directory.listSync()) {
      if (file is File) await file.delete();
    }
    await directory.delete();
  });

  test(
    'draft restores exact fields and operation key for one user only',
    () async {
      await drafts.write(1, null, {
        'fields': {'title': 'Mochila azul'},
        'operationKey': 'same-key',
        'uncertain': true,
      });
      final restored = await drafts.read(1, null);
      expect(restored?['fields']['title'], 'Mochila azul');
      expect(restored?['operationKey'], 'same-key');
      expect(restored?['uncertain'], true);
      expect(await drafts.read(2, null), isNull);
      expect(await drafts.read(1, 7), isNull);
    },
  );
  test('draft image survives navigation and is removed on discard', () async {
    final bytes = Uint8List.fromList([1, 2, 3]);
    await drafts.writeImage(1, null, bytes);
    expect(await drafts.readImage(1, null), bytes);
    await drafts.clear(1, null);
    expect(await drafts.readImage(1, null), isNull);
  });
  test(
    'expired and malformed drafts are removed instead of restored',
    () async {
      FlutterSecureStorage.setMockInitialValues({
        'argos.draft.1.new':
            '{"savedAt":"2000-01-01T00:00:00","fields":{"title":"old"}}',
        'argos.draft.2.new': 'invalid',
      });
      expect(await drafts.read(1, null), isNull);
      expect(await drafts.read(2, null), isNull);
      expect(
        await const FlutterSecureStorage().read(key: 'argos.draft.1.new'),
        isNull,
      );
    },
  );
}
