class ApiConfig {
  // Update this to your actual backend URL
  static const String baseUrl = 'https://attendance-2-akos.onrender.com';

  static String get loginUrl => '$baseUrl/api/auth/login';
  static String get changePasswordUrl => '$baseUrl/api/auth/change-password';
  static String get teacherCheckInUrl => '$baseUrl/api/attendance/teacher/checkin';
  static String get teacherAttendanceHistoryUrl => '$baseUrl/api/attendance/teacher/me';
}
