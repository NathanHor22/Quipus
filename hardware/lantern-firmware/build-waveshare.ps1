param([switch]$Clean)

& (Join-Path $PSScriptRoot "build-profile.ps1") -Profile waveshare -Clean:$Clean
exit $LASTEXITCODE
