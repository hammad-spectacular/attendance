require('dotenv').config({path:'C:/Users/Hammad/Desktop/the eyeg/.env'});
const {Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL, ssl:process.env.DATABASE_URL.startsWith('postgres://')?{rejectUnauthorized:false}:undefined});
const q=(sql,a=[])=>p.query(sql,a);
(async()=>{
  const r={};
  for (const [k,sql] of Object.entries({
    students:"SELECT tenant_id, COUNT(*)::int c FROM students GROUP BY tenant_id ORDER BY tenant_id",
    classes:"SELECT tenant_id, COUNT(*)::int c FROM classes GROUP BY tenant_id ORDER BY tenant_id",
    usersCols:"SELECT column_name FROM information_schema.columns WHERE table_name='users' ORDER BY ordinal_position",
    usersByType:"SELECT role, COUNT(*)::int c FROM users GROUP BY role",
    schools:"SELECT id, school_code, school_name, status FROM organizations ORDER BY id",
  })) { try { r[k]=(await q(sql)).rows; } catch(e){ r[k]='ERR: '+e.message } }
  console.log(JSON.stringify(r,null,2));
  await p.end();
})().catch(e=>{console.error(e.message); return p.end()});
