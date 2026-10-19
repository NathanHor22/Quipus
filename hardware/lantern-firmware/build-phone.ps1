param([switch]$Clean)
$ErrorActionPreference = "Stop"
& (Join-Path $PSScriptRoot "build-profile.ps1") -Profile "phone" -Clean:$Clean
exit $LASTEXITCODE
