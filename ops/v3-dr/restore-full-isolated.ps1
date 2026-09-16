param(
  [Parameter(Mandatory=$true)][string]$BackupDirectory,
  [switch]$Execute
)
$ErrorActionPreference='Stop'
$protectedRefs=@('xaklsoqyzwowtjwcpwmb','tmydirzzlmlmtjgwqcgh')
$targetRef=$env:SUPABASE_DR_PROJECT_REF
$targetUrl=$env:SUPABASE_DR_DB_URL
if($protectedRefs -contains $targetRef){throw 'Restore target ref is protected.'}
if($targetUrl -and ($protectedRefs|Where-Object {$targetUrl -match [regex]::Escape($_)})){throw 'Restore target URL is protected.'}
if(-not $targetRef -or -not $targetUrl){throw 'Disposable target ref and DB URL are required.'}
foreach($name in 'roles.sql','schema.sql','data.sql','expected-verification.json','manifest.json'){if(-not (Test-Path -LiteralPath (Join-Path $BackupDirectory $name))){throw "Missing $name."}}
$manifest=Get-Content -LiteralPath (Join-Path $BackupDirectory 'manifest.json') -Raw|ConvertFrom-Json
if($manifest.format -ne 'nico-fit-supabase-disaster-recovery-v1' -or $manifest.source_project_ref -ne 'xaklsoqyzwowtjwcpwmb' -or -not $manifest.read_only_enforced){throw 'Backup manifest identity or read-only evidence is invalid.'}
foreach($item in $manifest.files){
  $path=Join-Path $BackupDirectory $item.name
  if(-not (Test-Path -LiteralPath $path)){throw "Manifest file missing: $($item.name)"}
  $actual=(Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
  if($actual -ne $item.sha256 -or (Get-Item -LiteralPath $path).Length -ne $item.bytes){throw "Checksum or size mismatch: $($item.name)"}
}
if(-not (Get-Command psql -ErrorAction SilentlyContinue)){throw 'psql is required.'}
if(-not $Execute){Write-Output 'Backup bundle and protected-target guards passed. No restore executed.';exit 0}
if($env:NICO_FIT_DR_RESTORE_APPROVAL -ne 'approved-disposable-full-restore'){throw 'Disposable restore approval marker is missing.'}
& psql $targetUrl -X --single-transaction --variable ON_ERROR_STOP=1 --file (Join-Path $BackupDirectory 'roles.sql') --file (Join-Path $BackupDirectory 'schema.sql') --command "SET session_replication_role = replica" --file (Join-Path $BackupDirectory 'data.sql')
if($LASTEXITCODE -ne 0){throw 'Disposable restore failed.'}
$verificationSql=@"
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
"@
$actualJson=(& psql $targetUrl -X -v ON_ERROR_STOP=1 -Atc $verificationSql | Where-Object {$_ -match '^\{'}) -join ''
if($LASTEXITCODE -ne 0 -or -not $actualJson){throw 'Post-restore verification failed.'}
$expected=Get-Content -LiteralPath (Join-Path $BackupDirectory 'expected-verification.json') -Raw|ConvertFrom-Json
$actual=$actualJson|ConvertFrom-Json
foreach($property in $expected.PSObject.Properties.Name){if([string]$expected.$property -ne [string]$actual.$property){throw "Restore mismatch for ${property}: expected $($expected.$property), got $($actual.$property)."}}
$report=[ordered]@{status='PASS';verified_at=(Get-Date).ToUniversalTime().ToString('o');target_project_ref=$targetRef;source_created_at=$manifest.created_at;checks=$actual}
$report|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $BackupDirectory 'restore-verification.json') -Encoding utf8
Write-Output "Restore completed in disposable target $targetRef. Auth login verification is still required."
