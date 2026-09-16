param(
  [Parameter(Mandatory=$true)][string]$BackupFile,
  [switch]$Execute
)
$ErrorActionPreference = 'Stop'
$productionRef = 'xaklsoqyzwowtjwcpwmb'
$stagingRef = 'tmydirzzlmlmtjgwqcgh'
if (-not (Test-Path -LiteralPath $BackupFile -PathType Leaf)) { throw 'Backup file does not exist.' }
if ($env:NICO_FIT_TARGET_PROJECT_REF -eq $productionRef) { throw 'Restore target must never be production.' }
if ($env:NICO_FIT_TARGET_PROJECT_REF -eq $stagingRef) { throw 'Restore target must never be the retained staging project.' }
if (-not $env:NICO_FIT_TARGET_PROJECT_REF) { throw 'NICO_FIT_TARGET_PROJECT_REF is required.' }
if ($env:NICO_FIT_TARGET_KIND -ne 'disposable-local-supabase') { throw 'Restore is limited to a disposable local Supabase stack.' }
if (-not (Get-Command pg_restore -ErrorAction SilentlyContinue)) { throw 'pg_restore is required.' }
& pg_restore --list $BackupFile | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Backup archive is unreadable.' }
if (-not $Execute) {
  Write-Output 'Archive is readable. Dry run only; no restore executed.'
  exit 0
}
if ($env:NICO_FIT_RESTORE_APPROVAL -ne 'approved-isolated-restore') { throw 'Explicit isolated restore approval marker is missing.' }
foreach ($name in 'PGHOST','PGDATABASE','PGUSER','PGPASSWORD') { if (-not (Get-Item "Env:$name" -ErrorAction SilentlyContinue).Value) { throw "Missing $name." } }
if ($env:PGHOST -match "$productionRef|$stagingRef") { throw 'PGHOST points to a protected project.' }
& pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname=$env:PGDATABASE $BackupFile
if ($LASTEXITCODE -ne 0) { throw 'Isolated restore failed.' }
Write-Output "Restore completed only in isolated target $env:NICO_FIT_TARGET_PROJECT_REF. Run inventory and application validation before accepting the backup."
