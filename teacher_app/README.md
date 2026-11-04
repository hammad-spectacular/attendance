# The Eye - Teacher Android App

A Flutter-based Android application for teachers to mark attendance via QR code scanning, integrated with The Eye's existing backend system.

## Features

### Phase 1 (Current)
- **Authentication**: Direct integration with The Eye's existing backend
  - Login using existing teacher credentials (School ID + Teacher ID)
  - First-time password change flow (required for new accounts)
  - JWT token-based authentication
  - Automatic logout functionality

- **QR Code Attendance**
  - Scan school's QR code to mark attendance
  - Location verification (GPS coordinates captured)
  - Real-time attendance submission to backend
  - Success/error feedback with dialogs

- **Simple UI**
  - Clean, intuitive login screen
  - Password change screen for first-time users
  - Main screen with "Updates on the way!" message
  - QR scanner as the primary feature

## Technical Architecture

### Backend Integration
The app uses The Eye's existing backend APIs:
- `/api/auth/login` - Teacher authentication
- `/api/auth/change-password` - Password management
- `/api/attendance/teacher/checkin` - QR-based attendance submission
- `/api/attendance/teacher/me` - Attendance history

### Database Integration
- Uses existing `teachers` table for authentication
- New `teacher_attendance` table for QR-based check-ins
- Stores: teacher_id, tenant_id, branch_id, date, check_in_time, location (lat/lng), qr_code_data
- Proper tenant/branch isolation enforced by backend

### Security
- No local password storage
- All authentication via backend APIs
- JWT tokens stored securely in SharedPreferences
- HTTPS communication with backend
- Token generation invalidation on password change

## Setup Instructions

### Prerequisites
1. Flutter SDK 3.13.5 or higher
2. Android Studio with SDK 21+
3. Access to The Eye's backend (URL: http://13.63.55.73)
4. A teacher account in The Eye's database

### Installation

1. Navigate to the project directory:
```bash
cd teacher_app
```

2. Install dependencies:
```bash
flutter pub get
```

3. Update backend URL if needed:
   - Edit `lib/config/api_config.dart`
   - Change `baseUrl` to your backend URL

4. Run the app:
```bash
flutter run
```

### Android Permissions
The app requires the following permissions (configured in AndroidManifest.xml):
- `CAMERA` - For QR code scanning
- `ACCESS_FINE_LOCATION` - For GPS-based attendance verification
- `ACCESS_COARSE_LOCATION` - For location services

## Testing Requirements

### Critical Testing Steps

Before declaring the app integrated, you MUST test the following:

#### 1. Authentication Testing
- [ ] Log in with an existing teacher account (from The Eye's database)
- [ ] Verify incorrect credentials are rejected
- [ ] Test first-time password change flow
- [ ] Verify the new password works on both mobile app AND web application
- [ ] Verify password is updated in The Eye's database (check `teachers` table)
- [ ] Verify `is_first_login` flag is set to `false` after password change

#### 2. QR Attendance Testing
- [ ] Create a test QR code containing school identifier data
- [ ] Scan the QR code with the app
- [ ] Verify location permission is requested and granted
- [ ] Verify attendance is submitted successfully
- [ ] Check `teacher_attendance` table in database for the record
- [ ] Verify the record contains: teacher_id, tenant_id, branch_id, date, location, qr_code_data
- [ ] Verify another academy's teacher cannot access this teacher's records

#### 3. Database Verification
Run these SQL queries to verify integration:

```sql
-- Check teacher record
SELECT id, name, login_id, tenant_id, is_first_login, branch_id
FROM teachers
WHERE login_id = 'YOUR_TEST_TEACHER_ID';

-- Check teacher attendance record
SELECT ta.*, t.name as teacher_name, o.school_name
FROM teacher_attendance ta
JOIN teachers t ON ta.teacher_id = t.id
JOIN organizations o ON ta.tenant_id = o.school_code
WHERE t.login_id = 'YOUR_TEST_TEACHER_ID'
ORDER BY ta.date DESC
LIMIT 5;
```

#### 4. Cross-Platform Verification
- [ ] Log in to The Eye's web admin panel
- [ ] Navigate to the attendance section
- [ ] Verify the teacher's QR attendance appears in the admin dashboard
- [ ] Verify the attendance is associated with the correct tenant and branch

## API Endpoints

### Login
```
POST /api/auth/login
Body: {
  "full_id": "SCHOOL-123",
  "password": "password"
}
Response: {
  "success": true,
  "token": "jwt_token",
  "role": "teacher",
  "is_first_login": true/false,
  "redirect_url": "/change-password.html" or "/teacher.html"
}
```

### Change Password
```
POST /api/auth/change-password
Headers: Authorization: Bearer <token>
Body: {
  "current_password": "old_password",  // Required only if not first login
  "new_password": "new_password",
  "confirm_password": "new_password"
}
Response: {
  "success": true,
  "token": "new_jwt_token",
  "redirect_url": "/teacher.html",
  "message": "Password changed successfully"
}
```

### Teacher Check-in (QR)
```
POST /api/attendance/teacher/checkin
Headers: Authorization: Bearer <token>
Body: {
  "qr_code_data": "school_qr_data",
  "location_lat": 24.8607,
  "location_lng": 67.0011
}
Response: {
  "success": true,
  "message": "Check-in successful",
  "attendance_id": 123,
  "check_in_time": "2026-11-02T08:30:00Z",
  "date": "2026-11-02",
  "teacher_name": "John Doe"
}
```

## Backend Changes Made

### New Table: teacher_attendance
```sql
CREATE TABLE teacher_attendance (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  tenant_id VARCHAR(10) NOT NULL REFERENCES organizations(school_code) ON DELETE CASCADE,
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  check_in_time TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  location_lat NUMERIC(10, 6),
  location_lng NUMERIC(10, 6),
  qr_code_data TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(teacher_id, date)
);
```

### New API Endpoints
- `POST /api/attendance/teacher/checkin` - Submit teacher attendance via QR
- `GET /api/attendance/teacher/me` - Get teacher's attendance history

## Project Structure

```
teacher_app/
├── lib/
│   ├── config/
│   │   └── api_config.dart          # Backend API URLs
│   ├── services/
│   │   └── api_service.dart         # HTTP client and API calls
│   ├── screens/
│   │   ├── login_screen.dart        # Login UI
│   │   ├── change_password_screen.dart  # Password change UI
│   │   └── main_screen.dart         # QR scanner and main UI
│   └── main.dart                    # App entry point
├── android/
│   └── app/
│       └── src/main/
│           └── AndroidManifest.xml  # Permissions configuration
└── pubspec.yaml                     # Dependencies
```

## Dependencies

- `http: ^1.2.0` - HTTP client for API calls
- `shared_preferences: ^2.2.2` - Local storage for auth tokens
- `mobile_scanner: ^4.0.1` - QR code scanning
- `geolocator: ^10.1.0` - GPS location services
- `permission_handler: ^11.3.0` - Runtime permission handling

## Important Notes

1. **No Separate Registration**: The app does NOT create teacher accounts. Teachers must be created through The Eye's admin system first.

2. **Password Security**: Passwords are never stored on the device. All password operations go through the backend.

3. **First-Time Login**: Teachers with `is_first_login = true` are forced to change their password before accessing the app.

4. **Database as Source of Truth**: Local storage is only for temporary auth tokens. All attendance data is stored in The Eye's database.

5. **Tenant Isolation**: The backend enforces tenant/branch isolation, so teachers from one school cannot access another school's data.

## Troubleshooting

### Camera not working
- Ensure camera permission is granted in app settings
- Check AndroidManifest.xml has CAMERA permission
- Test on a physical device (emulator camera support varies)

### Location not working
- Ensure location permission is granted
- Check device location services are enabled
- GPS may not work indoors

### Login fails
- Verify backend URL is correct in api_config.dart
- Check network connectivity
- Verify teacher account exists in The Eye's database
- Check teacher portal is enabled for the school (tenant_features table)

### Password change fails
- Ensure password meets requirements (8+ chars, 1 special char)
- For first-time login, current_password should be null
- Verify backend is running and accessible

## Future Enhancements (Not in Phase 1)

- Student attendance taking
- Class management
- Dashboard with attendance statistics
- Offline mode support
- Push notifications
- Profile management
- School announcements
