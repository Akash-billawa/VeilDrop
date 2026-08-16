#requires -Version 7
<#
.SYNOPSIS
  Provision a streaming-standby replica of the VeilDrop PostgreSQL primary.
.DESCRIPTION
  Runs pg_basebackup against the primary (WAL streaming, physical
  replication slot), writes standby.signal + primary_conninfo (-R), sets the
  standby port, starts it with pg_ctl, and waits until the WAL sender reports
  'streaming'. The connecting role must have the REPLICATION attribute
  (superuser, or a dedicated role: CREATE ROLE veildrop_repl LOGIN REPLICATION).
.EXAMPLE
  .\scripts\replica.ps1 -PrimaryUrl "postgresql://veildrop_repl:***@primary:5432/veildrop" -StandbyDir .\replica\standby
.PARAMETER PrimaryUrl
  Full postgresql:// URL of the PRIMARY. Defaults to VEILDROP_DATABASE_URL or
  local defaults. The user needs the REPLICATION attribute.
.PARAMETER StandbyDir
  Data directory for the standby. Created if missing; must be empty unless -Force.
.PARAMETER StandbyPort
  Port the standby listens on. Default 5433.
.PARAMETER SlotName
  Physical replication slot created on the primary. Default veildrop_repl_slot.
.PARAMETER PgBin
  Directory containing pg_basebackup / pg_ctl / psql. Auto-detected from PATH
  or C:\Program Files\PostgreSQL\<version>\bin.
.PARAMETER Force
  Wipe an existing non-empty -StandbyDir and re-sync from scratch.
#>

[CmdletBinding()]
param(
    [string]$PrimaryUrl = $env:VEILDROP_DATABASE_URL,
    [string]$StandbyDir = (Join-Path (Split-Path $PSScriptRoot -Parent) "replica\standby"),
    [int]$StandbyPort = 5433,
    [string]$SlotName = "veildrop_repl_slot",
    [string]$PgBin = "",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

function Get-PgBin {
    if ($PgBin) { return $PgBin }
    $cmd = Get-Command pg_basebackup -ErrorAction SilentlyContinue
    if ($cmd) { return Split-Path $cmd.Source }
    $root = "C:\Program Files\PostgreSQL"
    if (Test-Path $root) {
        $ver = Get-ChildItem $root -Directory | Sort-Object Name -Descending | Select-Object -First 1
        $candidate = Join-Path $ver.FullName "bin"
        if (Test-Path (Join-Path $candidate "pg_basebackup.exe")) { return $candidate }
    }
    throw "PostgreSQL binaries not found; install PostgreSQL or pass -PgBin"
}

function Assert-Exists([string]$name) {
    if (-not (Test-Path (Join-Path $bin $name))) {
        throw "$name not found in $bin"
    }
}

if (-not $PrimaryUrl) {
    $PrimaryUrl = "postgresql://veildrop:veildrop@localhost:5432/veildrop"
}

$bin = Get-PgBin
Assert-Exists "pg_basebackup.exe"
Assert-Exists "pg_ctl.exe"
Assert-Exists "psql.exe"
Assert-Exists "pg_isready.exe"

$uri = [System.Uri]::new($PrimaryUrl)
$db = $uri.AbsolutePath.TrimStart("/")
$hostName = $uri.Host
$port = $uri.Port
$user = $uri.UserInfo.Split(":")[0]

if (Test-Path $StandbyDir) {
    if ((Get-ChildItem $StandbyDir -Force | Measure-Object).Count -gt 0) {
        if (-not $Force) {
            throw "$StandbyDir exists and is not empty; pass -Force to re-sync from scratch"
        }
        Write-Warning "[replica] wiping $StandbyDir (-Force)"
        Remove-Item -LiteralPath $StandbyDir -Recurse -Force
    }
}
New-Item -ItemType Directory -Force -Path $StandbyDir | Out-Null

Write-Host "[replica] base backup: $db @ $hostName`:$port (user $user) -> $StandbyDir"
$env:PGPASSWORD = [System.Net.WebUtility]::UrlDecode($uri.UserInfo.Split(":", 2)[1])
& (Join-Path $bin "pg_basebackup.exe") `
    -h $hostName -p $port -U $user -d $db `
    -D $StandbyDir -X stream -C -S $SlotName -R
if ($LASTEXITCODE -ne 0) { throw "pg_basebackup failed with exit code $LASTEXITCODE" }
Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue

$conf = Join-Path $StandbyDir "postgresql.conf"
Add-Content -Path $conf -Value "`nport = $StandbyPort"

$log = Join-Path (Split-Path $StandbyDir -Parent) "standby.log"
Write-Host "[replica] starting standby on port $StandbyPort ..."
& (Join-Path $bin "pg_ctl.exe") -D $StandbyDir -l $log start
if ($LASTEXITCODE -ne 0) { throw "pg_ctl start failed with exit code $LASTEXITCODE" }

Write-Host "[replica] waiting for streaming state ..."
$streaming = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    & (Join-Path $bin "pg_isready.exe") -h $hostName -p $StandbyPort -q 2>$null
    if ($LASTEXITCODE -ne 0) { continue }
    $env:PGPASSWORD = [System.Net.WebUtility]::UrlDecode($uri.UserInfo.Split(":", 2)[1])
    $state = & (Join-Path $bin "psql.exe") -h $hostName -p $port -U $user -d $db `
        -tAc "SELECT state FROM pg_stat_replication WHERE application_name = 'walreceiver'"
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    if ($state -match "streaming") { $streaming = $true; break }
}
if (-not $streaming) { throw "standby never reached 'streaming' state; check $log" }

Write-Host "[replica] done: standby streaming on port $StandbyPort (slot $SlotName)"
Write-Host "[replica] verify anytime with: .\scripts\replication-check.ps1"
Write-Host "[replica] to run as a Windows service (persist across reboots):"
Write-Host "  pg_ctl register VeilDropStandby -N VeilDropStandby -D `"$StandbyDir`" -o `"-p $StandbyPort`""
