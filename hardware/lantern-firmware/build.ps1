param([switch]$Clean)
$ErrorActionPreference = "Stop"
& (Join-Path $PSScriptRoot "build-profile.ps1") -Profile "original" -Clean:$Clean
exit $LASTEXITCODE
