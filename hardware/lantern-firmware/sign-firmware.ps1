param(
  # Kept outside the repository. Back it up offline: recorders accept wireless
  # updates only from the key that signed their running firmware.
  [string]$Key = (Join-Path $env:USERPROFILE ".quipus\firmware-signing-key.pem"),
  [string]$Build = "build-waveshare",
  [switch]$NewKey
)

$ErrorActionPreference = "Stop"
$python = Join-Path $env:USERPROFILE ".espressif\python_env\idf5.2_py3.11_env\Scripts\python.exe"
$buildPath = Join-Path $PSScriptRoot $Build
$unsigned = Join-Path $buildPath "lantern.bin"
$signed = Join-Path $buildPath "lantern.signed.bin"
if (-not (Test-Path -LiteralPath $unsigned)) { throw "Build the firmware first: $unsigned is missing." }

if (Test-Path -LiteralPath $Key) {
  if ($NewKey) { throw "A signing key already exists at $Key; refusing to replace it." }
} else {
  if (-not $NewKey) {
    throw "No signing key at $Key. Run once with -NewKey to create one, then back it up offline."
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Key) | Out-Null
  & $python -m espsecure generate_signing_key --version 2 --scheme rsa3072 $Key
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  # Only the current Windows user may read the private key.
  icacls $Key /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
  Write-Host "Created signing key at $Key. Back it up offline now."
}

& $python -m espsecure sign_data --version 2 --keyfile $Key --output $signed $unsigned
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $python -m espsecure verify_signature --version 2 --keyfile $Key $signed
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $signed).Hash.ToLowerInvariant()
Write-Host "Signed image: $signed"
Write-Host "Bytes: $((Get-Item -LiteralPath $signed).Length)  SHA-256: $hash"
