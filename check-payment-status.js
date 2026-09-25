require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function checkPaymentStatus() {
  try {
    console.log('🔍 Checking payment status in Neon database...\n');

    // Check if fee_payments table exists and its structure
    const tableInfo = await pool.query(`
      SELECT column_name, data_type, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'fee_payments' 
      ORDER BY ordinal_position
    `);
    
    console.log('📋 fee_payments table structure:');
    console.table(tableInfo.rows);

    // Check current payment records
    const payments = await pool.query(`
      SELECT id, student_id, month, amount_due, amount_paid, status, payment_date, tenant_id
      FROM fee_payments
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    console.log('\n💰 Recent payment records:');
    if (payments.rows.length === 0) {
      console.log('No payment records found in database');
    } else {
      console.table(payments.rows);
      
      // Analyze status calculation
      console.log('\n🔍 Status Analysis:');
      payments.rows.forEach(row => {
        const due = Number(row.amount_due);
        const paid = Number(row.amount_paid);
        const calculatedStatus = paid >= due ? 'paid' : (paid > 0 ? 'partial' : 'unpaid');
        const statusMatch = row.status === calculatedStatus ? '✅' : '❌';
        console.log(`${statusMatch} Student ${row.student_id} | Month: ${row.month} | Due: ${due} | Paid: ${paid} | DB Status: ${row.status} | Calculated: ${calculatedStatus}`);
      });
    }

    // Check fee structures
    const structures = await pool.query(`
      SELECT id, type, target_id, monthly_fee, admission_fee, transport_fee, discount, tenant_id
      FROM fee_structures
      ORDER BY created_at DESC
      LIMIT 5
    `);
    
    console.log('\n📊 Recent fee structures:');
    if (structures.rows.length === 0) {
      console.log('No fee structures found in database');
    } else {
      console.table(structures.rows);
    }

    // Test status calculation logic
    console.log('\n🧪 Testing status calculation logic:');
    const testCases = [
      { due: 100, paid: 0, expected: 'unpaid' },
      { due: 100, paid: 50, expected: 'partial' },
      { due: 100, paid: 100, expected: 'paid' },
      { due: 100, paid: 150, expected: 'paid' }
    ];
    
    testCases.forEach(({ due, paid, expected }) => {
      const calculated = paid >= due ? 'paid' : (paid > 0 ? 'partial' : 'unpaid');
      const match = calculated === expected ? '✅' : '❌';
      console.log(`${match} Due: ${due}, Paid: ${paid} -> ${calculated} (expected: ${expected})`);
    });

  } catch (error) {
    console.error('❌ Error checking payment status:', error.message);
    console.error('Full error:', error);
  } finally {
    await pool.end();
  }
}

checkPaymentStatus();
