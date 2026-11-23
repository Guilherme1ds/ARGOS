final _uploadPhoto = RegExp(
  r'/uploads/[\w-]+\.(jpg|png|webp)$',
  caseSensitive: false,
);
final _extension = RegExp(r'\.(jpg|png|webp)$', caseSensitive: false);

/// Miniatura (640 px, WebP) que a API gera para cada foto enviada:
/// `/uploads/x.jpg` → `/uploads/x.thumb.webp`. Recebe a URL já resolvida
/// (`assetUrl`) e devolve '' quando não se aplica; quem usa volta para a
/// foto original se a miniatura falhar.
String thumbnailUrl(String assetUrl) => _uploadPhoto.hasMatch(assetUrl)
    ? assetUrl.replaceFirst(_extension, '.thumb.webp')
    : '';
