require('dotenv').config({path:'C:/Users/Hammad/Desktop/the eyeg/.env'});
const {Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL, ssl:process.env.DATABASE_URL.startsWith('postgres://')?{rejectUnauthorized:false}:undefined});
const q=(sql,a=[])=>p.query(sql,a);
(async()=>{
  const r=[];
  for (const o of (await q("SELECT id, school_code FROM organizations ORDER BY id")).rows){
    const cs=(await q("SELECT COUNT(*)::int c FROM classes WHERE tenant_id=$1",[o.school_code])).rows[0].c;
    const ss=(await q("SELECT COUNT(*)::int c FROM students WHERE tenant_id=$1",[o.school_code])).rows[0].c;
    const st=(await q("SELECT COUNT(*)::int c FROM fee_structures WHERE tenant_id=$1",[o.school_code])).rows[0].c;
    const pays=await q("SELECT status, COUNT(*)::int c FROM fee_payments WHERE tenant_id=$1 GROUP BY status",[o.school_code]);
    const rec=(await q("SELECT COUNT(*)::int c FROM fee_payments WHERE tenant_id=$1",[o.school_code])).rows[0].c;
    r.push({code:o.school_code, classes:cs, students:ss, fee_structures:st, fee_payments:rec, statuses:Object.fromEntries(pays.rows.map(x=>[x.status,x.c]))});
  }
  console.log(JSON.stringify(r,null,2));
  const fs=(await q("SELECT type,target_id,monthly_fee,admission_fee,transport_fee,discount,tenant_id FROM fee_structures ORDER BY tenant_id,type,target_id LIMIT 30")).rows;
  console.log('FEE STRUCTURES SAMPLES:'); console.log(JSON.stringify(fs,null,2));
  await p.end();
})().catch(e=>{console.error('ERR:',e.message); return p.end()});
