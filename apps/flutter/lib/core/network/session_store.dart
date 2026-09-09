import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

abstract class SessionStore {
  Future<String?> read();
  Future<void> write(String? cookie);
}

class SecureSessionStore implements SessionStore {
  static const storage = FlutterSecureStorage();
  static const key = 'argos.refresh.v1';
  Future<void> _pending = Future.value();

  @override
  Future<String?> read() async {
    await _pending;
    return kIsWeb ? null : storage.read(key: key);
  }

  @override
  Future<void> write(String? cookie) {
    // Web sessions stay in the browser's httpOnly cookie, never localStorage.
    if (kIsWeb) return Future.value();
    final next = _pending
        .catchError((Object _) {})
        .then(
          (_) => cookie == null
              ? storage.delete(key: key)
              : storage.write(key: key, value: cookie),
        );
    _pending = next;
    return next;
  }
}
