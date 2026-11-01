const express = require('express');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/auth/me', (req, res) => {
  const referer = req.headers.referer || '';
  let role = 'admin';
  if (referer.includes('teacher.html')) role = 'teacher';
  else if (referer.includes('student.html')) role = 'student';
  else if (referer.includes('coordinator.html')) role = 'coordinator';

  res.json({
    id: 1,
    role,
    name: `Test ${role}`,
    schoolName: 'Test School',
    branch: 'Main'
  });
});

app.get('/api/tenant-features', (req, res) => {
  res.json({
    teacher_management: true,
    student_management: true,
    fees: true,
    attendance: true
  });
});

app.get('/api/auth/capacity', (req, res) => {
  res.json({ students: 50, teachers: 10 });
});

app.get('/api/branches', (req, res) => {
  res.json({ branches: [{ id: 1, name: 'Main Campus' }] });
});

app.get('/api/classes', (req, res) => res.json([]));
app.get('/api/teachers', (req, res) => res.json([{ id: 1, name: 'Test teacher' }]));
app.get('/api/students', (req, res) => res.json([]));
app.get('/api/attendance', (req, res) => res.json([]));
app.get('/api/attendance/today', (req, res) => res.json({ date: '2026-11-01', records: [] }));
app.get('/api/announcements', (req, res) => res.json([]));
app.get('/api/coordinators', (req, res) => res.json([]));
app.get('/api/fees/structures', (req, res) => res.json([]));
app.get('/api/fees/payments', (req, res) => res.json([]));
app.get('/api/fees/stats', (req, res) => res.json({ totalExpected: 0, totalCollected: 0 }));

// Student endpoints
app.get('/api/classes/me', (req, res) => res.json({ id: 1, name: 'Grade 10', section: 'A' }));
app.get('/api/students/me', (req, res) => res.json({ id: 101, name: 'Student One', class_id: 1 }));
app.get('/api/homework', (req, res) => res.json([]));
app.get('/api/attendance/me', (req, res) => res.json([]));
app.get('/api/fees/me', (req, res) => res.json([]));

// Coordinator endpoints
app.get('/api/coordinator/me', (req, res) => res.json({ id: 1, name: 'Coordinator One', branch_id: 1 }));

const server = app.listen(3333, () => {
  console.log('Test navigation server running on port 3333');
});
