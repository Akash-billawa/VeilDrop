#requires -Version 7
<#
.SYNOPSIS
  Promote the VeilDrop streaming standby to be the new primary (failover).
.DESCRIPTION
  Signals the standby postmaster with pg_ctl promote, waits until it leaves
  recovery mode, and reminds you of the follow-up steps (repoint the app,
  re-sync the old primary as a standby). Safe to run twice: a promoted node
  is no longer in recovery, so the promote is a no-op.
.EXAMPLE
  .\scripts\promote.ps1 -StandbyDir .\replica\standby
.PARAMETER StandbyDir
  Data directory of the standby to promote.
.PARAMETER StandbyPort
  Port it listens on (used for the readiness poll). Default 5433.
.PARAMETER PgBin
  Directory containing pg_ctl / psql. Auto-detected from PATH or Program Files.
#>

[CmdletBinding()]
param(
    [string]$StandbyDir = (Join-Path (Split-Path $PSScriptRoot -Parent) "replica\standby"),
    [int]$StandbyPort = 5433,
    [string]$StandbyUser = "postgres",
    [string]$PgBin = ""
)

$ErrorActionPreference = "Stop"

function Get-PgBin {
    if ($PgBin) { return $PgBin }
    $cmd = Get-Command pg_ctl -ErrorAction SilentlyContinue
    if ($cmd) { return Split-Path $cmd.Source }
    $root = "C:\Program Files\PostgreSQL"
    if (Test-Path $root) {
        $ver = Get-ChildItem $root -Directory | Sort-Object Name -Descending | Select-Object -First 1
        $candidate = Join-Path $ver.FullName "bin"
        if (Test-Path (Join-Path $candidate "pg_ctl.exe")) { return $candidate }
    }
    throw "PostgreSQL binaries not found; install PostgreSQL or pass -PgBin"
}

if (-not (Test-Path $StandbyDir)) {
    throw "StandbyDir '$StandbyDir' does not exist"
}

$bin = Get-PgBin

Write-Host "[promote] signaling $StandbyDir ..."
& (Join-Path $bin "pg_ctl.exe") -D $StandbyDir promote
if ($LASTEXITCODE -ne 0) {
    Write-Host "[promote] pg_ctl promote returned $LASTEXITCODE (likely already promoted)" -ForegroundColor Yellow
}

Write-Host "[promote] waiting for the node to leave recovery mode ..."
$writable = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    & (Join-Path $bin "pg_isready.exe") -h 127.0.0.1 -p $StandbyPort -q 2>$null
    if ($LASTEXITCODE -ne 0) { continue }
    $inRecovery = & (Join-Path $bin "psql.exe") -h 127.0.0.1 -p $StandbyPort -U $StandbyUser -d veildrop `
        -tAc "SELECT pg_is_in_recovery()" 2>$null
    if ($inRecovery -match "^f") { $writable = $true; break }
}
if (-not $writable) { throw "node did not leave recovery mode within 60s" }

Write-Host "[promote] DONE: node is now the writable primary on port $StandbyPort"
Write-Host ""
Write-Host "Follow-up:"
Write-Host "  1. Point the app at the new primary: VEILDROP_DATABASE_URL=postgresql://...@127.0.0.1:$StandbyPort/veildrop"
Write-Host "  2. Re-sync the old primary as a standby: .\scripts\replica.ps1 -PrimaryUrl <new-primary-url> -StandbyDir <old-primary-dir> -Force -StandbyPort $StandbyPort"
Write-Host "  3. Verify: .\scripts\replication-check.ps1"
