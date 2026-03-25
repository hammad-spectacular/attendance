// ============================================
// PHASE 4: Express Backend Server
// ============================================
// Run: npm init -y && npm install express
// Start: node server.js
// Open: http://localhost:3000
// ============================================

const express = require('express');
const app = express();
const PORT = 3000;

// ============================================
// MIDDLEWARE
// ============================================
app.use(express.json());
app.use(express.static('.')); // Serves index.html from same folder

// ============================================
// WELCOME ENDPOINT (ROOT)
// ============================================
app.get('/', (req, res) => {
    res.json({
        success: true,
        name: 'Attendance Management System',
        version: '1.0.0',
        status: 'online',
        endpoints: {
            health: 'GET /health',
            submit: 'POST /submit-attendance'
        },
        students: [
            'Ali Khan (+923001234567)',
            'Sara Ahmed (+923111234567)',
            'Usman Malik (+923211234567)',
            'Fatima Noor (+923331234567)',
            'Hassan Raza (+923451234567)'
        ],
        nextPhase: 'CallMeBot WhatsApp Integration'
    });
});

// ============================================
// HEALTH CHECK ENDPOINT
// ============================================
app.get('/health', (req, res) => {
    res.json({
        status: 'online',
        time: new Date().toISOString(),
        message: 'Attendance server is running'
    });
});

// ============================================
// SUBMIT ATTENDANCE ENDPOINT
// ============================================
app.post('/submit-attendance', (req, res) => {
    const { date, totalStudents, presentCount, absentCount, absentees } = req.body;

    // Validation
    if (!absentees || !Array.isArray(absentees)) {
        console.log('❌ Invalid request — no absentees array');
        return res.status(400).json({
            success: false,
            message: 'Invalid data: absentees array required'
        });
    }

    // ============================================
    // LOG RECEIVED DATA
    // ============================================
    console.log('\n' + '='.repeat(50));
    console.log('📋 ATTENDANCE RECEIVED');
    console.log('='.repeat(50));
    console.log(`📅 Date:       ${date}`);
    console.log(`👥 Total:      ${totalStudents}`);
    console.log(`✅ Present:    ${presentCount}`);
    console.log(`❌ Absent:     ${absentCount}`);
    console.log('-'.repeat(50));

    if (absentees.length === 0) {
        console.log('🎉 All students present! No SMS needed.');
    } else {
        console.log('📱 ABSENTEES (will receive WhatsApp SMS):');
        console.log('-'.repeat(50));
        absentees.forEach((student, index) => {
            const phoneStatus = student.phoneValid ? '✅' : '⚠️ INVALID';
            console.log(`  ${index + 1}. ${student.name}`);
            console.log(`     Phone: ${student.phone} ${phoneStatus}`);
        });
    }

    console.log('-'.repeat(50));
    console.log(`⏰ Received at: ${new Date().toLocaleTimeString()}`);
    console.log('🔮 Next: Phase 4.5 — CallMeBot WhatsApp API');
    console.log('='.repeat(50) + '\n');

    // ============================================
    // RESPONSE
    // ============================================
    res.json({
        success: true,
        message: `Attendance received for ${date}`,
        absentCount: absentees.length,
        presentCount: presentCount,
        totalStudents: totalStudents,
        serverTime: new Date().toISOString(),
        whatsappStatus: 'pending — Phase 4.5'
    });
});

// ============================================
// 404 HANDLER
// ============================================
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint not found'
    });
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
    console.log('\n' + '='.repeat(50));
    console.log('🚀 ATTENDANCE SERVER STARTED');
    console.log('='.repeat(50));
    console.log(`🌐 URL:    http://localhost:${PORT}`);
    console.log(`📡 API:    http://localhost:${PORT}/submit-attendance`);
    console.log(`💚 Health: http://localhost:${PORT}/health`);
    console.log('='.repeat(50));
    console.log('📋 Hardcoded Students:');
    console.log('   1. Ali Khan      +923001234567');
    console.log('   2. Sara Ahmed    +923111234567');
    console.log('   3. Usman Malik   +923211234567');
    console.log('   4. Fatima Noor   +923331234567');
    console.log('   5. Hassan Raza   +923451234567');
    console.log('='.repeat(50));
    console.log('⏳ Waiting for attendance submissions...\n');
});
