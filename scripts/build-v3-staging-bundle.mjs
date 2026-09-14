import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
const projectRef=process.env.SUPABASE_STAGING_PROJECT_REF;
const projectUrl=process.env.SUPABASE_STAGING_URL;
const publishableKey=process.env.SUPABASE_STAGING_PUBLISHABLE_KEY;
const productionRef='xaklsoqyzwowtjwcpwmb';

if(!projectRef || !projectUrl || !publishableKey)throw new Error('Missing staging project ref, URL, or publishable key.');
if(projectRef===productionRef)throw new Error('Refusing to target the production Supabase project.');
if(!projectUrl.includes(projectRef))throw new Error('Staging URL does not match the staging project ref.');

const password=()=>`Nf3!${randomBytes(24).toString('base64url')}`;
const passwordA=process.env.SUPABASE_STAGING_USER_A_PASSWORD || password();
const passwordB=process.env.SUPABASE_STAGING_USER_B_PASSWORD || password();
const sqlLiteral=value=>`'${value.replaceAll("'","''")}'`;

const passwordSettings=[
  `select set_config('nico_fit.staging_password_a', ${sqlLiteral(passwordA)}, false);`,
  `select set_config('nico_fit.staging_password_b', ${sqlLiteral(passwordB)}, false);`
];

const migration=await read('supabase/migration-v3-schema.sql');
const bootstrap=await read('supabase/staging-v2-bootstrap.sql');
const fixtures=await read('supabase/staging-v2-fixtures.sql');
const sessions=await read('supabase/backfill-v2-sessions.sql');
const workouts=await read('supabase/backfill-v2-workouts.sql');
const grants=await read('supabase/staging-v3-api-grants.sql');
const tests=await read('supabase/test-v3-staging.sql');
const phases=[
  [...passwordSettings,bootstrap].join('\n\n'),
  migration,
  migration,
  fixtures,
  [sessions,workouts].join('\n\n'),
  [sessions,workouts].join('\n\n'),
  grants,
  tests
];

await mkdir(new URL('.tmp/',root),{recursive:true});
for(const [index,phase] of phases.entries()){
  await writeFile(new URL(`.tmp/v3-staging-${index+1}.sql`,root),phase,'utf8');
}
await writeFile(new URL('.tmp/v3-staging-apply.sql',root),phases.join('\n\n'),'utf8');
await writeFile(new URL('.env.v3-staging.local',root),[
  `SUPABASE_STAGING_PROJECT_REF=${projectRef}`,
  `SUPABASE_STAGING_URL=${projectUrl}`,
  `SUPABASE_STAGING_PUBLISHABLE_KEY=${publishableKey}`,
  'SUPABASE_STAGING_USER_A_EMAIL=nico-fit-v3-a@example.invalid',
  `SUPABASE_STAGING_USER_A_PASSWORD=${passwordA}`,
  'SUPABASE_STAGING_USER_B_EMAIL=nico-fit-v3-b@example.invalid',
  `SUPABASE_STAGING_USER_B_PASSWORD=${passwordB}`,
  ''
].join('\n'),'utf8');

console.log('Created eight staged SQL phases, combined bundle, and guarded local environment file.');
