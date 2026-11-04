// Test script for teacher attendance API
// Run with: node test-teacher-attendance-api.js

const http = require('http');

const BASE_URL = 'http://13.63.55.73';

// Test 1: Check if server is running
function testHealth() {
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}/api/health`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('✓ Health check passed:', data);
        resolve();
      });
    }).on('error', reject);
  });
}

// Test 2: Check if teacher_attendance table exists (requires DB access)
// This is just a placeholder - actual test would query the database
console.log('\n=== Teacher Attendance API Test ===\n');
console.log('Note: This test only checks server availability.');
console.log('Full testing requires:');
console.log('1. A valid teacher account in the database');
console.log('2. JWT token from login');
console.log('3. Actual QR code data\n');

testHealth()
  .then(() => {
    console.log('\n✓ Server is running and accessible');
    console.log('\nNext steps:');
    console.log('1. Run the Flutter app: cd teacher_app && flutter run');
    console.log('2. Test login with a real teacher account');
    console.log('3. Test QR attendance submission');
    console.log('4. Verify records in the teacher_attendance table\n');
  })
  .catch(err => {
    console.error('✗ Server not accessible:', err.message);
    console.log('\nMake sure the backend server is running:');
    console.log('cd "C:\\Users\\Hammad\\Desktop\\the eyeg" && npm start\n');
  });
