const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function testPaymentInsert() {
  try {
    // First, let's insert a test payment record manually
    const studentId = 23; // Student 1 in ALIR
    const month = '2025-09';
    const amountDue = 6000;
    const amountPaid = 6000;
    const paymentMethod = 'cash';
    const paymentDate = '2025-09-25';
    const notes = 'Test payment';
    const tenantId = 'ALIR';

    console.log('Attempting to insert payment record...');
    console.log('Student ID:', studentId);
    console.log('Month:', month);
    console.log('Amount Due:', amountDue);
    console.log('Amount Paid:', amountPaid);

    const result = await pool.query(
      `INSERT INTO fee_payments (student_id, month, amount_due, amount_paid, status, payment_method, payment_date, notes, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [studentId, month, amountDue, amountPaid, 'paid', paymentMethod, paymentDate, notes, tenantId]
    );

    console.log('Payment inserted successfully!');
    console.log('Result:', result.rows[0]);

    // Now query it back
    const checkResult = await pool.query(
      'SELECT * FROM fee_payments WHERE student_id = $1 AND month = $2 AND tenant_id = $3',
      [studentId, month, tenantId]
    );

    console.log('Payment record retrieved:');
    console.log(checkResult.rows);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

testPaymentInsert();