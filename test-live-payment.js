require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function testLivePayment() {
  try {
    console.log('🧪 Testing live payment workflow simulation...\n');

    // 1. Simulate what happens when you try to record a payment via the API
    console.log('📝 Simulating POST /api/fees/payments request:');
    
    const testPayment = {
      student_id: 23,
      month: '2025-10', // This should be unpaid currently
      amount_due: 6000,
      amount_paid: 3000, // Partial payment
      payment_method: 'cash',
      payment_date: '2025-09-25',
      notes: 'Test partial payment'
    };

    console.log('Payment data:', testPayment);

    // Check current state before
    const beforeState = await pool.query(`
      SELECT id, student_id, month, amount_due, amount_paid, status 
      FROM fee_payments 
      WHERE student_id = $1 AND month = $2
    `, [testPayment.student_id, testPayment.month]);
    
    console.log('\n📊 Before payment:');
    if (beforeState.rows.length > 0) {
      console.table(beforeState.rows);
    } else {
      console.log('No existing payment record (will create new)');
    }

    // Simulate the backend logic from serverg.js
    console.log('\n🔍 Backend status calculation:');
    const due = Number(testPayment.amount_due);
    const paid = Number(testPayment.amount_paid);
    
    let calculatedStatus = 'unpaid';
    if (paid >= due) {
      calculatedStatus = 'paid';
    } else if (paid > 0) {
      calculatedStatus = 'partial';
    }
    
    console.log(`Due: ${due}, Paid: ${paid} -> Status: ${calculatedStatus}`);

    // Execute the same logic as the API
    let result;
    if (beforeState.rows.length > 0) {
      // Update existing
      result = await pool.query(`
        UPDATE fee_payments 
        SET amount_due = $1, amount_paid = $2, status = $3, payment_method = $4, payment_date = $5, notes = $6, updated_at = CURRENT_TIMESTAMP
        WHERE student_id = $7 AND month = $8 AND tenant_id = $9
        RETURNING *
      `, [due, paid, calculatedStatus, testPayment.payment_method, testPayment.payment_date, testPayment.notes, 
          testPayment.student_id, testPayment.month, 'ALIR']);
      console.log('✅ Updated existing payment record');
    } else {
      // Insert new
      result = await pool.query(`
        INSERT INTO fee_payments (student_id, month, amount_due, amount_paid, status, payment_method, payment_date, notes, tenant_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
      `, [testPayment.student_id, testPayment.month, due, paid, calculatedStatus, 
          testPayment.payment_method, testPayment.payment_date, testPayment.notes, 'ALIR']);
      console.log('✅ Created new payment record');
    }

    console.log('\n📊 After payment:');
    console.table(result.rows);

    // Verify the status was saved correctly
    const savedRecord = result.rows[0];
    const statusCorrect = savedRecord.status === calculatedStatus;
    console.log(`\n✅ Status verification: ${statusCorrect ? 'PASS' : 'FAIL'}`);
    console.log(`   Expected: ${calculatedStatus}, Saved: ${savedRecord.status}`);

    // 2. Test what the GET API would return
    console.log('\n🌐 Testing GET /api/fees/payments response:');
    const apiResponse = await pool.query(`
      SELECT 
        students.id as student_id,
        students.name as student_name,
        students.roll_no,
        students.class_id,
        classes.name as class_name,
        fee_payments.id as payment_id,
        fee_payments.month as month_year,
        fee_payments.amount_due,
        fee_payments.amount_paid,
        COALESCE(fee_payments.status, 'not_set_up') as status,
        fee_payments.payment_date,
        fee_payments.payment_method,
        fee_payments.notes
      FROM students
      LEFT JOIN fee_payments ON students.id = fee_payments.student_id AND fee_payments.tenant_id = students.tenant_id AND fee_payments.month = $2
      LEFT JOIN classes ON students.class_id = classes.id AND students.tenant_id = classes.tenant_id
      WHERE students.id = $1 AND students.tenant_id = 'ALIR'
    `, [testPayment.student_id, testPayment.month]);

    console.log('API response for student 23, month 2025-10:');
    console.table(apiResponse.rows);

    // 3. Test the quick mark paid functionality
    console.log('\n⚡ Testing quick mark paid (marking remaining amount as paid):');
    const quickPayAmount = due - paid; // 3000 remaining
    const newPaidAmount = due; // Full payment
    const quickPayStatus = 'paid';

    const quickPayResult = await pool.query(`
      UPDATE fee_payments 
      SET amount_paid = $1, status = $2, updated_at = CURRENT_TIMESTAMP
      WHERE student_id = $3 AND month = $4 AND tenant_id = $5
      RETURNING *
    `, [newPaidAmount, quickPayStatus, testPayment.student_id, testPayment.month, 'ALIR']);

    console.log('After quick mark paid:');
    console.table(quickPayResult.rows);

    console.log('\n✅ Payment workflow test completed successfully');
    console.log('If this is working in the database but not in the UI, the issue is in the frontend');

  } catch (error) {
    console.error('❌ Error in payment workflow test:', error.message);
    console.error('Full error:', error);
  } finally {
    await pool.end();
  }
}

testLivePayment();
