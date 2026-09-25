require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function checkStudentsData() {
  try {
    console.log('🔍 Checking students data and fee structure configuration...\n');

    // 1. Check all students
    const students = await pool.query(`
      SELECT id, name, roll_no, class_id, tenant_id
      FROM students
      WHERE tenant_id = 'ALIR'
      ORDER BY id
    `);
    
    console.log('📋 All students:');
    console.table(students.rows);

    // 2. Check classes
    const classes = await pool.query(`
      SELECT id, name, tenant_id
      FROM classes
      WHERE tenant_id = 'ALIR'
      ORDER BY id
    `);
    
    console.log('\n📚 Available classes:');
    console.table(classes.rows);

    // 3. Check fee structures
    const structures = await pool.query(`
      SELECT id, type, target_id, monthly_fee, admission_fee, transport_fee, discount, tenant_id
      FROM fee_structures
      WHERE tenant_id = 'ALIR'
      ORDER BY type, target_id
    `);
    
    console.log('\n💰 Fee structures:');
    console.table(structures.rows);

    // 4. Analyze which students have fee structures
    console.log('\n🔍 Fee structure coverage analysis:');
    
    for (const student of students.rows) {
      let hasStructure = false;
      let structureType = 'none';
      let structureInfo = '';

      // Check for student-specific structure
      const studentStructure = structures.rows.find(s => s.type === 'student' && s.target_id === student.id);
      if (studentStructure) {
        hasStructure = true;
        structureType = 'student-specific';
        structureInfo = `Monthly: ${studentStructure.monthly_fee}`;
      } 
      // Check for class-level structure
      else if (student.class_id) {
        const classStructure = structures.rows.find(s => s.type === 'class' && s.target_id === student.class_id);
        if (classStructure) {
          hasStructure = true;
          structureType = 'class-level';
          structureInfo = `Class ${student.class_id}, Monthly: ${classStructure.monthly_fee}`;
        }
      }

      const status = hasStructure ? '✅' : '❌';
      const className = student.class_id ? (classes.rows.find(c => c.id === student.class_id)?.name || 'Unknown') : 'NO CLASS';
      
      console.log(`${status} Student ${student.id} (${student.name}): Class ${student.class_id} (${className}) - ${structureType} ${structureInfo}`);
    }

    // 5. Check payment records
    const payments = await pool.query(`
      SELECT id, student_id, month, amount_due, amount_paid, status
      FROM fee_payments
      WHERE tenant_id = 'ALIR'
      ORDER BY student_id, month
    `);
    
    console.log('\n💳 Payment records:');
    if (payments.rows.length === 0) {
      console.log('No payment records found');
    } else {
      console.table(payments.rows);
    }

  } catch (error) {
    console.error('❌ Error checking students data:', error.message);
    console.error('Full error:', error);
  } finally {
    await pool.end();
  }
}

checkStudentsData();
