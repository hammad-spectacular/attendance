// ============================================
// PHASE 4: Express Backend Server
// ============================================
// Run: npm init -y && npm install express
// Start: node server.js
// Open: http://localhost:3000
// ============================================
require('dotenv').config(); // Load default .env file
const express = require('express');
const http = require('http');
//const twilio = require('twilio'); // npm install twilio
const { sendVeevoSMS } = require('./veevotech-sms');
const app = express();
const PORT = 3000;

// 🔑 TWILIO CONFIG (from environment variables)
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhone = process.env.TWILIO_PHONE_NUMBER;

// ============================================
// ENTERPRISE SMS FUNCTION (modular - Twilio/WhatsApp ready)
// ============================================
async function sendSMS(phone, message, studentName) {
    try {
        const twilio = require('twilio');
        const client = twilio(accountSid, authToken);
        const result = await client.messages.create({
            body: message,
            from: twilioPhone,
            to: phone
        });

        console.log(`✅ SMS SID: ${result.sid} → ${phone} (${studentName})`);
        return { success: true, sid: result.sid };
    } catch (error) {
        console.error(`❌ SMS failed → ${phone}:`, error.message);
        return { success: false, error: error.message };
    }
}

// Phase 6: Easy provider swap
async function sendViaProvider(provider, phone, message, studentName) {
    if (provider === 'veevotech') return sendVeevoSMS(phone, message, studentName);
    if (provider === 'twilio') return sendSMS(phone, message, studentName);
    // if (provider === 'whatsapp') return sendWhatsApp(phone, message);
}

// ============================================
// MIDDLEWARE
// ============================================
app.use(express.json());
app.use(express.static('.')); // Serves index.html from same folder

// Enable CORS for frontend requests
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
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
app.post('/submit-attendance', async (req, res) => {
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

    let results = [];
    if (absentees.length === 0) {
        console.log('🎉 All students present! No SMS needed.');
    } else {
        console.log(`📱 Twilio processing ${absentees.length} absentees...`);
        console.log('-'.repeat(50));

        // Process each absentee
        for (const student of absentees) {
            const message = `Your child ${student.name} was absent today.`;
            // Call our enterprise SMS function provider
            const result = await sendViaProvider('veevotech', student.phone, message, student.name);
            results.push({ name: student.name, phone: student.phone, ...result });
        }
    }

    console.log('-'.repeat(50));
    const successCount = results.filter(r => r && r.success).length;
    console.log(`📊 SMS sent: ${successCount}/${absentees.length}`);
    console.log(`⏰ Received at: ${new Date().toLocaleTimeString()}`);
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
        sent: successCount,
        results: results.slice(0, 3) // First 3 for frontend
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
const server = http.createServer(app);
server.listen(PORT, () => {
    console.log('\n' + '='.repeat(50));
    console.log('🚀 ATTENDANCE SERVER STARTED');
    console.log('='.repeat(50));
    console.log(`🌐 URL:    http://localhost:${PORT}`);
    console.log(`📡 API:    http://localhost:${PORT}/submit-attendance`);
    console.log(`💚 Health: http://localhost:${PORT}/health`);
    console.log('='.repeat(50));
    console.log('⏳ Waiting for attendance submissions...\n');
});
