import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../../../../app/theme/argos_tokens.dart';
import '../../../../core/network/thumbnails.dart';

class ArgosAvatar extends StatelessWidget {
  const ArgosAvatar({
    required this.label,
    this.imageUrl,
    this.size = 37.6,
    super.key,
  });

  final String label;
  final String? imageUrl;
  final double size;

  @override
  Widget build(BuildContext context) {
    final colors = context.argosColors;
    final safeImage = imageUrl ?? '';
    final thumb = thumbnailUrl(safeImage);
    Widget initialsFallback(BuildContext context, String url, Object error) =>
        Center(child: _Initials(label: label, size: size));

    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(color: colors.surface, width: 2),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFFF7A18), Color(0xFFD62976), Color(0xFF4F5BD5)],
          stops: [0, 0.48, 1],
        ),
        boxShadow: [BoxShadow(color: colors.line, spreadRadius: 1)],
      ),
      child: ClipOval(
        child: safeImage.isEmpty
            ? Center(
                child: _Initials(label: label, size: size),
              )
            : CachedNetworkImage(
                imageUrl: thumb.isEmpty ? safeImage : thumb,
                fit: BoxFit.cover,
                errorWidget: thumb.isEmpty
                    ? initialsFallback
                    : (context, url, error) => CachedNetworkImage(
                        imageUrl: safeImage,
                        fit: BoxFit.cover,
                        errorWidget: initialsFallback,
                      ),
              ),
      ),
    );
  }
}

class _Initials extends StatelessWidget {
  const _Initials({required this.label, required this.size});

  final String label;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Text(
      initials(label),
      style: Theme.of(context).textTheme.labelMedium?.copyWith(
        color: Colors.white,
        fontSize: size <= 30 ? 10.4 : 12.5,
        fontWeight: FontWeight.w900,
      ),
    );
  }
}

String initials(String value) {
  final words = value
      .trim()
      .split(RegExp(r'\s+'))
      .where((word) => word.isNotEmpty)
      .take(2);
  final result = words.map((word) => word[0].toUpperCase()).join();
  return result.isEmpty ? 'A' : result;
}
