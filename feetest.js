require('dotenv').config({path:'C:/Users/Hammad/Desktop/the eyeg/.env'});
const {Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL, ssl:process.env.DATABASE_URL.startsWith('postgres://')?{rejectUnauthorized:false}:undefined});
(async()=>{
  const c=await p.connect();
  try {
    await c.query('BEGIN');
    const st=(await c.query("SELECT s.id FROM students s WHERE tenant_id='ALIR' ORDER BY id LIMIT 3")).rows.map(r=>r.id);
    const cls=(await c.query("SELECT id FROM classes WHERE tenant_id='ALIR' LIMIT 1")).rows[0].id;
    console.log('students for ALIR:', st.join(','), '| class:', cls);
    // needs student accounts, attach directly: fee_structures + fee_payments rows
    await c.query("INSERT INTO fee_structures (type,target_id,monthly_fee,admission_fee,transport_fee,discount,tenant_id) VALUES ($1,$2,12000,5000,2000,500,'ALIR')",['class',cls]);
    const month=new Date().toISOString().slice(0,7);
    const prev='2026-08-01'.slice(0,7);
    await c.query("INSERT INTO fee_payments (student_id,month,amount_due,amount_paid,status,payment_date,tenant_id) VALUES ($1,$2,12000,12000,'paid',now(),'ALIR')",[st[0],month]);
    await c.query("INSERT INTO fee_payments (student_id,month,amount_due,amount_paid,status,payment_date,tenant_id) VALUES ($1,$2,12000,5000,'partial',now(),'ALIR')",[st[1],month]);
    await c.query("INSERT INTO fee_payments (student_id,month,amount_due,amount_paid,status,tenant_id) VALUES ($1,$2,12000,0,'unpaid',null,'ALIR')",[st[2],month]);
    // replay /api/fees/me queries for student 1
    const si=await c.query("SELECT s.name as student_name, s.class_id, c.name as class_name FROM students s LEFT JOIN classes c ON s.class_id=c.id AND s.tenant_id=c.tenant_id WHERE s.id=$1 AND s.tenant_id=$2",[st[0],'ALIR']);
    const s=si.rows[0];
    const fs=await c.query("SELECT type,monthly_fee,admission_fee,transport_fee,discount FROM fee_structures WHERE type='student' AND target_id=$1 AND tenant_id=$2",[st[0],'ALIR']);
    const cfg=fs.rows[0]||(await c.query("SELECT type,monthly_fee,admission_fee,transport_fee,discount FROM fee_structures WHERE type='class' AND target_id=$1 AND tenant_id=$2",[s.class_id,'ALIR'])).rows[0]||null;
    const pr=await c.query("SELECT fp.id,fp.month as month_year,fp.amount_due,fp.amount_paid,fp.status,fp.payment_date FROM fee_payments fp WHERE fp.student_id=$1 AND fp.tenant_id=$2 ORDER BY fp.month DESC",[st[0],'ALIR']);
    const rec=pr.rows[0];
    const label=rec.status=='paid'?'Paid':rec.status=='partial'?'Partial':rec.status=='not_set_up'?'Not Set Up':'Unpaid';
    console.log('\n=== /api/fees/me shape for student', st[0], '===');
    console.log(JSON.stringify({structure:cfg, current:{month_year:rec.month_year,amount_due:rec.amount_due,amount_paid:rec.amount_paid,status:rec.status}, statusBadgeTheStudentTabShows:label, historyCount:pr.rows.length},null,2));
    // also verify the 3-status mapping is what renderFees produces
    const map={};
    for(const r of (await c.query("SELECT fp.status, COUNT(*)::int c FROM fee_payments fp WHERE fp.tenant_id='ALIR' GROUP BY fp.status")).rows) map[r.status]=r.c;
    console.log('badges that would render across test records:', JSON.stringify(map));
    await c.query('ROLLBACK');
    console.log('\nROLLED BACK — no changes persisted.');
  } finally { c.release(); await p.end(); }
})().catch(e=>{console.error('ERR:',e.message); return p.end()});
