param(
  [string]$OutputDirectory=(Join-Path $PWD 'artifacts/v3-full-disaster-recovery'),
  [switch]$Execute
)
$ErrorActionPreference='Stop'
$productionRef='xaklsoqyzwowtjwcpwmb'
$stagingRef='tmydirzzlmlmtjgwqcgh'
$sourceUrl=$env:NICO_FIT_PROD_DB_URL
if(-not $Execute){Write-Output 'Dry run. Requires pg_dump, psql, Supabase CLI, Docker, NICO_FIT_PROD_DB_URL and explicit approval.';exit 0}
if($env:NICO_FIT_PROD_PROJECT_REF -ne $productionRef){throw 'Exact production ref is required.'}
if($env:NICO_FIT_DR_READ_ONLY_APPROVAL -ne 'approved-read-only-full-export'){throw 'Read-only export approval marker is missing.'}
if(-not $sourceUrl -or $sourceUrl -notmatch [regex]::Escape($productionRef)){throw 'Source URL must contain the exact production ref.'}
if($sourceUrl -match [regex]::Escape($stagingRef)){throw 'The retained staging project is forbidden.'}
foreach($command in 'pg_dump','psql','supabase','docker'){
  if(-not (Get-Command $command -ErrorAction SilentlyContinue)){throw "$command is required."}
}
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$target=Join-Path $OutputDirectory $stamp
New-Item -ItemType Directory -Force -Path $target | Out-Null
$forensicDump=Join-Path $target 'forensic-full.dump'
$priorOptions=$env:PGOPTIONS
$env:PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=120000'
try{
  & psql $sourceUrl -X -v ON_ERROR_STOP=1 -Atc "begin transaction read only; select current_database(),current_setting('server_version'); commit;" | Set-Content (Join-Path $target 'source-probe.txt') -Encoding utf8
  if($LASTEXITCODE -ne 0){throw 'Read-only source probe failed.'}
  $verificationSql=@"
begin transaction read only;
select json_build_object(
  'auth_users',(select count(*) from auth.users),
  'readiness',(select count(*) from public.readiness),
  'workouts',(select count(*) from public.workouts),
  'match_reviews',(select count(*) from public.match_reviews),
  'football_sessions',(select count(*) from public.football_sessions),
  'workout_sessions',(select count(*) from public.workout_sessions),
  'sync_tombstones',(select count(*) from public.sync_tombstones),
  'v2_rls_tables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('readiness','workouts','match_reviews','football_sessions','workout_sessions','sync_tombstones') and c.relrowsecurity),
  'v2_policies',(select count(*) from pg_policies where schemaname='public' and tablename in ('readiness','workouts','match_reviews','football_sessions','workout_sessions','sync_tombstones')),
  'orphaned_v2_rows',(
    select count(*) from (
      select user_id from public.readiness union all select user_id from public.workouts
      union all select user_id from public.match_reviews union all select user_id from public.football_sessions
      union all select user_id from public.workout_sessions union all select user_id from public.sync_tombstones
    ) owned left join auth.users u on u.id=owned.user_id where u.id is null
  )
)::text;
commit;
"@
  $verificationJson=(& psql $sourceUrl -X -v ON_ERROR_STOP=1 -Atc $verificationSql | Where-Object {$_ -match '^\{'}) -join ''
  if($LASTEXITCODE -ne 0 -or -not $verificationJson){throw 'Read-only source verification snapshot failed.'}
  $verificationJson|ConvertFrom-Json|ConvertTo-Json -Depth 4|Set-Content (Join-Path $target 'expected-verification.json') -Encoding utf8
  & pg_dump $sourceUrl --format=custom --no-owner --no-privileges --no-subscriptions --file $forensicDump
  if($LASTEXITCODE -ne 0){throw 'Forensic pg_dump failed.'}
  & supabase db dump --db-url $sourceUrl -f (Join-Path $target 'roles.sql') --role-only
  if($LASTEXITCODE -ne 0){throw 'Supabase roles export failed under read-only enforcement.'}
  & supabase db dump --db-url $sourceUrl -f (Join-Path $target 'schema.sql')
  if($LASTEXITCODE -ne 0){throw 'Supabase schema export failed under read-only enforcement.'}
  & supabase db dump --db-url $sourceUrl -f (Join-Path $target 'data.sql') --use-copy --data-only -x 'storage.buckets_vectors' -x 'storage.vector_indexes'
  if($LASTEXITCODE -ne 0){throw 'Supabase data export failed under read-only enforcement.'}
}finally{$env:PGOPTIONS=$priorOptions}
$files=Get-ChildItem -LiteralPath $target -File | ForEach-Object {[ordered]@{name=$_.Name;bytes=$_.Length;sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()}}
$manifest=[ordered]@{format='nico-fit-supabase-disaster-recovery-v1';created_at=(Get-Date).ToUniversalTime().ToString('o');source_project_ref=$productionRef;read_only_enforced=$true;files=$files}
$manifest|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $target 'manifest.json') -Encoding utf8
Write-Output "Full export created outside Git: $target"
