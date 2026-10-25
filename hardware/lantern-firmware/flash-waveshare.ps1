param(
  [Parameter(Mandatory = $true)]
  [string]$Port,
  # Refuse to write unless the connected board has this MAC (aa:bb:cc:dd:ee:ff).
  [string]$ExpectMac,
  [switch]$Monitor,
  [switch]$ManualBootloader
)

$ErrorActionPreference = "Stop"
$python = Join-Path $env:USERPROFILE ".espressif\python_env\idf5.2_py3.11_env\Scripts\python.exe"

# build-profile.ps1 resolves only the ESP32-S3 build tools, so a missing
# debugger for another target cannot block flashing.
& (Join-Path $PSScriptRoot "build-waveshare.ps1")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
# Wireless updates are accepted only from the key that signed the running app,
# so USB installs always write the signed image.
& (Join-Path $PSScriptRoot "sign-firmware.ps1")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$before = if ($ManualBootloader) { "no_reset" } else { "default_reset" }
if ($ExpectMac) {
  $identity = & $python -m esptool --chip esp32s3 -p $Port --before $before --after no_reset read_mac 2>&1 | Out-String
  if ($identity -notmatch "MAC:\s*([0-9a-f:]{17})" -or $Matches[1] -ne $ExpectMac.ToLowerInvariant()) {
    throw "Connected board is not $ExpectMac; nothing was written."
  }
}
Push-Location (Join-Path $PSScriptRoot "build-waveshare")
try {
  $images = (Get-Content -Raw "flash_args") -split "\s+" | Where-Object { $_ } |
    ForEach-Object { if ($_ -eq "lantern.bin") { "lantern.signed.bin" } else { $_ } }
  & $python -m esptool --chip esp32s3 -p $Port -b 460800 `
    --before $before --after hard_reset write_flash --verify @images
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  if ($Monitor) {
    & $python -m esp_idf_monitor -p $Port lantern.elf
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }
} finally { Pop-Location }
