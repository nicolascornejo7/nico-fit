import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import pg from 'pg';
import crypto from 'node:crypto';

const STAGING_REF='tmydirzzlmlmtjgwqcgh';
const PRODUCTION_REF='xaklsoqyzwowtjwcpwmb';
const STAGING_URL=`https://${STAGING_REF}.supabase.co`;
const databaseUrl=process.env.SUPABASE_STAGING_DATABASE_URL || process.env.SUPABASE_STAGING_POSTGRES_URL;
const ref=process.env.SUPABASE_STAGING_PROJECT_REF;
const url=process.env.SUPABASE_STAGING_URL;
if(ref!==STAGING_REF) throw new Error(`Ref guard failed: expected ${STAGING_REF}.`);
if(url!==STAGING_URL || url.includes(PRODUCTION_REF)) throw new Error('URL guard failed: staging only.');
if(!databaseUrl) throw new Error('Missing SUPABASE_STAGING_DATABASE_URL (or SUPABASE_STAGING_POSTGRES_URL); no administrative PostgreSQL connection is available.');
if(databaseUrl.includes(PRODUCTION_REF)) throw new Error('Production database URL is forbidden.');
if(/service[_-]?role|secret|sb_secret/i.test(databaseUrl)) throw new Error('Secret/service-role material must not be passed through this runner.');
const allowPoolerCertificate=process.env.SUPABASE_STAGING_DB_SSL_ALLOW_SELF_SIGNED==='true';
const sql=await readFile(resolve(import.meta.dirname,'..','supabase/migration-v3-audit-retention.sql'),'utf8');
const {Client}=pg;
const client=new Client({connectionString:databaseUrl,ssl:{rejectUnauthorized:!allowPoolerCertificate},connectionTimeoutMillis:15000});
const report={projectRef:STAGING_REF,checks:{}};
async function denied(client,sql,code='42501') { await client.query('savepoint expected_denial'); try { await client.query(sql); return false; } catch(error) { await client.query('rollback to savepoint expected_denial'); return error.code===code || error.code==='55000'; } }
try {
  await client.connect();
  await client.query('begin');
  await client.query(sql);
  await client.query(sql);
  report.checks.migrationAppliedTwice=true;
  await client.query('begin');
  const fn=await client.query(`select proname from pg_proc where pronamespace='nico_fit_v3'::regnamespace and proname in ('audit_retention_preview','purge_operational_audit')`);
  report.checks.functionsCreated=fn.rows.map(row=>row.proname).sort().join(',')==='audit_retention_preview,purge_operational_audit';
  const fixtureUser=(await client.query('select id from auth.users order by id limit 1')).rows[0]?.id;
  if(!fixtureUser) throw new Error('No staging Auth user available for reversible fixtures.');
  const eligible=crypto.randomUUID();
  const retained=crypto.randomUUID();
  await client.query(`insert into nico_fit_v3.operational_audit(event_id,user_id,event_type,error_kind,occurred_at) values ($1,$3,'sync_failure','transient',clock_timestamp()),($2,$3,'sync_failure','permanent',clock_timestamp())`,[eligible,retained,fixtureUser]);
  await client.query('alter table nico_fit_v3.operational_audit disable trigger audit_append_only');
  await client.query(`update nico_fit_v3.operational_audit set received_at=case event_id when $1 then clock_timestamp()-interval '31 days' else clock_timestamp() end where event_id in ($1,$2)`,[eligible,retained]);
  await client.query('alter table nico_fit_v3.operational_audit enable trigger audit_append_only');
  const preview=await client.query("select * from nico_fit_v3.audit_retention_preview(clock_timestamp())");
  report.checks.preview=preview.rows.some(row=>row.category==='sync_failure:transient' && Number(row.eligible_count)>=1);
  const anon=await client.query('select current_user');
  await client.query('set role anon');
  report.checks.anonDenied=await denied(client,'select * from nico_fit_v3.audit_retention_preview()');
  await client.query('reset role'); await client.query('set role authenticated');
  report.checks.authenticatedDenied=await denied(client,"select * from nico_fit_v3.purge_operational_audit('retention')");
  const updateDenied=await denied(client,`update nico_fit_v3.operational_audit set error_kind='auth' where event_id='${retained}'`);
  const deleteDenied=await denied(client,`delete from nico_fit_v3.operational_audit where event_id='${retained}'`);
  report.checks.clientUpdateDeleteBlocked=updateDenied && deleteDenied;
  await client.query('reset role');
  const purge=await client.query("select * from nico_fit_v3.purge_operational_audit('retention')");
  report.checks.adminPurge=purge.rows.some(row=>row.category==='sync_failure:transient' && Number(row.purged_count)>=1);
  report.checks.retainedRow=Number((await client.query('select count(*) from nico_fit_v3.operational_audit where event_id=$1',[retained])).rows[0].count)===1;
  report.checks.rlsEnabled=(await client.query(`select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='nico_fit_v3' and c.relname='operational_audit'`)).rows[0]?.relrowsecurity===true;
  await client.query('rollback');
} catch(error) {
  try { await client.query('rollback'); } catch {}
  throw new Error(`Administrative staging validation failed: ${error.message}`);
} finally { await client.end(); }
console.log(JSON.stringify({...report,secretOutput:false}));
