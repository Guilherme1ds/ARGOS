class FeedComment {
  const FeedComment({
    required this.id,
    required this.itemId,
    required this.userId,
    required this.authorName,
    required this.body,
    required this.createdAt,
    this.authorNickname,
    this.authorAvatarUrl,
  });

  final int id;
  final int itemId;
  final int userId;
  final String authorName;
  final String? authorNickname;
  final String? authorAvatarUrl;
  final String body;
  final String createdAt;

  String get handle =>
      (authorNickname?.isNotEmpty ?? false) ? authorNickname! : authorName;

  factory FeedComment.fromJson(Map<String, dynamic> json) {
    return FeedComment(
      id: _intValue(json['id']),
      itemId: _intValue(json['item_id']),
      userId: _intValue(json['user_id']),
      authorName: json['author_name']?.toString() ?? '',
      authorNickname: json['author_nickname']?.toString(),
      authorAvatarUrl: json['author_avatar_url']?.toString(),
      body: json['body']?.toString() ?? '',
      createdAt: json['created_at']?.toString() ?? '',
    );
  }
}

int _intValue(Object? value) {
  if (value is int) return value;
  return int.tryParse(value?.toString() ?? '') ?? 0;
}
