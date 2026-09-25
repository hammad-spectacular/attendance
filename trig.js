require('dotenv').config({path:'C:/Users/Hammad/Desktop/the eyeg/.env'});
const {Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL, ssl:process.env.DATABASE_URL.startsWith('postgres://')?{rejectUnauthorized:false}:undefined});
const q=(sql,a=[])=>p.query(sql,a);
(async()=>{
  const trg=await q("SELECT tgname, pg_get_triggerdef(t.oid) AS def FROM pg_trigger t WHERE NOT t.tgisinternal AND tgrelid='fee_structures'::regclass");
  console.log('TRIGGERS on fee_structures:'); trg.rows.forEach(r=>console.log(' ',r.tgname,'=>',r.def));
  const cnt=await q("SELECT COUNT(*)::int c FROM fee_structures");
  console.log('fee_structures rows now (post-rollback):', cnt.rows[0].c);
  await p.end();
})().catch(e=>{console.error('ERR:',e.message); return p.end()});
