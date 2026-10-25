param(
  [ValidateSet("original", "v2", "phone", "waveshare")]
  [string]$Profile = "v2",
  [switch]$Clean,
  # Waveshare release builds for wireless updates, e.g. -Version 0.13.1-quipus.
  # Each version builds in build-v<x.y.z> (bench: build-v<x.y.z>b); sign it with
  # sign-firmware.ps1 -Build.
  [string]$Version,
  # Bench only: the image fails its first-boot check to prove rollback.
  [switch]$BenchRollback
)

$ErrorActionPreference = "Stop"
$firmwareRoot = $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $firmwareRoot "..\..")).Path
$idfRoot = Join-Path $repoRoot ".tools\esp-idf"
$toolRoot = Join-Path $env:USERPROFILE ".espressif"
$pythonRoot = Join-Path $toolRoot "python_env\idf5.2_py3.11_env"
if (-not (Test-Path -LiteralPath (Join-Path $idfRoot "tools\idf.py"))) {
  throw "Install ESP-IDF v5.2.3 in .tools/esp-idf before building."
}
$env:IDF_PATH = $idfRoot
$env:IDF_TOOLS_PATH = $toolRoot
$env:IDF_PYTHON_ENV_PATH = $pythonRoot
$env:PATH = (Join-Path $pythonRoot "Scripts") + ";" + $env:PATH
# Building needs the compiler, CMake and Ninja, not unrelated targets' debuggers.
# Resolve their installed paths explicitly so a missing RISC-V GDB cannot block
# this ESP32-S3-only build. No global IDF installation state is modified.
foreach ($entry in @(
  @{ directory = "tools\xtensa-esp-elf"; executable = "xtensa-esp32s3-elf-gcc.exe" },
  @{ directory = "tools\cmake"; executable = "cmake.exe" },
  @{ directory = "tools\ninja"; executable = "ninja.exe" }
)) {
  $binary = Get-ChildItem -LiteralPath (Join-Path $toolRoot $entry.directory) -Recurse -Filter $entry.executable | Select-Object -First 1
  if (-not $binary) { throw "Missing build tool: $($entry.executable)" }
  $env:PATH = $binary.DirectoryName + ";" + $env:PATH
}
$profiles = @{
  original = @{ build = "build"; config = "sdkconfig"; defaults = "sdkconfig.defaults" }
  v2 = @{ build = "build-v2"; config = "sdkconfig.v2"; defaults = "sdkconfig.v2.defaults" }
  phone = @{ build = "build-phone"; config = "sdkconfig.phone"; defaults = "sdkconfig.v2.defaults;sdkconfig.phone-audio.defaults" }
  waveshare = @{ build = "build-waveshare"; config = "sdkconfig.waveshare"; defaults = "sdkconfig.waveshare.defaults" }
}
$selected = $profiles[$Profile]
if ($BenchRollback -and -not $Version) { throw "-BenchRollback needs -Version." }
if ($Version) {
  if ($Profile -ne "waveshare") { throw "-Version is only supported for the waveshare profile." }
  if ($Version -cnotmatch '^\d{1,5}\.\d{1,5}\.\d{1,5}(-[a-z0-9-]+)?$') { throw "Version must look like 0.13.1-quipus." }
  # Short folder names keep ESP-IDF object paths under Windows' 260-character limit.
  $numbers = ($Version -split "-")[0]
  $suffix = if ($BenchRollback) { "$($numbers)b" } else { $numbers }
  $buildFolder = "build-v$suffix"
  New-Item -ItemType Directory -Force -Path (Join-Path $firmwareRoot $buildFolder) | Out-Null
  $versionDefaults = Join-Path (Join-Path $firmwareRoot $buildFolder) "version.defaults"
  $lines = @("CONFIG_QUIPUS_FIRMWARE_VERSION_CUSTOM=y", "CONFIG_QUIPUS_FIRMWARE_VERSION=`"$Version`"")
  if ($BenchRollback) { $lines += "CONFIG_QUIPUS_OTA_BENCH_FAIL_NEW_IMAGE=y" }
  Set-Content -LiteralPath $versionDefaults -Value $lines -Encoding ascii
  $selected = @{ build = $buildFolder; config = "sdkconfig.release-$suffix"; defaults = "sdkconfig.waveshare.defaults;$versionDefaults" }
}
$env:IDF_CCACHE_ENABLE = "0"
$env:ESP_IDF_VERSION = "5.2.3"
Push-Location $firmwareRoot
try {
  $arguments = @("-B", $selected.build, "-D", "IDF_TARGET=esp32s3", "-D", "SDKCONFIG=$($selected.config)", "-D", "SDKCONFIG_DEFAULTS=$($selected.defaults)")
  if ($Clean) {
    $buildPath = [IO.Path]::GetFullPath((Join-Path $firmwareRoot $selected.build))
    $allowedPrefix = [IO.Path]::GetFullPath($firmwareRoot).TrimEnd('\') + '\'
    if (-not $buildPath.StartsWith($allowedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Build directory escaped the firmware workspace."
    }
    if (Test-Path -LiteralPath $buildPath) {
      if ((Get-Item -LiteralPath $buildPath).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Refusing to clean a linked build directory."
      }
      & (Join-Path $pythonRoot "Scripts\python.exe") (Join-Path $idfRoot "tools\idf.py") @arguments fullclean
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
  }
  & (Join-Path $pythonRoot "Scripts\python.exe") (Join-Path $idfRoot "tools\idf.py") @arguments build
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally { Pop-Location }
