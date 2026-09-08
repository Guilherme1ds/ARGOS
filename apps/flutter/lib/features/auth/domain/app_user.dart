class AppUser {
  const AppUser({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
    this.nickname,
    this.avatarUrl,
    this.permissions = const [],
  });

  final int id;
  final String name;
  final String email;
  final String role;
  final String? nickname;
  final String? avatarUrl;
  final List<String> permissions;

  factory AppUser.fromJson(Map<String, dynamic> json) {
    return AppUser(
      id: _intValue(json['id']),
      name: json['name']?.toString() ?? '',
      email: json['email']?.toString() ?? '',
      role: json['role']?.toString() ?? 'user',
      nickname: json['nickname']?.toString(),
      avatarUrl: json['avatarUrl']?.toString(),
      permissions: (json['permissions'] as List<dynamic>? ?? const [])
          .map((value) => value.toString())
          .toList(),
    );
  }
}

int _intValue(Object? value) {
  if (value is int) return value;
  return int.tryParse(value?.toString() ?? '') ?? 0;
}
