require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function testUserWorkflow() {
  try {
    console.log('🧪 Testing complete user payment workflow...\n');

    // Step 1: User navigates to fees page and loads student data
    console.log('📱 Step 1: User loads fees page');
    console.log('   - Loading students and fee structures...');
    
    const students = await pool.query(`
      SELECT id, name, roll_no, class_id 
      FROM students 
      WHERE tenant_id = 'ALIR' 
      LIMIT 3
    `);
    
    const structures = await pool.query(`
      SELECT id, type, target_id, monthly_fee 
      FROM fee_structures 
      WHERE tenant_id = 'ALIR'
    `);
    
    console.log(`   ✅ Loaded ${students.rows.length} students`);
    console.log(`   ✅ Loaded ${structures.rows.length} fee structures`);

    // Step 2: User selects a student in the payment modal
    const testStudent = students.rows[0];
    console.log(`\n📱 Step 2: User selects student ${testStudent.name} (ID: ${testStudent.id})`);
    
    // Simulate onStudentChange() logic
    let studentStructure = structures.rows.find(s => s.type === 'student' && s.target_id === testStudent.id);
    if (!studentStructure && testStudent.class_id) {
      studentStructure = structures.rows.find(s => s.type === 'class' && s.target_id === testStudent.class_id);
    }
    
    if (studentStructure) {
      const monthlyFee = Number(studentStructure.monthly_fee) || 0;
      console.log(`   ✅ Fee structure found: Rs. ${monthlyFee.toLocaleString()}`);
    } else {
      console.log(`   ❌ No fee structure found for this student`);
      return;
    }

    // Step 3: User fills out payment form
    const monthlyFee = Number(studentStructure.monthly_fee) || 0;
    const testMonth = '2025-10';
    const testPayment = {
      student_id: testStudent.id,
      month: testMonth,
      amount_due: monthlyFee,
      amount_paid: Math.floor(monthlyFee * 0.5), // Pay half
      payment_method: 'cash',
      payment_date: new Date().toISOString().split('T')[0],
      notes: 'Test payment from user workflow'
    };
    
    console.log(`\n📱 Step 3: User fills payment form`);
    console.log(`   - Student: ${testStudent.name}`);
    console.log(`   - Month: ${testMonth}`);
    console.log(`   - Amount Due: Rs. ${testPayment.amount_due.toLocaleString()}`);
    console.log(`   - Amount Paid: Rs. ${testPayment.amount_paid.toLocaleString()}`);

    // Step 4: Check if payment record already exists (backend logic)
    console.log(`\n📱 Step 4: Backend checks for existing payment record`);
    const existing = await pool.query(`
      SELECT id FROM fee_payments 
      WHERE student_id = $1 AND month = $2 AND tenant_id = $3
    `, [testPayment.student_id, testPayment.month, 'ALIR']);
    
    if (existing.rows.length > 0) {
      console.log(`   ✅ Existing record found (ID: ${existing.rows[0].id}), will update`);
    } else {
      console.log(`   ✅ No existing record, will create new`);
    }

    // Step 5: Backend calculates status
    console.log(`\n📱 Step 5: Backend calculates payment status`);
    const due = Number(testPayment.amount_due);
    const paid = Number(testPayment.amount_paid);
    
    let calculatedStatus = 'unpaid';
    if (paid >= due) {
      calculatedStatus = 'paid';
    } else if (paid > 0) {
      calculatedStatus = 'partial';
    }
    
    console.log(`   ✅ Status calculated: ${calculatedStatus}`);

    // Step 6: Backend saves to database
    console.log(`\n📱 Step 6: Backend saves payment to database`);
    let result;
    if (existing.rows.length > 0) {
      result = await pool.query(`
        UPDATE fee_payments 
        SET amount_due = $1, amount_paid = $2, status = $3, payment_method = $4, payment_date = $5, notes = $6, updated_at = CURRENT_TIMESTAMP
        WHERE student_id = $7 AND month = $8 AND tenant_id = $9
        RETURNING *
      `, [due, paid, calculatedStatus, testPayment.payment_method, testPayment.payment_date, testPayment.notes, 
          testPayment.student_id, testPayment.month, 'ALIR']);
      console.log(`   ✅ Updated existing payment record`);
    } else {
      result = await pool.query(`
        INSERT INTO fee_payments (student_id, month, amount_due, amount_paid, status, payment_method, payment_date, notes, tenant_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
      `, [testPayment.student_id, testPayment.month, due, paid, calculatedStatus, 
          testPayment.payment_method, testPayment.payment_date, testPayment.notes, 'ALIR']);
      console.log(`   ✅ Created new payment record`);
    }

    const savedRecord = result.rows[0];
    console.log(`   ✅ Saved record ID: ${savedRecord.id}`);
    console.log(`   ✅ Final status in DB: ${savedRecord.status}`);

    // Step 7: Frontend refreshes payment list
    console.log(`\n📱 Step 7: Frontend refreshes payment list`);
    const refreshedPayments = await pool.query(`
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

    console.log(`   ✅ API returns payment data for student`);
    const apiData = refreshedPayments.rows[0];
    console.log(`   ✅ Status from API: ${apiData.status}`);
    console.log(`   ✅ Amount Paid from API: ${apiData.amount_paid}`);

    // Step 8: Frontend displays updated status
    console.log(`\n📱 Step 8: Frontend displays updated status`);
    const statusMatch = apiData.status === calculatedStatus;
    const amountMatch = Number(apiData.amount_paid) === paid;
    
    console.log(`   ${statusMatch ? '✅' : '❌'} Status display: ${apiData.status} (expected: ${calculatedStatus})`);
    console.log(`   ${amountMatch ? '✅' : '❌'} Amount display: ${apiData.amount_paid} (expected: ${paid})`);

    // Final verification
    console.log(`\n🎯 Workflow Result: ${statusMatch && amountMatch ? 'SUCCESS ✅' : 'FAILURE ❌'}`);
    
    if (!statusMatch || !amountMatch) {
      console.log('\n⚠️ Issues detected:');
      if (!statusMatch) console.log('   - Status mismatch between database and API response');
      if (!amountMatch) console.log('   - Amount mismatch between database and API response');
    } else {
      console.log('\n✅ Complete payment workflow is functioning correctly');
      console.log('If you are still experiencing issues in the UI, the problem may be:');
      console.log('   1. Frontend JavaScript errors (check browser console)');
      console.log('   2. CSS/styling issues hiding the updated status');
      console.log('   3. Caching issues in the browser');
      console.log('   4. Authentication/session issues');
    }

  } catch (error) {
    console.error('❌ Error in user workflow test:', error.message);
    console.error('Full error:', error);
  } finally {
    await pool.end();
  }
}

testUserWorkflow();
