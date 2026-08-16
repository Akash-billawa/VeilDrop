#requires -Version 7
<#
.SYNOPSIS
  Timestamped, encrypted logical backup of the VeilDrop PostgreSQL database.
.DESCRIPTION
  Runs pg_dump -Fc, encrypts the dump with GPG (AES-256), writes a SHA-256
  manifest, and prunes old dumps (keep N by default). Passphrase is read via
  -Passphrase, loaded from -PassphraseFile, or prompted; never written to disk
  in clear text.
.EXAMPLE
  .\scripts\backup.ps1 -OutDir .\backups
.EXAMPLE
  .\scripts\backup.ps1 -OutDir .\backups -PassphraseFile C:\ProgramData\VeilDrop\backup-passphrase.bin
.PARAMETER OutDir
  Directory for dumps + manifest. Created if missing.
.PARAMETER DatabaseUrl
  Full postgresql:// URL. Defaults to VEILDROP_DATABASE_URL or local defaults.
.PARAMETER Keep
  Number of encrypted dumps to retain. Default 14.
.PARAMETER Passphrase
  SecureString used for GPG symmetric encryption. Prompted if omitted.
.PARAMETER PassphraseFile
  Path to a DPAPI-encrypted SecureString blob (written by
  scripts/backup-schedule.ps1). Used when the task cannot prompt. Takes
  precedence over prompting but -Passphrase wins if both are given.
#>

[CmdletBinding()]
param(
    [string]$OutDir = (Join-Path (Split-Path $PSScriptRoot -Parent) "backups"),
    [string]$DatabaseUrl = $env:VEILDROP_DATABASE_URL,
    [int]$Keep = 14,
    [System.Security.SecureString]$Passphrase,
    [string]$PassphraseFile
)

$ErrorActionPreference = "Stop"

if (-not $Passphrase -and $PassphraseFile) {
    if (-not (Test-Path -LiteralPath $PassphraseFile)) {
        throw "PassphraseFile not found: $PassphraseFile"
    }
    $Passphrase = Get-Content -LiteralPath $PassphraseFile -Raw | ConvertTo-SecureString
    Write-Verbose "[backup] passphrase loaded from $PassphraseFile"
}
if (-not $Passphrase) {
    $Passphrase = Read-Host "Backup passphrase" -AsSecureString
}
if (-not $DatabaseUrl) {
    $DatabaseUrl = "postgresql://veildrop:veildrop@localhost:5432/veildrop"
}

$uri = [System.Uri]::new($DatabaseUrl)
$db = $uri.AbsolutePath.TrimStart("/")
$hostName = $uri.Host
$port = $uri.Port
$user = $uri.UserInfo.Split(":")[0]

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$rawDump = Join-Path $OutDir "veildrop-$stamp.dump"
$encDump = "$rawDump.gpg"
$manifest = Join-Path $OutDir "MANIFEST.txt"

Write-Host "[backup] dumping $db @ $hostName`:$port (user $user) ..."
if ($env:PGPASSWORD -and $uri.UserInfo) {
    Write-Warning "PGPASSWORD env set overrides the URL password; using PGPASSWORD."
}
$env:PGPASSWORD = [System.Net.WebUtility]::UrlDecode($uri.UserInfo.Split(":", 2)[1])
& pg_dump -h $hostName -p $port -U $user -d $db -Fc -f $rawDump
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed with exit code $LASTEXITCODE" }

$ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Passphrase)
try {
    $passText = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}

Write-Host "[backup] encrypting with GPG AES-256 ..."
& gpg --batch --yes --pinentry-mode loopback --passphrase $passText `
    --symmetric --cipher-algo AES256 -o $encDump $rawDump
if ($LASTEXITCODE -ne 0) { throw "gpg encryption failed with exit code $LASTEXITCODE" }

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $encDump).Hash.ToLowerInvariant()
$line = "$stamp`t$((Get-Item $encDump).Length) bytes`tsha256=$hash`t$([DateTime]::UtcNow.ToString('o'))"
Add-Content -Path $manifest -Value $line
Remove-Item -LiteralPath $rawDump -Force

Write-Host "[backup] done: $encDump"
Write-Host "[backup] manifest line: $line"

$all = Get-ChildItem -LiteralPath $OutDir -Filter "veildrop-*.dump.gpg" | Sort-Object Name
$excess = $all | Select-Object -Skip $Keep
foreach ($old in $excess) {
    Write-Host "[backup] pruning $($old.Name)"
    Remove-Item -LiteralPath $old.FullName -Force
}
