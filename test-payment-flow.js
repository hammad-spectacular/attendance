require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function testPaymentFlow() {
  try {
    console.log('🧪 Testing payment flow in Neon database...\n');

    // 1. Check current state
    console.log('📊 Current database state:');
    const currentPayments = await pool.query(`
      SELECT id, student_id, month, amount_due, amount_paid, status, tenant_id
      FROM fee_payments
      ORDER BY created_at DESC
      LIMIT 5
    `);
    console.table(currentPayments.rows);

    // 2. Test inserting a new payment with different scenarios
    console.log('\n🧪 Testing payment status calculation scenarios:');
    
    const testCases = [
      { student_id: 23, month: '2025-10', amount_due: 6000, amount_paid: 0, expected_status: 'unpaid' },
      { student_id: 23, month: '2025-11', amount_due: 6000, amount_paid: 3000, expected_status: 'partial' },
      { student_id: 23, month: '2025-12', amount_due: 6000, amount_paid: 6000, expected_status: 'paid' },
    ];

    for (const testCase of testCases) {
      // Clean up any existing record for this test case
      await pool.query(`
        DELETE FROM fee_payments 
        WHERE student_id = $1 AND month = $2
      `, [testCase.student_id, testCase.month]);

      // Insert test payment
      const result = await pool.query(`
        INSERT INTO fee_payments (student_id, month, amount_due, amount_paid, status, tenant_id)
        VALUES ($1, $2, $3, $4, $5, 'ALIR')
        RETURNING *
      `, [
        testCase.student_id, 
        testCase.month, 
        testCase.amount_due, 
        testCase.amount_paid, 
        testCase.expected_status
      ]);

      const inserted = result.rows[0];
      const statusMatch = inserted.status === testCase.expected_status ? '✅' : '❌';
      
      console.log(`${statusMatch} Test: Due ${testCase.amount_due}, Paid ${testCase.amount_paid}`);
      console.log(`   Expected: ${testCase.expected_status}, DB Status: ${inserted.status}`);
      console.log(`   Record ID: ${inserted.id}\n`);
    }

    // 3. Test the API endpoint logic (simulate what the backend does)
    console.log('🔍 Testing backend status calculation logic:');
    
    const testValues = [
      { due: 6000, paid: 0 },
      { due: 6000, paid: 100 },
      { due: 6000, paid: 3000 },
      { due: 6000, paid: 6000 },
      { due: 6000, paid: 7000 },
    ];

    testValues.forEach(({ due, paid }) => {
      const dueNum = Number(due);
      const paidNum = Number(paid);
      
      // This is the logic from serverg.js lines 2224-2230
      let calculatedStatus = 'unpaid';
      if (paidNum >= dueNum) {
        calculatedStatus = 'paid';
      } else if (paidNum > 0) {
        calculatedStatus = 'partial';
      }
      
      console.log(`Due: ${dueNum}, Paid: ${paidNum} -> Status: ${calculatedStatus}`);
    });

    // 4. Check if there are any students without fee structures
    console.log('\n📋 Checking students without fee structures:');
    const studentsWithoutStructures = await pool.query(`
      SELECT s.id, s.name, s.class_id
      FROM students s
      WHERE s.tenant_id = 'ALIR'
      AND NOT EXISTS (
        SELECT 1 FROM fee_structures fs 
        WHERE (fs.type = 'student' AND fs.target_id = s.id)
        OR (fs.type = 'class' AND fs.target_id = s.class_id)
      )
      LIMIT 5
    `);
    
    if (studentsWithoutStructures.rows.length > 0) {
      console.log('Students without fee structures:');
      console.table(studentsWithoutStructures.rows);
    } else {
      console.log('✅ All students have fee structures configured');
    }

    // 5. Check if the frontend API endpoint is working correctly
    console.log('\n🌐 Testing the GET /api/fees/payments query logic:');
    const apiQueryResult = await pool.query(`
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
      LEFT JOIN fee_payments ON students.id = fee_payments.student_id AND fee_payments.tenant_id = students.tenant_id AND fee_payments.month = '2025-09'
      LEFT JOIN classes ON students.class_id = classes.id AND students.tenant_id = classes.tenant_id
      WHERE students.tenant_id = 'ALIR'
      ORDER BY students.name ASC
      LIMIT 3
    `);
    
    console.log('Sample API query results:');
    console.table(apiQueryResult.rows);

  } catch (error) {
    console.error('❌ Error testing payment flow:', error.message);
    console.error('Full error:', error);
  } finally {
    await pool.end();
  }
}

testPaymentFlow();
