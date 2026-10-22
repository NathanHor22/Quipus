param(
  [Parameter(Mandatory = $true)]
  [string]$Port,
  [switch]$Monitor,
  [switch]$ManualBootloader
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$env:IDF_PATH = Join-Path $repoRoot ".tools\esp-idf"
$env:IDF_TOOLS_PATH = Join-Path $env:USERPROFILE ".espressif"
$env:IDF_PYTHON_ENV_PATH = Join-Path $env:IDF_TOOLS_PATH "python_env\idf5.2_py3.11_env"
$env:PATH = (Join-Path $env:IDF_PYTHON_ENV_PATH "Scripts") + ";" + $env:PATH
. (Join-Path $env:IDF_PATH "export.ps1")

Push-Location $PSScriptRoot
try {
  $arguments = @(
    "-B", "build-waveshare",
    "-D", "IDF_TARGET=esp32s3",
    "-D", "SDKCONFIG=sdkconfig.waveshare",
    "-D", "SDKCONFIG_DEFAULTS=sdkconfig.waveshare.defaults"
  )
  if ($ManualBootloader) {
    idf.py @arguments build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Push-Location (Join-Path $PSScriptRoot "build-waveshare")
    try {
      python -m esptool --chip esp32s3 -p $Port -b 460800 `
        --before no_reset --after hard_reset write_flash "@flash_args"
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally { Pop-Location }
    if ($Monitor) {
      idf.py @arguments -p $Port monitor
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
  } else {
    $arguments += @("-p", $Port, "flash")
    if ($Monitor) { $arguments += "monitor" }
    idf.py @arguments
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }
} finally { Pop-Location }
