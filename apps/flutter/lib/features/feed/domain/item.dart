import 'feed_comment.dart';

enum ItemStatus { lost, found, claimed, returned }

enum ItemType { lost, found }

enum ApprovalStatus { pending, approved, rejected }

class Item {
  const Item({
    required this.id,
    required this.type,
    required this.title,
    required this.description,
    required this.category,
    required this.location,
    required this.eventDate,
    required this.status,
    required this.approvalStatus,
    required this.createdAt,
    this.ownerName,
    this.ownerNickname,
    this.ownerAvatarUrl,
    this.imageUrl,
    this.commentsCount = 0,
    this.latestComments = const [],
  });

  final int id;
  final String? ownerName;
  final String? ownerNickname;
  final String? ownerAvatarUrl;
  final ItemType type;
  final String title;
  final String description;
  final String category;
  final String location;
  final String eventDate;
  final ItemStatus status;
  final ApprovalStatus approvalStatus;
  final String? imageUrl;
  final String createdAt;
  final int commentsCount;
  final List<FeedComment> latestComments;

  String get authorHandle {
    if (ownerNickname != null && ownerNickname!.isNotEmpty) {
      return ownerNickname!;
    }
    if (ownerName != null && ownerName!.isNotEmpty) return ownerName!;
    return 'usuario.$id';
  }

  String get effectiveDate => createdAt.isNotEmpty ? createdAt : eventDate;

  Item copyWith({int? commentsCount, List<FeedComment>? latestComments}) {
    return Item(
      id: id,
      ownerName: ownerName,
      ownerNickname: ownerNickname,
      ownerAvatarUrl: ownerAvatarUrl,
      type: type,
      title: title,
      description: description,
      category: category,
      location: location,
      eventDate: eventDate,
      status: status,
      approvalStatus: approvalStatus,
      imageUrl: imageUrl,
      createdAt: createdAt,
      commentsCount: commentsCount ?? this.commentsCount,
      latestComments: latestComments ?? this.latestComments,
    );
  }

  factory Item.fromJson(Map<String, dynamic> json) {
    return Item(
      id: _intValue(json['id']),
      ownerName: json['owner_name']?.toString(),
      ownerNickname: json['owner_nickname']?.toString(),
      ownerAvatarUrl: json['owner_avatar_url']?.toString(),
      type: _itemType(json['type']?.toString()),
      title: json['title']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
      category: json['category']?.toString() ?? '',
      location: json['location']?.toString() ?? '',
      eventDate: json['event_date']?.toString() ?? '',
      status: _itemStatus(json['status']?.toString()),
      approvalStatus: _approvalStatus(json['approval_status']?.toString()),
      imageUrl: json['image_url']?.toString(),
      createdAt: json['created_at']?.toString() ?? '',
      commentsCount: _intValue(json['comments_count']),
      latestComments: (json['latest_comments'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(FeedComment.fromJson)
          .toList(growable: false),
    );
  }
}

String statusLabel(ItemStatus status) {
  return switch (status) {
    ItemStatus.lost => 'Perdido',
    ItemStatus.found => 'Encontrado',
    ItemStatus.claimed => 'Em análise',
    ItemStatus.returned => 'Devolvido',
  };
}

ItemStatus _itemStatus(String? value) {
  return switch (value) {
    'found' => ItemStatus.found,
    'claimed' => ItemStatus.claimed,
    'returned' => ItemStatus.returned,
    _ => ItemStatus.lost,
  };
}

ItemType _itemType(String? value) {
  return value == 'found' ? ItemType.found : ItemType.lost;
}

ApprovalStatus _approvalStatus(String? value) {
  return switch (value) {
    'approved' => ApprovalStatus.approved,
    'rejected' => ApprovalStatus.rejected,
    _ => ApprovalStatus.pending,
  };
}

int _intValue(Object? value) {
  if (value is int) return value;
  return int.tryParse(value?.toString() ?? '') ?? 0;
}
