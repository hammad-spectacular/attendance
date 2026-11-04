class ApiConfig {
  // Update this to your actual backend URL
  static const String baseUrl = 'http://13.63.55.73';

  static String get loginUrl => '$baseUrl/api/auth/login';
  static String get changePasswordUrl => '$baseUrl/api/auth/change-password';
  static String get teacherCheckInUrl => '$baseUrl/api/attendance/teacher/checkin';
  static String get teacherAttendanceHistoryUrl => '$baseUrl/api/attendance/teacher/me';
}
