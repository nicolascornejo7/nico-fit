param(
  [string]$OutputDirectory = (Join-Path $PWD 'artifacts/v3-cutover-backup'),
  [switch]$Execute
)
$ErrorActionPreference = 'Stop'
$productionRef = 'xaklsoqyzwowtjwcpwmb'
if ($env:NICO_FIT_PROD_PROJECT_REF -ne $productionRef) { throw 'Exact production project ref is required.' }
if (-not $Execute) {
  Write-Output 'Dry run only. Supply -Execute after manual backup approval.'
  Write-Output 'Required environment: PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD NICO_FIT_PROD_PROJECT_REF NICO_FIT_BACKUP_APPROVAL.'
  exit 0
}
if ($env:NICO_FIT_BACKUP_APPROVAL -ne 'approved-read-only-backup') { throw 'Explicit backup approval marker is missing.' }
foreach ($name in 'PGHOST','PGDATABASE','PGUSER','PGPASSWORD') { if (-not (Get-Item "Env:$name" -ErrorAction SilentlyContinue).Value) { throw "Missing $name." } }
foreach ($command in 'pg_dump','psql') { if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "$command is required." } }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$target = Join-Path $OutputDirectory $stamp
New-Item -ItemType Directory -Force -Path $target | Out-Null
$dumpFile = Join-Path $target 'nico-fit-production.dump'
$schemaFile = Join-Path $target 'schema.sql'
$inventoryFile = Join-Path $target 'inventory.txt'
$priorPgOptions = $env:PGOPTIONS
$env:PGOPTIONS = '-c default_transaction_read_only=on'
try {
  & pg_dump --format=custom --no-owner --no-privileges --file=$dumpFile
  if ($LASTEXITCODE -ne 0) { throw 'pg_dump custom backup failed.' }
  & pg_dump --schema-only --no-owner --no-privileges --file=$schemaFile
  if ($LASTEXITCODE -ne 0) { throw 'pg_dump schema backup failed.' }
  & psql -X -v ON_ERROR_STOP=1 -f (Join-Path $PSScriptRoot '../../supabase/production-inventory-readonly.sql') 1> $inventoryFile
  if ($LASTEXITCODE -ne 0) { throw 'Read-only inventory failed.' }
} finally {
  $env:PGOPTIONS = $priorPgOptions
}
$files = Get-ChildItem -LiteralPath $target -File | ForEach-Object {
  [ordered]@{ name=$_.Name; bytes=$_.Length; sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant() }
}
$manifest = [ordered]@{ created_at=(Get-Date).ToUniversalTime().ToString('o'); project_ref=$productionRef; format='pg_dump-custom'; files=$files }
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $target 'manifest.json') -Encoding utf8
Write-Output "Backup completed: $target"
Write-Output 'Store this directory encrypted and verify restoration in an isolated project before cutover.'
