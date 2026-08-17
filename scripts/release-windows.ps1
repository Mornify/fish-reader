<#
Publish the Windows half of a release from a Windows PC.

Windows cannot be cross-compiled from macOS (Tauri needs the MSVC toolchain and
WebView2), so this runs on the Windows machine and ATTACHES to the release that
`npm run release <version>` already created from the Mac. It never creates or
retags a release, so it cannot clobber the macOS half.

    powershell -ExecutionPolicy Bypass -File scripts\release-windows.ps1 -Version 0.2.3

Prerequisites (one time):
  * Node 20+            https://nodejs.org
  * Rust (MSVC toolchain)  https://rustup.rs   → `rustup default stable-msvc`
  * Visual Studio Build Tools with "Desktop development with C++"
  * GitHub CLI, logged in:  winget install GitHub.cli ; gh auth login
  * The updater signing key copied to %USERPROFILE%\.tauri\fish-reader.key
    (copy it off the Mac by hand — do NOT paste it into a chat or a commit)
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Repo = "Mornify/fish-reader"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Fail($msg) { Write-Host "X $msg" -ForegroundColor Red; exit 1 }
function Step($msg) { Write-Host "> $msg" -ForegroundColor Cyan }

if ($Version -notmatch '^\d+\.\d+\.\d+$') { Fail "version must look like 1.2.3" }

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$keyPath = Join-Path $env:USERPROFILE ".tauri\fish-reader.key"
if (-not (Test-Path $keyPath)) {
  Fail "signing key missing at $keyPath — without it the build cannot produce an update users will accept"
}
foreach ($tool in @("node", "npm", "cargo", "gh")) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Fail "$tool is not on PATH" }
}

# The binary must match the tag, or Windows users get a build that reports a
# version the release never contained.
$conf = Get-Content "src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json
if ($conf.version -ne $Version) {
  Fail "tauri.conf.json says $($conf.version) but you asked for $Version. Check out the tag first: git checkout v$Version"
}

Step "installing dependencies"
npm ci
if ($LASTEXITCODE -ne 0) { Fail "npm ci failed" }

Step "building the signed Windows bundle"
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content $keyPath -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npm run tauri build
if ($LASTEXITCODE -ne 0) { Fail "tauri build failed" }
$env:TAURI_SIGNING_PRIVATE_KEY = $null

Step "scanning the build for credentials"
# Same guarantee as the macOS release: never publish a build containing a key.
# A Fish Audio key is 32 lowercase hex characters near an auth-ish word.
$suspect = Get-ChildItem -Recurse -File "dist", "src-tauri\target\release\bundle" -ErrorAction SilentlyContinue |
  Where-Object { $_.Extension -notin ".png", ".jpg", ".jpeg", ".ico", ".woff", ".woff2", ".map" } |
  Where-Object {
    $t = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
    $t -and ($t -cmatch '[0-9a-f]{32}') -and ($t -imatch 'api[_-]?key|authorization|bearer')
  }
if ($suspect) {
  $suspect | ForEach-Object { Write-Host "  possible credential in $($_.FullName)" -ForegroundColor Red }
  Fail "release aborted; nothing was published"
}
Write-Host "  no credentials found" -ForegroundColor Green

$nsis = "src-tauri\target\release\bundle\nsis"
$setup   = Get-ChildItem "$nsis\*-setup.exe"      -ErrorAction SilentlyContinue | Select-Object -First 1
$archive = Get-ChildItem "$nsis\*-setup.nsis.zip" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $setup)   { Fail "no NSIS installer in $nsis — is bundle.targets ['nsis'] for windows?" }
if (-not $archive) { Fail "no updater archive in $nsis — is createUpdaterArtifacts on?" }
$sig = "$($archive.FullName).sig"
if (-not (Test-Path $sig)) { Fail "updater signature missing — was TAURI_SIGNING_PRIVATE_KEY set?" }

Step "uploading to release v$Version"
gh release upload "v$Version" $setup.FullName $archive.FullName $sig --repo $Repo --clobber
if ($LASTEXITCODE -ne 0) { Fail "upload failed — does release v$Version exist?" }

Step "merging the Windows entry into latest.json"
# Merge, never overwrite: latest.json holds one entry per platform and the macOS
# entry was written from the Mac. Replacing the file would stop every Mac
# install from ever seeing an update again.
$manifestUrl = "https://github.com/$Repo/releases/download/v$Version/latest.json"
try { Invoke-WebRequest $manifestUrl -OutFile "existing.json" -UseBasicParsing } catch { }
$existingArg = if (Test-Path "existing.json") { "existing.json" } else { "-" }

$url = "https://github.com/$Repo/releases/download/v$Version/$($archive.Name)"
node scripts\merge-updater-json.mjs $existingArg "windows-x86_64" $url $sig $Version | Set-Content -Encoding utf8 "latest.json"

$merged = Get-Content "latest.json" -Raw | ConvertFrom-Json
$platforms = $merged.platforms.PSObject.Properties.Name
if ($platforms -notcontains "windows-x86_64") { Fail "merge produced no windows entry" }
Write-Host "  manifest platforms: $($platforms -join ', ')" -ForegroundColor Green

gh release upload "v$Version" "latest.json" --repo $Repo --clobber
if ($LASTEXITCODE -ne 0) { Fail "manifest upload failed" }

Remove-Item "existing.json", "latest.json" -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Done. v$Version now has a Windows installer, and Windows installs will auto-update." -ForegroundColor Green
Write-Host "Note: the installer is UNSIGNED (no code-signing certificate), so SmartScreen"
Write-Host "will warn on first run: More info -> Run anyway."
