import 'dart:io';

import 'package:dio/dio.dart';

void configureBrowser(Dio dio) {}

String defaultApiOrigin() => Platform.isAndroid
    ? 'http://10.0.2.2:3333'
    : 'http://localhost:3333';
