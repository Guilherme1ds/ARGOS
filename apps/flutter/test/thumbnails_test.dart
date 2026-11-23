import 'package:argos_mobile/core/network/thumbnails.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('deriva a miniatura só para fotos enviadas ao ARGOS', () {
    expect(
      thumbnailUrl('https://argos.example/uploads/1731-abc_DEF12.jpg'),
      'https://argos.example/uploads/1731-abc_DEF12.thumb.webp',
    );
    expect(
      thumbnailUrl('http://10.0.2.2:3333/uploads/1-x.PNG'),
      'http://10.0.2.2:3333/uploads/1-x.thumb.webp',
    );
    // Já é miniatura, não é upload ou está vazio: sem miniatura.
    expect(thumbnailUrl('https://argos.example/uploads/1-x.thumb.webp'), '');
    expect(thumbnailUrl('https://lh3.googleusercontent.com/a/photo.jpg'), '');
    expect(thumbnailUrl(''), '');
  });
}
