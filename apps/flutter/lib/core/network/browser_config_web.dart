import 'package:dio/dio.dart';
import 'package:dio/browser.dart';

void configureBrowser(Dio dio) {
  dio.httpClientAdapter = BrowserHttpClientAdapter(withCredentials: true);
}
