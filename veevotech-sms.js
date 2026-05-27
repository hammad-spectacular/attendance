// ============================================
// VeevoTech SMS Integration Module
// ============================================



/**
 * Send SMS via VeevoTech API
 * @param {string} phone - Receiver phone number (format: +923001234567)
 * @param {string} message - SMS text content
 * @param {string} studentName - Student name (for logging)
 * @returns {Promise<object>} API response
 */
async function sendVeevoSMS(phone, message, studentName) {
    const hash = process.env.VEEVOTECH_HASH;
    const sender = process.env.VEEVOTECH_SENDER;
    const apiUrl = process.env.VEEVOTECH_API_URL;

    // Validate credentials
    if (!hash || !sender || !apiUrl) {
        throw new Error('VeevoTech credentials missing in .env file');
    }

    // Format phone number (remove spaces, ensure + prefix)
    const formattedPhone = phone.replace(/[\s\-\(\)]/g, '');

    if (!formattedPhone.startsWith('+92')) {
        throw new Error(`Invalid Pakistan phone number: ${phone}`);
    }

    // VeevoTech API payload
    const payload = {
        hash: hash,
        sendernum: sender,
        receivernum: formattedPhone,
        textmessage: message
    };

    console.log('\n📤 Sending SMS via VeevoTech:');
    console.log(`   Student: ${studentName}`);
    console.log(`   Phone: ${formattedPhone}`);
    console.log(`   Message: "${message.substring(0, 50)}..."`);

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(`VeevoTech API Error: ${response.status} - ${JSON.stringify(data)}`);
        }

        // VeevoTech success response check
        if (data.STATUS === 'SUCCESSFUL' || data.response_code === 200) {
            console.log(`   ✅ SMS sent successfully to ${studentName}`);
            return {
                success: true,
                provider: 'veevotech',
                phone: formattedPhone,
                response: data
            };
        } else {
            console.log(`   ⚠️ VeevoTech returned error: ${JSON.stringify(data)}`);
            return {
                success: false,
                provider: 'veevotech',
                phone: formattedPhone,
                error: data.message || 'Unknown error',
                response: data
            };
        }

    } catch (error) {
        console.error(`   ❌ Failed to send SMS to ${studentName}:`, error.message);
        return {
            success: false,
            provider: 'veevotech',
            phone: formattedPhone,
            error: error.message
        };
    }
}

module.exports = { sendVeevoSMS };
