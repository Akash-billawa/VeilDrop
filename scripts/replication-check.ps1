#requires -Version 7
<#
.SYNOPSIS
  Health check for the VeilDrop streaming-standby replication.
.DESCRIPTION
  Reports the WAL sender state on the primary and the replay position on the
  standby. Exit code 0 = healthy (streaming, standby in recovery). Exit code
  1 = degraded or broken — suitable for a scheduled task / monitoring hook.
.EXAMPLE
  .\scripts\replication-check.ps1
.PARAMETER PrimaryUrl
  Full postgresql:// URL of the PRIMARY. Defaults to VEILDROP_DATABASE_URL or
  local defaults. Needs SELECT on pg_stat_replication.
.PARAMETER StandbyHost / -StandbyPort
  Where the standby listens. Default 127.0.0.1:5433.
.PARAMETER PgBin
  Directory containing psql. Auto-detected from PATH or Program Files.
#>

[CmdletBinding()]
param(
    [string]$PrimaryUrl = $env:VEILDROP_DATABASE_URL,
    [string]$StandbyHost = "127.0.0.1",
    [int]$StandbyPort = 5433,
    [string]$PgBin = ""
)

$ErrorActionPreference = "Stop"

function Get-PgBin {
    if ($PgBin) { return $PgBin }
    $cmd = Get-Command psql -ErrorAction SilentlyContinue
    if ($cmd) { return Split-Path $cmd.Source }
    $root = "C:\Program Files\PostgreSQL"
    if (Test-Path $root) {
        $ver = Get-ChildItem $root -Directory | Sort-Object Name -Descending | Select-Object -First 1
        $candidate = Join-Path $ver.FullName "bin"
        if (Test-Path (Join-Path $candidate "psql.exe")) { return $candidate }
    }
    throw "PostgreSQL binaries not found; install PostgreSQL or pass -PgBin"
}

if (-not $PrimaryUrl) {
    $PrimaryUrl = "postgresql://veildrop:veildrop@localhost:5432/veildrop"
}

$bin = Get-PgBin
$uri = [System.Uri]::new($PrimaryUrl)
$hostName = $uri.Host
$port = $uri.Port
$user = $uri.UserInfo.Split(":")[0]
$db = $uri.AbsolutePath.TrimStart("/")

$env:PGPASSWORD = [System.Net.WebUtility]::UrlDecode($uri.UserInfo.Split(":", 2)[1])

$senders = & (Join-Path $bin "psql.exe") -h $hostName -p $port -U $user -d $db `
    -tAc "SELECT application_name || '|' || state || '|' || sync_state || '|' || coalesce(replay_lag::text, 'n/a') FROM pg_stat_replication"
Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue

$healthy = $false
Write-Host "[replcheck] primary $hostName`:$port — WAL senders:"
if (-not $senders) {
    Write-Host "  (none)"
} else {
    foreach ($s in @($senders)) {
        $parts = $s.Trim() -split "\|"
        Write-Host ("  {0,-16} state={1,-10} sync={2,-8} replay_lag={3}" -f $parts[0], $parts[1], $parts[2], $parts[3])
        if ($parts[1] -eq "streaming") { $healthy = $true }
    }
}

$env:PGPASSWORD = ""
$recovery = & (Join-Path $bin "psql.exe") -h $StandbyHost -p $StandbyPort -U $user -d $db `
    -tAc "SELECT pg_is_in_recovery() || '|' || coalesce(pg_last_wal_replay_lsn()::text, 'n/a')" 2>$null
Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue

if ($recovery) {
    $parts = $recovery.Trim() -split "\|"
    Write-Host "[replcheck] standby $StandbyHost`:$StandbyPort — in_recovery=$($parts[0]) replay_lsn=$($parts[1])"
} else {
    Write-Host "[replcheck] standby $StandbyHost`:$StandbyPort — UNREACHABLE"
    $healthy = $false
}

if ($healthy -and $recovery -and $recovery.Trim() -match "^t") {
    Write-Host "[replcheck] HEALTHY: streaming, standby in recovery"
    exit 0
} else {
    Write-Host "[replcheck] DEGRADED: no streaming sender or standby not in recovery" -ForegroundColor Yellow
    exit 1
}
