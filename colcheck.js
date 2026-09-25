require('dotenv').config({path:'C:/Users/Hammad/Desktop/the eyeg/.env'});
const {Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL, ssl:process.env.DATABASE_URL.startsWith('postgres://')?{rejectUnauthorized:false}:undefined});
const q=(sql,args=[])=>p.query(sql,args);
(async()=>{
  for (const t of ['organizations','schools','tenants','fee_payments','fee_structures']) {
    try { const r=await q("SELECT column_name FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position",[t]);
      console.log(t+': '+(r.rows.length?r.rows.map(x=>x.column_name).join(', '):'<no table>'));
    } catch(e){ console.log(t+': ERROR '+e.message) }
  }
  const tabs=await q("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
  console.log('ALL TABLES: '+tabs.rows.map(x=>x.table_name).join(', '));
  await p.end();
})().catch(e=>{console.error(e.message); return p.end()});
