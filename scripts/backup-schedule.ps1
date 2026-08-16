#requires -Version 7
<#
.SYNOPSIS
  Registers (or removes) the VeilDrop encrypted-backup scheduled task.
.DESCRIPTION
  Persists the GPG passphrase as a DPAPI-encrypted blob readable only by the
  current user, then registers a Windows scheduled task that runs
  scripts/backup.ps1 daily with -PassphraseFile. The passphrase is never
  written to disk in clear text.
.EXAMPLE
  .\scripts\backup-schedule.ps1 -OutDir D:\veildrop-backups -DatabaseUrl "postgresql://veildrop:...@db:5432/veildrop"
  Prompts for the passphrase once, then registers the task.
.EXAMPLE
  .\scripts\backup-schedule.ps1 -Unregister
.PARAMETER OutDir
  Backup destination directory (defaults to <repo>\backups).
.PARAMETER DatabaseUrl
  Full postgresql:// URL; defaults to VEILDROP_DATABASE_URL.
.PARAMETER Keep
  Encrypted dumps to retain (forwarded to backup.ps1, default 14).
.PARAMETER Passphrase
  SecureString; prompted if omitted. Stored DPAPI-encrypted in -PassphraseFile.
.PARAMETER PassphraseFile
  Where the DPAPI-encrypted passphrase lives (default
  %ProgramData%\VeilDrop\backup-passphrase.bin).
.PARAMETER TaskName
  Scheduled task name (default "VeilDrop Backup").
.PARAMETER At
  Run time (default "02:00").
.PARAMETER Weekly
  Run weekly instead of daily.
.PARAMETER Unregister
  Remove the task instead of registering it.
#>

[CmdletBinding()]
param(
    [string]$OutDir = (Join-Path (Split-Path $PSScriptRoot -Parent) "backups"),
    [string]$DatabaseUrl = $env:VEILDROP_DATABASE_URL,
    [int]$Keep = 14,
    [System.Security.SecureString]$Passphrase,
    [string]$PassphraseFile = (Join-Path $env:ProgramData "VeilDrop\backup-passphrase.bin"),
    [string]$TaskName = "VeilDrop Backup",
    [string]$At = "02:00",
    [switch]$Weekly,
    [switch]$Unregister
)

$ErrorActionPreference = "Stop"

if ($Unregister) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "[backup-schedule] removed task '$TaskName'"
    } else {
        Write-Warning "[backup-schedule] no task named '$TaskName' found"
    }
    exit 0
}

$backupScript = Join-Path $PSScriptRoot "backup.ps1"
if (-not (Test-Path -LiteralPath $backupScript)) {
    throw "backup.ps1 not found next to this script: $backupScript"
}

if (-not $Passphrase) {
    $Passphrase = Read-Host "Backup passphrase" -AsSecureString
}
if (-not $Passphrase.Length) {
    throw "empty passphrase - refusing to schedule backups"
}

# --- Persist the passphrase DPAPI-encrypted (current user only) ---
$passDir = Split-Path -Parent $PassphraseFile
New-Item -ItemType Directory -Force -Path $passDir | Out-Null
$Passphrase | ConvertFrom-SecureString | Set-Content -LiteralPath $PassphraseFile -NoNewline

$acl = New-Object System.Security.AccessControl.FileSecurity
$acl.SetOwner([System.Security.Principal.WindowsIdentity]::GetCurrent().User)
$acl.SetAccessRuleProtection($true, $false)
$acl.AddAccessRule(
    (New-Object System.Security.AccessControl.FileSystemAccessRule(
        [System.Security.Principal.WindowsIdentity]::GetCurrent().Name,
        "FullControl", "Allow")))
$acl.AddAccessRule(
    (New-Object System.Security.AccessControl.FileSystemAccessRule("SYSTEM", "FullControl", "Allow")))
Set-Acl -LiteralPath $PassphraseFile -AclObject $acl
Write-Host "[backup-schedule] passphrase stored DPAPI-encrypted at $PassphraseFile (owner-only ACL)"

# --- Build the task action ---
$args = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$backupScript`" " +
    "-OutDir `"$OutDir`" -Keep $Keep -PassphraseFile `"$PassphraseFile`""
if ($DatabaseUrl) {
    $args += " -DatabaseUrl `"$DatabaseUrl`""
}
$action = New-ScheduledTaskAction -Execute "pwsh" -Argument $args

$trigger = if ($Weekly) {
    New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday -At $At
} else {
    New-ScheduledTaskTrigger -Daily -At $At
}

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 90) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 10)

$principal = New-ScheduledTaskPrincipal `
    -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
    -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force | Out-Null

$task = Get-ScheduledTask -TaskName $TaskName
Write-Host "[backup-schedule] registered task '$TaskName'"
Write-Host "  action : pwsh -File $backupScript -OutDir $OutDir -Keep $Keep -PassphraseFile $PassphraseFile"
Write-Host "  trigger: $(if ($Weekly) { 'weekly' } else { 'daily' }) at $At"
Write-Host "  next   : $($task.NextRunTime)"
Write-Host "  verify : Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"