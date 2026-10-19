param([switch]$Clean)
$ErrorActionPreference = "Stop"
& (Join-Path $PSScriptRoot "build-profile.ps1") -Profile "v2" -Clean:$Clean
exit $LASTEXITCODE
